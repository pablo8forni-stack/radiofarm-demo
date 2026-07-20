import { useState } from "react";
import { todasLasSedes, totStock } from "../../helpers/stock.js";
import { toggleFarmEnSede } from "../../services/firestore/sedes.js";

export function TabSedes({ catalogo, onToast }) {
  const sedes = todasLasSedes(catalogo);
  const [sedeActiva, setSedeActiva] = useState(() => (sedes.find((s) => s.principal) || sedes[0])?.id);

  async function toggleFarm(farmId) {
    const actuales = catalogo.sedes[sedeActiva]?.farmIds || [];
    const activo = actuales.includes(farmId);
    if (activo) {
      const conStock = totStock(catalogo.stock[sedeActiva]?.[farmId] || []) > 0;
      if (conStock) { onToast("Tiene stock activo en esta sede. Primero registrá el egreso.", "error"); return; }
    }
    try {
      await toggleFarmEnSede(sedeActiva, farmId, !activo);
      const farm = catalogo.farms.find((f) => f.id === farmId);
      onToast(activo ? `${farm?.nombre} quitado de ${catalogo.sedes[sedeActiva]?.short}` : `${farm?.nombre} agregado a ${catalogo.sedes[sedeActiva]?.short}`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  const activos = catalogo.sedes[sedeActiva]?.farmIds || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {sedes.map((s) => (
          <button key={s.id} onClick={() => setSedeActiva(s.id)} className={`px-3 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition whitespace-nowrap ${sedeActiva === s.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {s.short}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Activá o desactivá radiofármacos para <span className="font-semibold text-gray-700">{catalogo.sedes[sedeActiva]?.nombre}</span>.
        Los desactivados dejan de aparecer en el inventario de esa sede.
      </p>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {catalogo.farms.map((f, i) => {
          const activo = activos.includes(f.id);
          const conStock = totStock(catalogo.stock[sedeActiva]?.[f.id] || []) > 0;
          return (
            <div key={f.id} className={`flex items-center justify-between px-5 py-3.5 ${i < catalogo.farms.length - 1 ? "border-b border-gray-50" : ""} hover:bg-gray-50/40 transition`}>
              <div>
                <div className={`font-semibold text-sm ${activo ? "text-gray-800" : "text-gray-400"}`}>{f.nombre}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {f.viales_x_kit > 1 ? `Kit ${f.viales_x_kit}u` : "Por unidad"}
                  {activo && conStock && <span className="ml-2 text-emerald-600 font-medium">· {totStock(catalogo.stock[sedeActiva]?.[f.id] || [])} viales en stock</span>}
                </div>
              </div>
              <button onClick={() => toggleFarm(f.id)} className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${activo ? "bg-blue-600" : "bg-gray-200"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${activo ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
