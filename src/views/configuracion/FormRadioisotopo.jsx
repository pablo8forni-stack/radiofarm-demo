import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";

export function FormRadioisotopo({ form, setForm, onConfirm, onCancel, confirmLabel, error }) {
  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre" value={form.nombre} onChange={(e) => setForm({ nombre: e.target.value })} placeholder="Ej: Lutecio-177" />
      {error && <p className="text-red-600 text-xs leading-relaxed">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
        <Btn onClick={onConfirm} disabled={!form.nombre.trim()}>{confirmLabel}</Btn>
      </div>
    </div>
  );
}
