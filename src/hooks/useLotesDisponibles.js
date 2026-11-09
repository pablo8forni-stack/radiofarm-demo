import { useCallback, useEffect, useRef, useState } from "react";
import { estadoPorLoteDosisUnica, disponiblesDesdeEstadoPorLote } from "../services/firestore/mibgLotes.js";
import { hoy } from "../helpers/formato.js";

// Clave estable del conjunto que de verdad importa para recalcular --
// SÓLO los ids de los lotes candidatos y los ids de las anulaciones (sede,
// isótopo y vencimiento ya determinan QUIÉN entra a `lotes`, eso lo decide
// el llamador antes de pasarlo acá). Si lotes/anulaciones son referencias
// NUEVAS pero representan el mismo conjunto (típico de un listener en
// vivo que reemite sin cambios reales), esta clave queda igual.
function claveEstable(lotes, anulaciones) {
  const idsLotes = lotes.map((l) => l.id).sort().join(",");
  const idsAnulados = [...anulaciones.keys()].sort().join(",");
  return `${idsLotes}|${idsAnulados}`;
}

// Fail-closed ante un error que no es un rechazo por lote individual (eso ya
// lo absorbe Promise.allSettled DENTRO de estadoPorLoteDosisUnica, ver
// mibgLotes.js -- eso nunca llega a tirar). Esto es para un error más
// arriba (ej. de programación, o lotes/anulaciones con una forma
// inesperada) -- ningún lote se muestra "disponible" por descarte cuando ni
// siquiera se pudo clasificar, y la corrida igual queda resuelta (cargando
// no se queda pegado en true para siempre).
function estadoFalloCerrado(lotes, error) {
  return new Map(lotes.map((l) => [l.id, { estado: "no-verificable", uso: null, error }]));
}

// Hook compartido (TabPacientes.jsx y TabLoteDosisUnica.jsx) sobre
// estadoPorLoteDosisUnica -- orquesta CUÁNDO recalcular (clave estable, sin
// relanzar de más) y evita que una corrida vieja pise a una más nueva
// (corridaRef, un token incremental: una respuesta que llega tarde nunca
// sobreescribe el resultado de una corrida posterior, aunque haya empezado
// antes -- caso real posible si cambia el isótopo rápido mientras la
// corrida vieja todavía está en vuelo).
//
// cargando NO es un booleano propio -- es DERIVADO de comparar la clave
// ACTUAL (de lotes/anulaciones, en cada render) contra claveResuelta (la
// clave para la que estadoPorLote de verdad vale, estado de React). Una
// sola fuente de verdad: no hay forma de que "cargando" quede desincronizado
// de si el resultado mostrado corresponde al pedido actual, ni de quedarse
// pegado en true para siempre (el try/catch de ejecutar() garantiza que
// SIEMPRE se llega a fijar claveResuelta, incluso si estadoPorLoteDosisUnica
// revienta). refrescar() fuerza un recálculo invalidando claveResuelta
// (poniéndola en null) -- eso solo ya alcanza para que cargando vuelva a
// true de inmediato (clave !== null), sin necesitar tocar ninguna otra ref.
export function useLotesDisponibles(lotes, { anulaciones, prefijo }) {
  const [estadoPorLote, setEstadoPorLote] = useState(new Map());
  const [claveResuelta, setClaveResuelta] = useState(null);
  const corridaRef = useRef(0);
  const claveAnteriorRef = useRef(null);

  const clave = claveEstable(lotes, anulaciones);
  const cargando = clave !== claveResuelta;

  const ejecutar = useCallback(async (lotesActuales, anulacionesActuales, claveDeEstaCorrida) => {
    const miCorrida = ++corridaRef.current;
    let resultado;
    try {
      resultado = await estadoPorLoteDosisUnica(lotesActuales, { anulaciones: anulacionesActuales, prefijo, hoyISO: hoy() });
    } catch (error) {
      resultado = estadoFalloCerrado(lotesActuales, error);
    }
    if (miCorrida !== corridaRef.current) return; // llegó tarde -- se descarta, no pisa una corrida más nueva
    setEstadoPorLote(resultado);
    setClaveResuelta(claveDeEstaCorrida);
  }, [prefijo]);

  useEffect(() => {
    if (clave === claveAnteriorRef.current) return;
    claveAnteriorRef.current = clave;
    ejecutar(lotes, anulaciones, clave);
  }, [lotes, anulaciones, ejecutar, clave]);

  // Fuerza un recálculo aunque la clave no haya cambiado -- necesario
  // después de guardar una administración: el lote usado sigue teniendo el
  // mismo id, la clave no se mueve, pero su estado real sí cambió (ya no
  // está disponible). No toca claveAnteriorRef (eso es sólo del efecto de
  // arriba, para decidir si hace falta una corrida NUEVA por cambio de
  // conjunto) -- invalidar claveResuelta ya alcanza para cargando y para que
  // ejecutar() la vuelva a fijar al terminar.
  const refrescar = useCallback(() => {
    setClaveResuelta(null);
    ejecutar(lotes, anulaciones, clave);
  }, [lotes, anulaciones, ejecutar, clave]);

  return {
    estadoPorLote,
    cargando,
    refrescar,
    disponibles: disponiblesDesdeEstadoPorLote(lotes, estadoPorLote),
  };
}
