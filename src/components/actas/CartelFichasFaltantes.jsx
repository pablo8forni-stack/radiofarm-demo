import { useEffect, useMemo, useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Modal } from "../ui/Modal.jsx";
import { Sel } from "../ui/Sel.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { calcularHuecos, calcularFichasSospechosas, formatearListaFichas } from "../../helpers/huecosFicha.js";
import { FRASES_MOTIVACIONALES } from "../../constants/frasesMotivacionales.js";
import { listenFichasUsadasRecientes, listenFichasDescartadas, descartarFicha, deshacerDescarte } from "../../services/firestore/fichasDescartadas.js";

// Hora del DISPOSITIVO a propósito (no hay hora de servidor confiable sin
// agregar infraestructura nueva -- ver diagnóstico, 4/10): mismo criterio
// que ya usa el resto de la app (hoy(), detección de atraso de ficha,
// "marcados hoy" en Libro 1). Ventana única desde las 13:00 en adelante,
// sin corte a las 19:00 (queda cubierta por ser posterior). Sólo gatea el
// CARTEL de huecos/motivacional (Pablo, confirmado A) -- el aviso de ficha
// sospechosa es independiente, se ve todo el día (ver más abajo).
const MINUTOS_INICIO = 13 * 60;

function pasoElHorario() {
  const ahora = new Date();
  return ahora.getHours() * 60 + ahora.getMinutes() >= MINUTOS_INICIO;
}

// Cartel de fichas faltantes + aviso de ficha sospechosa (Libro 2) -- N° de
// Ficha de VM RIS, correlativo por sede. Un hueco se reclama mientras la
// ficha activa inmediatamente superior tenga menos de 48hs (ver
// helpers/huecosFicha.js). Visible para cualquier usuario de la sede; sólo
// admin ve "Descartar"/auditoría.
//
// Costo (medido con datos reales de producción, única sede activa hoy):
// el listener de fichasUsadas/fichasDescartadas arranca al MONTAR (no a
// las 13:00) -- confirmado con Pablo (punto B, 2026-10): el aviso de ficha
// sospechosa tiene que verse todo el día, así que no hay forma de demorar
// el listener sin perder esa cobertura. Esto reemplaza el diseño anterior
// (activación a las 13:00) -- sigue siendo una fracción chica (~50-220
// lecturas por apertura) de las ~1350 que Libro 2 ya paga con sus 9
// listeners existentes, sólo que ahora arranca más temprano en el día.
// anulacionesRaw: el array CRUDO (no el Map por anulaId) -- mismo dato que
// ya trae anulacionesRaw en TabPacientes.jsx (listenAnulacionesActas, sin
// límite, reutilizado acá sin costo marginal -- ver diagnóstico, punto 4a).
export function CartelFichasFaltantes({ sedeId, esAdmin, usuario, anulacionesRaw, onToast }) {
  const [activo, setActivo] = useState(pasoElHorario());
  useEffect(() => {
    if (activo) return;
    const id = setInterval(() => { if (pasoElHorario()) setActivo(true); }, 60000);
    return () => clearInterval(id);
  }, [activo]);

  const [fichasUsadas, setFichasUsadas] = useState([]);
  const [fichasDescartadas, setFichasDescartadas] = useState([]);
  useEffect(() => { if (sedeId) return listenFichasUsadasRecientes(sedeId, setFichasUsadas); }, [sedeId]);
  useEffect(() => { if (sedeId) return listenFichasDescartadas(sedeId, setFichasDescartadas); }, [sedeId]);

  const [mDescartar, setMDescartar] = useState(false);
  const [numeroElegido, setNumeroElegido] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mAuditoria, setMAuditoria] = useState(false);

  const { huecos, saltosGrandes } = useMemo(
    () => (activo ? calcularHuecos(fichasUsadas, anulacionesRaw, fichasDescartadas, sedeId, new Date()) : { huecos: [], saltosGrandes: [] }),
    [activo, fichasUsadas, anulacionesRaw, fichasDescartadas, sedeId]
  );

  // Siempre activo (no gateado por "activo"/13:00) -- vence solo a las
  // 48hs (ver helpers/huecosFicha.js), que es la única forma de que un
  // falso positivo no quede visible para siempre sin pedirle a nadie que
  // anule un registro válido sólo para "limpiar" el aviso.
  const sospechosas = useMemo(
    () => calcularFichasSospechosas(fichasUsadas, anulacionesRaw, sedeId, new Date()),
    [fichasUsadas, anulacionesRaw, sedeId]
  );

  // Rota por día (no aleatorio en cada render -- se mantiene estable
  // mientras la pantalla queda abierta, no "parpadea" entre frases).
  const frase = useMemo(() => {
    const dia = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    return FRASES_MOTIVACIONALES[dia % FRASES_MOTIVACIONALES.length];
  }, []);

  function abrirDescartar() {
    setNumeroElegido(String(huecos[0] ?? ""));
    setMotivo("");
    setMDescartar(true);
  }

  async function confirmarDescarte() {
    if (!numeroElegido || !motivo.trim()) return;
    setGuardando(true);
    try {
      await descartarFicha({ sedeId, numero: numeroElegido, motivo: motivo.trim(), usuario });
      onToast("Ficha descartada -- deja de reclamarse en el cartel");
      setMDescartar(false); setMotivo("");
    } catch (e) {
      onToast(e.message || "No se pudo descartar la ficha", "error");
    } finally {
      setGuardando(false);
    }
  }

  async function deshacer(descarte) {
    try {
      await deshacerDescarte(descarte, "Descarte deshecho -- corrección de un error", usuario);
      onToast("Descarte deshecho. Si la ficha sigue sin cargarse, vuelve a reclamarse en el cartel.", "info", 8000);
    } catch (e) {
      onToast(e.message || "No se pudo deshacer el descarte", "error");
    }
  }

  // Un descarte "vigente" no tiene su anula_descarte_ correspondiente --
  // mismo criterio que calcularHuecos, repetido acá sólo para la vista de
  // auditoría (quién/cuándo/motivo de TODOS, vigentes y deshechos).
  const idsDescarteAnulados = useMemo(
    () => new Set((anulacionesRaw || []).map((a) => a.anulaId).filter((id) => typeof id === "string" && id.startsWith("descarte_"))),
    [anulacionesRaw]
  );
  const descartesOrdenados = useMemo(
    () => [...fichasDescartadas]
      .filter((d) => d.sedeId === sedeId)
      .sort((a, b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0)),
    [fichasDescartadas, sedeId]
  );

  if (!activo && sospechosas.length === 0) return null;

  return (
    <>
      {/* Aviso de ficha sospechosa -- otro color (rojo), sin nombres de
          personas, visible todo el día (no espera a las 13:00). Texto
          literal pedido por Pablo: nunca sugiere anular -- esa es una
          decisión de quien confirme que está mal, no del cartel. */}
      {sospechosas.map((n) => (
        <div key={n} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          La ficha {n} parece mal tipeada: se aleja mucho de las demás. Revisá el número.
        </div>
      ))}

      {activo && (
        huecos.length > 0 || saltosGrandes.length > 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                {huecos.length > 0 && (
                  <span className="text-sm text-amber-800 font-semibold">
                    Falta{huecos.length > 1 ? "n" : ""} cargar la{huecos.length > 1 ? "s" : ""} ficha{huecos.length > 1 ? "s" : ""} {formatearListaFichas(huecos)}
                  </span>
                )}
                {saltosGrandes.map((s) => (
                  <span key={`${s.inferior}-${s.superior}`} className="text-sm text-amber-800 font-semibold">
                    Hay un salto grande entre las fichas {s.inferior} e {s.superior}: revisar.
                  </span>
                ))}
              </div>
              {esAdmin && (
                <div className="flex gap-2">
                  <Btn size="sm" variant="outline" onClick={() => setMAuditoria(true)}>Fichas descartadas</Btn>
                  {huecos.length > 0 && <Btn size="sm" variant="outline" onClick={abrirDescartar}>Descartar una ficha</Btn>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-blue-700">{frase}</span>
            {esAdmin && (
              <Btn size="sm" variant="outline" onClick={() => setMAuditoria(true)}>Fichas descartadas</Btn>
            )}
          </div>
        )
      )}

      <Modal open={mDescartar} title="Descartar ficha salteada" onClose={() => setMDescartar(false)} size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Confirmá que esta ficha fue salteada por VM RIS (muy poco frecuente) -- deja de reclamarse en el cartel, sin afectar la carga normal si el paciente aparece después.
          </p>
          <Sel label="N° de Ficha" value={numeroElegido} onChange={(e) => setNumeroElegido(e.target.value)}>
            {huecos.map((n) => <option key={n} value={n}>{n}</option>)}
          </Sel>
          <Input label="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: confirmado con guardia, VM RIS salteó el número" />
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMDescartar(false)} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={confirmarDescarte} disabled={guardando || !numeroElegido || !motivo.trim()}>
              {guardando ? "Guardando..." : "Descartar"}
            </Btn>
          </div>
        </div>
      </Modal>

      <Modal open={mAuditoria} title="Fichas descartadas" onClose={() => setMAuditoria(false)} size="lg">
        <div className="flex flex-col divide-y divide-gray-100">
          {descartesOrdenados.map((d) => {
            const anulaId = `descarte_${d.sedeId}_${d.numero}_${d.intentoNro}`;
            const deshecho = idsDescarteAnulados.has(anulaId);
            return (
              <div key={d.id} className="py-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-gray-800">Ficha {d.numero}</span>
                  <Badge color={deshecho ? "gray" : "orange"}>{deshecho ? "Deshecho" : "Vigente"}</Badge>
                </div>
                <div className="text-xs text-gray-500">{fmtTs(d.fecha)} · {d.usuarioNombre}</div>
                <div className="text-xs text-gray-600 italic">{d.motivo}</div>
                {!deshecho && esAdmin && (
                  <div className="flex justify-end">
                    <button onClick={() => deshacer(d)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                      Deshacer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {descartesOrdenados.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">Sin fichas descartadas en esta sede.</div>
          )}
        </div>
      </Modal>
    </>
  );
}
