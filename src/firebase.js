import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Lee de import.meta.env (Vite, browser) o cae a process.env (Node, para los
// scripts de prueba en scripts/testing/ que corren con `node --env-file`) --
// en el bundle de browser la rama process.env nunca se evalúa porque
// import.meta.env siempre está poblado ahí, así que `typeof process` jamás
// se referencia en ese caso.
function env(key) {
  return import.meta.env?.[key] ?? (typeof process !== "undefined" ? process.env[key] : undefined);
}

const firebaseConfig = {
  apiKey: env("VITE_FIREBASE_API_KEY"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: env("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: env("VITE_FIREBASE_APP_ID"),
};

export const app = initializeApp(firebaseConfig);

// Cache local persistente: los listeners siguen sirviendo el último dato
// conocido sin conexión, y las escrituras que no dependen de una lectura
// previa (p. ej. ingreso) se encolan y sincronizan solas al volver la señal.
// Las operaciones con runTransaction (egreso/transferencia/anulación) NO se
// benefician de esto: necesitan un viaje redondo al servidor para leer el
// estado real y evitar condiciones de carrera, así que fallan explícitamente
// si no hay conexión (ver helpers/erroresRed.js).
// persistentLocalCache necesita IndexedDB (no existe en Node) -- en los
// scripts de prueba cae al caché en memoria por defecto de Firestore, sin
// afectar en nada el comportamiento real de la app en el browser.
const persistente = typeof indexedDB !== "undefined";

export const db = initializeFirestore(app, persistente
  ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }
  : {});

export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
