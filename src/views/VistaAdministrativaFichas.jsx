import { useEffect, useMemo, useRef, useState } from "react";
import { CartelFichasFaltantes } from "../components/actas/CartelFichasFaltantes.jsx";
import { ModalEmitirFicha } from "../components/actas/ModalEmitirFicha.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Btn } from "../components/ui/Btn.jsx";
import { Input } from "../components/ui/Input.jsx";
import { listenAnulacionesActas } from "../services/firestore/actas.js";
import { listenFichasUsadasRecientes, listenFichasDescartadas } from "../services/firestore/fichasDescartadas.js";
import { idsFichaAnulados, calcularHuecos, huecosYaAnulados } from "../helpers/huecosFicha.js";
import {
  listenEmisionesFicha, listenEmisionesResueltas, listenFichaUsadaEstado,
  calcularFichaIntentoObservado, liberarEmisionStandalone,
} from "../services/firestore/emisionesFicha.js";
import { normalizarDocumento } from "../helpers/documento.js";

const MOTIVO_LIBERAR_TOPE = 300;

// Fase 2.1a -- estado de una fila: cruza la emisión, su resolución (si la
// hay) y el estado real de fichasUsadas (vigente/anulado + DNI) para esa
// misma ficha. "cargada" acá es SIEMPRE el cruce de respaldo (acta vigente
// con el mismo DNI) -- "cargada_con_correccion" es Fase 2.2, no se escribe
// desde esta pantalla, pero si existiera (dato de otra fuente) se muestra
// igual como "Cargada" en vez de romper.
function estadoDeFila(emision, resuelta, fichaEstado) {
  if (resuelta) {
    if (resuelta.estado === "liberada") return { tipo: "liberada", color: "gray", texto: "Liberada", motivo: resuelta.motivo };
    if (resuelta.estado === "cargada" || resuelta.estado === "cargada_con_correccion") return { tipo: "cargada", color: "green", texto: "Cargada" };
    return { tipo: resuelta.estado, color: "gray", texto: resuelta.estado };
  }
  if (!fichaEstado) return { tipo: "verificando", color: "gray", texto: "Verificando..." };
  if (!fichaEstado.vigente) return { tipo: "pendiente", color: "red", texto: "Pendiente" };
  // Comparación normalizada en los dos lados -- fichaEstado.dni ya viene
  // normalizado desde listenFichaUsadaEstado, pero emision.dni puede ser
  // de una emisión creada antes de este ajuste (24/11).
  if (normalizarDocumento(fichaEstado.dni) === normalizarDocumento(emision.dni)) return { tipo: "cargada", color: "green", texto: "Cargada" };
  return { tipo: "conflicto", color: "orange", texto: "N° usado por otro paciente" };
}

// Pantalla del rol "administrativa" (Fase 1A/1B) -- control de N° de Ficha
// de su propia sede: encabezado (última vigente + anulada más reciente, si
// corresponde), lista de solo lectura (N° ficha / estado / nombre / DNI /
// motivo de anulación -- DNI es Fase 1B, "—" en históricos sin el campo) y
// cartel de huecos/sospechosas, mismo CartelFichasFaltantes que ya usa un
// técnico, con esAdmin={false} para que las acciones de escritura
// (Descartar/Auditoría/Deshacer) queden ocultas igual que para cualquier
// no-admin -- sin tocar ese componente.
//
// Decisión de Pablo sobre fichas anuladas sin recarga ("opción A"): el
// flujo de anulación/descarte sigue exactamente como está hoy -- el admin
// anula y, si no va a recargar, además descarta aparte. Esta pantalla sólo
// EXPLICA ese estado, nunca lo cambia. Por eso NADA de este archivo toca
// calcularHuecos, CartelFichasFaltantes.jsx ni el flujo de anulación.
//
// No lee el libro de actas (decisión de Pablo): sólo fichasUsadas,
// fichasDescartadas y anulaciones de su propia sede -- los 3 ya cubiertos
// por firestore.rules (ver plan Fase 1A). listenAnulacionesActas ahora
// sólo le trae tipo=="anulacion" de su sede (la regla nueva), nunca el
// contenido de otras actas.
//
// listenFichasUsadasRecientes y listenFichasDescartadas son los MISMOS
// queries (misma colección, mismo where, mismo orderBy/limit) que
// CartelFichasFaltantes.jsx ya corre para calcular huecos -- el SDK de
// Firestore comparte un único stream de Watch entre listeners idénticos,
// así que esto no suma lecturas de servidor nuevas, sólo listeners en
// memoria del lado del cliente. Mismo tope ya existente (120,
// LIMITE_FICHAS_USADAS) -- no se agregó ninguna ventana nueva.
export function VistaAdministrativaFichas({ usuario, onToast }) {
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [fichasUsadas, setFichasUsadas] = useState([]);
  const [fichasDescartadas, setFichasDescartadas] = useState([]);

  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { sedeId: usuario.sede }), [usuario.sede]);
  useEffect(() => listenFichasUsadasRecientes(usuario.sede, setFichasUsadas), [usuario.sede]);
  useEffect(() => listenFichasDescartadas(usuario.sede, setFichasDescartadas), [usuario.sede]);

  // === Fase 2.1a -- Emisión de fichas ===
  // Bandera de funcionalidad (23/11, Pablo): apagada por defecto en
  // producción (nadie la define ahí), prendida a mano en .env.emulator y
  // .env.staging. Motivo: un deploy de hosting a producción ANTES de
  // desplegar las reglas de emisionesFicha/emisionesFichaResueltas rompería
  // esta pantalla -- con la bandera apagada, ni se renderiza la sección ni
  // se abre un solo listener nuevo (ver los returns tempranos de abajo,
  // NUNCA se salta la llamada al hook en sí, sólo su cuerpo -- las reglas
  // de hooks exigen que el llamado en sí sea incondicional).
  const emisionHabilitada = import.meta.env.VITE_EMISION_FICHAS_HABILITADA === "1";

  const [emisiones, setEmisiones] = useState([]);
  const [resueltas, setResueltas] = useState([]);
  const [estadosFicha, setEstadosFicha] = useState({}); // numero -> {k, vigente, dni}
  const [mostrarEmitir, setMostrarEmitir] = useState(false);
  const [liberandoId, setLiberandoId] = useState(null);
  const [motivoLiberar, setMotivoLiberar] = useState("");
  const [enviandoLiberar, setEnviandoLiberar] = useState(false);
  const [erroresFila, setErroresFila] = useState({}); // id -> mensaje

  useEffect(() => {
    if (!emisionHabilitada) return undefined;
    return listenEmisionesFicha(usuario.sede, setEmisiones);
  }, [usuario.sede, emisionHabilitada]);
  useEffect(() => {
    if (!emisionHabilitada) return undefined;
    return listenEmisionesResueltas(usuario.sede, setResueltas);
  }, [usuario.sede, emisionHabilitada]);

  const resueltaPorId = useMemo(() => new Map(resueltas.map((r) => [r.id, r])), [resueltas]);
  const emisionesPendientes = useMemo(
    () => emisiones.filter((e) => !resueltaPorId.has(e.id)),
    [emisiones, resueltaPorId]
  );
  const numerosPendientes = useMemo(
    () => [...new Set(emisionesPendientes.map((e) => e.numero))],
    [emisionesPendientes]
  );

  // Listener por FILA pendiente (no por colección entera) -- se crea cuando
  // un número entra en "pendiente" y se destruye cuando sale (se resuelve).
  // Ver listenFichaUsadaEstado: hasta 5 docs por número, nunca fichasUsadas
  // entera.
  const listenersRef = useRef(new Map());
  useEffect(() => {
    if (!emisionHabilitada) return;
    const activos = listenersRef.current;
    for (const numero of numerosPendientes) {
      if (!activos.has(numero)) {
        const unsub = listenFichaUsadaEstado(usuario.sede, numero, (estado) => {
          setEstadosFicha((prev) => ({ ...prev, [numero]: estado }));
        });
        activos.set(numero, unsub);
      }
    }
    for (const [numero, unsub] of activos) {
      if (!numerosPendientes.includes(numero)) {
        unsub();
        activos.delete(numero);
      }
    }
  }, [numerosPendientes, usuario.sede, emisionHabilitada]);
  useEffect(() => () => { for (const unsub of listenersRef.current.values()) unsub(); }, []);

  // Respaldo (no instantáneo): una anulación SIN ningún alta nueva de por
  // medio no dispara el listener de arriba (fichasUsadas es inmutable) --
  // se refresca en foco de pestaña y con el botón "Actualizar".
  async function refrescarEstados() {
    const entradas = await Promise.all(
      numerosPendientes.map(async (numero) => [numero, await calcularFichaIntentoObservado(usuario.sede, numero)])
    );
    setEstadosFicha((prev) => ({ ...prev, ...Object.fromEntries(entradas) }));
  }
  useEffect(() => {
    if (!emisionHabilitada) return undefined;
    function onFoco() {
      if (document.visibilityState === "visible") refrescarEstados();
    }
    document.addEventListener("visibilitychange", onFoco);
    return () => document.removeEventListener("visibilitychange", onFoco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numerosPendientes.join(","), emisionHabilitada]);

  const filasEmision = useMemo(
    () => emisiones
      .slice()
      .sort((a, b) => b.pacienteFichaNum - a.pacienteFichaNum)
      .map((e) => ({ emision: e, resuelta: resueltaPorId.get(e.id) || null, estado: estadoDeFila(e, resueltaPorId.get(e.id), estadosFicha[e.numero]) })),
    [emisiones, resueltaPorId, estadosFicha]
  );

  const avisoSedeAuditando = usuario.rol === "admin" && usuario.sedeAuditando !== usuario.sede;

  async function confirmarLiberar(fila) {
    setEnviandoLiberar(true);
    setErroresFila((prev) => ({ ...prev, [fila.emision.id]: "" }));
    try {
      await liberarEmisionStandalone({
        sedeId: usuario.sede, numero: fila.emision.numero, emisionVersion: fila.emision.emisionVersion,
        motivo: motivoLiberar, usuarioEmail: usuario.email,
      });
      setLiberandoId(null);
      setMotivoLiberar("");
      onToast?.("Emisión liberada.", "success");
    } catch (e) {
      const esCarrera = e.code === "permission-denied";
      setErroresFila((prev) => ({
        ...prev,
        [fila.emision.id]: esCarrera ? "El estado de esta ficha cambió, actualizá e intentá de nuevo." : e.message,
      }));
      if (esCarrera) refrescarEstados();
    } finally {
      setEnviandoLiberar(false);
    }
  }

  const anulacionPorId = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // Mismo criterio de "ANULADA" que ya usa huecosFicha.js (numerosActivos) --
  // por INTENTO, no por número: un número con 2 intentos (uno anulado, uno
  // activo) muestra cada intento como su propia fila con su propio estado,
  // reflejo fiel de los documentos reales en vez de colapsarlos. `motivo`
  // sale del mismo doc de anulación, sin ninguna lectura nueva.
  const filas = useMemo(() => {
    const idsAnulados = idsFichaAnulados(anulacionesRaw);
    return fichasUsadas
      .filter((f) => f.sedeId === usuario.sede)
      .map((f) => {
        const anulaId = `ficha_${f.sedeId}_${f.pacienteFicha}_${f.fichaIntentoNro}`;
        const anulada = idsAnulados.has(anulaId);
        return { ...f, anulada, motivo: anulada ? anulacionPorId.get(anulaId)?.motivo : null };
      });
  }, [fichasUsadas, anulacionesRaw, anulacionPorId, usuario.sede]);

  // "Última ficha cargada" = mayor número entre las filas VIGENTES (no
  // anuladas) -- a propósito distinto de listenUltimaFicha/obtenerUltimaFicha
  // (services/firestore/actas.js), que consultan fichasUsadas directo sin
  // excluir anuladas: para esta pantalla esa función mostraría un número
  // anulado como si fuera el vigente, exactamente lo que Pablo pidió evitar.
  //
  // "Anulada más reciente": si el número más alto de TODOS (anulados
  // incluidos) es mayor al vigente, es una anulación sin reemplazo todavía
  // -- se muestra aparte. CASO ACEPTADO, documentado a pedido de Pablo: si
  // la corrección se recarga con un número MENOR al anulado (ej. se tipeó
  // 1000 en vez de 100, se corrige como 100), esta línea NO desaparece
  // sola -- 100 nunca va a superar a 1000 en términos numéricos puros, así
  // que "Anulada más reciente: 1000" queda mostrándose para siempre aunque
  // el caso ya esté resuelto. No se intenta detectar esto (requeriría
  // heurísticas de cercanía/tiempo fuera de alcance) -- aceptado así.
  const { vigente, anuladaMasReciente } = useMemo(() => {
    if (filas.length === 0) return { vigente: null, anuladaMasReciente: null };
    const activas = filas.filter((f) => !f.anulada);
    const vigenteNum = activas.length ? Math.max(...activas.map((f) => f.pacienteFichaNum)) : null;
    const maxTotal = Math.max(...filas.map((f) => f.pacienteFichaNum));
    const hayAnuladaMasAlta = vigenteNum == null || maxTotal > vigenteNum;
    return { vigente: vigenteNum, anuladaMasReciente: hayAnuladaMasAlta ? maxTotal : null };
  }, [filas]);

  // Mismo gate horario (13:00) que CartelFichasFaltantes.jsx -- duplicado a
  // propósito: ese archivo es compartido con técnicos y Pablo pidió no
  // tocarlo. Si el cartel de abajo no muestra nada antes de las 13:00, esta
  // aclaración tampoco debería aparecer sin nada que aclarar.
  const MINUTOS_INICIO_HUECOS = 13 * 60;
  const [huecosActivo, setHuecosActivo] = useState(() => {
    const ahora = new Date();
    return ahora.getHours() * 60 + ahora.getMinutes() >= MINUTOS_INICIO_HUECOS;
  });
  useEffect(() => {
    if (huecosActivo) return;
    const id = setInterval(() => {
      const ahora = new Date();
      if (ahora.getHours() * 60 + ahora.getMinutes() >= MINUTOS_INICIO_HUECOS) setHuecosActivo(true);
    }, 60000);
    return () => clearInterval(id);
  }, [huecosActivo]);

  // Aclaración sobre el cartel de huecos (Pablo, "opción A" -- no cambia el
  // cartel compartido, sólo lo explica acá al lado). Reusa calcularHuecos
  // (función pura, misma firma/inputs que ya usa CartelFichasFaltantes) sin
  // duplicar su lógica, y huecosYaAnulados (huecosFicha.js) para separar
  // los que ya figuran anulados (nota) de los huecos reales -- nunca
  // cargados -- que no llevan nota.
  const huecosAnuladosSinReemplazo = useMemo(() => {
    if (!huecosActivo) return [];
    const { huecos } = calcularHuecos(fichasUsadas, anulacionesRaw, fichasDescartadas, usuario.sede, new Date());
    return huecosYaAnulados(huecos, fichasUsadas, usuario.sede);
  }, [huecosActivo, fichasUsadas, anulacionesRaw, fichasDescartadas, usuario.sede]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Control de fichas</h2>
        <p className="text-xs text-gray-400 mt-0.5">N° de Ficha de VM RIS, correlativo por sede</p>
      </div>

      {/* Fase 2.1a -- Emisión de fichas -- bandera de funcionalidad: nada de
          esto se renderiza (ni corre ningún listener, ver los useEffect de
          arriba) si VITE_EMISION_FICHAS_HABILITADA no es exactamente "1". */}
      {emisionHabilitada && <>
      {avisoSedeAuditando && (
        <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
          No se pudo verificar el historial de esta ficha. Si entraste como admin, configurá "Sede en auditoría" = tu sede en Configuración antes de usar esta pantalla.
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <h3 className="text-sm font-bold text-gray-800">Emisión de fichas</h3>
          <div className="flex gap-2">
            <Btn variant="outline" size="sm" onClick={refrescarEstados}>Actualizar</Btn>
            <Btn variant="primary" size="sm" onClick={() => setMostrarEmitir(true)}>Emitir ficha</Btn>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {filasEmision.length === 0 && (
            <p className="px-4 py-3 text-xs text-gray-400 text-center">Sin emisiones todavía.</p>
          )}
          {filasEmision.map((fila) => {
            const puedeLiberar = fila.estado.tipo === "pendiente" || fila.estado.tipo === "conflicto";
            return (
              <div key={fila.emision.id} className="px-4 py-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">{fila.emision.pacienteFichaNum} <span className="text-xs text-gray-400">v{fila.emision.emisionVersion}</span></span>
                  <Badge color={fila.estado.color}>{fila.estado.texto}</Badge>
                </div>
                <div className="text-xs text-gray-600">
                  {fila.emision.nombre} <span className="text-gray-400">· DNI {fila.emision.dni} · {fila.emision.estudio}</span>
                </div>
                {fila.estado.tipo === "liberada" && fila.estado.motivo && (
                  <p className="text-xs text-gray-400 truncate" title={fila.estado.motivo}>{fila.estado.motivo}</p>
                )}
                {erroresFila[fila.emision.id] && (
                  <p className="text-xs text-red-600">{erroresFila[fila.emision.id]}</p>
                )}
                {puedeLiberar && liberandoId !== fila.emision.id && (
                  <div className="flex justify-end">
                    <Btn variant="outline" size="sm" onClick={() => { setLiberandoId(fila.emision.id); setMotivoLiberar(""); }}>Liberar</Btn>
                  </div>
                )}
                {liberandoId === fila.emision.id && (
                  <div className="flex flex-col gap-2 mt-1">
                    <Input
                      label="Motivo (obligatorio)" value={motivoLiberar}
                      onChange={(e) => setMotivoLiberar(e.target.value.slice(0, MOTIVO_LIBERAR_TOPE))}
                      placeholder="Ej: ficha emitida sin usar, vencida..."
                    />
                    <span className="text-xs text-gray-400 text-right">{motivoLiberar.length}/{MOTIVO_LIBERAR_TOPE}</span>
                    <div className="flex gap-2 justify-end">
                      <Btn variant="outline" size="sm" onClick={() => { setLiberandoId(null); setMotivoLiberar(""); }} disabled={enviandoLiberar}>Cancelar</Btn>
                      <Btn variant="danger" size="sm" onClick={() => confirmarLiberar(fila)} disabled={!motivoLiberar.trim() || enviandoLiberar}>
                        {enviandoLiberar ? "Liberando..." : "Confirmar"}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {mostrarEmitir && (
        <ModalEmitirFicha
          sedeId={usuario.sede}
          usuarioEmail={usuario.email}
          onClose={() => setMostrarEmitir(false)}
          onEmitida={() => onToast?.("Ficha emitida.", "success")}
        />
      )}
      </>}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex flex-col gap-1">
        <p className="text-xs text-gray-400">Última ficha cargada</p>
        <p className="text-2xl font-bold text-gray-800">{vigente ?? "—"}</p>
        {anuladaMasReciente != null && (
          <p className="text-xs text-orange-500 font-semibold">Anulada más reciente: {anuladaMasReciente}</p>
        )}
      </div>
      {/* Fase 1B: se suma DNI -- la tabla de 3 columnas ya quedaba angosta
          en celular, agregar una 4ta columna la hacía peor. En vez de eso,
          disposición compacta de 2 líneas por fila (ficha + estado arriba,
          nombre + DNI abajo) -- mismo patrón que ya usa el modal "Fichas
          descartadas" de CartelFichasFaltantes.jsx (auditoría), sin tocar
          ese archivo, sólo repitiendo el estilo visual. Funciona igual en
          desktop y celular, no hace falta una versión aparte por ancho.
          DNI histórico ausente (fichas de antes de la 1B) muestra "—" --
          nunca se rellena ni se modifica el documento viejo. */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
        {filas.length === 0 && (
          <p className="px-4 py-3 text-xs text-gray-400 text-center">Sin fichas cargadas todavía.</p>
        )}
        {filas.map((f) => (
          <div key={f.id} className="px-4 py-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-800">{f.pacienteFichaNum}</span>
              {f.anulada ? <Badge color="red">ANULADA</Badge> : <Badge color="green">Activa</Badge>}
            </div>
            <div className="text-xs text-gray-600">
              {f.pacienteNombre || "—"} <span className="text-gray-400">· DNI {f.pacienteDni || "—"}</span>
            </div>
            {f.anulada && f.motivo && (
              <p className="text-xs text-gray-400 truncate" title={f.motivo}>{f.motivo}</p>
            )}
          </div>
        ))}
      </div>
      <CartelFichasFaltantes sedeId={usuario.sede} esAdmin={false} usuario={usuario} anulacionesRaw={anulacionesRaw} onToast={onToast} />
      {huecosAnuladosSinReemplazo.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex flex-col gap-1">
          {huecosAnuladosSinReemplazo.map((n) => (
            <p key={n} className="text-xs text-blue-700">
              La ficha {n} ya figura anulada (ver tabla). Si no se va a recargar, el administrador debe descartarla.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
