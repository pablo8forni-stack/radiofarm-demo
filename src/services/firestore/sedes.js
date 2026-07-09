import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { SEDES } from "../../constants/sedes.js";

const sedesCol = collection(db, "sedes");
const sedeRef = (sedeId) => doc(sedesCol, sedeId);

// Emite {sedeId:{nombre,short,activo,farmIds,puntosReorden}} con las 4 sedes fijas.
export function listenSedes(callback) {
  return onSnapshot(sedesCol, (snap) => {
    const sedes = {};
    snap.docs.forEach((d) => {
      sedes[d.id] = { farmIds: [], puntosReorden: {}, activo: false, ...d.data() };
    });
    callback(sedes);
  });
}

export function toggleSedeActiva(sedeId, activa) {
  if (sedeId === "central") return Promise.resolve(); // Central siempre activa
  return updateDoc(sedeRef(sedeId), { activo: activa });
}

export function toggleFarmEnSede(sedeId, farmId, activarlo) {
  return updateDoc(sedeRef(sedeId), {
    farmIds: activarlo ? arrayUnion(farmId) : arrayRemove(farmId),
  });
}

export function setPuntoReorden(sedeId, farmId, min) {
  return updateDoc(sedeRef(sedeId), { [`puntosReorden.${farmId}`]: parseInt(min) || 1 });
}

// Al eliminar un radiofármaco del catálogo, se lo quita de la lista de
// farmIds activos de las 4 sedes (mirror del comportamiento original en
// TabCatalogo, hecho ahora con un batch en vez de un solo objeto local).
export function quitarFarmDeTodasLasSedes(farmId) {
  const batch = writeBatch(db);
  SEDES.forEach((s) => batch.update(sedeRef(s.id), { farmIds: arrayRemove(farmId) }));
  return batch.commit();
}
