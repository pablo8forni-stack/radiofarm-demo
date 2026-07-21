import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";

export function FormFarm({ nombre, setNombre, kit, setKit, proveedorHabitualId, setProveedorHabitualId, proveedores, onConfirm, onCancel, confirmLabel }) {
  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Macroagregados de Albúmina" />
      <Sel label="Proveedor habitual (opcional)" value={proveedorHabitualId} onChange={(e) => setProveedorHabitualId(e.target.value)}>
        <option value="">Sin asignar</option>
        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Sel>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">Presentación del distribuidor</label>
        <div className="flex gap-2">
          <button onClick={() => setKit(1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${kit === 1 || kit === "1" ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            Por unidad
          </button>
          <button onClick={() => setKit((k) => (k === 1 || k === "1" ? 5 : k))} className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${kit > 1 || kit > "1" ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            En kit
          </button>
        </div>
        {(kit > 1 || kit > "1") && <Input label="Viales por kit" type="number" min={2} max={50} value={kit} onChange={(e) => setKit(parseInt(e.target.value) || 2)} />}
      </div>
      {(kit > 1 || kit > "1") && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
          Al ingresar, se pedirá cantidad de kits y se calculará automáticamente el total de viales.
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
        <Btn onClick={onConfirm} disabled={!nombre.trim()}>{confirmLabel}</Btn>
      </div>
    </div>
  );
}
