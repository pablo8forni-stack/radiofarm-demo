import { createContext, useEffect, useState } from "react";
import { listenFarms } from "../services/firestore/farms.js";
import { listenSedes } from "../services/firestore/sedes.js";
import { listenLotes } from "../services/firestore/stock.js";
import { listenProveedores } from "../services/firestore/proveedores.js";

export const CatalogoContext = createContext(null);

// Un solo Provider a nivel app con los datos "chicos" (catálogo, config de
// sedes, todo el stock vía collectionGroup, proveedores) sincronizados en
// tiempo real -- mirror del `estado` de la demo, pero alimentado por
// listeners de Firestore en vez de localStorage. Movimientos y actas se
// escuchan aparte, por vista, para no cargar historial completo siempre.
export function CatalogoProvider({ children }) {
  const [farms, setFarms] = useState([]);
  const [sedes, setSedes] = useState({});
  const [stock, setStock] = useState({});
  const [proveedores, setProveedores] = useState([]);
  const [listo, setListo] = useState({ farms: false, sedes: false, stock: false, proveedores: false });

  useEffect(() => {
    const marcarListo = (clave) => setListo((l) => ({ ...l, [clave]: true }));
    const unsubs = [
      listenFarms((v) => { setFarms(v); marcarListo("farms"); }),
      listenSedes((v) => { setSedes(v); marcarListo("sedes"); }),
      listenLotes((v) => { setStock(v); marcarListo("stock"); }),
      listenProveedores((v) => { setProveedores(v); marcarListo("proveedores"); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const cargando = !Object.values(listo).every(Boolean);

  return (
    <CatalogoContext.Provider value={{ farms, sedes, stock, proveedores, cargando }}>
      {children}
    </CatalogoContext.Provider>
  );
}
