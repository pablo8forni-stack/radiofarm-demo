import { useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { fmtTs } from "../../helpers/formato.js";

// Más simple que ModalAnular.jsx (movimientos): un acta no tiene efecto de
// stock que revertir ni caso de transferencia, sólo motivo obligatorio.
export function ModalAnularActa({ acta, resumen, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm(acta, motivo.trim());
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open title="Anular acta" onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
          Vas a anular: <span className="font-bold">{resumen}</span>, registrada el {fmtTs(acta.fecha)}.
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
          El acta original queda en el listado marcada como ANULADA junto con el motivo -- nunca se edita ni se borra. Después de confirmar se abre el formulario precargado con estos mismos datos para que corrijas sólo lo que estaba mal.
        </div>
        <Input label="Motivo de la anulación (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Error en la dosis cargada, paciente equivocado..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
          <Btn variant="danger" onClick={confirmar} disabled={!motivo.trim() || enviando}>{enviando ? "Anulando..." : "Confirmar anulación"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
