// Derivación de "disponible/usado/anulado" de un lote de MIBG -- ANTES vivía
// duplicada de forma sutilmente distinta en TabMibg.jsx (estadoDe) y
// TabPacientes.jsx (picker de lote), y las dos versiones divergieron: una
// filtraba usos anulados, la otra no (auditoría de seguridad, hallazgo #12).
// Una sola función, usada en los dos lados, para que nunca vuelva a pasar.
//
// anulaciones: Map<id, anulación> keyed por anulaId (mismo Map que ya arma
// cada pantalla desde listenAnulacionesActas). usoPorLoteId: Map<mibgLoteId,
// actaI131Mibg> (la acta que usó ese lote, si existe alguna).
export function estadoMibgLote(loteId, { anulaciones, usoPorLoteId }) {
  if (anulaciones.has(loteId)) return "anulado";
  const uso = usoPorLoteId.get(loteId);
  // Defensivo: si el acta que usó el lote está anulada pero el lote todavía
  // no (ventana breve del flujo en 2 pasos de anularActaMibgYLote, o datos
  // viejos previos a esta corrección), sigue contando como "usado" -- nunca
  // "disponible" mientras exista una acta apuntándole, anulada o no.
  if (uso) return "usado";
  return "disponible";
}
