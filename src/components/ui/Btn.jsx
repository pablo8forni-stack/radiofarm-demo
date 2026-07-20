export function Btn({ variant = "primary", size = "md", disabled, children, className = "", ...p }) {
  // min-h-11 (44px) sólo en mobile -- estándar Apple/Google de área de toque
  // mínima. md:min-h-0 lo revierte en desktop, donde no aplica (mouse, no dedo).
  const base = "font-semibold rounded-xl transition-all focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed min-h-11 md:min-h-0";
  const v = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    danger: "bg-red-500 text-white hover:bg-red-600 shadow-sm",
    ghost: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    teal: "bg-teal-600 text-white hover:bg-teal-700 shadow-sm",
    warning: "border border-amber-300 text-amber-700 hover:bg-amber-50",
  };
  const s = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  return (
    <button disabled={disabled} className={`${base} ${v[variant]} ${s[size]} ${className}`} {...p}>
      {children}
    </button>
  );
}
