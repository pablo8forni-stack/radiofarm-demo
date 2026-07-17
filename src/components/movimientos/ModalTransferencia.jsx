import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { fmtF } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { uid } from "../../helpers/id.js";

export function ModalTransferencia({ open, farm, sedeOrigenId, catalogo, usuario, onConfirm, onClose }) {
  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [operacionId, setOperacionId] = useState(() => uid());

  const disp = (catalogo.stock[sedeOrigenId]?.[farm?.id] || []).filter((l) => l.cantidad > 0);
  const destinos = sedesActivas(catalogo).filter((s) => s.id !== sedeOrigenId && (catalogo.sedes[s.id]?.farmIds || []).includes(farm?.id));

  // operacionId se genera una vez por apertura del modal, no en cada click de
  // "Confirmar" -- ver mismo criterio en ModalEgreso.jsx.
  useEffect(() => {
    if (disp.length) setLoteId(disp[0].id);
    setCantidad(1);
    setDestino(destinos[0]?.id || "");
    setObs("");
    setEnviando(false);
    setOperacionId(uid());
  }, [open, farm?.id]);

  const lote = disp.find((l) => l.id === loteId);

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm({ loteId, cantidad, sedeDestino: destino, observacion: obs.trim(), operacionId });
    } finally {
      setEnviando(false);
    }
  }
  const sedeOrigen = sedesActivas(catalogo).find((s) => s.id === sedeOrigenId) || { short: sedeOrigenId };

  return (
    <Modal open={open} title={`Transferencia — ${farm?.nombre}`} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        {!disp.length ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin stock disponible para transferir.</p>
        ) : !destinos.length ? (
          <p className="text-sm text-gray-400 text-center py-6">Ninguna otra sede tiene este radiofármaco asignado. Activalo primero en Configuración.</p>
        ) : (
          <>
            <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2 text-xs text-teal-700">
              Desde <span className="font-bold">{sedeOrigen?.short}</span>. Se descuenta acá y se acredita en la sede destino, vinculado como un solo movimiento.
            </div>
            <Sel label="Lote a transferir" value={loteId} onChange={(e) => setLoteId(e.target.value)}>
              {disp.map((l) => <option key={l.id} value={l.id}>{l.lote} · Venc: {fmtF(l.vencimiento)} · {l.cantidad} disp.</option>)}
            </Sel>
            <Input label="Cantidad (viales)" type="number" min={1} max={lote?.cantidad || 1} value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))} />
            <Sel label="Sede destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              {destinos.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Sel>
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Préstamo por faltante puntual" />
            <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">Por: <span className="font-semibold text-gray-700">{usuario?.nombre}</span></div>
            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
              <Btn variant="teal" onClick={confirmar} disabled={!loteId || !destino || enviando}>
                {enviando ? "Transfiriendo..." : "Confirmar transferencia"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
