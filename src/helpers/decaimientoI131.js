// Motor de decaimiento de I-131 -- funciones puras, sin Firestore. Una sola
// fuente de verdad para la fórmula: la usan tanto las pantallas en vivo
// (Stock de viales) como el cálculo que se congela en el desglose de una
// extracción nueva, para que nunca haya dos lugares del código calculando
// lo mismo de formas distintas.
export const VIDA_MEDIA_I131_DIAS = 8.02;
export const LAMBDA_I131_POR_DIA = Math.log(2) / VIDA_MEDIA_I131_DIAS;

export function aFecha(valor) {
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

// ===========================================================================
// "Decaído" (9/11, decisión de Pablo) -- un vial/extracción de I-131 está
// decaído cuando su actividad restante calculada es MENOR a 0,5 mCi (un solo
// umbral, terapéutico y diagnóstico por igual). Puede quedar volumen y estar
// decaído igual -- NO es lo mismo que "agotado por volumen" (eso ya lo cubre
// volumenRestante <= 0, sin cambios). La fecha de vencimiento es sólo
// informativa -- nunca entra en ninguna de estas funciones.
// ===========================================================================
export const UMBRAL_DECAIDO_I131_MCI = 0.5;

// Margen de seguridad (9/11, ajuste C de Pablo) para las ventanas de tiempo
// que acotan las consultas de extracciones/vinculaciones (ver actas.js y
// TabStockViales.jsx/TabPacientes.jsx) -- `fecha` de una extracción/acta es
// SIEMPRE serverTimestamp() (ver addActaI131Extraccion, actas.js), nunca
// tipeada ni retroactiva; `fechaCalibracion` de un vial, en cambio, SÍ es un
// datetime-local tipeado por la técnica (ver TabStockViales.jsx#guardarVial)
// -- puede quedar, por error de tipeo, con una hora del mismo día posterior
// al momento real en que se registró el vial o se hizo una extracción same-
// day. Sin este margen, una extracción legítima del mismo día de la
// calibración podría quedar excluida de la ventana por pura diferencia de
// horario tipeado vs. servidor.
export const MARGEN_VENTANA_DIAS_I131 = 1;

export function fechaMenosMargenDias(fecha, dias = MARGEN_VENTANA_DIAS_I131) {
  return new Date(aFecha(fecha).getTime() - dias * 24 * 60 * 60 * 1000);
}

// Cota superior de la actividad real SIN leer ninguna extracción -- nunca
// hace falta para decidir que un vial YA está decaído. Demostración: la
// actividad real es concentración(días) × volumenRestante, y
// volumenRestante <= volumenInicial siempre (nunca se extrae más de lo que
// había) -- por lo tanto actividadRestante <= concentración(días) ×
// volumenInicial = actividadTeorica(actividadCalibrada, días). Si la
// teórica (que asume volumen INTACTO, el caso más favorable posible) ya
// cruzó el umbral, la real también, sin excepción. Esto es lo que permite
// clasificar la mayoría de los viales viejos como decaídos con cero
// lecturas de extracciones (ver TabStockViales.jsx).
export function decaidoPorTeorica(vial, ahora = new Date()) {
  return actividadTeorica(vial.actividadCalibrada, diasTranscurridos(vial.fechaCalibracion, ahora)) < UMBRAL_DECAIDO_I131_MCI;
}

// Función única (9/11) que reemplaza las 3 copias idénticas que existían en
// TabStockViales.jsx (tabla desktop, tarjeta mobile) y VialDetalle.jsx --
// mismo cálculo exacto, solo centralizado y con el booleano de decaimiento
// ya resuelto. `extracciones` tiene que venir YA acotado a una ventana que
// cubra desde antes de vial.fechaCalibracion (ver fechaMenosMargenDias) --
// esta función no lo verifica, confía en quien la llama (ver comentario de
// listenActasDesdeFecha en actas.js).
export function estadoDecaimientoVial(vial, extracciones, ahora = new Date()) {
  const volumenRestante = Math.max(0, vial.volumenInicial - volumenExtraidoDe(vial.id, extracciones));
  const actividad = actividadRestante(vial, volumenRestante, ahora);
  return { volumenRestante, actividadRestante: actividad, estaDecaido: actividad < UMBRAL_DECAIDO_I131_MCI };
}

// Extracción SIN dosis vinculada -- decae desde su propia actividad
// congelada al momento de extraerla, sin depender del vial de origen ni de
// ninguna otra extracción (cero lecturas nuevas). Prioriza actividadMedida
// (el dato real del activímetro) sobre actividadCalculada (la guía teórica,
// ver DesgloseCalculo.jsx) -- si tiene las dos, la medida es la que manda.
// Si no tiene NINGUNA de las dos (dato viejo/malformado), falla ABIERTO
// (nunca decaída) -- pedido explícito de Pablo: más vale mostrarla de más
// que ocultar por error una extracción real que hace falta vincular.
export function estaDecaidaExtraccion(extraccion, ahora = new Date()) {
  const actividadBase = extraccion.actividadMedida ?? extraccion.actividadCalculada;
  if (!actividadBase) return false;
  return actividadTeorica(actividadBase, diasTranscurridos(extraccion.fecha, ahora)) < UMBRAL_DECAIDO_I131_MCI;
}
