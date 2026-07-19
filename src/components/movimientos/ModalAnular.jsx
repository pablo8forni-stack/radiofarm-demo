import { useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { TIPO_INFO } from "../../constants/tipoMovimiento.js";

export function ModalAnular({ mov, catalogo, onConfirm, onClose }) {
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const info = TIPO_INFO[mov.tipo] || { label: mov.tipo };
  const esEntrada = mov.tipo === "ingreso" || mov.tipo === "transferencia_entrada";
  const esTransferencia = mov.tipo === "transferencia_salida" || mov.tipo === "transferencia_entrada";
  const sedeOrigen = mov.tipo === "transferencia_salida" ? mov.sedeNombre : mov.sedeRelacionada;
  const sedeDestino = mov.tipo === "transferencia_salida" ? mov.sedeRelacionada : mov.sedeNombre;

  // Si ya se consumió parte del ingreso (egresos posteriores), anularlo deja
  // el lote en 0 en vez de "restar" -- Math.max(0, ...) en
  // anularMovimientoTransaction absorbe la diferencia en silencio. Sólo
  // aplica al ingreso simple (la transferencia tiene su propio chequeo, que
  // sí bloquea en vez de sólo avisar -- ver anularTransferenciaTransaction).
  const stockActualLote = mov.tipo === "ingreso" && mov.loteId
    ? (catalogo?.stock[mov.sedeId]?.[mov.farmId] || []).find((l) => l.id === mov.loteId)?.cantidad
    : undefined;
  const hayStockParcial = stockActualLote !== undefined && stockActualLote < mov.cantidad;

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm(mov, obs.trim());
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open title={esTransferencia ? "Anular transferencia" : "Anular movimiento"} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
          {esTransferencia ? (
            <>Vas a anular la transferencia completa de <span className="font-bold">{mov.cantidad}</span> vial{mov.cantidad > 1 ? "es" : ""} de{" "}
            <span className="font-bold">{mov.farmNombre}</span> de <span className="font-bold">{sedeOrigen}</span> a <span className="font-bold">{sedeDestino}</span>, registrada el {fmtTs(mov.fecha)}.</>
          ) : (
            <>Vas a anular: <span className="font-bold">{info.label}</span> de <span className="font-bold">{mov.cantidad}</span> vial{mov.cantidad > 1 ? "es" : ""} de{" "}
            <span className="font-bold">{mov.farmNombre}</span> ({mov.sedeNombre}), registrado el {fmtTs(mov.fecha)}.</>
          )}
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
          {esTransferencia
            ? `Efecto en stock: se devolverán ${mov.cantidad} viales a ${sedeOrigen} y se descontarán ${mov.cantidad} de ${sedeDestino}. Ambos movimientos (salida y entrada) quedan en el historial marcados como ANULADOS.`
            : `Efecto en stock: ${esEntrada ? `se descontarán ${mov.cantidad} viales` : `se devolverán ${mov.cantidad} viales`}. El movimiento original queda en el historial marcado como ANULADO.`}
        </div>
        {hayStockParcial && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            El stock restante del lote ({stockActualLote}) es menor a la cantidad original del ingreso ({mov.cantidad}). Al anular, el lote quedará en 0 y la diferencia ya consumida quedará registrada solo en el historial.
          </div>
        )}
        <Input label="Motivo de la anulación (obligatorio)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Estudio cancelado, error de carga..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
          <Btn variant="danger" onClick={confirmar} disabled={!obs.trim() || enviando}>{enviando ? "Anulando..." : "Confirmar anulación"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
