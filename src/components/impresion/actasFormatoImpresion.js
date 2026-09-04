import { TIPO_LABEL_I131 } from "../../constants/tipoI131.js";
import { fmtHora } from "../../helpers/formato.js";

// Formato compartido por los documentos impresos -- deliberadamente
// SEPARADO de las funciones equivalentes en TabPacientes.jsx (mismo
// criterio, no se reimplementa distinto, pero tampoco se toca esa pantalla
// para esta función nueva, ver plan confirmado). Si algún día conviene
// unificarlas, es un refactor aparte.

export function tipoTextoCSV(a, catalogo) {
  if (TIPO_LABEL_I131[a.tipo]) return TIPO_LABEL_I131[a.tipo].label;
  if (a.isotopoId && a.isotopoId !== "tc99m") {
    return catalogo.radioisotopos?.find((i) => i.id === a.isotopoId)?.nombre || a.isotopoId;
  }
  return "Tc-99m";
}

export function dosisRegistro(a) {
  if (a.mciAdministrados != null) return { valor: a.mciAdministrados, unidad: "mCi" };
  if (a.actividadAdministrada != null) return { valor: a.actividadAdministrada, unidad: a.unidadActividad || "mCi" };
  if (a.tipo === "i131_mibg" && a.actividadCalibrada != null) return { valor: a.actividadCalibrada, unidad: "mCi" };
  return null;
}

export function textoConformidad(lote) {
  if (lote.conformidad === true) return "Sí";
  if (lote.conformidad === false) return "No conforme";
  return "Sin dato";
}

export function fmtFechaHora(fecha) {
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  return { fecha: d.toLocaleDateString("es-AR"), hora: fmtHora(fecha) };
}
