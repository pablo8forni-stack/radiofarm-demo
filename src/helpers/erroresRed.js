// Egreso, transferencia y anulación usan runTransaction, que necesita ida y
// vuelta al servidor para leer el estado real antes de escribir (por eso son
// atómicas y seguras contra condiciones de carrera). Sin conexión, Firestore
// no puede garantizar esa lectura fresca y la transacción falla en el momento
// en vez de quedar encolada — a diferencia del ingreso (writeBatch, sin
// lectura previa), que sí se sincroniza solo al volver la señal.
const CODIGOS_SIN_CONEXION = new Set(["unavailable", "deadline-exceeded", "cancelled"]);

export const MENSAJE_CONTINGENCIA =
  "Sin conexión. Este movimiento no se pudo registrar en el sistema — anotalo en la planilla de papel de contingencia y cargalo en RadioFarm apenas vuelva la conexión.";

export function esErrorSinConexion(error) {
  return !navigator.onLine || CODIGOS_SIN_CONEXION.has(error?.code);
}

// Envuelve una operación transaccional (egreso/transferencia/anulación) y
// convierte cualquier falla por falta de conexión en el mensaje de
// contingencia, dejando pasar cualquier otro error tal cual.
export async function conMensajeDeContingencia(operacion) {
  try {
    return await operacion();
  } catch (error) {
    if (esErrorSinConexion(error)) {
      const e = new Error(MENSAJE_CONTINGENCIA);
      e.esContingencia = true;
      throw e;
    }
    throw error;
  }
}
