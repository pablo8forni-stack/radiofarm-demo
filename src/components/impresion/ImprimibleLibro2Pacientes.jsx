import { EncabezadoImpresion } from "./EncabezadoImpresion.jsx";
import { BloqueFirma } from "./BloqueFirma.jsx";
import { claseFilaAnulada, claseCampoAnulado, LeyendaAnulado } from "./marcadoAnulada.jsx";
import { fmtFechaHora, tipoTextoCSV, dosisRegistro, textoConformidad } from "./actasFormatoImpresion.js";

// El CSV de Libro 2 tiene 26 columnas (ver TabPacientes.jsx#filaCSV) porque
// además de los datos del paciente lleva 7 columnas del lote vinculado
// (MIBG/Lutecio-177) -- pero esas 7 sólo aplican a una fracción chica de
// filas (el resto son Tc-99m, sin lote). Ponerlas como columna fija haría
// la tabla enorme e ilegible para el 90% de las filas que las tienen todas
// en "—". Acá van como una segunda línea DENTRO de la fila, sólo cuando
// corresponde -- mismo dato, mismo criterio de "todo lo que se ve en
// pantalla" (TabPacientes.jsx tiene el mismo patrón de panel de detalle
// para el lote vinculado), mejor legibilidad en papel.
export function ImprimibleLibro2Pacientes({ actas, anulaciones, lotesPorId, sedeNombre, mesTexto, nombreResponsable, catalogo }) {
  return (
    <div className="p-6 text-black text-[10px] font-sans">
      <EncabezadoImpresion titulo="Libro 2 — Pacientes" sedeNombre={sedeNombre} mesTexto={mesTexto} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-1">Fecha</th>
            <th className="py-1 pr-1">Hora</th>
            <th className="py-1 pr-1">N° Ficha</th>
            <th className="py-1 pr-1">Paciente</th>
            <th className="py-1 pr-1">DNI</th>
            <th className="py-1 pr-1">Médico</th>
            <th className="py-1 pr-1">Peso/Talla</th>
            <th className="py-1 pr-1">Tipo</th>
            <th className="py-1 pr-1">Estudio</th>
            <th className="py-1 pr-1">Radiofármaco/Lote</th>
            <th className="py-1 pr-1">Dosis</th>
            <th className="py-1 pr-1">Técnico</th>
            <th className="py-1">Observación</th>
          </tr>
        </thead>
        <tbody>
          {actas.map((a) => {
            const anulacion = anulaciones.get(a.id);
            const { fecha, hora } = fmtFechaHora(a.fecha);
            const dosis = dosisRegistro(a);
            const lote = lotesPorId.get(a.mibgLoteId || a.loteDosisUnicaId) || null;
            const campo = claseCampoAnulado(!!anulacion);
            return (
              <tr key={a.id} className={`border-b border-gray-300 align-top ${claseFilaAnulada(!!anulacion)}`}>
                <td className={`py-1 pr-1 ${campo}`}>{fecha}</td>
                <td className={`py-1 pr-1 ${campo}`}>{hora}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.pacienteFicha || "—"}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.pacienteNombre}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.pacienteDni}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.medicoResponsable || "—"}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.peso ?? "—"}/{a.talla ?? "—"}</td>
                <td className={`py-1 pr-1 ${campo}`}>{tipoTextoCSV(a, catalogo)}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.estudio || "—"}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.farmNombre || a.lote || "—"}{a.lote && a.farmNombre ? ` (${a.lote})` : ""}</td>
                <td className={`py-1 pr-1 ${campo}`}>{dosis ? `${dosis.valor} ${dosis.unidad}` : "—"}</td>
                <td className={`py-1 pr-1 ${campo}`}>{a.usuarioNombre}</td>
                <td className="py-1">
                  {anulacion ? <LeyendaAnulado motivo={anulacion.motivo} /> : (a.observacion || "—")}
                  {lote && (
                    <div className="text-[9px] text-gray-600 mt-0.5">
                      Lote vinculado {lote.numeroLote} · {lote.proveedor} · {lote.actividadCalibrada} mCi/{lote.volumen} mL ·
                      Vence {lote.fechaVencimiento} · Conformidad: {textoConformidad(lote)}
                    </div>
                  )}
                </td>
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
