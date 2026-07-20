export function Sel({ label, children, ...p }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-gray-600">{label}</label>}
      <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-11 md:min-h-0" {...p}>
        {children}
      </select>
    </div>
  );
}
