import { EncabezadoImpresionPedido } from "./EncabezadoImpresionPedido.jsx";
import { fmtF } from "../../helpers/formato.js";

// Marca vencido/próximo a vencer con negrita + texto, NUNCA sólo color --
// mismo criterio ya confirmado con el marcado de actas anuladas: tiene que
// leerse igual en blanco y negro (muchas impresoras de oficina imprimen
// sin color por default).
function EtiquetaVencimiento({ dias, vencido, pronto }) {
  if (vencido) return <span className="font-bold">⚠ VENCIDO ({Math.abs(dias)} días)</span>;
  if (pronto) return <span className="font-bold">⚠ VENCE EN {dias} DÍAS</span>;
  return null;
}

// Documento por sede -- "A reponer" es lo que ya se ve en pantalla (stock
// por debajo del mínimo); "En stock" es NUEVO: una fila por LOTE
// individual (no un total agregado -- confirmado que catalogo.stock puede
// tener varios lotes por radiofármaco, cada uno con su propio vencimiento,
// ver helpers/stock.js), para poder revisar vencimientos de lo que queda
// en la heladera antes de que se venza sin usarse.
export function ImprimiblePedido({ sedeNombre, generadoPor, aReponer, enStock }) {
  return (
    <div className="p-6 text-black text-xs font-sans">
      <EncabezadoImpresionPedido sedeNombre={sedeNombre} generadoPor={generadoPor} />

      <h2 className="text-sm font-bold mb-2">A reponer</h2>
      {aReponer.length === 0 ? (
        <p className="text-gray-500 mb-6">Todo el stock al día -- nada por debajo del mínimo.</p>
      ) : (
        <table className="w-full border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1 pr-2">Radiofármaco</th>
              <th className="py-1 pr-2">Stock</th>
              <th className="py-1 pr-2">Mínimo</th>
              <th className="py-1">Cantidad a pedir</th>
            </tr>
          </thead>
          <tbody>
            {aReponer.map((i) => (
              <tr key={i.farm.id} className="border-b border-gray-300">
                <td className="py-1 pr-2">{i.farm.nombre}</td>
                <td className="py-1 pr-2">{i.tot}</td>
                <td className="py-1 pr-2">{i.mn}</td>
                <td className="py-1 font-bold">{i.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="text-sm font-bold mb-2">En stock</h2>
      <p className="text-gray-500 mb-2">Radiofármacos con stock por encima del mínimo -- para revisar vencimientos de lo que queda en la heladera.</p>
      {enStock.length === 0 ? (
        <p className="text-gray-500">Sin radiofármacos en esta condición.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1 pr-2">Radiofármaco</th>
              <th className="py-1 pr-2">Lote</th>
              <th className="py-1 pr-2">Cantidad</th>
              <th className="py-1">Vencimiento</th>
            </tr>
          </thead>
          <tbody>
            {enStock.flatMap((grupo) =>
              grupo.lotes.map((l, i) => (
                <tr key={`${grupo.farm.id}-${l.lote}-${i}`} className={`border-b border-gray-300 ${l.vencido || l.pronto ? "font-bold" : ""}`}>
                  <td className="py-1 pr-2">{grupo.farm.nombre}</td>
                  <td className="py-1 pr-2">{l.lote || "—"}</td>
                  <td className="py-1 pr-2">{l.cantidad}</td>
                  <td className="py-1">
                    {fmtF(l.vencimiento)}
                    {(l.vencido || l.pronto) && <span className="ml-2"><EtiquetaVencimiento dias={l.dias} vencido={l.vencido} pronto={l.pronto} /></span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
