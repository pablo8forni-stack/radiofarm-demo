import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { addMibgLote, listenMibgLotes } from "../../services/firestore/mibgLotes.js";
import { estadoMibgLote } from "../../helpers/mibgLote.js";

const VACIO = { numeroLote: "", proveedor: "", actividadCalibrada: "", volumen: "", fechaHoraCalibracion: "", fechaVencimiento: "", conformidad: null, obs: "" };

const ESTADO_LOTE = {
  disponible: { label: "Disponible", color: "green" },
  usado: { label: "Usado", color: "gray" },
  anulado: { label: "Anulado", color: "red" },
};

// Qué tipo de acta "usa" un lote de dosis única, y en qué campo queda el
// vínculo -- distinto según isótopo porque MIBG ya estaba en producción con
// su propio namespace (tipo i131_mibg, campo mibgLoteId) cuando se agregó
// Lutecio-177 (que reusa el 'paciente' de siempre, campo loteDosisUnicaId,
// ver TabPacientes.jsx). Ver administrarLoteDosisUnicaTransaction en
// mibgLotes.js -- misma asimetría, mismo motivo.
const TIPO_USO = { mibg: "i131_mibg", lutecio177: "paciente" };
const CAMPO_LOTE_ID = { mibg: "mibgLoteId", lutecio177: "loteDosisUnicaId" };

// Lote de dosis única -- componente COMPARTIDO entre "Gestión I-131 > MIBG"
// (isotopoId="mibg") y "Actas ARN > Libro 4 — Lutecio-177"
// (isotopoId="lutecio177"): mismo modelo de datos y mismos principios
// (create-only, sin curva de decaimiento ni balance HAY/SACADO/QUEDAN --
// cada vial es una dosis completa para un único paciente, se administra al
// llegar), pero DOS pestañas separadas y visualmente distintas a propósito
// -- I-131 y Lutecio-177 nunca deben mezclarse en la navegación aunque
// compartan la colección mibg_lote por debajo (nombre histórico, ver nota en
// mibgLotes.js). Abierta a CUALQUIER técnico (sin accesoTerapiaI131/
// accesoAgendaI131). "Disponible" se deriva acá mismo (nunca se guarda un
// contador): un lote deja de estarlo apenas existe un acta no anulada que lo
// usa, o si el lote mismo se anula -- ambos vía listeners en vivo, nunca
// queda "vencido" por refrescar la pantalla.
export function TabLoteDosisUnica({ catalogo, usuario, esAdmin, onToast, isotopoId, titulo, descripcion, placeholderLote, onIrALibro2 }) {
  const [lotesTodos, setLotesTodos] = useState([]);
  const [usosRaw, setUsosRaw] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [loteBloqueado, setLoteBloqueado] = useState(null);
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => listenMibgLotes(setLotesTodos, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas(TIPO_USO[isotopoId], setUsosRaw, { esAdmin, sedeId: usuario.sede }), [isotopoId]);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // Filtro por isótopo SIEMPRE client-side (nunca en la query) -- ver nota en
  // mibgLotes.js#listenMibgLotes: los lotes de MIBG ya en producción no
  // tienen isotopoId, y se interpretan como 'mibg' por ausencia.
  const lotes = useMemo(() => lotesTodos.filter((l) => (l.isotopoId || "mibg") === isotopoId), [lotesTodos, isotopoId]);
  // 'paciente' trae los 3 isótopos mezclados (tc99m/lu177/i131) -- para
  // Lutecio-177 hay que filtrar además por isotopoId=='lu177' antes de armar
  // el mapa de usos (para MIBG, TIPO_USO ya scopeó la consulta a i131_mibg
  // exclusivamente, no hace falta filtrar de nuevo).
  // !anulaciones.has(u.id): un uso anulado no cuenta como "usado" -- anular
  // la administración es independiente de anular el lote (ver
  // helpers/mibgLote.js), así que el lote vuelve a "disponible" apenas se
  // anula la acta que lo usaba.
  const usos = useMemo(
    () => (isotopoId === "lutecio177" ? usosRaw.filter((u) => u.isotopoId === "lu177" && u.loteDosisUnicaId && !anulaciones.has(u.id)) : usosRaw.filter((u) => !anulaciones.has(u.id))),
    [usosRaw, isotopoId, anulaciones]
  );
  const usoPorLoteId = useMemo(() => new Map(usos.map((u) => [u[CAMPO_LOTE_ID[isotopoId]], u])), [usos, isotopoId]);

  function estadoDe(lote) {
    return estadoMibgLote(lote.id, { anulaciones, usoPorLoteId });
  }

  const lotesFiltrados = useMemo(
    () => lotes.filter((l) => !filtroSede || l.sedeId === filtroSede)
      .sort((a, b) => (b.fecha?.toDate?.() ?? new Date(b.fecha)) - (a.fecha?.toDate?.() ?? new Date(a.fecha))),
    [lotes, filtroSede]
  );

  // Doble chequeo con usoPorLoteId (además del gate en el botón "Anular" más
  // abajo): la regla server-side es la garantía real, esto es sólo para un
  // mensaje amigable si el estado cambió mientras el modal estaba abierto
  // (alguien administró el lote en el ínterin) -- usoPorLoteId es reactivo
  // (listener en vivo), así que ya refleja ese cambio para cuando se confirma.
  async function confirmarAnulacion(lote, motivo) {
    const uso = usoPorLoteId.get(lote.id);
    if (uso) {
      onToast(`Este lote tiene una administración activa (Paciente: ${uso.pacienteNombre}, ${fmtTs(uso.fecha)}) -- anulá primero ese registro en Libro 2.`, "error", 8000);
      setMAnular(null);
      return;
    }
    try {
      await anularActaTransaction(lote, motivo, usuario);
      onToast("Lote anulado", "info", 6000);
      setMAnular(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function pedirAnulacion(lote) {
    const uso = usoPorLoteId.get(lote.id);
    if (uso) { setLoteBloqueado({ lote, uso }); return; }
    setMAnular(lote);
  }

  async function guardar() {
    if (!form.numeroLote.trim() || !form.proveedor.trim() || !form.actividadCalibrada || !form.volumen || !form.fechaHoraCalibracion || !form.fechaVencimiento) return;
    if (form.conformidad === null) return;
    if (!form.conformidad && !form.obs.trim()) return;
    setGuardando(true);
    try {
      await addMibgLote({
        sedeId: usuario.sede, sedeNombre: catalogo.sedes[usuario.sede]?.nombre,
        isotopoId, numeroLote: form.numeroLote.trim(), proveedor: form.proveedor.trim(),
        actividadCalibrada: parseFloat(form.actividadCalibrada) || 0,
        volumen: parseFloat(form.volumen) || 0,
        fechaHoraCalibracion: new Date(form.fechaHoraCalibracion),
        fechaVencimiento: form.fechaVencimiento,
        conformidad: form.conformidad,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: form.obs.trim(),
      });
      onToast("Lote registrado");
      setMostrarForm(false);
      setForm(VACIO);
    } catch (e) {
      onToast(e.message || "No se pudo registrar el lote", "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        {descripcion}
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {esAdmin ? (
          <div className="w-full md:w-auto">
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          </div>
        ) : <div />}
        <Btn size="sm" onClick={() => setMostrarForm(true)} className="w-full md:w-auto">+ Registrar lote nuevo</Btn>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">Nuevo lote de {titulo}</h3>
            <button onClick={() => setMostrarForm(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="N° de lote" value={form.numeroLote} onChange={(e) => setForm((f) => ({ ...f, numeroLote: e.target.value }))} placeholder={placeholderLote} />
            <Input label="Proveedor" value={form.proveedor} onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value }))} placeholder="Ej: IPEN" />
            <Input label="Actividad calibrada (mCi)" type="number" min={0} step={0.1} value={form.actividadCalibrada} onChange={(e) => setForm((f) => ({ ...f, actividadCalibrada: e.target.value }))} placeholder="150" />
            <Input label="Volumen (mL)" type="number" min={0} step={0.1} value={form.volumen} onChange={(e) => setForm((f) => ({ ...f, volumen: e.target.value }))} placeholder="10" />
            <Input label="Fecha/hora de calibración" type="datetime-local" value={form.fechaHoraCalibracion} onChange={(e) => setForm((f) => ({ ...f, fechaHoraCalibracion: e.target.value }))} />
            <Input label="Fecha de vencimiento" type="date" value={form.fechaVencimiento} onChange={(e) => setForm((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">¿Lo recibido coincide con lo pedido?</label>
            <div className="flex gap-2">
              <Btn size="sm" variant={form.conformidad === true ? "primary" : "outline"} onClick={() => setForm((f) => ({ ...f, conformidad: true }))}>Sí, conforme</Btn>
              <Btn size="sm" variant={form.conformidad === false ? "danger" : "outline"} onClick={() => setForm((f) => ({ ...f, conformidad: false }))}>No conforme</Btn>
            </div>
          </div>
          <Input
            label={`Observación${form.conformidad === false ? " (obligatoria -- detallá la no conformidad)" : " (opcional)"}`}
            value={form.obs} onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))}
          />
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMostrarForm(false)} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={
              guardando || !form.numeroLote.trim() || !form.proveedor.trim() || !form.actividadCalibrada || !form.volumen ||
              !form.fechaHoraCalibracion || !form.fechaVencimiento || form.conformidad === null || (!form.conformidad && !form.obs.trim())
            }>
              {guardando ? "Guardando..." : "Guardar lote"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Lotes de {titulo}</span>
          <Badge color="blue">{lotesFiltrados.length}</Badge>
        </div>
        <div className="divide-y divide-gray-50">
          {lotesFiltrados.map((l) => {
            const estado = ESTADO_LOTE[estadoDe(l)];
            const anulacion = anulaciones.get(l.id);
            const uso = usoPorLoteId.get(l.id);
            return (
              <div key={l.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-semibold text-gray-800">{l.numeroLote}</div>
                  <Badge color={estado.color}>{estado.label}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {fmtTs(l.fecha)} · {l.sedeNombre} · Proveedor: {l.proveedor}
                </div>
                <div className="text-xs text-gray-700">
                  {l.actividadCalibrada} mCi en {l.volumen} mL · Calibrado {fmtTs(l.fechaHoraCalibracion)} · Vence {fmtF(l.fechaVencimiento)}
                </div>
                {l.conformidad === false && <div className="text-xs text-red-600 font-semibold">No conforme</div>}
                {uso && <div className="text-xs text-gray-500">Usado en: Ficha {uso.pacienteFicha || "—"} · {uso.pacienteNombre} · {fmtTs(uso.fecha)}</div>}
                {l.observacion && <div className="text-xs text-gray-400 italic">{l.observacion}</div>}
                {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
                <div className="text-xs text-gray-400">{l.usuarioNombre}</div>
                {esAdmin && estadoDe(l) !== "anulado" && (
                  <div className="flex justify-end mt-0.5">
                    <button onClick={() => pedirAnulacion(l)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                      Anular
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {lotesFiltrados.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">Sin lotes de {titulo} registrados todavía.</div>
          )}
        </div>
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`Lote ${mAnular.numeroLote} — ${mAnular.actividadCalibrada} mCi`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}

      {/* Bloqueo de anulación con administración activa (ver
          firestore.rules#loteTieneAdministracionActiva): el paciente no
          puede quedar apuntando a un lote inválido -- primero hay que anular
          esa administración en Libro 2, con el atajo de abajo para no tener
          que buscarla a mano. */}
      {loteBloqueado && (
        <Modal open title="No se puede anular" onClose={() => setLoteBloqueado(null)} size="sm">
          <div className="flex flex-col gap-4">
            <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
              Este lote tiene una administración activa -- Paciente: <span className="font-bold">{loteBloqueado.uso.pacienteNombre}</span>, {fmtTs(loteBloqueado.uso.fecha)}. Anulá primero ese registro en Libro 2 antes de poder corregir el lote.
            </div>
            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={() => setLoteBloqueado(null)}>Cerrar</Btn>
              {onIrALibro2 && (
                <Btn onClick={() => {
                  onIrALibro2("pacientes", { busqueda: loteBloqueado.uso.pacienteDni });
                  setLoteBloqueado(null);
                }}>
                  Ir a Libro 2
                </Btn>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
