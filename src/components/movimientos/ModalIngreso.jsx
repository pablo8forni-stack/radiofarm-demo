import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { hoy } from "../../helpers/formato.js";

export function ModalIngreso({ open, farm, proveedores, onConfirm, onClose }) {
  const [lote, setLote] = useState("");
  const [venc, setVenc] = useState("");
  const [cant, setCant] = useState(1);
  const [provId, setProvId] = useState(proveedores[0]?.id || "");
  const [obs, setObs] = useState("");

  useEffect(() => {
    setLote(""); setVenc(""); setCant(1); setProvId(proveedores[0]?.id || ""); setObs("");
  }, [open]);

  const prov = proveedores.find((p) => p.id === provId);
  const vxk = farm?.viales_x_kit || 1;
  const enKit = vxk > 1;
  const totalViales = cant * vxk;

  return (
    <Modal open={open} title={`Ingreso — ${farm?.nombre}`} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <Input label="N° de lote" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej: ARN-2025-050" />
        <Input label="Fecha de vencimiento" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} min={hoy()} />
        <div className="flex flex-col gap-1">
          <Input label={enKit ? `Cantidad (kits de ${vxk} viales)` : "Cantidad (viales)"} type="number" min={1} value={cant}
            onChange={(e) => setCant(Math.max(1, parseInt(e.target.value) || 1))} />
          {enKit && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
              {cant} kit{cant > 1 ? "s" : ""} × {vxk} viales = <span className="font-bold">{totalViales} viales</span> en stock
            </div>
          )}
        </div>
        <Sel label="Proveedor" value={provId} onChange={(e) => setProvId(e.target.value)}>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Sel>
        <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Pedido parcial, faltó un lote..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn
            onClick={() => onConfirm({ lote, vencimiento: venc, cantidad: totalViales, kits: enKit ? cant : null, proveedorNombre: prov?.nombre, observacion: obs.trim() })}
            disabled={!lote || !venc}
          >
            Registrar ingreso
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
