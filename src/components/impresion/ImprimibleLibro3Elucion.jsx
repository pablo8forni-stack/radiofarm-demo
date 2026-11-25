import { EncabezadoImpresion } from "./EncabezadoImpresion.jsx";
import { BloqueFirma } from "./BloqueFirma.jsx";
import { claseFilaAnulada, claseCampoAnulado, LeyendaAnulado } from "./marcadoAnulada.jsx";
import { fmtFechaHora } from "./actasFormatoImpresion.js";
import { textoSubfilaGenerador } from "../../helpers/elucionGenerador.js";

export function ImprimibleLibro3Elucion({ actas, anulaciones, sedeNombre, mesTexto, nombreResponsable }) {
  return (
    <div className="p-6 text-black text-xs font-sans">
      <EncabezadoImpresion titulo="Libro 3 — Elución" sedeNombre={sedeNombre} mesTexto={mesTexto} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2">Fecha</th>
            <th className="py-1 pr-2">Hora</th>
            <th className="py-1 pr-2">Lote/Serie generador</th>
            <th className="py-1 pr-2">Act. calibrada (mCi)</th>
            <th className="py-1 pr-2">Act. eluida (mCi)</th>
            <th className="py-1 pr-2">Volumen (mL)</th>
            <th className="py-1 pr-2">Técnico</th>
            <th className="py-1">Observación</th>
          </tr>
        </thead>
        {actas.map((a) => {
          const anulacion = anulaciones.get(a.id);
          const { fecha, hora } = fmtFechaHora(a.fecha);
          const campo = claseCampoAnulado(!!anulacion);
          const subfila = textoSubfilaGenerador(a);
          return (
            // Fila + subfila en su PROPIO <tbody> (24/11) -- break-inside-
            // avoid acá mantiene juntas las dos entre páginas; un <tr> suelto
            // con break-inside:avoid (index.css) sólo evita que ESA fila se
            // parta sola, no que la siguiente (la subfila) quede en la
            // página de al lado. Varios <tbody> en una sola <table> son HTML
            // válido, se ven igual que uno solo.
            <tbody key={a.id} className="break-inside-avoid">
              <tr className={`border-b ${subfila ? "" : "border-gray-300"} ${claseFilaAnulada(!!anulacion)}`}>
                <td className={`py-1 pr-2 ${campo}`}>{fecha}</td>
                <td className={`py-1 pr-2 ${campo}`}>{hora}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.loteGenerador}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.actividadCalibrada ?? "—"}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.actividadEluida}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.volumen}</td>
                <td className={`py-1 pr-2 ${campo}`}>{a.usuarioNombre}</td>
                <td className="py-1">{anulacion ? <LeyendaAnulado motivo={anulacion.motivo} /> : (a.observacion || "—")}</td>
              </tr>
              {subfila && (
                <tr className={`border-b border-gray-300 ${claseFilaAnulada(!!anulacion)}`}>
                  <td colSpan={8} className={`py-0.5 pr-2 text-[10px] text-gray-600 ${campo}`}>{subfila}</td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
      {actas.length === 0 && <p className="text-center py-6 text-gray-500">Sin registros este mes.</p>}
      <BloqueFirma nombreResponsable={nombreResponsable} />
    </div>
  );
}
