export function Badge({ color, children }) {
  const c = {
    red: "bg-red-100 text-red-700 border border-red-200",
    orange: "bg-orange-100 text-orange-700 border border-orange-200",
    green: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    blue: "bg-blue-100 text-blue-700 border border-blue-200",
    gray: "bg-gray-100 text-gray-500 border border-gray-200",
    purple: "bg-purple-100 text-purple-700 border border-purple-200",
    teal: "bg-teal-100 text-teal-700 border border-teal-200",
  };
  return <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${c[color] || c.gray}`}>{children}</span>;
}
