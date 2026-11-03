import { createContext, useEffect, useState } from "react";
import { listenFarms } from "../services/firestore/farms.js";
import { listenSedes } from "../services/firestore/sedes.js";
import { listenLotes, listenLotesSede } from "../services/firestore/stock.js";
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
// Para técnico/admin, un fallo REAL de listenLotes/listenLotesSede (no
// debería pasar nunca bajo las reglas actuales, es la red de seguridad) NO
// se trata como "sin stock" -- confundir "no sabemos el stock" con "no hay
// stock" podría hacer que alguien opere sobre un número falso. En cambio:
// se registra el error (consola + registrarLog, mismo visor de diagnóstico
// que ya usa el resto de la app), se expone `stockError` en el contexto
// para que App.jsx muestre un aviso visible y persistente, y de todas
// formas se llama a marcarListo("stock") -- para no colgar la app en carga
// infinita -- sin nunca pisar `stock` con un valor inventado.
//
// Aislamiento entre sedes (2026-11): técnico pasa a escuchar SÓLO su propia
// sede (listenLotesSede, sedeId=usuario.sede -- nunca sedeAuditando, eso es
// sólo de admin) -- firestore.rules ya no le permite el collectionGroup sin
// filtro de las demás sedes. Admin sigue con listenLotes (todas las sedes,
// excepción de logística aceptada -- ver firestore.rules). rol "tecnico" sin
// sedeId (roles/{email}.sede vacío/ausente -- no debería pasar nunca, cuenta
// mal dada de alta) NO llama a listenLotesSede(undefined,...) -- eso arma
// collection(db,'sedes',undefined,'lotes'), una ruta inválida -- se trata
// como el mismo error visible que un fallo real de lectura. Mismo criterio
// para cualquier rol que no sea exactamente "administrativa"/"tecnico"/
// "admin" (dato corrupto o un rol nuevo todavía no contemplado acá): no se
// suscribe a nada por las dudas, pero tampoco se queda en blanco sin avisar.
export function CatalogoProvider({ children, rol, sedeId }) {
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
    const marcarErrorStock = (motivo, err) => {
      console.error(`[catalogo] stock no disponible: ${motivo}`, err || "");
      registrarLog(`[catalogo] stock no disponible: ${motivo}${err ? ` -- ${err.code}: ${err.message}` : ""}`);
      setStockError(true);
      marcarListo("stock");
    };
    const unsubs = [
      listenFarms((v) => { setFarms(v); marcarListo("farms"); }),
      listenSedes((v) => { setSedes(v); marcarListo("sedes"); }),
      listenProveedores((v) => { setProveedores(v); marcarListo("proveedores"); }),
      listenRadioisotopos((v) => { setRadioisotopos(v); marcarListo("radioisotopos"); }),
      listenEstudios((v) => { setEstudios(v); marcarListo("estudios"); }),
    ];
    if (rol === "administrativa") {
      marcarListo("stock");
    } else if (rol === "tecnico") {
      if (!sedeId) {
        marcarErrorStock(`rol "tecnico" sin sedeId (roles/{email}.sede vacío o ausente)`);
      } else {
        unsubs.push(listenLotesSede(
          sedeId,
          (v) => { setStock(v); setStockError(false); marcarListo("stock"); },
          (err) => marcarErrorStock("listenLotesSede() falló", err)
        ));
      }
    } else if (rol === "admin") {
      unsubs.push(listenLotes(
        (v) => { setStock(v); setStockError(false); marcarListo("stock"); },
        (err) => marcarErrorStock("listenLotes() falló", err)
      ));
    } else {
      marcarErrorStock(`rol desconocido: "${rol}"`);
    }
    return () => unsubs.forEach((u) => u());
  }, [rol, sedeId]);

  const cargando = !Object.values(listo).every(Boolean);

  return (
    <CatalogoContext.Provider value={{ farms, sedes, stock, stockError, proveedores, radioisotopos, estudios, cargando }}>
      {children}
    </CatalogoContext.Provider>
  );
}
