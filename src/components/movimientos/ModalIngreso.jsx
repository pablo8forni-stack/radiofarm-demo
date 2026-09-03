import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { hoy } from "../../helpers/formato.js";

// itemEditando: cuando se pasa, precarga el formulario con un ítem ya
// agregado al carrito (para corregirlo sin tener que recargarlo de cero) en
// vez de arrancar en blanco para uno nuevo.
export function ModalIngreso({ open, farm, proveedores, itemEditando, onConfirm, onClose }) {
  const [lote, setLote] = useState("");
  const [venc, setVenc] = useState("");
  const [cant, setCant] = useState(1);
  // Unidades sueltas ADEMÁS de los kits enteros -- caso real: kits ya
  // empezados (frascos usados antes de existir este registro en
  // RadioFarm) al inventariar la heladera para arrancar. Se suma al total
  // sin multiplicarse por vxk -- son unidades individuales, no kits
  // parciales. Sólo tiene sentido cuando el radiofármaco viene en kits
  // (enKit); para "por unidad" no hay distinción kit/suelta que hacer.
  const [unidadesSueltas, setUnidadesSueltas] = useState(0);
  const [provId, setProvId] = useState(proveedores[0]?.id || "");
  const [obs, setObs] = useState("");

  useEffect(() => {
    if (itemEditando) {
      setLote(itemEditando.lote);
      setVenc(itemEditando.vencimiento);
      // itemEditando.kits puede ser 0 (carga de sólo sueltas) -- "|| cantidad"
      // fallaba ahí porque 0 es falsy en JS, precargaba el TOTAL en vez de 0.
      setCant(itemEditando.kits != null ? itemEditando.kits : itemEditando.cantidad);
      setUnidadesSueltas(itemEditando.unidadesSueltas || 0);
      setProvId(proveedores.find((p) => p.nombre === itemEditando.proveedorNombre)?.id || proveedores[0]?.id || "");
      setObs(itemEditando.observacion);
    } else {
      setLote(""); setVenc(""); setCant(1); setUnidadesSueltas(0); setProvId(proveedores[0]?.id || ""); setObs("");
    }
  }, [open]);

  const prov = proveedores.find((p) => p.id === provId);
  const vxk = farm?.viales_x_kit || 1;
  const enKit = vxk > 1;
  const sueltas = enKit ? unidadesSueltas : 0;
  const totalViales = cant * vxk + sueltas;

  return (
    <Modal open={open} title={`${itemEditando ? "Editar ingreso" : "Ingreso"} — ${farm?.nombre}`} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <Input label="N° de lote" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej: ARN-2025-050" />
        <Input label="Fecha de vencimiento" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} min={hoy()} />
        <div className="flex flex-col gap-1">
          {/* Mínimo 1 SÓLO cuando no hay kits (ahí cant es la única cantidad
              posible, no puede quedar en 0) -- con kits, 0 es válido a
              propósito: el caso real es cargar SÓLO unidades sueltas de un
              kit ya empezado, sin ningún kit entero (kits=0, sueltas=N). La
              validación real de "no guardar un ítem vacío" está en el botón
              de abajo, sobre el total, no acá. */}
          <Input label={enKit ? `Cantidad (kits de ${vxk} viales)` : "Cantidad (viales)"} type="number" min={enKit ? 0 : 1} value={cant}
            onChange={(e) => setCant(Math.max(enKit ? 0 : 1, parseInt(e.target.value) || 0))} />
          {enKit && (
            <>
              <Input label="Unidades sueltas adicionales (opcional)" type="number" min={0} value={unidadesSueltas}
                onChange={(e) => setUnidadesSueltas(Math.max(0, parseInt(e.target.value) || 0))}
                placeholder="Ej: kit ya empezado, frascos usados antes de este registro" />
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
                {cant} kit{cant > 1 ? "s" : ""} × {vxk}{sueltas > 0 ? ` + ${sueltas} suelta${sueltas > 1 ? "s" : ""}` : ""} = <span className="font-bold">{totalViales} viales</span> en stock
              </div>
            </>
          )}
        </div>
        <Sel label="Proveedor" value={provId} onChange={(e) => setProvId(e.target.value)}>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Sel>
        <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Pedido parcial, faltó un lote..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn
            onClick={() => onConfirm({ lote, vencimiento: venc, cantidad: totalViales, kits: enKit ? cant : null, unidadesSueltas: sueltas || null, proveedorNombre: prov?.nombre, observacion: obs.trim() })}
            disabled={!lote || !venc || totalViales <= 0}
          >
            {itemEditando ? "Guardar cambios" : "Agregar a la lista"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
