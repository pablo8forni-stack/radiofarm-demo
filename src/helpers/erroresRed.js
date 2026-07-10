// Egreso, transferencia y anulación usan runTransaction, que necesita ida y
// vuelta al servidor para leer el estado real antes de escribir (por eso son
// atómicas y seguras contra condiciones de carrera). Sin conexión, Firestore
// no puede garantizar esa lectura fresca y la transacción falla en el momento
// en vez de quedar encolada — a diferencia del ingreso (writeBatch, sin
// lectura previa), que sí se sincroniza solo al volver la señal.
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
  "No se pudo registrar: tu usuario no tiene permiso para esta operación. Anotalo en la planilla de papel de contingencia y avisá a la encargada de radiofarmacia.";

export const MENSAJE_CONTENCION =
  "No se pudo registrar por mucha actividad al mismo tiempo sobre este lote. Esperá unos segundos y probá de nuevo; si vuelve a fallar, anotalo en la planilla de papel de contingencia.";

export function esErrorSinConexion(error) {
  return !navigator.onLine || CODIGOS_SIN_CONEXION.has(error?.code);
}

export function esErrorDePermiso(error) {
  return CODIGOS_PERMISO.has(error?.code);
}

export function esErrorDeContencion(error) {
  return CODIGOS_CONTENCION.has(error?.code);
}

// Envuelve una operación transaccional (egreso/transferencia/anulación) y
// traduce las fallas que el técnico no puede resolver por sí mismo (sin
// conexión, sin permiso, mucha contención) a un mensaje claro con qué hacer
// en el momento, dejando pasar tal cual cualquier otro error (p. ej. "Stock
// insuficiente", que ya es un mensaje entendible armado por la propia app).
export async function conMensajeDeContingencia(operacion) {
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
  }
}
