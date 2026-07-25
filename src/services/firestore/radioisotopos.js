import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

// Esta colección controla SOLO qué nombres existen/aparecen en selectores de
// isótopo (Libro 2, Terapia I-131). El comportamiento especial de cada uno
// (campos extra, pestaña propia, permisos) sigue atado en el código al id
// fijo del documento (ej. if (isotopoId === 'lu177')), no es genérico ni
// configurable. Agregar una fila nueva acá NO le da automáticamente ningún
// comportamiento especial -- eso sigue requiriendo código nuevo. Los 3 ids
// con comportamiento real hoy son 'tc99m', 'lu177' e 'i131' (sembrados una
// vez, ver notas de deploy) -- cualquier otro id que se agregue desde la
// pestaña Isótopos queda como entrada inerte en los selectores genéricos.
const radioisotoposCol = collection(db, "radioisotopos");
const radioisotopoRef = (id) => doc(radioisotoposCol, id);

export function listenRadioisotopos(callback) {
  return onSnapshot(query(radioisotoposCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Id autogenerado (mismo criterio que addProveedor) -- no expone el concepto
// de "id interno" al admin, y no importa cuál sea: sólo los 3 ids sembrados
// a mano tienen algún comportamiento atado en el código.
export function addRadioisotopo({ nombre }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(radioisotopoRef(id), { nombre });
}

export function updateRadioisotopo(id, { nombre }) {
  return updateDoc(radioisotopoRef(id), { nombre });
}
