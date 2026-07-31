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
