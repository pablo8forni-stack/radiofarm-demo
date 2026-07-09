import { useMemo, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Btn } from "../components/ui/Btn.jsx";
import { Sel } from "../components/ui/Sel.jsx";
import { fmtF, hoy } from "../helpers/formato.js";
import { descargarArchivo } from "../helpers/descargarArchivo.js";
import { totStock, farmsDeSede, sedesActivas, puntoReorden } from "../helpers/stock.js";

export function VistaPedidos({ catalogo, esAdmin, onToast }) {
  const [sedeF, setSedeF] = useState("");

  const items = useMemo(() => {
    const res = [];
    sedesActivas(catalogo).forEach((sede) => {
      if (sedeF && sede.id !== sedeF) return;
      farmsDeSede(catalogo, sede.id).forEach((f) => {
        const tot = totStock(catalogo.stock[sede.id]?.[f.id] || []);
        const mn = puntoReorden(catalogo, sede.id, f.id);
        if (tot <= mn) res.push({ sede, farm: f, tot, mn, sugerido: Math.max(0, mn * 2 - tot) });
      });
    });
    return res;
  }, [catalogo, sedeF]);

  function exportarTxt() {
    const agr = {};
    items.forEach((i) => { agr[i.sede.id] ??= { sede: i.sede, items: [] }; agr[i.sede.id].items.push(i); });
    const l = [`PEDIDO / REPOSICIÓN — FUESMEN`, `Fecha: ${fmtF(hoy())}`, ``];
    Object.values(agr).forEach(({ sede, items: its }) => {
      l.push(`── ${sede.nombre} ──`);
      its.forEach((i) => l.push(`  • ${i.farm.nombre} | Stock: ${i.tot} (mín: ${i.mn}) | Pedir: ~${i.sugerido}`));
      l.push(``);
    });
    l.push(`— RadioFarm · FUESMEN`);
    descargarArchivo(l.join("\n"), `pedido_${hoy()}.txt`, "text/plain;charset=utf-8");
    onToast("Pedido exportado");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div><h2 className="text-base font-bold text-gray-800">Lista de pedido</h2><p className="text-xs text-gray-400 mt-0.5">Stock por debajo del mínimo · todas las sedes</p></div>
        <div className="flex gap-2 flex-wrap">
          {esAdmin && (
            <Sel value={sedeF} onChange={(e) => setSedeF(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          )}
          {esAdmin && items.length > 0 && <Btn size="sm" variant="outline" onClick={exportarTxt}>↓ .txt</Btn>}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-sm font-bold text-emerald-700">Todo el stock al día</div>
          <div className="text-xs text-emerald-500 mt-1">No hay productos por debajo del mínimo</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sedesActivas(catalogo).map((sede) => {
            const its = items.filter((i) => i.sede.id === sede.id);
            if (!its.length) return null;
            return (
              <div key={sede.id}>
                <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{sede.nombre}</span>
                  <div className="flex-1 h-px bg-gray-100" /><Badge color="red">{its.length} para pedir</Badge>
                </div>
                {its.map(({ farm, tot, mn, sugerido }) => (
                  <div key={farm.id} className="bg-white border border-red-100 rounded-xl px-4 py-3 shadow-sm flex items-center justify-between gap-3 mb-2">
                    <div>
                      <div className="font-semibold text-gray-800 text-sm">{farm.nombre}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex gap-3">
                        <span>Stock: <span className="text-red-600 font-bold">{tot}</span></span>
                        <span>Mín: {mn}</span>
                        {esAdmin && <span className="text-blue-600 font-semibold">Pedir: ~{sugerido}</span>}
                      </div>
                    </div>
                    <Badge color="red">PEDIR</Badge>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
