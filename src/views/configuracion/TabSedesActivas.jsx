import { Badge } from "../../components/ui/Badge.jsx";
import { SEDES } from "../../constants/sedes.js";
import { idsSedesActivas } from "../../helpers/stock.js";
import { toggleSedeActiva } from "../../services/firestore/sedes.js";

export function TabSedesActivas({ catalogo, roles, onToast }) {
  const activas = idsSedesActivas(catalogo);

  async function toggle(sedeId) {
    if (sedeId === "central") return;
    const activa = activas.includes(sedeId);
    try {
      await toggleSedeActiva(sedeId, !activa);
      const sede = SEDES.find((s) => s.id === sedeId);
      onToast(activa ? `${sede?.short} desactivada — oculta en toda la app` : `${sede?.short} activada`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        <span className="font-semibold">Modo piloto:</span> desactivá las sedes que aún no operan con la app. Las sedes desactivadas desaparecen del inventario, pedidos, historial y actas, pero <span className="font-semibold">sus datos se conservan intactos</span> y reaparecen al reactivarlas. FUESMEN Central no se puede desactivar.
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {SEDES.map((s, i) => {
          const activa = activas.includes(s.id);
          const esCentral = s.id === "central";
          const usuariosSede = roles.filter((r) => r.sede === s.id && r.rol !== "admin").length;
          return (
            <div key={s.id} className={`flex items-center justify-between px-5 py-4 ${i < SEDES.length - 1 ? "border-b border-gray-50" : ""} ${!activa ? "bg-gray-50/50" : ""}`}>
              <div>
                <div className={`font-semibold text-sm ${activa ? "text-gray-800" : "text-gray-400"}`}>{s.nombre}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {esCentral ? "Sede principal — siempre activa" : activa ? `Operativa · ${usuariosSede} técnico${usuariosSede !== 1 ? "s" : ""} asignado${usuariosSede !== 1 ? "s" : ""}` : "Desactivada — datos conservados"}
                </div>
              </div>
              {esCentral ? (
                <Badge color="blue">Siempre activa</Badge>
              ) : (
                <button onClick={() => toggle(s.id)} className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${activa ? "bg-blue-600" : "bg-gray-200"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${activa ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
