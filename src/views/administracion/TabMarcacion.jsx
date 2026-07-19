import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { listenActas, addActaMarcacion, actasPorRango } from "../../services/firestore/actas.js";

export function TabMarcacion({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
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
    return (
      <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[a.sedeId]?.short || "—"}</td>
        <td className="px-3 py-2.5 text-xs font-semibold text-gray-800">{a.farmNombre}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.lote || "—"}</td>
        <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{a.mciMarcacion}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
        <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
        <td className="px-3 py-2.5 text-xs text-gray-400 italic">{a.observacion || "—"}</td>
      </tr>
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
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap items-center">
          {filtroFecha && <Input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />}
          <Btn size="sm" variant="outline" onClick={() => setFiltroFecha(filtroFecha ? "" : hoy())}>
            {filtroFecha ? "Ver todos" : "Ver por fecha"}
          </Btn>
          {esAdmin && (
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {filtroFecha ? (
            actas.length > 0 && <Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>
          ) : (
            <>
              <Input type="date" value={rangoDesde} onChange={(e) => setRangoDesde(e.target.value)} />
              <span className="text-xs text-gray-400">a</span>
              <Input type="date" value={rangoHasta} onChange={(e) => setRangoHasta(e.target.value)} />
              <Btn size="sm" variant="outline" onClick={exportarRango} disabled={!rangoDesde || !rangoHasta || exportandoRango}>
                {exportandoRango ? "Exportando..." : "↓ CSV por rango"}
              </Btn>
            </>
          )}
          <Btn size="sm" variant="primary" onClick={() => setMostrarForm(true)}>+ Registrar marcación</Btn>
        </div>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nueva marcación</h3>
            <button onClick={() => setMostrarForm(false)} className="text-gray-400 hover:text-gray-600">
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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Marcaciones del ${fmtF(filtroFecha)}` : "Todas las marcaciones"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {["Hora", "Sede", "Radiofármaco", "Lote", "mCi marcación", "Técnico", "Observación"].map((h) => (
                <th key={h} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupos
              ? grupos.flatMap((g) => [
                  <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                    <td colSpan={7} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
                      {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                    </td>
                  </tr>,
                  ...g.items.map(filaMarcacion),
                ])
              : actas.map(filaMarcacion)}
          </tbody>
        </table>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay marcaciones para la fecha seleccionada." : "No hay marcaciones registradas."}
          </div>
        )}
      </div>
    </div>
  );
}
