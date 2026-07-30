import { collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebase.js";

const pedidosCol = collection(db, "pedidosSemanales");

// Id determinístico sedeId_semana -- a diferencia de turnos (muchos
// documentos, uno por paciente), acá hay UN SOLO doc por sede+semana que se
// va completando/corrigiendo en el momento con setDoc merge, nunca un
// alta+edición separadas. Mismo espíritu de "editar libremente durante la
// semana" que turnos, pero con la forma de un registro único en vez de una
// lista.
const pedidoRef = (sedeId, semana) => doc(pedidosCol, `${sedeId}_${semana}`);

export function listenPedidoSemanal(sedeId, semana, callback) {
  return onSnapshot(pedidoRef(sedeId, semana), (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

// `campos` puede traer `null` para un valor que el usuario borró del input
// -- se traduce a deleteField() en vez de guardar null, porque la regla
// exige que el campo, SI está presente, sea number/timestamp (null no
// pasaría esa validación).
export function guardarPedidoSemanal(sedeId, semana, campos) {
  const datos = {};
  for (const [k, v] of Object.entries(campos)) datos[k] = v == null ? deleteField() : v;
  return setDoc(pedidoRef(sedeId, semana), { sedeId, semana, ...datos, actualizadoEn: serverTimestamp() }, { merge: true });
}
