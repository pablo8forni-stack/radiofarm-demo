// Egreso, transferencia y anulación usan runTransaction, que necesita ida y
// vuelta al servidor para leer el estado real antes de escribir (por eso son
// atómicas y seguras contra condiciones de carrera) -- a diferencia del
// ingreso (writeBatch, sin lectura previa), que sí se encola y se sincroniza
// solo al volver la señal.
//
// Probado contra staging real con disableNetwork()/enableNetwork() (la forma
// oficial de simular offline del SDK): a diferencia de una lectura simple
// (getDocFromServer, que rechaza al toque con code "unavailable"),
// runTransaction NO respetó disableNetwork() -- la operación resolvió sola,
// sin nunca reconectar. No hay forma de confirmar acá qué pasa en un corte
// de red físico real (no se puede simular eso en este entorno), pero el
// resultado ya alcanza para no poder asumir "si no hay conexión, la
// transacción rechaza rápido y limpio con alguno de estos códigos" -- por
// eso egreso/transferencia/anulación usan un id de operación determinístico
// (ver operacionId en stock.js/movimientos.js) en vez de confiar en
// distinguir el error a tiempo: si el cliente reintenta después de un error
// dudoso, el id ya usado hace que el reintento sea un no-op en vez de
// aplicar el efecto dos veces, sin importar qué haya pasado la primera vez.
const CODIGOS_SIN_CONEXION = new Set(["unavailable", "deadline-exceeded", "cancelled"]);

// permission-denied: las reglas rechazaron la escritura (rol/sede no
// coincide, o algo raro en los datos). aborted/resource-exhausted: la
// transacción agotó sus reintentos por mucha contención sobre el mismo lote
// (dos técnicos operando el mismo lote casi al mismo tiempo). En los tres
// casos el técnico no tiene forma de resolverlo desde la app en el momento.
const CODIGOS_PERMISO = new Set(["permission-denied"]);
const CODIGOS_CONTENCION = new Set(["aborted", "resource-exhausted"]);

export const MENSAJE_CONTINGENCIA =
  "Sin conexión. Este movimiento no se pudo registrar en el sistema — anotalo en la planilla de papel de contingencia y cargalo en RadioFarm apenas vuelva la conexión.";

export const MENSAJE_PERMISO =
  "No se pudo registrar: tu usuario no tiene permiso para esta operación. Anotalo en la planilla de papel de contingencia y avisá al responsable de radiofarmacia.";

export const MENSAJE_CONTENCION =
  "No se pudo registrar por mucha actividad al mismo tiempo sobre este lote. Esperá unos segundos y probá de nuevo; si vuelve a fallar, anotalo en la planilla de papel de contingencia.";

// `typeof navigator` guarda contra entornos sin ese global (p. ej. los
// scripts de prueba en scripts/testing/, que corren esta misma función en
// Node): ahí `navigator.onLine` no existe, y un `!navigator.onLine` sin
// guardar clasificaría CUALQUIER error como "sin conexión" sin importar su
// causa real. En el browser el comportamiento no cambia (navigator.onLine
// siempre es un booleano real ahí).
export function esErrorSinConexion(error) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return offline || CODIGOS_SIN_CONEXION.has(error?.code);
}

export function esErrorDePermiso(error) {
  return CODIGOS_PERMISO.has(error?.code);
}

export function esErrorDeContencion(error) {
  return CODIGOS_CONTENCION.has(error?.code);
}

// Contador simple (no React) de operaciones críticas en vuelo -- egreso,
// transferencia y anulación, las que de verdad modifican stock existente.
// Lo usa el listener de 'online' en App.jsx: si la conexión vuelve mientras
// esto está en > 0, el técnico tenía una de estas operaciones en curso justo
// cuando se cortó, así que conviene avisarle que revise el Historial.
let operacionesCriticasEnCurso = 0;
export const marcarOperacionCritica = () => { operacionesCriticasEnCurso++; };
export const desmarcarOperacionCritica = () => { operacionesCriticasEnCurso = Math.max(0, operacionesCriticasEnCurso - 1); };
export const hayOperacionCriticaEnCurso = () => operacionesCriticasEnCurso > 0;

// Envuelve una operación transaccional (egreso/transferencia/anulación) y
// traduce las fallas que el técnico no puede resolver por sí mismo (sin
// conexión, sin permiso, mucha contención) a un mensaje claro con qué hacer
// en el momento, dejando pasar tal cual cualquier otro error (p. ej. "Stock
// insuficiente", que ya es un mensaje entendible armado por la propia app).
export async function conMensajeDeContingencia(operacion) {
  marcarOperacionCritica();
  try {
    return await operacion();
  } catch (error) {
    if (esErrorSinConexion(error)) {
      const e = new Error(MENSAJE_CONTINGENCIA);
      e.esContingencia = true;
      throw e;
    }
    if (esErrorDePermiso(error)) {
      const e = new Error(MENSAJE_PERMISO);
      e.esContingencia = true;
      throw e;
    }
    if (esErrorDeContencion(error)) {
      const e = new Error(MENSAJE_CONTENCION);
      e.esContingencia = true;
      throw e;
    }
    throw error;
  } finally {
    desmarcarOperacionCritica();
  }
}
