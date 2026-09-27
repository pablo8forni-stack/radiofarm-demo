// Extraída de TabMarcacion.jsx para poder testearla aparte (mismo criterio
// que dedupeLotesPorFarm.js/guardSecuencia.js) -- arma las opciones del
// selector de Lote de Marcación (Libro 1) con granularidad por MOVIMIENTO
// individual de egreso, no por texto de lote.
//
// Bug real encontrado (Pablo, evidencia propia): con 2 egresos + 2
// marcaciones reales del mismo lote (stock a 0), se pudo crear una TERCERA
// marcación sin ningún egreso real que la respalde -- el selector viejo
// deduplicaba por texto de lote, así que 2 egresos del mismo lote (o
// incluso de lotes distintos, mismo farmId) se veían como una sola opción
// SIEMPRE disponible, sin importar cuántas marcaciones ya la habían
// consumido. "1 egreso = 1 marcación", confirmado -- cada egreso es su
// propia fila, consumible una sola vez (ver marcacionesRaw/anulaciones).
//
// Motivos de descarte (vencimiento/derrame) excluidos -- mismo criterio que
// ya tenía TabMarcacion.jsx: un egreso de descarte no es candidato de
// marcación.
const MOTIVOS_DESCARTE = ["Vencimiento", "Derrame / accidente"];

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// marcacionesRaw: actas tipo "marcacion" ya cargadas (no hace falta acotarlas
// a HOY -- un egreso de hoy sólo puede haber sido consumido por una
// marcación de hoy o de un instante después, siempre dentro de la ventana ya
// cargada en pantalla). anulaciones: Map anulaId -> acta de anulación (mismo
// shape que ya arma TabMarcacion.jsx/TabPacientes.jsx).
export function egresosDisponiblesParaMarcar(egresadosHoyRaw, farmId, lotesEnStock, marcacionesRaw, anulaciones) {
  const stockPorLote = new Map(lotesEnStock.map((l) => [l.lote, l]));
  const consumidos = new Set(
    marcacionesRaw
      .filter((a) => a.egresoMovimientoId && !anulaciones.has(a.id))
      .map((a) => a.egresoMovimientoId)
  );
  return egresadosHoyRaw
    .filter((m) => m.farmId === farmId && !MOTIVOS_DESCARTE.includes(m.motivo))
    .map((m) => ({
      id: m.id, lote: m.lote, fecha: m.fecha,
      vencimiento: stockPorLote.get(m.lote)?.vencimiento,
      seleccionable: !consumidos.has(m.id),
    }))
    .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha));
}
