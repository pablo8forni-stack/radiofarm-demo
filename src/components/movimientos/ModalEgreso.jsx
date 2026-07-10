import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { fmtF } from "../../helpers/formato.js";

export function ModalEgreso({ open, farm, lotes, usuario, onConfirm, onClose }) {
  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState("Estudio");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const disp = (lotes || []).filter((l) => l.cantidad > 0);

  useEffect(() => {
    if (disp.length) setLoteId(disp[0].id);
    setCantidad(1);
    setMotivo("Estudio");
    setObs("");
    setEnviando(false);
  }, [open, farm?.id]);

  const lote = disp.find((l) => l.id === loteId);

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm({ loteId, cantidad, motivo, observacion: obs.trim() });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open={open} title={`Egreso — ${farm?.nombre}`} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        {!disp.length ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin stock disponible.</p>
        ) : (
          <>
            <Sel label="Lote" value={loteId} onChange={(e) => setLoteId(e.target.value)}>
              {disp.map((l) => (
                <option key={l.id} value={l.id}>{l.lote} · Venc: {fmtF(l.vencimiento)} · {l.cantidad} disp.</option>
              ))}
            </Sel>
            <Input label="Cantidad (viales)" type="number" min={1} max={lote?.cantidad || 1} value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))} />
            <Sel label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {["Estudio", "Control de calidad", "Derrame / accidente", "Vencimiento", "Otro"].map((m) => <option key={m}>{m}</option>)}
            </Sel>
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Paciente suspendido, vial roto..." />
            <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">Por: <span className="font-semibold text-gray-700">{usuario?.nombre}</span></div>
            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
              <Btn variant="danger" onClick={confirmar} disabled={enviando}>{enviando ? "Registrando..." : "Registrar egreso"}</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
