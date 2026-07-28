// Motor de decaimiento de I-131 -- funciones puras, sin Firestore. Una sola
// fuente de verdad para la fórmula: la usan tanto las pantallas en vivo
// (Stock de viales) como el cálculo que se congela en el desglose de una
// extracción nueva, para que nunca haya dos lugares del código calculando
// lo mismo de formas distintas.
export const VIDA_MEDIA_I131_DIAS = 8.02;
export const LAMBDA_I131_POR_DIA = Math.log(2) / VIDA_MEDIA_I131_DIAS;

function aFecha(valor) {
  return valor?.toDate ? valor.toDate() : new Date(valor);
}

export function diasTranscurridos(fechaCalibracion, hasta = new Date()) {
  const ms = aFecha(hasta).getTime() - aFecha(fechaCalibracion).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

// mCi/mL en el momento -- concentración pura por decaimiento, independiente
// de cuánto volumen ya se haya extraído (extraer no cambia la concentración
// de lo que queda, sólo la cantidad de mL disponibles).
export function concentracionMCiPorMl(actividadCalibrada, volumenInicial, dias) {
  if (!volumenInicial) return 0;
  return (actividadCalibrada / volumenInicial) * Math.exp(-LAMBDA_I131_POR_DIA * dias);
}

// Curva teórica del vial completo (asume volumen intacto) -- es la que se
// grafica en CurvaDecaimiento.jsx.
export function actividadTeorica(actividadCalibrada, dias) {
  return actividadCalibrada * Math.exp(-LAMBDA_I131_POR_DIA * dias);
}

// Actividad real restante: decaimiento aplicado x lo que efectivamente queda
// de volumen (después de descontar extracciones ya registradas). Es el punto
// destacado en "hoy" de la curva, y el número que importa para uso clínico.
export function actividadRestante(vial, volumenRestanteMl, hasta = new Date()) {
  const dias = diasTranscurridos(vial.fechaCalibracion, hasta);
  const conc = concentracionMCiPorMl(vial.actividadCalibrada, vial.volumenInicial, dias);
  return conc * Math.max(0, volumenRestanteMl);
}

// mL ya extraídos de un vial puntual, sumando todas las extracciones que lo
// referencian (una extracción puede combinar varios viales -- ver
// TabStockViales.jsx). Client-side porque Firestore no permite indexar bien
// un campo dentro de un array de objetos de largo variable.
export function volumenExtraidoDe(vialId, extracciones) {
  return extracciones.reduce((suma, ext) => {
    const item = (ext.viales || []).find((v) => v.vialId === vialId);
    return suma + (item?.mlExtraidos || 0);
  }, 0);
}

// Desglose completo de UNA porción de extracción (un vial dentro de, quizás,
// varios) -- esto es lo que se guarda tal cual en desglosePorVial, congelado
// en el momento de crear la extracción, para que una consulta futura nunca
// recalcule (y por lo tanto nunca cambie) un número regulatorio ya mostrado.
export function calcularDesglosePorVial(vial, mlExtraidos, hasta = new Date()) {
  const dias = diasTranscurridos(vial.fechaCalibracion, hasta);
  const concentracion = concentracionMCiPorMl(vial.actividadCalibrada, vial.volumenInicial, dias);
  return {
    vialId: vial.id, mlExtraidos,
    actividadCalibrada: vial.actividadCalibrada, volumenInicial: vial.volumenInicial,
    fechaCalibracion: vial.fechaCalibracion, diasTranscurridos: dias,
    concentracionMCiPorMl: concentracion, mCiCalculado: concentracion * mlExtraidos,
  };
}
