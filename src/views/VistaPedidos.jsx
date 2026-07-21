import { useMemo, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Btn } from "../components/ui/Btn.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Sel } from "../components/ui/Sel.jsx";
import { fmtF, hoy } from "../helpers/formato.js";
import { descargarArchivo } from "../helpers/descargarArchivo.js";
import { totStock, farmsDeSede, sedesActivas, puntoReorden } from "../helpers/stock.js";

export function VistaPedidos({ catalogo, esAdmin, onToast }) {
  const [sedeF, setSedeF] = useState("");
  const [agruparPor, setAgruparPor] = useState("sede"); // "sede" | "proveedor"
  // Ajuste puntual de sesión, no se guarda en Firestore -- "sugerido" (el
  // cálculo automático) queda intacto como referencia, "cantidad" es lo que
  // realmente se exporta. Se pierde al salir de la pantalla, a propósito.
  const [cantidadesEditadas, setCantidadesEditadas] = useState({});

  const items = useMemo(() => {
    const res = [];
    sedesActivas(catalogo).forEach((sede) => {
      if (sedeF && sede.id !== sedeF) return;
      farmsDeSede(catalogo, sede.id).forEach((f) => {
        const tot = totStock(catalogo.stock[sede.id]?.[f.id] || []);
        const mn = puntoReorden(catalogo, sede.id, f.id);
        if (tot <= mn) {
          const key = `${sede.id}_${f.id}`;
          const sugerido = Math.max(0, mn * 2 - tot);
          res.push({ key, sede, farm: f, tot, mn, sugerido, cantidad: cantidadesEditadas[key] ?? sugerido });
        }
      });
    });
    return res;
  }, [catalogo, sedeF, cantidadesEditadas]);

  function setCantidad(key, valor) {
    setCantidadesEditadas((c) => ({ ...c, [key]: Math.max(0, parseInt(valor) || 0) }));
  }

  function restaurarSugerido(key) {
    setCantidadesEditadas((c) => {
      const n = { ...c };
      delete n[key];
      return n;
    });
  }

  // Agrupa la lista ya filtrada según el toggle -- misma función para la
  // pantalla y para el .txt exportado, así nunca se desincronizan. "Sin
  // proveedor asignado" siempre al final, el resto alfabético.
  function agruparItems(lista) {
    const agr = {};
    if (agruparPor === "sede") {
      lista.forEach((i) => { agr[i.sede.id] ??= { id: i.sede.id, titulo: i.sede.nombre, items: [] }; agr[i.sede.id].items.push(i); });
      return Object.values(agr);
    }
    lista.forEach((i) => {
      const prov = catalogo.proveedores.find((p) => p.id === i.farm.proveedorHabitualId);
      const key = prov?.id || "_sin";
      agr[key] ??= { id: key, titulo: prov?.nombre || "Sin proveedor asignado", contacto: prov, items: [] };
      agr[key].items.push(i);
    });
    return Object.values(agr).sort((a, b) => {
      if (a.titulo === "Sin proveedor asignado") return 1;
      if (b.titulo === "Sin proveedor asignado") return -1;
      return a.titulo.localeCompare(b.titulo);
    });
  }

  // Lista chica (decenas de ítems como mucho) -- no hace falta useMemo acá.
  const grupos = agruparItems(items);

  function exportarTxt() {
    const l = [`PEDIDO / REPOSICIÓN — FUESMEN`, `Fecha: ${fmtF(hoy())}`, `Agrupado por: ${agruparPor === "proveedor" ? "Proveedor" : "Sede"}`, ``];
    grupos.forEach(({ titulo, contacto, items: its }) => {
      l.push(`── ${titulo} ──`);
      if (agruparPor === "proveedor" && contacto) {
        const datosContacto = [contacto.contactoNombre, contacto.contactoEmail, contacto.contactoTelefono].filter(Boolean).join(" · ");
        if (datosContacto) l.push(`   Contacto: ${datosContacto}`);
      }
      its.forEach((i) => {
        const sedeTag = agruparPor === "proveedor" ? ` [${i.sede.short || i.sede.nombre}]` : "";
        l.push(`  • ${i.farm.nombre}${sedeTag} | Stock: ${i.tot} (mín: ${i.mn}) | Pedir: ${i.cantidad}`);
      });
      l.push(``);
    });
    l.push(`— RadioFarm · FUESMEN`);
    descargarArchivo(l.join("\n"), `pedido_${hoy()}.txt`, "text/plain;charset=utf-8");
    onToast("Pedido exportado");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-start md:justify-between">
        <div><h2 className="text-base font-bold text-gray-800">Lista de pedido</h2><p className="text-xs text-gray-400 mt-0.5">Stock por debajo del mínimo · todas las sedes</p></div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            <button onClick={() => setAgruparPor("sede")} className={`px-3 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-md transition ${agruparPor === "sede" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Por sede</button>
            <button onClick={() => setAgruparPor("proveedor")} className={`px-3 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-md transition ${agruparPor === "proveedor" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Por proveedor</button>
          </div>
          {esAdmin && (
            <div className="w-full md:w-auto">
              <Sel value={sedeF} onChange={(e) => setSedeF(e.target.value)}>
                <option value="">Todas las sedes</option>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            </div>
          )}
          {esAdmin && items.length > 0 && <Btn size="sm" variant="outline" onClick={exportarTxt} className="w-full md:w-auto">↓ .txt</Btn>}
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
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{g.titulo}</span>
                <div className="flex-1 h-px bg-gray-100" /><Badge color="red">{g.items.length} para pedir</Badge>
              </div>
              {esAdmin && agruparPor === "proveedor" && g.contacto && (
                <div className="text-xs text-gray-500 mb-2 -mt-1">
                  Contacto: {[g.contacto.contactoNombre, g.contacto.contactoEmail, g.contacto.contactoTelefono].filter(Boolean).join(" · ") || "Sin datos de contacto cargados"}
                </div>
              )}
              {g.items.map((i) => (
                <div key={i.key} className="bg-white border border-red-100 rounded-xl px-4 py-3 shadow-sm flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="font-semibold text-gray-800 text-sm">
                      {i.farm.nombre}
                      {agruparPor === "proveedor" && <span className="text-gray-400 font-normal"> [{i.sede.short || i.sede.nombre}]</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex gap-3 items-center flex-wrap">
                      <span>Stock: <span className="text-red-600 font-bold">{i.tot}</span></span>
                      <span>Mín: {i.mn}</span>
                      {esAdmin && (
                        <span className="flex items-center gap-1">
                          <span className="text-blue-600 font-semibold">Pedir:</span>
                          <div className="w-16"><Input type="number" min={0} value={i.cantidad} onChange={(e) => setCantidad(i.key, e.target.value)} /></div>
                          {i.cantidad !== i.sugerido && (
                            <button onClick={() => restaurarSugerido(i.key)} title={`Restaurar sugerido (${i.sugerido})`} className="text-gray-400 hover:text-gray-600 px-1">↺</button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge color="red">PEDIR</Badge>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
