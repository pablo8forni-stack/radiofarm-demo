import { EncabezadoImpresion } from "./EncabezadoImpresion.jsx";
import { BloqueFirma } from "./BloqueFirma.jsx";
import { claseFilaAnulada, claseCampoAnulado, LeyendaAnulado } from "./marcadoAnulada.jsx";
import { fmtFechaHora, textoConformidad } from "./actasFormatoImpresion.js";
import { estadoMibgLote } from "../../helpers/mibgLote.js";

// Una fila por lote de Lutecio-177 LLEGADO dentro del mes elegido (filtro
// por fecha de llegada, ver lotesDelMes en helpers/mibgLote.js). Un lote
// SIN fecha de llegada nunca llega acá -- lotesDelMes lo excluye de
// cualquier mes (decisión de Pablo, 4/11: un libro regulatorio no puede
// repetir el mismo lote cada mes); GenerarActasImpresion.jsx lo muestra
// aparte, como aviso (avisoLotesSinFecha), no como fila de este libro. Su uso
// (paciente/actividad/técnico/fecha real de administración), si lo tuvo, se
// busca SIN acotar por fecha (usoActivoDeLote en services/firestore/
// mibgLotes.js, por id determinístico del lote) -- así que acá se ve
// correctamente aunque la administración haya quedado en un mes distinto
// del de llegada (antes, cuando usoPorLoteId salía de las actas YA
// recortadas al mes, esto mostraba "disponible" en cualquier mes que no
// fuera el de uso real -- bug corregido, ver GenerarActasImpresion.jsx).
//
// anulaciones: Map anulaId -> doc, SIN acotar por fecha (cubre TANTO lote
// anulado como administración anulada -- son dos hechos independientes,
// mismo criterio que estadoMibgLote). usoPorLoteId: Map loteId -> acta de
// administración (ya excluye usos anulados, los arma usoActivoDeLote).
export function ImprimibleLibro4Lutecio({ lotes, anulaciones, usoPorLoteId, sedeNombre, mesTexto, nombreResponsable }) {
  return (
    <div className="p-6 text-black text-xs font-sans">
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
