// N° de Ficha (Libro 2): secuencia correlativa asignada por VM RIS, propia
// de CADA SEDE (no global -- cada sede lleva su propio libro de Actas,
// numeración independiente, ver nota larga en firestore.rules). Normalizamos
// a la forma canónica (sólo dígitos, sin ceros a la izquierda) para que
// "4521" y "04521" no puedan colisionar como fichas "distintas" y burlar la
// unicidad (fichasUsadas/{sedeId}_{ficha}_{intento}, ver
// services/firestore/actas.js) -- mismo criterio de limpieza que ya usa
// pacienteDni en el importador de turnos (helpers/importarTurnosI131.js).
// null si el texto (después de limpiar separadores) no es puramente
// numérico -- el llamador lo trata como formato inválido.
export function normalizarFicha(texto) {
  const limpio = (texto || "").replace(/[.\s-]/g, "");
  return /^\d+$/.test(limpio) ? String(parseInt(limpio, 10)) : null;
}

// Orden de listado (Libro 2, Gestión I-131): por N° de Ficha ascendente --
// el orden real de VM RIS, no el momento en que cada acta terminó de
// guardarse (un estudio con demora propia, ej. MIBI con ergometría, puede
// guardarse varios minutos después de un paciente de ficha posterior). Es
// SOLO de visualización -- no toca fecha/serverTimestamp() ni ninguna
// consulta a Firestore, ver comentario en TabPacientes.jsx/
// TabRegistrosI131.jsx donde se usa.
// Orden compuesto (sedeId, fichaNum asc): nunca mezcla fichas de sedes
// distintas en una sola secuencia -- agrupa por sede primero (aunque hoy
// sedeAuditando ya deja cada listado en una sola sede, esto lo deja
// correcto igual si algo volviera a mezclar sedes). Ficha no numérica o
// vacía va al final, sin alterar el orden relativo entre ellas (Array.sort
// es estable) ni el del resto.
export function compararPorSedeYFicha(a, b) {
  if (a.sedeId !== b.sedeId) return a.sedeId < b.sedeId ? -1 : 1;
  const fa = parseInt(a.pacienteFicha, 10);
  const fb = parseInt(b.pacienteFicha, 10);
  const aValida = Number.isFinite(fa);
  const bValida = Number.isFinite(fb);
  if (aValida && bValida) return fa - fb;
  if (aValida) return -1;
  if (bValida) return 1;
  return 0;
}

// Misma agrupación por sede y mismo criterio de "ficha inválida al final"
// que compararPorSedeYFicha, pero con la ficha en orden DESCENDENTE
// (la más alta arriba) -- pantalla de Libro 2/Gestión I-131 (no el PDF de
// impresión mensual, que sigue por fecha real, ver GenerarActasImpresion.jsx
// -- nunca usó este comparador). Motivo: al cargar un paciente nuevo, se
// quiere ver el último arriba de todo sin scrollear.
// A propósito NO se hace invirtiendo los argumentos ni negando el
// resultado completo de compararPorSedeYFicha -- un comparador correcto es
// antisimétrico (compararPorSedeYFicha(b,a) === -compararPorSedeYFicha(a,b)
// SIEMPRE), así que eso invertiría también el orden de sede y haría que
// las fichas inválidas queden PRIMERO en vez de al final. Sólo se niega la
// parte de ficha (delegada 100% a la función original, sedeId ya es
// igual acá adentro), el desempate de sede se escribe aparte, sin invertir.
export function compararPorSedeYFichaDescendente(a, b) {
  if (a.sedeId !== b.sedeId) return a.sedeId < b.sedeId ? -1 : 1;
  return -compararPorSedeYFicha(a, b);
}
