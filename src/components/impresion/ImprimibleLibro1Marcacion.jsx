import { EncabezadoImpresion } from "./EncabezadoImpresion.jsx";
import { BloqueFirma } from "./BloqueFirma.jsx";
import { claseFilaAnulada, claseCampoAnulado, LeyendaAnulado } from "./marcadoAnulada.jsx";
import { fmtFechaHora } from "./actasFormatoImpresion.js";

// actas: ya vienen ordenadas por fecha ascendente (orden de lectura de un
// libro en papel) y acotadas al mes+sede elegidos -- ver
// TabImpresionMensual.jsx, que arma estos props. anulaciones: Map
// anulaId -> doc de anulación (mismo criterio que TabMarcacion.jsx).
export function ImprimibleLibro1Marcacion({ actas, anulaciones, sedeNombre, mesTexto, nombreResponsable }) {
  return (
    <div className="p-6 text-black text-xs font-sans">
      <EncabezadoImpresion titulo="Libro 1 — Marcación" sedeNombre={sedeNombre} mesTexto={mesTexto} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2">Fecha</th>
            <th className="py-1 pr-2">Hora</th>
            <th className="py-1 pr-2">Radiofármaco</th>
            <th className="py-1 pr-2">Lote</th>
            <th className="py-1 pr-2">mCi marcación</th>
            <th className="py-1 pr-2">Técnico</th>
            <th className="py-1">Observación</th>
          </tr>
        </thead>
        <tbody>
          {actas.map((a) => {
            const anulacion = anulaciones.get(a.id);
            const { fecha, hora } = fmtFechaHora(a.fecha);
            const campo = claseCampoAnulado(!!anulacion);
            return (
              <tr key={a.id} className={`border-b border-gray-300 ${claseFilaAnulada(!!anulacion)}`}>
                <td className={`py-1 pr-2 ${campo}`}>{fecha}</td>
                <td className={`py-1 pr-2 ${campo}`}>{hora}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.farmNombre}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.lote || "—"}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.mciMarcacion}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.usuarioNombre}</td>
                <td className="py-1">{anulacion ? <LeyendaAnulado motivo={anulacion.motivo} /> : (a.observacion || "—")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {actas.length === 0 && <p className="text-center py-6 text-gray-500">Sin registros este mes.</p>}
      <BloqueFirma nombreResponsable={nombreResponsable} />
    </div>
  );
}
