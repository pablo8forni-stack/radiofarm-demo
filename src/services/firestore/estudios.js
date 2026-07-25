import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase.js";
import { slugify } from "../../helpers/formato.js";

// Lista dinámica de estudios disponibles en el selector de Libro 2 --
// reemplaza a la constante fija que había en constants/estudios.js. A
// diferencia de radioisotopos, acá el id NO tiene ningún significado especial
// para el código: el estudio se guarda en el acta como el nombre (string)
// elegido, nunca por id, así que no hay riesgo de que un id "incorrecto"
// rompa nada -- cualquier nombre cargado funciona igual.
const estudiosCol = collection(db, "estudios");
const estudioRef = (id) => doc(estudiosCol, id);

export function listenEstudios(callback) {
  return onSnapshot(query(estudiosCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addEstudio({ nombre }) {
  const id = `${slugify(nombre)}-${Date.now().toString().slice(-4)}`;
  return setDoc(estudioRef(id), { nombre });
}

export function updateEstudio(id, { nombre }) {
  return updateDoc(estudioRef(id), { nombre });
}

export function deleteEstudio(id) {
  return deleteDoc(estudioRef(id));
}
