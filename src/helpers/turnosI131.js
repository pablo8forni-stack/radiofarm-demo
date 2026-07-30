import { TIPO_LABEL_I131 } from "../constants/tipoI131.js";

// Tipos válidos para un turno de Agenda -- subconjunto FIJO de
// TIPO_LABEL_I131 (que ahora también trae i131_captacion_resultado/
// i131_seguimiento_fin, agregados para el historial por paciente y que NO
// son turnos agendables). Mismo listado que turnoValido() en
// firestore.rules -- si se agrega un tipo acá, agregarlo ahí también.
export const TIPOS_TURNO_VALIDOS = [
  "i131_ablativa", "i131_dosis", "i131_barrido",
  "i131_captacion", "i131_centellograma", "i131_captacion_centellograma",
];

export const TOPE_SEMANAL_MCI = 500;

// Sólo ablativa/dosis (mCi) cuentan para el tope semanal del proveedor --
// los 3 diagnósticos son µCi (otra unidad, no comparable sin conversión) y
// barrido no administra actividad nueva. Confirmado explícitamente.
export const esTipoMci = (tipoDosis) => tipoDosis === "i131_ablativa" || tipoDosis === "i131_dosis";

export function unidadDe(tipoDosis) {
  if (!esTipoMci(tipoDosis)) return tipoDosis && tipoDosis !== "i131_barrido" ? "uCi" : null;
  return "mCi";
}

export const TIPOS_TURNO = TIPOS_TURNO_VALIDOS.map((id) => ({ id, ...TIPO_LABEL_I131[id] }));
