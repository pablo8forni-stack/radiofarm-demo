import { SEDES } from "../constants/sedes.js";

// `catalogo` es la forma que expone CatalogoContext:
// { farms:[{id,nombre,viales_x_kit}], sedes:{sedeId:{nombre,short,activo,farmIds,puntosReorden}},
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

export const idsSedesActivas = (catalogo) =>
  SEDES.filter((s) => catalogo.sedes[s.id]?.activo).map((s) => s.id);

export const sedesActivas = (catalogo) => SEDES.filter((s) => catalogo.sedes[s.id]?.activo);

export const puntoReorden = (catalogo, sedeId, farmId) =>
  catalogo.sedes[sedeId]?.puntosReorden?.[farmId] ?? 2;
