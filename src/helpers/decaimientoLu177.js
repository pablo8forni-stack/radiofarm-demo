// Verificación cruzada de Lutecio-177 (Libro 4) -- archivo aparte, a
// propósito, de decaimientoI131.js: ese motor tiene el T½ de I-131
// (8.02 días) hardcodeado dentro de cada fórmula (no recibe el T½ como
// parámetro), así que no se puede reusar pasándole el de Lutecio-177 --
// confirmado leyendo el código antes de decidir, no asumido. El de
// Lutecio-177 es bien distinto: 6.647 días.
export const VIDA_MEDIA_LU177_DIAS = 6.647;
const LAMBDA_LU177_POR_DIA = Math.log(2) / VIDA_MEDIA_LU177_DIAS;

function aFecha(valor) {
  return valor?.toDate ? valor.toDate() : new Date(valor);
}

function diasTranscurridos(desde, hasta) {
  const ms = aFecha(hasta).getTime() - aFecha(desde).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

// Actividad en el momento de CALIBRACIÓN, calculada hacia atrás a partir de
// una actividad conocida en un momento POSTERIOR (la administración) --
// verificación cruzada del dato que viene impreso en la etiqueta del
// proveedor, no el cálculo principal (ver TabLoteDosisUnica.jsx).
export function actividadCalibradaHaciaAtras(actividadConocidaMBq, fechaCalibracion, fechaConocida) {
  const dias = diasTranscurridos(fechaCalibracion, fechaConocida);
  return actividadConocidaMBq * Math.exp(LAMBDA_LU177_POR_DIA * dias);
}
