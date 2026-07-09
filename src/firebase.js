import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// Cache local persistente: los listeners siguen sirviendo el último dato
// conocido sin conexión, y las escrituras que no dependen de una lectura
// previa (p. ej. ingreso) se encolan y sincronizan solas al volver la señal.
// Las operaciones con runTransaction (egreso/transferencia/anulación) NO se
// benefician de esto: necesitan un viaje redondo al servidor para leer el
// estado real y evitar condiciones de carrera, así que fallan explícitamente
// si no hay conexión (ver helpers/erroresRed.js).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
