import { useState } from "react";
import { PanelResumen } from "./PanelResumen.jsx";
import { TablaInventario } from "./TablaInventario.jsx";
import { totStock, farmsDeSede, sedesActivas, puntoReorden } from "../../helpers/stock.js";

export function VistaInventario({ catalogo, usuario, esAdmin, onToast }) {
  const sedesVisibles = esAdmin ? sedesActivas(catalogo) : sedesActivas(catalogo).filter((s) => s.id === usuario.sede);
  const [sedeActiva, setSedeActiva] = useState(usuario.sede);
  const countPedirSede = (sid) => farmsDeSede(catalogo, sid).filter((f) => totStock(catalogo.stock[sid]?.[f.id] || []) <= puntoReorden(catalogo, sid, f.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {esAdmin && <PanelResumen catalogo={catalogo} />}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl overflow-x-auto">
        {sedesVisibles.map((sede) => {
          const cp = countPedirSede(sede.id);
          return (
            <button key={sede.id} onClick={() => setSedeActiva(sede.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition whitespace-nowrap ${sedeActiva === sede.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {sede.short}
              {cp > 0 && <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{cp}</span>}
            </button>
          );
        })}
      </div>
      <TablaInventario sedeId={sedeActiva} catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />
    </div>
  );
}
