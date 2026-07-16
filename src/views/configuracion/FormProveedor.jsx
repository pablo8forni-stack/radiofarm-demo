import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";

export function FormProveedor({ form, setForm, onConfirm, onCancel, confirmLabel }) {
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre / razón social" value={form.nombre} onChange={set("nombre")} placeholder="Ej: Droguería del Sud S.A." />
      <Input label="CUIT" value={form.cuit} onChange={set("cuit")} placeholder="20-12345678-9" />
      <Input label="Dirección" value={form.direccion} onChange={set("direccion")} placeholder="Ej: Av. Siempre Viva 742, Mendoza" />
      <Input label="Persona de contacto" value={form.contactoNombre} onChange={set("contactoNombre")} placeholder="Ej: María Pérez" />
      <Input label="Email de contacto" type="email" value={form.contactoEmail} onChange={set("contactoEmail")} placeholder="ventas@proveedor.com" />
      <Input label="Teléfono" value={form.contactoTelefono} onChange={set("contactoTelefono")} placeholder="Ej: 0800-555-0001" />
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
        <Btn onClick={onConfirm} disabled={!form.nombre.trim()}>{confirmLabel}</Btn>
      </div>
    </div>
  );
}
