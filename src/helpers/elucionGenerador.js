import { normalizarLoteSeisDigitos } from "./lote.js";
import { fmtF } from "./formato.js";

// Fase de elución (24/11, Pablo) -- separa dos conceptos que antes estaban
// acoplados en un solo esPrimeraVez:
//   - marcadorExiste: ¿ya existe generadoresVistos para este lote/sede?
//     (eso sigue decidiéndolo loteGeneradorYaRegistrado, sin cambios).
//   - loteTieneVigenteConDatos: ¿hay, entre las actas YA cargadas por los
//     listeners de la pantalla, una elución de ese lote que NO esté anulada
//     y que tenga actividadCalibrada? (criterio "tiene datos" = sólo
//     actividadCalibrada != null, a propósito -- así un lote cargado antes
//     del 3/10, que sólo tiene ese campo, NO vuelve a pedir los otros 3).
// pedirDatos = !marcadorExiste || !loteTieneVigenteConDatos -- si el
// marcador no existe, es la primera vez de verdad; si existe pero la única
// elución vigente de ese lote no tiene datos (anulada, o nunca los tuvo),
// hay que volver a pedirlos.
//
// `anulaciones` es el mismo Map ya armado en TabElucion.jsx (keyed por
// anulaId == id del acta original -- elución no tiene ficha, así que
// anulaId siempre es el id del acta misma, nunca un id de ficha).
//
// Ventana de 150 (decisión de Pablo, 24/11): `actas` viene de
// listenActas("elucion", ...), que trae como mucho las últimas 150
// eluciones de la sede (todos los lotes mezclados, sin filtro de fecha --
// ver services/firestore/actas.js). Si la única elución vigente con datos
// de un lote quedara fuera de esas 150, loteTieneVigenteConDatos no la
// vería y pedirDatos daría true de más. Aceptado sin fallback a propósito:
// ~55 eluciones/mes es una ESTIMACIÓN de Pablo (conocimiento operativo del
// servicio, no una medición sobre datos reales ni de staging/producción),
// así que 150 cubrirían ~2,5 meses, más que la vida útil real de un
// generador -- y el error, cuando pasa, va en el sentido seguro (pide de
// más, nunca deja de pedir un dato regulatorio).

export function loteTieneVigenteConDatos(actas, anulaciones, sedeId, loteGenerador) {
  if (!loteGenerador) return false;
  const loteNorm = normalizarLoteSeisDigitos(loteGenerador);
  return actas.some((a) =>
    a.sedeId === sedeId &&
    a.loteGenerador &&
    normalizarLoteSeisDigitos(a.loteGenerador) === loteNorm &&
    a.actividadCalibrada != null &&
    !anulaciones.has(a.id)
  );
}

export function calcularPedirDatos({ marcadorExiste, actas, anulaciones, sedeId, loteGenerador }) {
  if (!marcadorExiste) return true;
  return !loteTieneVigenteConDatos(actas, anulaciones, sedeId, loteGenerador);
}

// Texto de la subfila -- Parte 2, punto 8/9. null si el acta no tiene
// NINGUNO de los 3 campos nuevos (lotes viejos con sólo actividadCalibrada
// no llevan subfila -- ese dato ya está en la columna "Act. calibrada").
// fmtF (formato.js) ya formatea "AAAA-MM-DD" por recorte de string, sin
// pasar por `new Date` -- evita el corrimiento de un día por zona horaria
// (UTC-3) que `new Date("2026-11-01")` sí tendría.
export function textoSubfilaGenerador(a) {
  if (a.fechaCalibracion == null && a.fechaVencimiento == null && a.numeroGenerador == null) return null;
  const partes = [];
  if (a.numeroGenerador) partes.push(`Generador N° ${a.numeroGenerador}`);
  if (a.actividadCalibrada != null) partes.push(`Mo-99 calibrada ${a.actividadCalibrada} mCi`);
  if (a.fechaCalibracion) partes.push(`Calibrado ${fmtF(a.fechaCalibracion)}`);
  if (a.fechaVencimiento) partes.push(`Vence ${fmtF(a.fechaVencimiento)}`);
  return partes.join(" · ");
}
