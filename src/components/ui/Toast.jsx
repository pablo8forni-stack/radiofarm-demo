import { useEffect } from "react";

// Duración base por tipo (antes fija en 2500ms para todos, insuficiente para
// alcanzar a leer errores o confirmaciones de operaciones críticas). `duracion`
// permite pisar este default puntualmente -- ver egreso/transferencia/anulación,
// que la usan para quedar en pantalla tanto como un error.
const DURACION_DEFAULT = { error: 6000, info: 4000, success: 4000 };

export function Toast({ msg, type, duracion, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, duracion || DURACION_DEFAULT[type] || DURACION_DEFAULT.success);
    return () => clearTimeout(t);
  }, []);
  const bg = { success: "bg-emerald-600", error: "bg-red-500", info: "bg-blue-600" };
  return (
    <div className={`fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-[100] ${bg[type] || bg.success} text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl`}>
      {msg}
    </div>
  );
}
