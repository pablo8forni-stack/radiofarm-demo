import { Badge } from "../../components/ui/Badge.jsx";
import { totStock, farmsDeSede, sedesActivas, puntoReorden } from "../../helpers/stock.js";

export function PanelResumen({ catalogo }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
      {sedesActivas(catalogo).map((sede) => {
        const farms = farmsDeSede(catalogo, sede.id);
        const pedir = farms.filter((f) => totStock(catalogo.stock[sede.id]?.[f.id] || []) <= puntoReorden(catalogo, sede.id, f.id));
        const conStock = farms.filter((f) => totStock(catalogo.stock[sede.id]?.[f.id] || []) > 0);
        return (
          <div key={sede.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">{sede.short}</div>
            <div className="text-2xl font-bold text-gray-800">{conStock.length}<span className="text-sm font-normal text-gray-400">/{farms.length}</span></div>
            <div className="text-xs text-gray-400 mb-2">con stock</div>
            {pedir.length > 0 ? <Badge color="red">⚠ {pedir.length} para pedir</Badge> : <Badge color="green">Stock OK</Badge>}
          </div>
        );
      })}
    </div>
  );
}
