import { collection, doc, onSnapshot, orderBy, limit, query, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";

const actasCol = collection(db, "actas");
const PAGINA = 150;

// tipo: "paciente" | "marcacion". El filtro de sede/fecha se aplica client-side
// sobre la página traída, como en VistaHistorial, para no requerir varios
// índices compuestos.
export function listenActas(tipo, callback) {
  const q = query(actasCol, where("tipo", "==", tipo), orderBy("fecha", "desc"), limit(PAGINA));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Alta simple, sin lectura previa -> offline-safe (se encola sola).
export function addActaPaciente(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "paciente", fecha: serverTimestamp() });
  return batch.commit();
}

export function addActaMarcacion(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "marcacion", fecha: serverTimestamp() });
  return batch.commit();
}
