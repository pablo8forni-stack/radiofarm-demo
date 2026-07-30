import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { HistorialPacienteI131 } from "./HistorialPacienteI131.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, actasPorRango, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { anularActaMibgYLote } from "../../services/firestore/mibgLotes.js";
import { TIPO_LABEL_I131 } from "../../constants/tipoI131.js";

const TIPOS_I131 = ["i131_ablativa", "i131_dosis", "i131_barrido", "i131_mibg", "i131_captacion", "i131_centellograma", "i131_captacion_centellograma"];

const TIMEOUT_BUSQUEDA_MS = 20000;
const MSJ_TIMEOUT_BUSQUEDA = "La consulta tardó demasiado, puede haber un problema de conexión -- intentá cerrar las otras pestañas de RadioFarm que tengas abiertas y reintentá.";

// Sin esto, una consulta que nunca resuelve deja el botón trabado en
// "Buscando..." para siempre -- ver misma nota en TabMarcacion.jsx.
function conTimeout(promesa, ms, mensaje) {
  let idTimeout;
  const timeout = new Promise((_, reject) => { idTimeout = setTimeout(() => reject(new Error(mensaje)), ms); });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));
}

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Vista de SÓLO CONSULTA de los 6 tipos de registro de I-131 -- la carga se
// mudó a Libro 2 (Pacientes), eligiendo I-131 como isótopo. Motivo: el N° de
// Ficha es un correlativo diario único compartido por TODOS los pacientes
// del servicio (Tc-99m, Lutecio, I-131 por igual); tener una pantalla de
// carga separada acá rompía esa continuidad -- obligaba a ir y volver entre
// pestañas para saber cuál era el próximo número. El modelo de datos y las
// reglas de Firestore no cambian acá, sólo el punto de entrada.
export function TabRegistrosI131({ catalogo, usuario, esAdmin, onToast }) {
  const [ablativaTodas, setAblativaTodas] = useState([]);
  const [dosisTodas, setDosisTodas] = useState([]);
  const [barridosTodas, setBarridosTodas] = useState([]);
  const [mibgTodas, setMibgTodas] = useState([]);
  const [captacionTodas, setCaptacionTodas] = useState([]);
  const [centellogramaTodas, setCentellogramaTodas] = useState([]);
  const [captCentellogramaTodas, setCaptCentellogramaTodas] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [historialDni, setHistorialDni] = useState(null);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [buscandoRango, setBuscandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState(null);
  const [resultadoRango, setResultadoRango] = useState(null);

  function cambiarRango(setter) {
    return (e) => { setter(e.target.value); setResultadoRango(null); setErrorRango(null); };
  }

  useEffect(() => listenActas("i131_ablativa", setAblativaTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_dosis", setDosisTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_barrido", setBarridosTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_mibg", setMibgTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion", setCaptacionTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_centellograma", setCentellogramaTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion_centellograma", setCaptCentellogramaTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // Historial completo por paciente (Parte C, auditorías ARN) -- mismo gate
  // que Stock de viales/Resultados %Captación: surge datos de
  // i131_captacion_resultado/i131_seguimiento_fin que un técnico sin
  // accesoTerapiaI131 no puede leer.
  const puedeVerHistorial = esAdmin || !!usuario.accesoTerapiaI131;

  // Los 7 tipos comparten un solo listado (con badge de tipo por fila) --
  // cada colección ya viene ordenada desc por fecha desde el listener, así
  // que sólo hace falta mezclar y volver a ordenar, no reordenar cada una.
  const actasTodas = useMemo(
    () => [...ablativaTodas, ...dosisTodas, ...barridosTodas, ...mibgTodas, ...captacionTodas, ...centellogramaTodas, ...captCentellogramaTodas]
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [ablativaTodas, dosisTodas, barridosTodas, mibgTodas, captacionTodas, centellogramaTodas, captCentellogramaTodas]
  );

  // Sin formulario que reabrir acá -- corregir un registro anulado se hace
  // volviendo a cargarlo en Libro 2 (Pacientes), eligiendo I-131 de nuevo.
  // MIBG es distinto: anular el acta anula TAMBIÉN el lote (dos pasos, ver
  // anularActaMibgYLote) -- corregir exige re-registrar el lote de cero
  // desde la etiqueta, no sólo recargar el acta (auditoría, #2).
  async function confirmarAnulacion(acta, motivo) {
    try {
      if (acta.tipo === "i131_mibg") {
        await anularActaMibgYLote(acta, motivo, usuario);
        onToast(
          "MIBG anulado (el lote también quedó anulado, no se reutiliza). Para corregir: registrá el lote de nuevo en la pestaña MIBG y cargá el acta correcta en Libro 2.",
          "info", 10000
        );
      } else {
        await anularActaTransaction(acta, motivo, usuario);
        onToast(
          `${TIPO_LABEL_I131[acta.tipo]?.label || acta.tipo} anulado. Para corregirlo, volvé a cargarlo en Libro 2 (Pacientes) eligiendo I-131.`,
          "info", 8000
        );
      }
      setMAnular(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  const actas = useMemo(
    () => actasTodas.filter((a) =>
      (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) &&
      (!filtroSede || a.sedeId === filtroSede) &&
      (!filtroTipo || a.tipo === filtroTipo)
    ),
    [actasTodas, filtroFecha, filtroSede, filtroTipo]
  );

  const grupos = useMemo(
    () => (filtroFecha ? null : agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))),
    [actas, filtroFecha]
  );

  // Ablativa/Dosis (mCi, con lote/cápsula) y los 3 diagnósticos (µCi, con
  // vínculo opcional a la dosis que motivó el estudio) usan esta línea/celda
  // para algo distinto -- Barrido corporal no lleva ninguno de los dos desde
  // que se le sacó el vínculo, siempre queda en "—".
  function detalleFila(a) {
    if (a.tipo === "i131_ablativa" || a.tipo === "i131_dosis") return `${a.actividadAdministrada} mCi · Lote ${a.lote}`;
    if (a.tipo === "i131_mibg") return `${a.actividadCalibrada} mCi · Lote ${a.numeroLote}`;
    if (a.tipo === "i131_captacion" || a.tipo === "i131_centellograma" || a.tipo === "i131_captacion_centellograma") {
      const base = a.actividadAdministrada != null ? `${a.actividadAdministrada} ${a.unidadActividad === "mCi" ? "mCi" : "µCi"}` : "—";
      return a.dosisActaId ? `${base} · Vinculado a dosis` : base;
    }
    return "—";
  }

  function filaI131(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = TIPO_LABEL_I131[a.tipo];
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5">{tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-600">{a.pacienteFicha || "—"}</td>
        <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
          {puedeVerHistorial ? (
            <button onClick={() => setHistorialDni(a.pacienteDni)} className="hover:underline hover:text-blue-700 text-left" title="Ver historial completo de I-131">
              {a.pacienteNombre}
            </button>
          ) : a.pacienteNombre}
          {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.pacienteDni}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">{a.medicoResponsable || "—"}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">{detalleFila(a)}</td>
        <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
        <td className="px-3 py-2.5 text-right">
          {esAdmin && !anulacion && (
            <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular
            </button>
          )}
        </td>
      </tr>
    );
  }

  function tarjetaI131(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = TIPO_LABEL_I131[a.tipo];
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          {puedeVerHistorial ? (
            <button onClick={() => setHistorialDni(a.pacienteDni)} className="font-semibold text-gray-800 text-sm hover:underline hover:text-blue-700 text-left" title="Ver historial completo de I-131">
              {a.pacienteNombre}
            </button>
          ) : <span className="font-semibold text-gray-800 text-sm">{a.pacienteNombre}</span>}
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        {tipo && <div><Badge color={tipo.color}>{tipo.label}</Badge></div>}
        <div className="text-xs text-gray-500">Ficha {a.pacienteFicha || "—"} · DNI {a.pacienteDni}</div>
        {a.medicoResponsable && <div className="text-xs text-gray-700">Médico: {a.medicoResponsable}</div>}
        <div className="text-xs text-gray-700">{detalleFila(a)}</div>
        <div className="text-xs text-gray-500">Técnico: {a.usuarioNombre}</div>
        {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
        {esAdmin && !anulacion && (
          <div className="flex justify-end mt-0.5">
            <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular
            </button>
          </div>
        )}
      </div>
    );
  }

  function filaCSV(a) {
    const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
    return [d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      a.sedeNombre, TIPO_LABEL_I131[a.tipo]?.label || a.tipo, a.pacienteFicha || "—", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
      a.actividadAdministrada ?? a.actividadCalibrada ?? "—", a.unidadActividad || (a.tipo === "i131_mibg" ? "mCi" : "—"), a.lote || a.numeroLote || "—", a.indicacion || "—", a.dosisActaId || "—",
      a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Tipo", "N° Ficha", "Paciente", "DNI", "Médico responsable", "Actividad administrada", "Unidad", "Lote", "Indicación", "Dosis vinculada (id)", "Técnico", "Observación"],
      ...lista.map(filaCSV),
    ];
    const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
    descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
  }

  function exportarCSV() {
    descargarCSV(actas, `terapia_i131_${filtroFecha || hoy()}.csv`);
    onToast("Gestión I-131 exportada");
  }

  // Buscar y descargar son dos pasos separados a propósito -- ver nota
  // completa en TabMarcacion.jsx#buscarRango. Trae los 7 tipos por separado
  // (siete consultas, mismo rango) y los mezcla, igual que el listado en vivo.
  async function buscarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setBuscandoRango(true);
    setErrorRango(null);
    setResultadoRango(null);
    try {
      const opts = { desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede };
      const resultados = await conTimeout(
        Promise.all(TIPOS_I131.map((t) => actasPorRango(t, opts))),
        TIMEOUT_BUSQUEDA_MS, MSJ_TIMEOUT_BUSQUEDA
      );
      let registros = resultados.flat().sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha));
      if (filtroTipo) registros = registros.filter((a) => a.tipo === filtroTipo);
      setResultadoRango(registros);
    } catch (e) {
      setErrorRango(e.message || "No se pudo buscar el rango.");
    } finally {
      setBuscandoRango(false);
    }
  }

  function descargarResultadoRango() {
    if (!resultadoRango?.length) return;
    descargarCSV(resultadoRango, `terapia_i131_${rangoDesde}_a_${rangoHasta}.csv`);
    onToast(`Gestión I-131 exportada: ${resultadoRango.length} registro${resultadoRango.length !== 1 ? "s" : ""}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        La carga de registros de I-131 se hace desde Libro 2 (Pacientes), eligiendo I-131 en "¿Es un caso distinto a Tc-99m?" -- así el N° de Ficha sigue el mismo correlativo diario que el resto de los pacientes. Acá sólo se consultan.
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex gap-2 items-center">
            {filtroFecha && <Input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />}
            <Btn size="sm" variant="outline" onClick={() => setFiltroFecha(filtroFecha ? "" : hoy())}>
              {filtroFecha ? "Ver todos" : "Ver por fecha"}
            </Btn>
          </div>
          <div className="w-full md:w-auto">
            <Sel value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Todos los tipos</option>
              {TIPOS_I131.map((t) => <option key={t} value={t}>{TIPO_LABEL_I131[t].label}</option>)}
            </Sel>
          </div>
          {esAdmin && (
            <div className="w-full md:w-auto">
              <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
                <option value="">Todas las sedes</option>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {filtroFecha ? (
            actas.length > 0 && (
              <Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>
            )
          ) : (
            <>
              <div className="flex gap-2 items-center">
                <div className="flex-1 md:flex-none"><Input label="Desde" type="date" value={rangoDesde} onChange={cambiarRango(setRangoDesde)} /></div>
                <span className="text-xs text-gray-400 mt-5">a</span>
                <div className="flex-1 md:flex-none"><Input label="Hasta" type="date" value={rangoHasta} onChange={cambiarRango(setRangoHasta)} /></div>
              </div>
              <Btn size="sm" variant="outline" onClick={buscarRango} disabled={!rangoDesde || !rangoHasta || buscandoRango}>
                {buscandoRango ? "Buscando..." : "Buscar"}
              </Btn>
            </>
          )}
        </div>
      </div>

      {errorRango && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{errorRango}</div>
      )}

      {resultadoRango !== null && (
        resultadoRango.length > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-xs rounded-xl px-3 py-2">
            <span>Se encontraron {resultadoRango.length} registro{resultadoRango.length !== 1 ? "s" : ""} entre {fmtF(rangoDesde)} y {fmtF(rangoHasta)}.</span>
            <Btn size="sm" variant="outline" onClick={descargarResultadoRango} className="sm:ml-auto">↓ Descargar CSV</Btn>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 text-gray-500 text-xs rounded-xl px-3 py-2">
            No se encontraron registros en ese rango.
          </div>
        )
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Registros del ${fmtF(filtroFecha)}` : "Todos los registros"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "Tipo", "N° Ficha", "Paciente", "DNI", "Médico", "Detalle", "Técnico", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos
                ? grupos.flatMap((g) => [
                    <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                      <td colSpan={9} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
                        {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                      </td>
                    </tr>,
                    ...g.items.map(filaI131),
                  ])
                : actas.map(filaI131)}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-gray-50">
          {grupos
            ? grupos.flatMap((g) => [
                <div key={`sep-${g.fecha}`} className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                </div>,
                ...g.items.map(tarjetaI131),
              ])
            : actas.map(tarjetaI131)}
        </div>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay registros para la fecha seleccionada." : "No hay registros."}
          </div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`${TIPO_LABEL_I131[mAnular.tipo]?.label || mAnular.tipo} — ${mAnular.pacienteNombre} (DNI ${mAnular.pacienteDni})`}
          notaExtra={mAnular.tipo === "i131_mibg" ? "Anular este registro también anula el lote físico usado -- nunca se reutiliza. Para corregir, registrá el lote de nuevo en la pestaña MIBG y cargá el acta correcta." : null}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}

      {puedeVerHistorial && (
        <HistorialPacienteI131
          open={!!historialDni}
          dni={historialDni}
          sedeId={esAdmin ? (filtroSede || null) : usuario.sede}
          esAdmin={esAdmin}
          onClose={() => setHistorialDni(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
