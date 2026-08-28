import { EncabezadoImpresion } from "./EncabezadoImpresion.jsx";
import { BloqueFirma } from "./BloqueFirma.jsx";
import { claseFilaAnulada, claseCampoAnulado, LeyendaAnulado } from "./marcadoAnulada.jsx";
import { fmtFechaHora, textoConformidad } from "./actasFormatoImpresion.js";
import { estadoMibgLote } from "../../helpers/mibgLote.js";

// Una fila por lote llegado dentro del mes elegido -- si además fue
// administrado DENTRO DEL MISMO MES, sus datos de uso (paciente/actividad/
// técnico/fecha real de administración) van pegados a la misma fila, igual
// que ya se ve en pantalla (TabLoteDosisUnica.jsx). En la práctica llegada
// y administración son casi siempre el mismo día ("cada vial es una dosis
// completa, se administra al llegar", ver comentario en ese archivo) -- el
// caso borde de un lote administrado recién el mes siguiente al de su
// llegada no queda reflejado acá (usoPorLoteId también está acotado al
// mes); se vería en el documento de Libro 2 de ese mes siguiente igual,
// donde si aparecen todas las administraciones de "paciente" del mes.
//
// anulaciones: Map anulaId -> doc (cubre TANTO lote anulado como
// administración anulada -- son dos hechos independientes, mismo criterio
// que estadoMibgLote). usosPorLoteId: Map loteId -> acta de administración
// (ya excluye usos anulados, arma esto TabImpresionMensual.jsx).
export function ImprimibleLibro4Lutecio({ lotes, anulaciones, usoPorLoteId, sedeNombre, mesTexto, nombreResponsable }) {
  return (
    <div className="p-6 text-black text-[10px] font-sans">
      <EncabezadoImpresion titulo="Libro 4 — Lutecio-177" sedeNombre={sedeNombre} mesTexto={mesTexto} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-1">Fecha llegada</th>
            <th className="py-1 pr-1">Lote</th>
            <th className="py-1 pr-1">Proveedor</th>
            <th className="py-1 pr-1">Act. calibrada</th>
            <th className="py-1 pr-1">Volumen</th>
            <th className="py-1 pr-1">Vencimiento</th>
            <th className="py-1 pr-1">Conformidad</th>
            <th className="py-1 pr-1">Estado</th>
            <th className="py-1 pr-1">Paciente administrado</th>
            <th className="py-1">Observación</th>
          </tr>
        </thead>
        <tbody>
          {lotes.map((l) => {
            const loteAnulado = anulaciones.has(l.id);
            const uso = usoPorLoteId.get(l.id) || null;
            const usoAnulado = uso ? anulaciones.get(uso.id) : null;
            const estado = estadoMibgLote(l.id, { anulaciones, usoPorLoteId });
            const { fecha } = fmtFechaHora(l.fecha);
            const campo = claseCampoAnulado(loteAnulado);
            return (
              <tr key={l.id} className={`border-b border-gray-300 align-top ${claseFilaAnulada(loteAnulado)}`}>
                <td className={`py-1 pr-1 ${campo}`}>{fecha}</td>
                <td className={`py-1 pr-1 ${campo}`}>{l.numeroLote}</td>
                <td className={`py-1 pr-1 ${campo}`}>{l.proveedor}</td>
                <td className={`py-1 pr-1 ${campo}`}>{l.actividadCalibrada} mCi</td>
                <td className={`py-1 pr-1 ${campo}`}>{l.volumen} mL</td>
                <td className={`py-1 pr-1 ${campo}`}>{l.fechaVencimiento}</td>
                <td className={`py-1 pr-1 ${campo}`}>{textoConformidad(l)}</td>
                <td className="py-1 pr-1">{loteAnulado ? <LeyendaAnulado motivo={anulaciones.get(l.id).motivo} /> : estado}</td>
                <td className="py-1 pr-1">
                  {uso ? (
                    <>
                      <span className={usoAnulado ? "line-through" : ""}>{uso.pacienteNombre} (DNI {uso.pacienteDni})</span>
                      {usoAnulado && <LeyendaAnulado motivo={usoAnulado.motivo} />}
                      <div className="text-[9px] text-gray-600">
                        {fmtFechaHora(uso.fecha).fecha} · {uso.mciAdministrados ?? "—"} mCi · Téc. {uso.usuarioNombre}
                      </div>
                    </>
                  ) : "—"}
                </td>
                <td className="py-1">{l.observacion || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lotes.length === 0 && <p className="text-center py-6 text-gray-500">Sin registros este mes.</p>}
      <BloqueFirma nombreResponsable={nombreResponsable} />
    </div>
  );
}
