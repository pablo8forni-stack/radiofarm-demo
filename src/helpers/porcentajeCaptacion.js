// Fórmula de %Captación -- pura, sin Firestore. A diferencia del
// decaimiento (helpers/decaimientoI131.js), no depende del tiempo en que se
// consulta: los mismos 4 inputs siempre dan el mismo resultado, así que acá
// no hace falta "congelar" nada por el paso del tiempo (sí se guarda el
// resultado en el acta igual, para no recalcular en cada render/CSV).
export function calcularPorcentajeCaptacion({ cuentasPaciente, fondo, cuentasEstandar, volumenAdministrado }) {
  const denominador = (cuentasEstandar - fondo) * volumenAdministrado;
  if (!denominador) return null;
  return ((cuentasPaciente - fondo) * 100) / denominador;
}
