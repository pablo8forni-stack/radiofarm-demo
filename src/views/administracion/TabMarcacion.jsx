import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { listenActas, addActaMarcacion, actasPorRango, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";

export function TabMarcacion({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [exportandoRango, setExportandoRango] = useState(false);

  const [farmId, setFarmId] = useState(""); const [lote, setLote] = useState("");
  const [mciMarcacion, setMciMarcacion] = useState(""); const [obs, setObs] = useState("");
  const [sedeId, setSedeId] = useState(usuario.sede);

  useEffect(() => listenActas("marcacion", setActasTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  // anulaId -> acta de anulación (motivo, fecha, quién) -- Map en vez de Set
  // porque el listado necesita mostrar el motivo, no sólo saber que existe.
  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  async function confirmarAnulacion(acta, motivo) {
    try {
      await anularActaTransaction(acta, motivo, usuario);
      onToast("Marcación anulada", "info", 6000);
      setMAnular(null);
      // Precarga el formulario con los mismos datos para corregir sólo lo
      // que estaba mal, en vez de tipear todo de nuevo.
      setSedeId(acta.sedeId); setFarmId(acta.farmId); setLote(acta.lote);
      setMciMarcacion(String(acta.mciMarcacion ?? "")); setObs(acta.observacion || "");
      setMostrarForm(true);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  const lotesDisp = (catalogo.stock[sedeId]?.[farmId] || []).filter((l) => l.cantidad > 0);

  function guardar() {
    if (!farmId || !lote || !mciMarcacion) return;
    const farm = catalogo.farms.find((f) => f.id === farmId);
    addActaMarcacion({
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      farmId, farmNombre: farm?.nombre || "", lote,
      mciMarcacion: parseFloat(mciMarcacion) || 0,
      usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
    }).catch((e) => onToast(e.message || "No se pudo guardar la marcación", "error"));
    onToast("Marcación registrada");
    setFarmId(""); setLote(""); setMciMarcacion(""); setObs(""); setMostrarForm(false);
  }

  const actas = useMemo(
    () => actasTodas.filter((a) => (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) && (!filtroSede || a.sedeId === filtroSede)),
    [actasTodas, filtroFecha, filtroSede]
  );

  // Sólo se agrupa por fecha en "Ver todos" -- con un día ya filtrado, todos
  // los registros mostrados comparten fecha y un separador no aportaría nada.
  const grupos = useMemo(
    () => (filtroFecha ? null : agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))),
    [actas, filtroFecha]
  );

  function filaMarcacion(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[a.sedeId]?.short || "—"}</td>
        <td className="px-3 py-2.5 text-xs font-semibold text-gray-800">{a.farmNombre}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.lote || "—"}</td>
        <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{a.mciMarcacion}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
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

  function tarjetaMarcacion(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm">{a.farmNombre}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        <div className="text-xs text-gray-500">
          {catalogo.sedes[a.sedeId]?.short || "—"} · Lote {a.lote || "—"} · <span className="font-bold text-blue-700">{a.mciMarcacion} mCi</span>
        </div>
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
      a.sedeNombre, a.farmNombre, a.lote || "—", a.mciMarcacion, a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [["Fecha", "Hora", "Sede", "Radiofármaco", "Lote", "mCi marcación", "Técnico", "Observación"], ...lista.map(filaCSV)];
    const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
    descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
  }

  function exportarCSV() {
    descargarCSV(actas, `libro1_marcacion_${filtroFecha || hoy()}.csv`);
    onToast("Libro 1 exportado");
  }

  // Sólo disponible en "Ver todos": el listener de pantalla está limitado a
  // PAGINA (150) para no cargar la vista, insuficiente para una auditoría ARN
  // de un período largo -- esto hace una consulta aparte, sin ese límite,
  // acotada al rango de fechas elegido.
  async function exportarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setExportandoRango(true);
    try {
      const registros = await actasPorRango("marcacion", {
        desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede,
      });
      if (!registros.length) { onToast("No hay marcaciones en ese rango", "error"); return; }
      descargarCSV(registros, `libro1_marcacion_${rangoDesde}_a_${rangoHasta}.csv`);
      onToast(`Libro 1 exportado: ${registros.length} registro${registros.length !== 1 ? "s" : ""}`);
    } catch (e) {
      onToast(e.message || "No se pudo exportar el rango", "error");
    } finally {
      setExportandoRango(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {/* Mobile: fecha+"Ver todos" en una fila, selector de sede en la suya a
            ancho completo -- en vez de los 3 comprimidos como en desktop. */}
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
        {/* Mobile: la acción principal (+ Registrar) va arriba, a ancho
            completo; CSV/rango quedan debajo, más chicos -- sólo un cambio de
            orden visual (order-*), el DOM y el desktop no cambian. */}
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
          <Btn size="sm" variant="primary" onClick={() => setMostrarForm(true)} className="w-full md:w-auto order-1 md:order-none">+ Registrar marcación</Btn>
        </div>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nueva marcación</h3>
            <button onClick={() => setMostrarForm(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {esAdmin && (
              <Sel label="Sede" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setFarmId(""); setLote(""); }}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            )}
            <Sel label="Radiofármaco" value={farmId} onChange={(e) => { setFarmId(e.target.value); setLote(""); }}>
              <option value="">Seleccionar...</option>
              {farmsDeSede(catalogo, sedeId).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </Sel>
            <Sel label="Lote" value={lote} onChange={(e) => setLote(e.target.value)} disabled={!farmId}>
              <option value="">Seleccionar lote...</option>
              {lotesDisp.map((l) => <option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
            </Sel>
            <Input label="mCi utilizados en marcación" type="number" min={0} step={0.1} value={mciMarcacion} onChange={(e) => setMciMarcacion(e.target.value)} placeholder="20" />
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: rendimiento del kit, incidencias..." />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => setMostrarForm(false)}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!farmId || !lote || !mciMarcacion}>Guardar marcación</Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Marcaciones del ${fmtF(filtroFecha)}` : "Todas las marcaciones"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        {/* Desktop: tabla de siempre. */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "Sede", "Radiofármaco", "Lote", "mCi marcación", "Técnico", "Observación", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos
                ? grupos.flatMap((g) => [
                    <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                      <td colSpan={8} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
                        {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                      </td>
                    </tr>,
                    ...g.items.map(filaMarcacion),
                  ])
                : actas.map(filaMarcacion)}
            </tbody>
          </table>
        </div>
        {/* Mobile: tarjeta por marcación en vez de columnas comprimidas. */}
        <div className="md:hidden divide-y divide-gray-50">
          {grupos
            ? grupos.flatMap((g) => [
                <div key={`sep-${g.fecha}`} className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                </div>,
                ...g.items.map(tarjetaMarcacion),
              ])
            : actas.map(tarjetaMarcacion)}
        </div>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay marcaciones para la fecha seleccionada." : "No hay marcaciones registradas."}
          </div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`${mAnular.farmNombre} — ${mAnular.mciMarcacion} mCi (${mAnular.sedeNombre || catalogo.sedes[mAnular.sedeId]?.nombre})`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
