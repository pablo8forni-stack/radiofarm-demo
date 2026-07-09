import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase.js";

const rolesCol = collection(db, "roles");
const rolRef = (email) => doc(rolesCol, email.trim().toLowerCase());

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

export function listenAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// Devuelve {nombre,rol,sede,email} o null si el email no tiene acceso otorgado.
export async function fetchRol(email) {
  const snap = await getDoc(rolRef(email));
  if (!snap.exists()) return null;
  return { email: email.trim().toLowerCase(), ...snap.data() };
}

// Para la pestaña Usuarios (solo admin): lista en vivo de todos los roles otorgados.
export function listenRoles(callback) {
  return onSnapshot(query(rolesCol, orderBy("nombre")), (snap) => {
    callback(snap.docs.map((d) => ({ email: d.id, ...d.data() })));
  });
}

// Alta/edición de un usuario: precarga acceso incluso antes de su primer login.
export function setRol(email, { nombre, rol, sede }) {
  return setDoc(rolRef(email), { nombre, rol, sede }, { merge: true });
}

export function eliminarRol(email) {
  return deleteDoc(rolRef(email));
}
