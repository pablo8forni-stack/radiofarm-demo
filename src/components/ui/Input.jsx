export function Input({ label, hint, ...p }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-gray-600">{label}</label>}
      <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" {...p} />
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}
