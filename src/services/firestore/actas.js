import { collection, doc, getDocs, onSnapshot, orderBy, limit, query, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";

const actasCol = collection(db, "actas");
const PAGINA = 150;

// tipo: "paciente" | "marcacion". El filtro de fecha se aplica client-side
// sobre la página traída (como en VistaHistorial), pero el de sede NO --
// las reglas de Firestore sólo dejan leer a un técnico las actas de su
// propia sede (tienen nombre/DNI de pacientes, Ley 25.326), y rechazan la
// consulta entera si no viene ya acotada por sedeId. `sedeId` acá es
// obligatorio para un técnico (esAdmin=false); un admin pasa sedeId=null
// para seguir viendo todas.
export function listenActas(tipo, callback, { esAdmin, sedeId } = {}) {
  const clausulas = [where("tipo", "==", tipo)];
  if (!esAdmin) clausulas.push(where("sedeId", "==", sedeId));
  const q = query(actasCol, ...clausulas, orderBy("fecha", "desc"), limit(PAGINA));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Para exportar CSV de un rango completo en modo "Ver todos" (sin el límite
// de PAGINA que tiene el listener de pantalla) -- getDocs suelto, no listener.
// Mismo motivo que arriba para el filtro de sede: si esAdmin es false, sedeId
// es obligatorio, si no la consulta completa se rechaza por las reglas.
export async function actasPorRango(tipo, { desde, hasta, sedeId, esAdmin }) {
  const clausulas = [
    where("tipo", "==", tipo),
    where("fecha", ">=", new Date(`${desde}T00:00:00`)),
    where("fecha", "<=", new Date(`${hasta}T23:59:59.999`)),
  ];
  if (!esAdmin || sedeId) clausulas.push(where("sedeId", "==", sedeId));
  const snap = await getDocs(query(actasCol, ...clausulas, orderBy("fecha", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
