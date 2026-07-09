import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

const farmsCol = collection(db, "farms");

export function listenFarms(callback) {
  return onSnapshot(query(farmsCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addFarm({ nombre, viales_x_kit }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(doc(farmsCol, id), { nombre, viales_x_kit: viales_x_kit || 1 });
}

export function updateFarm(farmId, { nombre, viales_x_kit }) {
  return updateDoc(doc(farmsCol, farmId), { nombre, viales_x_kit: viales_x_kit || 1 });
}

export function deleteFarm(farmId) {
  return deleteDoc(doc(farmsCol, farmId));
}
