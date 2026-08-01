// N° de Ficha (Libro 2): secuencia ÚNICA y CRECIENTE para TODA la
// institución, asignada por VM RIS -- nunca por sede, nunca se reinicia ni
// se repite. Normalizamos a la forma canónica (sólo dígitos, sin ceros a la
// izquierda) para que "4521" y "04521" no puedan colisionar como fichas
// "distintas" y burlar la unicidad (fichasUsadas/{ficha}, ver
// services/firestore/actas.js) -- mismo criterio de limpieza que ya usa
// pacienteDni en el importador de turnos (helpers/importarTurnosI131.js).
// null si el texto (después de limpiar separadores) no es puramente
// numérico -- el llamador lo trata como formato inválido.
export function normalizarFicha(texto) {
  const limpio = (texto || "").replace(/[.\s-]/g, "");
  return /^\d+$/.test(limpio) ? String(parseInt(limpio, 10)) : null;
}
