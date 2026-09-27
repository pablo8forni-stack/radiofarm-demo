// Extraída de TabPacientes.jsx para poder testearla aparte (mismo criterio
// que guardSecuencia.js) -- arma las opciones del selector de Lote de Tc-99m
// (Libro 2) a partir de las marcaciones crudas de Libro 1.
//
// Una fila por número de lote DISTINTO (si el mismo lote se remarca --
// repreparado -- sigue siendo una sola fila, su fecha se actualiza a la más
// nueva de sus marcaciones). Bug real encontrado (Pablo, evidencia propia):
// si el MISMO radiofármaco (farmId) se marca 2+ veces en el día -- mismo
// lote repreparado o uno distinto -- la versión vieja de esta función
// deduplicaba por texto de lote SIN guardar fecha, sin forma de saber cuál
// preparación era la más reciente; el selector escondía que había una
// marcación más nueva. Ahora cada fila lleva `fecha` (la más reciente de esa
// preparación) y, entre TODAS las filas de este farmId, sólo la de fecha más
// reciente queda `seleccionable: true` -- las demás quedan visibles pero no
// elegibles (ver ListaSeleccionable en TabPacientes.jsx), para que la
// técnica vea que existieron sin poder re-elegirlas por error.
//
// vencimiento es sólo un dato de Inventario (stock ACTUAL) para mostrar en
// la opción -- si el lote ya no está en stock, igual queda en la lista, sin
// ese dato extra.
function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function dedupeLotesPorFarm(actasRaw, farmId, lotesEnStock) {
  const stockPorLote = new Map(lotesEnStock.map((l) => [l.lote, l]));
  const fechaMasRecientePorLote = new Map();
  for (const a of actasRaw) {
    if (a.farmId !== farmId) continue;
    const anterior = fechaMasRecientePorLote.get(a.lote);
    if (!anterior || tsMillis(a.fecha) > tsMillis(anterior)) fechaMasRecientePorLote.set(a.lote, a.fecha);
  }
  return [...fechaMasRecientePorLote.entries()]
    .map(([loteTxt, fecha]) => ({ id: loteTxt, lote: loteTxt, fecha, vencimiento: stockPorLote.get(loteTxt)?.vencimiento }))
    .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha))
    .map((fila, i) => ({ ...fila, seleccionable: i === 0 }));
}
