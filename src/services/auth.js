import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  reauthenticateWithPopup,
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
  serverTimestamp,
} from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase.js";

const rolesCol = collection(db, "roles");
const rolRef = (email) => doc(rolesCol, email.trim().toLowerCase());

const solicitudesCol = collection(db, "solicitudes");
const solicitudRef = (email) => doc(solicitudesCol, email.trim().toLowerCase());

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

// Repite el login con Google contra la sesión ya activa, sin cerrarla --
// paso obligatorio inmediatamente antes de restaurar un backup (operación
// destructiva), para confirmar identidad además del texto de confirmación.
export function reautenticarConGoogle() {
  return reauthenticateWithPopup(auth.currentUser, googleProvider);
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

// Devuelve la solicitud de acceso ya enviada por ese email, o null si no hay ninguna.
export async function fetchSolicitud(email) {
  const snap = await getDoc(solicitudRef(email));
  if (!snap.exists()) return null;
  return { email: email.trim().toLowerCase(), ...snap.data() };
}

// Se llama cuando alguien se loguea con Google y no tiene doc en roles/.
export function crearSolicitud(email, nombre) {
  return setDoc(solicitudRef(email), {
    nombre: nombre || "",
    email: email.trim().toLowerCase(),
    fecha: serverTimestamp(),
    estado: "pendiente",
  });
}

// Para Configuración → Usuarios (sólo admin): lista en vivo de solicitudes pendientes.
export function listenSolicitudes(callback) {
  return onSnapshot(query(solicitudesCol, orderBy("fecha")), (snap) => {
    callback(snap.docs.map((d) => ({ email: d.id, ...d.data() })));
  });
}

// Aprobar: otorga el rol/sede elegidos y borra la solicitud.
export async function aprobarSolicitud(email, { nombre, rol, sede }) {
  await setRol(email, { nombre, rol, sede });
  await eliminarSolicitud(email);
}

// Rechazar: sólo borra la solicitud, sin otorgar acceso.
export function eliminarSolicitud(email) {
  return deleteDoc(solicitudRef(email));
}
