import { useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { TIPO_INFO } from "../../constants/tipoMovimiento.js";

export function ModalAnular({ mov, onConfirm, onClose }) {
  const [obs, setObs] = useState("");
  const info = TIPO_INFO[mov.tipo] || { label: mov.tipo };
  const esEntrada = mov.tipo === "ingreso" || mov.tipo === "transferencia_entrada";
  const esTransferencia = mov.tipo === "transferencia_salida" || mov.tipo === "transferencia_entrada";
  const sedeOrigen = mov.tipo === "transferencia_salida" ? mov.sedeNombre : mov.sedeRelacionada;
  const sedeDestino = mov.tipo === "transferencia_salida" ? mov.sedeRelacionada : mov.sedeNombre;
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
        <Input label="Motivo de la anulación (obligatorio)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Estudio cancelado, error de carga..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="danger" onClick={() => onConfirm(mov, obs.trim())} disabled={!obs.trim()}>Confirmar anulación</Btn>
        </div>
      </div>
    </Modal>
  );
}
