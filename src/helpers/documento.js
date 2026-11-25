// Fase 2.1a (24/11, Pablo) -- normalización ÚNICA de documento de
// identidad para la emisión de fichas. Puede haber pasaportes (letras +
// números) además de DNI -- NUNCA se valida que sea sólo dígitos, a
// diferencia de otros campos de esta app. Saca puntos/espacios/guiones,
// pasa a mayúscula. No toca TabPacientes.jsx ni la carga manual -- ese
// flujo sigue guardando pacienteDni tal cual lo tipeen, sin pasar por
// esto; por eso toda comparación contra datos de carga manual tiene que
// normalizar los DOS lados en el momento de comparar, nunca asumir que
// uno de los dos ya viene limpio.
export function normalizarDocumento(texto) {
  return (texto ?? "").trim().replace(/[.\s-]/g, "").toUpperCase();
}
