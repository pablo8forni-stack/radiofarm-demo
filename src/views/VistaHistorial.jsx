import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Btn } from "../components/ui/Btn.jsx";
import { Sel } from "../components/ui/Sel.jsx";
import { ModalAnular } from "../components/movimientos/ModalAnular.jsx";
import { SEDES } from "../constants/sedes.js";
import { TIPO_INFO } from "../constants/tipoMovimiento.js";
import { fmtTs, hoy } from "../helpers/formato.js";
import { descargarArchivo } from "../helpers/descargarArchivo.js";
import { sedesActivas } from "../helpers/stock.js";
import { listenMovimientos, anularMovimientoTransaction } from "../services/firestore/movimientos.js";

export function VistaHistorial({ catalogo, usuario, esAdmin, onToast }) {
  const [filtroSede, setFiltroSede] = useState(esAdmin ? "" : usuario.sede);
  const [filtroF, setFiltroF] = useState("");
  const [filtroT, setFiltroT] = useState("");
  const [mAnular, setMAnular] = useState(null);
  const [movimientos, setMovimientos] = useState([]);

  useEffect(() => {
    const unsub = listenMovimientos(filtroSede || null, setMovimientos);
    return unsub;
  }, [filtroSede]);

  const filtrados = useMemo(
    () => movimientos.filter((m) => (!filtroF || m.farmId === filtroF) && (!filtroT || m.tipo === filtroT)),
    [movimientos, filtroF, filtroT]
  );

  // Sólo detecta anulaciones dentro de la página cargada (últimos movimientos),
  // igual alcance que el resto del historial mostrado.
  const anulados = useMemo(() => new Set(movimientos.filter((m) => m.tipo === "anulacion").map((m) => m.anulaId)), [movimientos]);

  async function confirmarAnulacion(mov, observacion) {
    const motivoLabel = `Anula ${TIPO_INFO[mov.tipo]?.label || mov.tipo} del ${fmtTs(mov.fecha)}`;
    try {
      await anularMovimientoTransaction(mov, observacion, usuario, motivoLabel);
      onToast("Movimiento anulado", "info");
      setMAnular(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function exportarCSV() {
    const filas = [
      ["Fecha", "Sede", "Radiofármaco", "Tipo", "Cantidad", "Lote", "Motivo", "Observación", "Usuario", "Anulado"],
      ...filtrados.map((m) => [
        fmtTs(m.fecha), m.sedeNombre || "—", m.farmNombre, TIPO_INFO[m.tipo]?.label || m.tipo, m.cantidad, m.lote || "—",
        m.motivo || "—", m.observacion || "—", m.usuarioNombre || "—", anulados.has(m.id) ? "SÍ" : "—",
      ]),
    ];
    const csv = filas.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    descargarArchivo(csv, `historial_${hoy()}.csv`, "text/csv;charset=utf-8");
  }

  const esAnulable = (m) => esAdmin && m.tipo !== "anulacion" && !anulados.has(m.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {esAdmin && (
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          )}
          <Sel value={filtroF} onChange={(e) => setFiltroF(e.target.value)}>
            <option value="">Todos los radiofármacos</option>
            {catalogo.farms.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </Sel>
          <Sel value={filtroT} onChange={(e) => setFiltroT(e.target.value)}>
            <option value="">Todos</option>
            <option value="ingreso">Ingresos</option>
            <option value="egreso">Egresos</option>
            <option value="transferencia_salida">Transf. salida</option>
            <option value="transferencia_entrada">Transf. entrada</option>
            <option value="anulacion">Anulaciones</option>
          </Sel>
        </div>
        {esAdmin && filtrados.length > 0 && <Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>}
      </div>

      {esAdmin && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-700">
          <span className="font-semibold">Trazabilidad:</span> los movimientos no se editan ni se borran. Para corregir un error, usá el botón Anular — genera un movimiento compensatorio que revierte el stock y queda registrado.
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {["Fecha", "Sede", "Radiofármaco", "Tipo", "Cant.", "Lote", "Usuario", ""].map((h, i) => (
                <th key={i} className={`px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide ${i < 3 || i >= 5 ? "text-left" : "text-center"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map((m) => {
              const info = TIPO_INFO[m.tipo] || { label: m.tipo, color: "gray" };
              const fueAnulado = anulados.has(m.id);
              return (
                <tr key={m.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${fueAnulado ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(m.fecha)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 font-medium">
                    {SEDES.find((s) => s.id === m.sedeId)?.short || "—"}
                    {m.sedeRelacionada && <span className="text-teal-600"> {m.tipo === "transferencia_salida" ? "→" : "←"} {SEDES.find((s) => s.nombre === m.sedeRelacionada)?.short || m.sedeRelacionada}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-700 text-xs">
                    {m.farmNombre}
                    {m.observacion && <div className="text-xs text-gray-400 italic font-normal mt-0.5">"{m.observacion}"</div>}
                    {fueAnulado && <div className="text-xs text-orange-500 font-semibold mt-0.5">ANULADO</div>}
                  </td>
                  <td className="px-3 py-2.5 text-center"><Badge color={info.color}>{info.label}</Badge></td>
                  <td className="px-3 py-2.5 text-center font-bold text-gray-700">{m.cantidad}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{m.lote || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{m.usuarioNombre || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    {esAnulable(m) && <button onClick={() => setMAnular(m)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition">Anular</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin movimientos.</div>}
      </div>

      {mAnular && <ModalAnular mov={mAnular} onConfirm={confirmarAnulacion} onClose={() => setMAnular(null)} />}
    </div>
  );
}
