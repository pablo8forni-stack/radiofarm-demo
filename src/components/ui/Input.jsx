export function Input({ label, hint, type, ...p }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-gray-600">{label}</label>}
      <input
        type={type}
        // Los number empiezan con un valor por defecto (ej. "1" de cantidad)
        // que sin esto queda "pegado": un click + tipear resultaba en "19" en
        // vez de reemplazarlo por "9". Seleccionar todo al enfocar hace que
        // escribir reemplace el valor entero, en cualquier input numérico de
        // la app (cantidad de ingreso/egreso/transferencia, stock mínimo...).
        onFocus={type === "number" ? (e) => e.target.select() : undefined}
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-11 md:min-h-0"
        {...p}
      />
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}
