// `catalogo` es la forma que expone CatalogoContext:
// { farms:[{id,nombre,viales_x_kit}],
//   sedes:{sedeId:{nombre,short,activo,principal,eliminada,farmIds,puntosReorden}},
//   stock:{sedeId:{farmId:[lotes]}}, proveedores:[...] }

export const totStock = (lotes = []) => lotes.reduce((s, l) => s + (l.cantidad || 0), 0);

export const proxVenc = (lotes = []) => {
  const a = lotes.filter((l) => l.cantidad > 0 && l.vencimiento);
  return a.length ? a.reduce((mn, l) => (!mn || l.vencimiento < mn ? l.vencimiento : mn), null) : null;
};

export const farmsDeSede = (catalogo, sedeId) => {
  const activos = catalogo.sedes[sedeId]?.farmIds || [];
  return catalogo.farms.filter((f) => activos.includes(f.id));
};

// El principal siempre primero, después alfabético por nombre -- usado tanto
// para sedes (reemplaza el orden fijo que antes daba el array hardcodeado
// SEDES) como para proveedores (le da un efecto real a "marcar como
// principal" en el combo de Ingreso, más allá de ser una etiqueta).
const compararPrincipalYNombre = (a, b) => (b.principal === true) - (a.principal === true) || a.nombre.localeCompare(b.nombre);

export const todasLasSedes = (catalogo) =>
  Object.entries(catalogo.sedes)
    .filter(([, s]) => !s.eliminada)
    .map(([id, s]) => ({ id, ...s }))
    .sort(compararPrincipalYNombre);

export const sedesArchivadas = (catalogo) =>
  Object.entries(catalogo.sedes)
    .filter(([, s]) => s.eliminada)
    .map(([id, s]) => ({ id, ...s }))
    .sort(compararPrincipalYNombre);

export const sedesActivas = (catalogo) => todasLasSedes(catalogo).filter((s) => s.activo);

export const idsSedesActivas = (catalogo) => sedesActivas(catalogo).map((s) => s.id);

export const puntoReorden = (catalogo, sedeId, farmId) =>
  catalogo.sedes[sedeId]?.puntosReorden?.[farmId] ?? 2;

export const proveedoresOrdenados = (catalogo) => [...(catalogo.proveedores || [])].sort(compararPrincipalYNombre);
