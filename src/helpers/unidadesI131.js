// Conversión de unidades para I-131, Stock de viales (25/11, Pablo) --
// funciones puras, sin Firestore. NO toca decaimientoI131.js (el motor de
// decaimiento en sí no cambia): esto sólo formatea para mostrar o convierte
// un dato tipeado antes de guardarlo, siempre en las mismas unidades de
// siempre (mCi en Firestore).

// Extracciones se muestran en µCi en pantalla (decisión de Pablo) -- la
// actividad calibrada del vial y la actividad restante del stock SIGUEN en
// mCi, esta función no se usa para esas dos. 1 decimal, como en el ejemplo
// (0,0883 mCi -> "88.3 µCi"). toFixed ya resuelve cualquier ruido de punto
// flotante al redondear a esa cifra -- no hace falta redondear antes.
export function mCiATextoMicroCi(valorMCi) {
  return `${(valorMCi * 1000).toFixed(1)} µCi`;
}

// Conversión al GUARDAR el campo "Actividad medida (activímetro)" cuando la
// técnica tipeó en µCi (unidad por defecto, ver selector en VialDetalle) --
// redondeada a 9 decimales para evitar artefactos de punto flotante tipo
// 0.08830000000000001 en el valor que efectivamente queda en Firestore (no
// sólo en lo que se muestra en pantalla). El campo sigue siendo mCi, la
// regla actividadMedida > 0 no cambia.
export function microCiAMCi(valorMicroCi) {
  return Math.round((valorMicroCi / 1000) * 1e9) / 1e9;
}

// Volumen total de la dilución (alícuota del vial original + agua) --
// mismo motivo que arriba: 0.61 + 100 puede dar 100.61000000000001 en punto
// flotante. Redondeado a 3 decimales, de sobra para mL de jeringa. Este es
// el valor que se guarda como volumenInicial (igual que hoy, para no tocar
// decaimientoI131.js ni los viales ya cargados).
export function volumenTotalDilucion(volumenAlicuota, volumenDiluyente) {
  return Math.round((volumenAlicuota + volumenDiluyente) * 1000) / 1000;
}

// Aviso de posible error de unidad (25/11, Pablo): la medida y la calculada
// difieren en una relación cercana a 1000x -- típico de tipear en µCi un
// valor que el selector dejó marcado como mCi, o al revés. Banda [500,2000]
// (en cualquiera de los dos sentidos): angosta para no superponerse nunca
// con el aviso de 15% ya existente (que cubre discrepancias reales, mucho
// más chicas), ancha para no exigir que el error sea EXACTAMENTE 1000x.
// Guarda defensiva: si falta cualquiera de los dos valores (0 o ausente),
// no hay relación que calcular -- no es error de unidad, es dato incompleto.
export function pareceErrorDeUnidad(actividadMedidaMCi, actividadCalculadaMCi) {
  if (!actividadMedidaMCi || !actividadCalculadaMCi) return false;
  const relacion = actividadMedidaMCi / actividadCalculadaMCi;
  return (relacion >= 500 && relacion <= 2000) || (relacion >= 1 / 2000 && relacion <= 1 / 500);
}
