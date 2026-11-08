// Derivación de "disponible/usado/anulado" de un lote de MIBG -- ANTES vivía
// duplicada de forma sutilmente distinta en TabMibg.jsx (estadoDe) y
// TabPacientes.jsx (picker de lote), y las dos versiones divergieron: una
// filtraba usos anulados, la otra no (auditoría de seguridad, hallazgo #12).
// Una sola función, usada en los tres lados, para que nunca vuelva a pasar.
//
// anulaciones: Map<id, anulación> keyed por anulaId (mismo Map que ya arma
// cada pantalla desde listenAnulacionesActas). usoPorLoteId: Map<mibgLoteId,
// actaDeUso> -- IMPORTANTE: el llamador tiene que armar este mapa excluyendo
// usos ya anulados (`.filter(u => !anulaciones.has(u.id))`) -- anular la
// acta de administración es independiente de anular el lote (corrección de
// diseño: eran dos hechos distintos, no el mismo evento), así que un lote
// cuya única acta de uso está anulada vuelve a estar "disponible" sin tocar
// el lote en sí.
export function estadoMibgLote(loteId, { anulaciones, usoPorLoteId }) {
  if (anulaciones.has(loteId)) return "anulado";
  return usoPorLoteId.has(loteId) ? "usado" : "disponible";
}

// Lotes de Lutecio-177 (Libro 4) del mes elegido -- filtra CLIENT-SIDE en
// vez de agregar un where de fecha a lotesPorSede (mibgLotes.js), que no lo
// necesita para ningún otro llamador y así se evita un índice compuesto
// nuevo (sedeId+fecha). desde/hasta: "YYYY-MM-DD" (mismo shape que
// primerYUltimoDiaMes). Límite de mes con hora LOCAL explícita
// (00:00:00.000 / 23:59:59.999) -- mismo criterio que actasPorRango -- así
// un lote que llega el último día del mes no se corre al mes siguiente por
// comparar contra medianoche UTC.
//
// Un lote SIN campo fecha NO entra a NINGÚN mes (decisión de Pablo, 4/11,
// tras verlo en staging real: 298 lotes de prueba sin fecha aparecían
// repetidos en TODOS los libros mensuales -- un libro regulatorio no puede
// repetir el mismo lote cada mes, eso no es un detalle menor). Ver
// lotesSinFecha más abajo -- el llamador los muestra aparte, como aviso
// para corregir (anulación + recarga del lote), nunca mezclados en un mes.
export function lotesDelMes(lotes, { desde, hasta }) {
  const d0 = new Date(`${desde}T00:00:00`);
  const d1 = new Date(`${hasta}T23:59:59.999`);
  return lotes.filter((l) => {
    if (!l.fecha) return false;
    const f = l.fecha?.toDate ? l.fecha.toDate() : new Date(l.fecha);
    return f >= d0 && f <= d1;
  });
}

// Lotes SIN fecha de llegada -- excluidos de lotesDelMes de arriba, para
// CUALQUIER mes. No depende de desde/hasta: es un problema de dato
// incompleto, no "de qué mes es". addMibgLote (mibgLotes.js) siempre pone
// serverTimestamp(), así que esto no debería pasar por la app real -- pero
// no hay garantía sobre datos viejos, corregidos a mano, o (caso real
// encontrado en staging) escritos directo por un test harness que bypasea
// el servicio. El llamador los muestra como aviso aparte -- la corrección
// sigue siendo anulación + recarga del lote, no una edición directa.
export function lotesSinFecha(lotes) {
  return lotes.filter((l) => !l.fecha);
}

// Texto del aviso de Libro 4 para los lotes de lotesSinFecha -- lista como
// mucho los primeros 5 numeroLote, "y N más" si hay más. Caso real que
// obliga a esto: en staging llegó a haber 298 de una sola vez (datos de
// prueba del test harness, ver mibgLotes.js) -- listarlos todos hubiera
// sido un muro de texto en vez de un aviso legible. Separado de
// lotesSinFecha (y testeable sin React) porque el corte en 5 es puramente
// de presentación, no afecta qué lotes quedan excluidos de cada mes.
export function avisoLotesSinFecha(lotes) {
  if (lotes.length === 0) return "";
  const TOPE = 5;
  const numeros = lotes.slice(0, TOPE).map((l) => l.numeroLote || l.id);
  const resto = lotes.length - numeros.length;
  const lista = resto > 0 ? `${numeros.join(", ")} y ${resto} más` : numeros.join(", ");
  const plural = lotes.length !== 1 ? "s" : "";
  return `${lotes.length} lote${plural} de Lutecio-177 sin fecha de llegada, no incluido${plural} en ningún libro mensual: revisar -- ${lista}.`;
}

// Un solo normalizador para numeroLote de lotes de dosis única (MIBG y
// Lutecio-177) -- mayúsculas + espacios de sobra recortados. Deliberadamente
// más simple que normalizarLoteSeisDigitos (helpers/lote.js): ese otro es el
// formato específico de 6 dígitos de BACON (generadores/radiofármacos de
// stock), que no aplica acá -- acá sólo hace falta mayúscula+trim para que
// "lps261101e-25", "LPS261101E-25" y " LPS261101E-25 " comparen igual.
// Usarlo en los DOS lados de cualquier comparación (no sólo al guardar) es
// lo que permite que un lote viejo guardado en minúscula (de antes de este
// cambio, create-only, nunca se migra) siga matcheando contra uno nuevo.
export function normalizarNumeroLoteDosisUnica(numeroLote) {
  return (numeroLote || "").trim().toUpperCase().replace(/\s+/g, " ");
}

// Aviso (NO bloqueante) de vial duplicado -- mismo numeroLote normalizado +
// mismo numeroVial + misma sede, en un lote que no esté anulado. No exige
// "disponible": un vial ya usado con ese mismo número también es indicio de
// error de tipeo real (ver caso de Pablo, vial 5 y vial 6 de
// LPS261101E-25). `lotes` son los YA cargados en memoria (listenMibgLotes
// no tiene límite) -- esto es pura comparación local, sin lecturas nuevas.
export function loteVialYaExiste(lotes, { numeroLote, numeroVial, sedeId, anulaciones }) {
  const loteNorm = normalizarNumeroLoteDosisUnica(numeroLote);
  if (!loteNorm || !numeroVial) return false;
  return lotes.some((l) =>
    l.sedeId === sedeId &&
    normalizarNumeroLoteDosisUnica(l.numeroLote) === loteNorm &&
    l.numeroVial === numeroVial &&
    !anulaciones.has(l.id)
  );
}
