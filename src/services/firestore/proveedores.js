import { collection, doc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

const proveedoresCol = collection(db, "proveedores");

export function listenProveedores(callback) {
  return onSnapshot(query(proveedoresCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addProveedor({ nombre, contacto, principal }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(doc(proveedoresCol, id), { nombre, contacto: contacto || "", principal: !!principal });
}
