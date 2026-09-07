import { fmtHora } from "../../helpers/formato.js";

// Encabezado propio de Pedido/Reposición -- mismo look que
// EncabezadoImpresion.jsx (logo, línea divisoria) pero con campos propios
// (fecha Y HORA completa, generado por) en vez de mes/período -- no se
// reusa el de Actas tal cual para no arriesgar ese componente ya en
// producción por campos que no le corresponden.
export function EncabezadoImpresionPedido({ sedeNombre, generadoPor }) {
  const ahora = new Date();
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3 mb-4">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="RadioFarm" className="w-12 h-12 rounded-lg" />
        <div>
          <h1 className="text-lg font-bold">Pedido / Reposición — FUESMEN</h1>
          <p className="text-sm">FUESMEN · Sistema de Radiofármacos</p>
        </div>
      </div>
      <div className="text-right text-sm">
        <p><span className="font-semibold">Sede:</span> {sedeNombre}</p>
        <p><span className="font-semibold">Generado:</span> {ahora.toLocaleDateString("es-AR")} a las {fmtHora(ahora)}</p>
        <p><span className="font-semibold">Por:</span> {generadoPor}</p>
      </div>
    </div>
  );
}
