import { createContext, useEffect, useState } from "react";
import { listenFarms } from "../services/firestore/farms.js";
import { listenSedes } from "../services/firestore/sedes.js";
import { listenLotes } from "../services/firestore/stock.js";
import { listenProveedores } from "../services/firestore/proveedores.js";
import { listenRadioisotopos } from "../services/firestore/radioisotopos.js";
import { listenEstudios } from "../services/firestore/estudios.js";
import { registrarLog } from "../helpers/debugLog.js";

export const CatalogoContext = createContext(null);

// Un solo Provider a nivel app con los datos "chicos" (catálogo, config de
// sedes, todo el stock vía collectionGroup, proveedores) sincronizados en
// tiempo real -- mirror del `estado` de la demo, pero alimentado por
// listeners de Firestore en vez de localStorage. Movimientos y actas se
// escuchan aparte, por vista, para no cargar historial completo siempre.
//
// rol: el rol "administrativa" (Fase 1A) no tiene permiso de lectura sobre
// lotes (firestore.rules) -- a propósito, no debe ver stock. Por eso NO se
// suscribe a listenLotes en absoluto para ese rol (no es un error a
// manejar, es la ausencia intencional de un listener). "listo.stock" se
// marca de una sola vez, sin esperar ningún snapshot, para que su
// `cargando` resuelva igual de rápido que para cualquier otro rol.
//
// Para técnico/admin, un fallo REAL de listenLotes (no debería pasar nunca
// bajo las reglas actuales, es la red de seguridad) NO se trata como "sin
// stock" -- confundir "no sabemos el stock" con "no hay stock" podría hacer
// que alguien opere sobre un número falso. En cambio: se registra el error
// (consola + registrarLog, mismo visor de diagnóstico que ya usa el resto
// de la app), se expone `stockError` en el contexto para que App.jsx
// muestre un aviso visible y persistente, y de todas formas se llama a
// marcarListo("stock") -- para no colgar la app en carga infinita -- sin
// nunca pisar `stock` con un valor inventado.
export function CatalogoProvider({ children, rol }) {
  const [farms, setFarms] = useState([]);
  const [sedes, setSedes] = useState({});
  const [stock, setStock] = useState({});
  const [stockError, setStockError] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [radioisotopos, setRadioisotopos] = useState([]);
  const [estudios, setEstudios] = useState([]);
  const [listo, setListo] = useState({ farms: false, sedes: false, stock: false, proveedores: false, radioisotopos: false, estudios: false });

  useEffect(() => {
    const marcarListo = (clave) => setListo((l) => ({ ...l, [clave]: true }));
    const unsubs = [
      listenFarms((v) => { setFarms(v); marcarListo("farms"); }),
      listenSedes((v) => { setSedes(v); marcarListo("sedes"); }),
      listenProveedores((v) => { setProveedores(v); marcarListo("proveedores"); }),
      listenRadioisotopos((v) => { setRadioisotopos(v); marcarListo("radioisotopos"); }),
      listenEstudios((v) => { setEstudios(v); marcarListo("estudios"); }),
    ];
    if (rol === "administrativa") {
      marcarListo("stock");
    } else {
      unsubs.push(listenLotes(
        (v) => { setStock(v); setStockError(false); marcarListo("stock"); },
        (err) => {
          console.error("listenLotes() falló:", err);
          registrarLog(`[catalogo] listenLotes() falló: ${err.code} -- ${err.message}`);
          setStockError(true);
          marcarListo("stock");
        }
      ));
    }
    return () => unsubs.forEach((u) => u());
  }, [rol]);

  const cargando = !Object.values(listo).every(Boolean);

  return (
    <CatalogoContext.Provider value={{ farms, sedes, stock, stockError, proveedores, radioisotopos, estudios, cargando }}>
      {children}
    </CatalogoContext.Provider>
  );
}
