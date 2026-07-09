import { useEffect, useState } from "react";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";

export function ReordenForm({ min, onGuardar, onClose }) {
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">Cuando el stock llegue o baje de este número, el producto aparece como PEDIR.</p>
      <Input label="Viales mínimos" type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} />
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={() => onGuardar(val)}>Guardar</Btn>
      </div>
    </div>
  );
}
