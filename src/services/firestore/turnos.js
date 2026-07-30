import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";

const turnosCol = collection(db, "turnos");
const turnoRef = (id) => doc(turnosCol, id);

// Agenda de turnos I-131 (espacio de cálculo, Parte C) -- a diferencia de
// actas/movimientos, esta colección es mutable de verdad: un turno se
// reprograma, cancela o corrige libremente (ver firestore.rules#turnoValido).
// fechaTurno se guarda como string "YYYY-MM-DD": la comparación
// lexicográfica coincide con la cronológica, así que un rango de fechas es
// un where(">=")/where("<=") directo -- nunca se trae el histórico completo,
// sólo la semana en cuestión (ver helpers/semanaI131.js para los límites
// lunes/domingo).
function clausulasSemana(sedeId, inicioISO, finISO) {
  return [where("sedeId", "==", sedeId), where("fechaTurno", ">=", inicioISO), where("fechaTurno", "<=", finISO)];
}

// Listener en vivo, acotado a la semana visible en pantalla -- se
// resuscribe cada vez que cambia la semana (ver TabAgendaI131.jsx).
export function listenTurnosSemana(sedeId, inicioISO, finISO, callback) {
  const q = query(turnosCol, ...clausulasSemana(sedeId, inicioISO, finISO));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Consulta puntual (no listener) para cuando el formulario de alta/edición
// necesita el total de una semana DISTINTA a la que está visible en pantalla
// (agendar para dentro de 3 semanas mientras se mira la semana actual) --
// sigue acotada a esos 7 días, nunca al histórico.
export async function turnosDeSemana(sedeId, inicioISO, finISO) {
  const snap = await getDocs(query(turnosCol, ...clausulasSemana(sedeId, inicioISO, finISO)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function addTurno(data) {
  return addDoc(turnosCol, { ...data, fechaCreacion: serverTimestamp() });
}

export function updateTurno(id, data) {
  return updateDoc(turnoRef(id), { ...data, actualizadoEn: serverTimestamp() });
}

export function deleteTurno(id) {
  return deleteDoc(turnoRef(id));
}

// Aviso de posible duplicado en la importación desde Excel (Parte C) -- 3
// cláusulas de igualdad pura (sedeId, fechaTurno, pacienteDni), sin rango ni
// orderBy, así que Firestore la resuelve con los índices automáticos de
// campo único: no hace falta agregar nada a firestore.indexes.json. limit(1)
// porque sólo importa si existe al menos uno, no cuántos.
export async function existeTurno({ sedeId, fechaTurno, pacienteDni }) {
  const snap = await getDocs(query(
    turnosCol,
    where("sedeId", "==", sedeId), where("fechaTurno", "==", fechaTurno), where("pacienteDni", "==", pacienteDni),
    limit(1)
  ));
  return !snap.empty;
}

// Importación desde Excel (Parte C, uso regular) -- un solo writeBatch, todo
// o nada: si una fila choca con turnoValido() del lado servidor, ninguna se
// crea, en vez de dejar la importación a medias sin que quede claro cuál
// entró y cuál no. 400 en vez del límite real de Firestore (500) para dejar
// margen; una importación así de grande de todos modos conviene dividirla.
const TOPE_TURNOS_POR_IMPORTACION = 400;

export function addTurnosBatch(turnos) {
  if (turnos.length > TOPE_TURNOS_POR_IMPORTACION) {
    throw new Error(`Máximo ${TOPE_TURNOS_POR_IMPORTACION} turnos por importación -- dividí el archivo en tandas más chicas.`);
  }
  const batch = writeBatch(db);
  for (const data of turnos) {
    batch.set(doc(turnosCol), { ...data, fechaCreacion: serverTimestamp() });
  }
  return batch.commit();
}
