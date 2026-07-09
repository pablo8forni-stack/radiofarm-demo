import { useEffect } from "react";

export function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, []);
  const bg = { success: "bg-emerald-600", error: "bg-red-500", info: "bg-blue-600" };
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] ${bg[type] || bg.success} text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl`}>
      {msg}
    </div>
  );
}
