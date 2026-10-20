import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { fmtF } from "../../helpers/formato.js";
import { uid } from "../../helpers/id.js";
import { MOTIVOS_EGRESO, MOTIVOS_DESCARTE } from "../../constants/motivosEgreso.js";

export function ModalEgreso({ open, farm, lotes, usuario, onConfirm, onClose }) {
  const [loteId, setLoteId] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState("Estudio");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [operacionId, setOperacionId] = useState(() => uid());
  const disp = (lotes || []).filter((l) => l.cantidad > 0);
  const esDescarte = MOTIVOS_DESCARTE.includes(motivo);
  // El egreso es siempre de un vial para los motivos de marcación (Estudio,
  // Control de calidad, Otro) -- si hacen falta más viales, son más egresos,
  // cada uno con su propia marcación (ver egresosDisponiblesParaMarcar.js:
  // "1 egreso = 1 marcación"). El descarte (Vencimiento/Derrame) sí puede
  // ser de varios viales de una vez. `cantidad` sigue existiendo como
  // estado para el caso descarte; lo que de verdad se envía es
  // cantidadEfectiva, que ignora cualquier valor viejo de `cantidad` que
  // haya quedado de una selección anterior de motivo descarte -- mismo
  // valor que exige firestore.rules del lado del servidor (movimientoValido/
  // esMotivoDescarte), así que un envío real nunca debería chocar con esa
  // regla.
  const cantidadEfectiva = esDescarte ? cantidad : 1;

  // operacionId se genera una vez por apertura del modal (no en cada click de
  // "Confirmar"): si el egreso falla y el técnico reintenta sin cerrar el
  // modal, reusa el mismo id -- egresoTransaction lo usa como id
  // determinístico del movimiento, así el reintento no duplica el descuento
  // de stock si el intento anterior sí había llegado a aplicarse.
  useEffect(() => {
    if (disp.length) setLoteId(disp[0].id);
    setCantidad(1);
    setMotivo("Estudio");
    setObs("");
    setEnviando(false);
    setOperacionId(uid());
  }, [open, farm?.id]);

  const lote = disp.find((l) => l.id === loteId);

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm({ loteId, cantidad: cantidadEfectiva, motivo, observacion: obs.trim(), operacionId });
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
            {esDescarte ? (
              <Input label="Cantidad (viales)" type="number" min={1} max={lote?.cantidad || 1} value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))} />
            ) : (
              <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">
                Cantidad: <span className="font-semibold text-gray-700">1 vial</span>. Para más viales hacé otro egreso — cada egreso respalda una sola marcación.
              </div>
            )}
            <Sel label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {MOTIVOS_EGRESO.map((m) => <option key={m}>{m}</option>)}
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
