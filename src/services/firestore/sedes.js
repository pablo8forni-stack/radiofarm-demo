import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

const sedesCol = collection(db, "sedes");
const sedeRef = (sedeId) => doc(sedesCol, sedeId);

// Emite {sedeId:{nombre,short,activo,principal,eliminada,farmIds,puntosReorden}}
// con todas las sedes del catálogo dinámico.
export function listenSedes(callback) {
  return onSnapshot(sedesCol, (snap) => {
    const sedes = {};
    snap.docs.forEach((d) => {
      sedes[d.id] = {
        nombre: "", short: "", farmIds: [], puntosReorden: {}, activo: false, principal: false, eliminada: false,
        ...d.data(),
      };
    });
    callback(sedes);
  });
}

export function addSede({ nombre, short }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(sedeRef(id), {
    nombre, short: short || nombre, activo: false, principal: false, eliminada: false, farmIds: [], puntosReorden: {},
  });
}

export function updateSede(sedeId, { nombre, short }) {
  return updateDoc(sedeRef(sedeId), { nombre, short: short || nombre });
}

// esPrincipal se pasa desde la vista (catalogo.sedes[sedeId]?.principal) --
// esta función no debe conocer ningún id de sede fijo.
export function toggleSedeActiva(sedeId, activa, esPrincipal) {
  if (esPrincipal) return Promise.resolve(); // la sede principal siempre está activa
  return updateDoc(sedeRef(sedeId), { activo: activa });
}

export function archivarSede(sedeId) {
  return updateDoc(sedeRef(sedeId), { eliminada: true, activo: false });
}

export function desarchivarSede(sedeId) {
  return updateDoc(sedeRef(sedeId), { eliminada: false });
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
// farmIds activos de todas las sedes (mirror del comportamiento original en
// TabCatalogo, hecho ahora con un batch en vez de un solo objeto local).
// sedeIds lo pasa el caller (Object.keys(catalogo.sedes)) para no depender
// de ninguna lista fija.
export function quitarFarmDeTodasLasSedes(farmId, sedeIds) {
  const batch = writeBatch(db);
  sedeIds.forEach((id) => batch.update(sedeRef(id), { farmIds: arrayRemove(farmId) }));
  return batch.commit();
}
