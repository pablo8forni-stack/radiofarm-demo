import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, addActaElucion, actasPorRango, anularActaTransaction, listenAnulacionesActas, loteGeneradorYaRegistrado, normalizarLoteGenerador } from "../../services/firestore/actas.js";

export function TabElucion({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [exportandoRango, setExportandoRango] = useState(false);

  const [sedeId, setSedeId] = useState(usuario.sede);
  const [loteGenerador, setLoteGenerador] = useState("");
  const [loteVerificado, setLoteVerificado] = useState("");
  const [esPrimeraVez, setEsPrimeraVez] = useState(false);
  const [verificandoLote, setVerificandoLote] = useState(false);
  const [actividadCalibrada, setActividadCalibrada] = useState("");
  const [actividadEluida, setActividadEluida] = useState("");
  const [volumen, setVolumen] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => listenActas("elucion", setActasTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  // Se dispara al perder foco del campo lote (no en cada tecla) y también si
  // cambia la sede con un lote ya tipeado. Dos pasos:
  //  1) chequeo local instantáneo contra actasTodas (el listener en tiempo
  //     real) -- Firestore ya refleja ahí una escritura recién disparada
  //     aunque el servidor todavía no la confirmó, así que dos eluciones del
  //     mismo lote cargadas rápido una atrás de la otra no compiten en una
  //     carrera contra el paso 2.
  //  2) si no aparece localmente, getDoc directo por id determinístico
  //     (services/firestore/actas.js#loteGeneradorYaRegistrado), no una
  //     query -- cubre lotes con historial más viejo que los últimos 150
  //     registros cargados en pantalla. Si falla (ej. offline), se pide el
  //     dato igual: mejor pedir de más que perder un dato regulatorio que no
  //     se puede recuperar después.
  useEffect(() => {
    const lote = loteVerificado.trim();
    if (!lote) { setEsPrimeraVez(false); return; }
    // Mismo criterio de normalización que el id determinístico del marcador
    // (services/firestore/actas.js) -- si compara el texto tal cual lo tipeó
    // cada quien, "Gen2026014" y "gen2026014" nunca matchean entre sí.
    const loteNormalizado = normalizarLoteGenerador(lote);
    if (actasTodas.some((a) => a.loteGenerador && normalizarLoteGenerador(a.loteGenerador) === loteNormalizado)) {
      setEsPrimeraVez(false);
      return;
    }
    let cancelado = false;
    setVerificandoLote(true);
    loteGeneradorYaRegistrado(sedeId, lote)
      .then((yaRegistrado) => { if (!cancelado) setEsPrimeraVez(!yaRegistrado); })
      .catch(() => { if (!cancelado) setEsPrimeraVez(true); })
      .finally(() => { if (!cancelado) setVerificandoLote(false); });
    return () => { cancelado = true; };
  }, [sedeId, loteVerificado, actasTodas]);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  function limpiarForm() {
    setLoteGenerador(""); setLoteVerificado(""); setEsPrimeraVez(false);
    setActividadCalibrada(""); setActividadEluida(""); setVolumen(""); setObs("");
  }

  async function confirmarAnulacion(acta, motivo) {
    try {
      await anularActaTransaction(acta, motivo, usuario);
      onToast("Elución anulada", "info", 6000);
      setMAnular(null);
      // Precarga para corregir sólo lo que estaba mal -- ver mismo patrón en
      // TabMarcacion/TabPacientes. La detección de "primera vez" se vuelve a
      // correr sola (useEffect de arriba) apenas se precarga el lote.
      setSedeId(acta.sedeId); setLoteGenerador(acta.loteGenerador); setLoteVerificado(acta.loteGenerador);
      setActividadCalibrada(acta.actividadCalibrada != null ? String(acta.actividadCalibrada) : "");
      setActividadEluida(String(acta.actividadEluida ?? "")); setVolumen(String(acta.volumen ?? "")); setObs(acta.observacion || "");
      setMostrarForm(true);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  // A diferencia de ingreso/marcación/paciente (fire-and-forget, offline-safe
  // porque un rechazo real ahí es prácticamente imposible), la validez de una
  // elución depende de una condición server-side (loteGeneradorVisto) que el
  // cliente sólo puede aproximar -- un desfasaje cliente/regla (como el que
  // pasó con el fix de mayúsculas: cliente ya actualizado, regla de prod
  // todavía no) puede hacer que el guardado se rechace de verdad. Por eso acá
  // sí se espera la confirmación real del batch antes de avisar éxito, y si
  // falla, el error se muestra en el toast y el formulario se queda abierto
  // (no se limpia ni se cierra) para reintentar -- mismo criterio que ya
  // usamos en egreso/transferencia/anulación.
  async function guardar() {
    if (!loteGenerador.trim() || !actividadEluida || !volumen || (esPrimeraVez && !actividadCalibrada)) return;
    if (!catalogo.sedes[sedeId]?.eluye) return;
    const datos = {
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      loteGenerador: loteGenerador.trim(),
      actividadEluida: parseFloat(actividadEluida) || 0,
      volumen: parseFloat(volumen) || 0,
      usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
    };
    if (esPrimeraVez) datos.actividadCalibrada = parseFloat(actividadCalibrada) || 0;
    setGuardando(true);
    try {
      await addActaElucion(datos, esPrimeraVez);
      onToast("Elución registrada");
      limpiarForm();
      setMostrarForm(false);
    } catch (e) {
      onToast(e.message || "No se pudo guardar la elución", "error");
    } finally {
      setGuardando(false);
    }
  }

  const actas = useMemo(
    () => actasTodas.filter((a) => (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) && (!filtroSede || a.sedeId === filtroSede)),
    [actasTodas, filtroFecha, filtroSede]
  );

  const grupos = useMemo(
    () => (filtroFecha ? null : agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))),
    [actas, filtroFecha]
  );

  function filaElucion(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[a.sedeId]?.short || "—"}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-700">{a.loteGenerador}</td>
        <td className="px-3 py-2.5 text-xs text-gray-600">{a.actividadCalibrada != null ? `${a.actividadCalibrada} mCi` : "—"}</td>
        <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{a.actividadEluida}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
        <td className="px-3 py-2.5 text-xs text-gray-600">{a.volumen} ml</td>
        <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
        <td className="px-3 py-2.5 text-xs text-gray-400 italic">
          {a.observacion || "—"}
          {anulacion && <div className="text-orange-500 font-semibold not-italic mt-0.5">ANULADA: {anulacion.motivo}</div>}
        </td>
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

  function tarjetaElucion(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm font-mono">{a.loteGenerador}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        <div className="text-xs text-gray-500">
          {catalogo.sedes[a.sedeId]?.short || "—"} · Eluido: <span className="font-bold text-blue-700">{a.actividadEluida} mCi</span> · Vol: {a.volumen} ml
        </div>
        {a.actividadCalibrada != null && <div className="text-xs text-gray-500">Calibrada: {a.actividadCalibrada} mCi</div>}
        <div className="text-xs text-gray-500">Técnico: {a.usuarioNombre}</div>
        {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADA: {anulacion.motivo}</div>}
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
      a.sedeNombre, a.loteGenerador, a.actividadCalibrada ?? "—", a.actividadEluida, a.volumen, a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Lote/Serie generador", "Actividad calibrada (mCi)", "Actividad eluida (mCi)", "Volumen (ml)", "Técnico", "Observación"],
      ...lista.map(filaCSV),
    ];
    const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
    descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
  }

  function exportarCSV() {
    descargarCSV(actas, `libro3_elucion_${filtroFecha || hoy()}.csv`);
    onToast("Libro 3 exportado");
  }

  async function exportarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setExportandoRango(true);
    try {
      const registros = await actasPorRango("elucion", {
        desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede,
      });
      if (!registros.length) { onToast("No hay eluciones en ese rango", "error"); return; }
      descargarCSV(registros, `libro3_elucion_${rangoDesde}_a_${rangoHasta}.csv`);
      onToast(`Libro 3 exportado: ${registros.length} registro${registros.length !== 1 ? "s" : ""}`);
    } catch (e) {
      onToast(e.message || "No se pudo exportar el rango", "error");
    } finally {
      setExportandoRango(false);
    }
  }

  const sedeEluye = !!catalogo.sedes[sedeId]?.eluye;
  // Para un técnico (sede fija, sin selector) alcanza con mirar su propia
  // sede para decidir si tiene sentido abrir el formulario. Un admin puede
  // elegir cualquier sede adentro del form, así que su botón queda siempre
  // habilitado -- el aviso aparece adentro si la sede elegida no eluye.
  const puedeAbrirForm = esAdmin || !!catalogo.sedes[usuario.sede]?.eluye;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex gap-2 items-center">
            {filtroFecha && <Input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />}
            <Btn size="sm" variant="outline" onClick={() => setFiltroFecha(filtroFecha ? "" : hoy())}>
              {filtroFecha ? "Ver todos" : "Ver por fecha"}
            </Btn>
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
              <Btn size="sm" variant="outline" onClick={exportarCSV} className="order-2 md:order-none">↓ CSV</Btn>
            )
          ) : (
            <>
              <div className="flex gap-2 items-center order-2 md:order-none">
                <div className="flex-1 md:flex-none"><Input type="date" value={rangoDesde} onChange={(e) => setRangoDesde(e.target.value)} /></div>
                <span className="text-xs text-gray-400">a</span>
                <div className="flex-1 md:flex-none"><Input type="date" value={rangoHasta} onChange={(e) => setRangoHasta(e.target.value)} /></div>
              </div>
              <Btn size="sm" variant="outline" onClick={exportarRango} disabled={!rangoDesde || !rangoHasta || exportandoRango} className="order-3 md:order-none">
                {exportandoRango ? "Exportando..." : "↓ CSV por rango"}
              </Btn>
            </>
          )}
          <Btn
            size="sm" variant="primary" className="w-full md:w-auto order-1 md:order-none"
            onClick={() => setMostrarForm(true)} disabled={!puedeAbrirForm}
            title={puedeAbrirForm ? undefined : "Esta sede no tiene elución habilitada — activala en Configuración → Sedes activas"}
          >
            + Registrar elución
          </Btn>
        </div>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nueva elución</h3>
            <button onClick={() => { setMostrarForm(false); limpiarForm(); }} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {esAdmin && (
              <Sel label="Sede" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            )}
            {!sedeEluye && (
              <div className="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                Esta sede no tiene elución habilitada — activala en Configuración → Sedes activas.
              </div>
            )}
            <Input
              label="Lote/serie del generador" value={loteGenerador}
              onChange={(e) => setLoteGenerador(e.target.value)} onBlur={() => setLoteVerificado(loteGenerador)}
              placeholder="Ej: GEN-2026-014"
            />
            {verificandoLote && <div className="sm:col-span-2 text-xs text-gray-400">Verificando lote...</div>}
            {!verificandoLote && esPrimeraVez && (
              <>
                <div className="sm:col-span-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
                  Primera elución registrada de este lote/serie en esta sede — hace falta la actividad calibrada.
                </div>
                <Input label="Actividad de Mo-99 calibrada (mCi)" type="number" min={0} step={0.1} value={actividadCalibrada} onChange={(e) => setActividadCalibrada(e.target.value)} placeholder="1850" />
              </>
            )}
            <Input label="Actividad de Tc-99m eluida (mCi)" type="number" min={0} step={0.1} value={actividadEluida} onChange={(e) => setActividadEluida(e.target.value)} placeholder="740" />
            <Input label="Volumen (ml)" type="number" min={0} step={0.1} value={volumen} onChange={(e) => setVolumen(e.target.value)} placeholder="10" />
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: rendimiento, incidencias..." />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!sedeEluye || !loteGenerador.trim() || !actividadEluida || !volumen || (esPrimeraVez && !actividadCalibrada) || verificandoLote || guardando}>
              {guardando ? "Guardando..." : "Guardar elución"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Eluciones del ${fmtF(filtroFecha)}` : "Todas las eluciones"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "Sede", "Lote/Serie", "Act. calibrada", "Act. eluida", "Volumen", "Técnico", "Observación", ""].map((h, i) => (
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
                    ...g.items.map(filaElucion),
                  ])
                : actas.map(filaElucion)}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-gray-50">
          {grupos
            ? grupos.flatMap((g) => [
                <div key={`sep-${g.fecha}`} className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                </div>,
                ...g.items.map(tarjetaElucion),
              ])
            : actas.map(tarjetaElucion)}
        </div>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay eluciones para la fecha seleccionada." : "No hay eluciones registradas."}
          </div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`Elución ${mAnular.loteGenerador} — ${mAnular.actividadEluida} mCi (${mAnular.sedeNombre || catalogo.sedes[mAnular.sedeId]?.nombre})`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
