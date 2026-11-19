// Tipo de anulación (Paso T, 19/11): obligatorio al anular un acta con
// pacienteFicha (Tc-99m, Lutecio-177, MIBG, los 8 subtipos de I-131 oral) --
// nunca para marcación/elución/lotes, que no llevan ficha. Mismo patrón que
// sitioInyeccion.js: una sola constante, no repartida por cada pantalla.
export const TIPOS_ANULACION = [
  { codigo: "error_carga", etiqueta: "Error de carga (mismo paciente)" },
  { codigo: "estudio_no_realizado", etiqueta: "Estudio no realizado (ficha liberada)" },
];

const ETIQUETA_POR_CODIGO = new Map(TIPOS_ANULACION.map((t) => [t.codigo, t.etiqueta]));

// null (no "—") para anulaciones de antes de este cambio o de tipos sin
// ficha -- en pantalla/impresión esos casos no agregan nada entre paréntesis,
// a diferencia de sitioInyeccion.js (que siempre tiene una celda que llenar).
export const etiquetaTipoAnulacion = (codigo) => ETIQUETA_POR_CODIGO.get(codigo) || null;
