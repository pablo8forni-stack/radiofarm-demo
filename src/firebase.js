import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";

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

// SOLO DESARROLLO -- conecta a los emuladores locales de Firestore/Auth
// cuando se corre `npm run dev` con VITE_USE_EMULATOR=1, para poder probar
// la app real en el navegador con el login de Google FALSO del emulador de
// Auth (sin cuenta de Google real, sin tocar ningún dato de staging/
// producción). `import.meta.env.DEV` es una constante que Vite resuelve en
// tiempo de build: `true` sólo en `vite dev`, SIEMPRE `false` en `vite
// build` (staging o producción) sin importar nada en runtime -- por eso
// esta rama entera se elimina del bundle real (confirmado: `dist/` no
// contiene ninguna referencia a connectFirestoreEmulator/connectAuthEmulator
// después de un build, ver verificación en el chat). No requiere ningún
// cambio en firebase.json/firestore.rules -- usa las reglas reales tal
// cual, sólo corriendo contra el emulador en vez de contra la nube.
if (import.meta.env?.DEV && env("VITE_USE_EMULATOR") === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
