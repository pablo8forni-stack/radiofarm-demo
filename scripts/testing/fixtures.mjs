// Fixtures y helpers compartidos por scripts/testing/*.test.mjs. Corren
// contra el proyecto de staging (radiofarm-fuesmen-staging) -- en vivo
// (npm run test:staging) o contra el emulador de Firestore/Auth con las
// mismas reglas (npm run test:emulator, ver USE_FIRESTORE_EMULATOR más
// abajo) -- nunca se importa desde src/ ni se usa en la app real.
//
// El emulador existe porque tx.get(query(...)) dentro de una transacción
// (usado por transferenciaTransaction y por las anulaciones) rompe con un
// error interno del SDK cliente de Firebase cuando corre en Node contra el
// backend real (bug del SDK, no de la app -- en el browser funciona bien).
// Contra el emulador, mismo código, no se reprodujo.
//
// Requisito único, manual, ya hecho una vez en el proyecto de staging (sólo
// hace falta para test:staging, no para test:emulator):
//   1. Authentication > Sign-in method > Email/Password habilitado.
//   2. Firestore > doc roles/admin.test@radiofarm.local = {nombre, rol:"admin", sede:"central"}.
// A partir de ahí todo lo demás (catálogo, el resto de los roles, altas de
// Auth) lo hace este archivo con el SDK cliente, sin admin SDK ni claves de
// cuenta de servicio -- firmado como esa misma admin de prueba.
//
// Las pruebas de "conflicto" (dos operaciones simultáneas) NO necesitan dos
// identidades distintas en paralelo: alcanza con la MISMA sesión disparando
// dos llamadas a la vez (Promise.all) contra el mismo documento -- es
// justamente el escenario real que se quiere cubrir (dos clics, dos pestañas,
// dos técnicos concurrentes todos terminan siendo "dos escrituras
// simultáneas sobre el mismo doc" desde el punto de vista de Firestore). Por
// eso alcanza con una única sesión (auth/db por defecto de la app real) sin
// necesidad de apps secundarias.

import { randomUUID } from "node:crypto";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  connectAuthEmulator,
} from "firebase/auth";
import { doc, setDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs, terminate, connectFirestoreEmulator } from "firebase/firestore";
import { auth, db } from "../../src/firebase.js";
import { setRol } from "../../src/services/auth.js";
import { FARMS_DEFAULT, SEDE_FARMS_DEFAULT, PROVEEDORES_DEFAULT } from "../../src/constants/farmsSeed.js";

const PROYECTO_ESPERADO = "radiofarm-fuesmen-staging";
if (process.env.VITE_FIREBASE_PROJECT_ID !== PROYECTO_ESPERADO) {
  throw new Error(
    `Estos tests sólo corren contra "${PROYECTO_ESPERADO}" (proyecto actual: "${process.env.VITE_FIREBASE_PROJECT_ID || "(vacío)"}"). ` +
    `Corré con: npm run test:staging o npm run test:emulator`
  );
}

if (process.env.USE_FIRESTORE_EMULATOR === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}

const PASSWORD_TEST = "Test-Radiofarm-2026!";

export const SEDE_A = "central";
export const SEDE_B = "italiano";
// Único radiofármaco asignado a ambas sedes de prueba (ver SEDE_FARMS_DEFAULT
// en farmsSeed.js) -- necesario para que las transferencias tengan un
// destino válido.
export const FARM_ID = "mibi";

export const PERSONAS = {
  admin: { email: "admin.test@radiofarm.local", nombre: "Admin de Prueba", rol: "admin", sede: SEDE_A },
  tecnicoA: { email: "tecnico.central.test@radiofarm.local", nombre: "Tecnico Central Test", rol: "tecnico", sede: SEDE_A },
  tecnicoB: { email: "tecnico.italiano.test@radiofarm.local", nombre: "Tecnico Italiano Test", rol: "tecnico", sede: SEDE_B },
  // A propósito sin rol/sede: es la persona usada para probar el flujo de
  // solicitudes de acceso desde cero.
  sinRol: { email: "sinrol.test@radiofarm.local", nombre: "Sin Rol Test" },
};

function usuarioDe(persona) {
  return { email: persona.email, nombre: persona.nombre, rol: persona.rol, sede: persona.sede };
}

// Inicia sesión como esa persona en el auth/db por defecto de la app real
// (mismo singleton que usan egresoTransaction, transferenciaTransaction,
// etc.). Si el usuario de Auth todavía no existe (primera corrida), lo crea.
export async function loguearComo(persona) {
  if (auth.currentUser?.email === persona.email) return usuarioDe(persona);
  try {
    await signInWithEmailAndPassword(auth, persona.email, PASSWORD_TEST);
  } catch {
    await createUserWithEmailAndPassword(auth, persona.email, PASSWORD_TEST);
  }
  return usuarioDe(persona);
}

export async function desloguear() {
  await signOut(auth).catch(() => {});
}

// Firestore en Node mantiene streams gRPC abiertos que nunca se cierran
// solos (no hay ventana del navegador que los tire al cerrarse) -- sin esto
// el proceso de `node --test` queda vivo para siempre después de que todos
// los tests ya terminaron y pasaron. Cada archivo de test lo llama en un
// `after()` de nivel de archivo.
export async function cerrarConexiones() {
  await signOut(auth).catch(() => {});
  await terminate(db).catch(() => {});
}

export function loteDePrueba() {
  return `TEST-${randomUUID().slice(0, 8)}`;
}

// Crea un lote directamente (sin pasar por ingresoBatch, que además crea un
// movimiento -- acá sólo interesa el punto de partida del stock). Requiere
// estar logueado como admin (única identidad con create sobre lotes).
export async function crearLoteDirecto(sedeId, farmId, cantidad, opts = {}) {
  const loteId = opts.lote || loteDePrueba();
  const ref = doc(db, "sedes", sedeId, "lotes", loteId);
  await setDoc(ref, {
    farmId, lote: loteId, vencimiento: opts.vencimiento || "2027-01-01",
    cantidad, proveedorNombre: opts.proveedorNombre || "", creadoEn: serverTimestamp(),
  });
  return { loteId, ref };
}

// Requiere estar logueado como admin (única identidad con delete sobre lotes).
export async function borrarLote(sedeId, loteId) {
  await deleteDoc(doc(db, "sedes", sedeId, "lotes", loteId)).catch(() => {});
}

// Búsquedas por un solo campo (siempre indexado por default en Firestore, sin
// necesitar índices compuestos nuevos) -- suficiente para ubicar lo que un
// test acaba de crear, filtrando el resto en JS si hace falta.
export async function buscarLotePorNumero(sedeId, loteNum) {
  const snap = await getDocs(query(collection(db, "sedes", sedeId, "lotes"), where("lote", "==", loteNum)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function buscarMovimientos(campo, valor) {
  const snap = await getDocs(query(collection(db, "movimientos"), where(campo, "==", valor)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// El emulador arranca con Firestore vacío en cada corrida -- a diferencia de
// staging real (donde el doc admin se creó a mano una sola vez), acá no hay
// ningún admin todavía para bootstrapear el resto por reglas. Se resuelve con
// firebase-admin, pero SIN ninguna credencial real: sólo habla con el
// emulador local (vía FIRESTORE_EMULATOR_HOST), nunca con el proyecto real --
// el mismo motivo por el que se evitó admin SDK para todo lo demás sigue
// sin aplicar acá.
async function bootstrapAdminEnEmulador() {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const { initializeApp: initAdminApp, getApps: getAdminApps } = await import("firebase-admin/app");
  const { getFirestore: getAdminFirestore } = await import("firebase-admin/firestore");
  if (!getAdminApps().length) initAdminApp({ projectId: PROYECTO_ESPERADO });
  await getAdminFirestore().doc(`roles/${PERSONAS.admin.email}`).set({
    nombre: PERSONAS.admin.nombre, rol: "admin", sede: PERSONAS.admin.sede,
  });
}

// Idempotente: se puede llamar al principio de cada archivo de test las
// veces que haga falta sin duplicar ni romper nada.
export async function prepararFixturesGlobales() {
  if (process.env.USE_FIRESTORE_EMULATOR === "1") await bootstrapAdminEnEmulador();
  await loguearComo(PERSONAS.admin);

  for (const farm of FARMS_DEFAULT) {
    await setDoc(doc(db, "farms", farm.id), { nombre: farm.nombre, viales_x_kit: farm.viales_x_kit }, { merge: true });
  }

  await setDoc(doc(db, "sedes", SEDE_A), {
    nombre: "FUESMEN Central", short: "Central", activo: true,
    farmIds: SEDE_FARMS_DEFAULT[SEDE_A], puntosReorden: {},
  }, { merge: true });
  await setDoc(doc(db, "sedes", SEDE_B), {
    nombre: "C. Gamma Hospital Italiano", short: "Italiano", activo: true,
    farmIds: SEDE_FARMS_DEFAULT[SEDE_B], puntosReorden: {},
  }, { merge: true });

  const prov = PROVEEDORES_DEFAULT[0];
  await setDoc(doc(db, "proveedores", prov.id), {
    nombre: prov.nombre, contactoTelefono: prov.contactoTelefono || "", principal: !!prov.principal,
  }, { merge: true });

  await setRol(PERSONAS.tecnicoA.email, { nombre: PERSONAS.tecnicoA.nombre, rol: "tecnico", sede: SEDE_A });
  await setRol(PERSONAS.tecnicoB.email, { nombre: PERSONAS.tecnicoB.nombre, rol: "tecnico", sede: SEDE_B });

  // sinRol nunca debe arrancar con rol ni solicitud pendiente -- por si una
  // corrida anterior la aprobó/creó y no se limpió (aprobar/rechazar borran
  // la solicitud, pero por las dudas ante una corrida interrumpida a mitad).
  await deleteDoc(doc(db, "roles", PERSONAS.sinRol.email)).catch(() => {});
  await deleteDoc(doc(db, "solicitudes", PERSONAS.sinRol.email)).catch(() => {});
}

export { db };
