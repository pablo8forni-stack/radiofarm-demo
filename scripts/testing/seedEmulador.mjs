// Fase 2.1a (23/11) -- siembra datos de prueba en el EMULADOR LOCAL para
// poder abrir la app de verdad (`npm run dev` con VITE_USE_EMULATOR=1) y
// probar la pantalla de la administrativa a mano. NUNCA toca staging ni
// producción -- ver la guarda obligatoria más abajo.
//
// Uso (con el emulador ya corriendo aparte, `firebase emulators:start`):
//   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
//   node --env-file=.env.emulator scripts/testing/seedEmulador.mjs
import { setDoc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../src/firebase.js";
import { PERSONAS, SEDE_A, loguearComo, prepararFixturesGlobales, cerrarConexiones } from "./fixtures.mjs";
import { fichaUsadaRef, anulaFichaRef, addActaElucion, anularActaTransaction } from "../../src/services/firestore/actas.js";
import { addEstudio } from "../../src/services/firestore/estudios.js";

// Guarda obligatoria: si FIRESTORE_EMULATOR_HOST no está, abortar ANTES de
// escribir nada -- este chequeo tiene que pasar primero porque
// prepararFixturesGlobales() recién fija esa variable ella misma (ver
// bootstrapAdminEnEmulador en fixtures.mjs) si USE_FIRESTORE_EMULATOR=1; acá
// se exige que YA esté puesta de antes, a mano, como una segunda
// confirmación explícita e independiente de que se está apuntando al
// emulador local y no a ningún proyecto real.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "ABORTADO: falta FIRESTORE_EMULATOR_HOST. Este script sólo corre contra el emulador local -- " +
    'seteá $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080" antes de ejecutarlo, no se escribió nada.'
  );
  process.exit(1);
}

// Mismo bypass de admin ya usado en los scripts de medición de Fase 2.0/
// 2.1a -- SOLO para plantar un estado que el flujo normal de hoy no
// produciría (un acta "vieja" sin los 3 campos nuevos, simulando datos de
// antes del 3/10). Habla únicamente con el emulador local.
async function plantarDirecto(coleccion, id, data) {
  const { initializeApp: initAdminApp, getApps: getAdminApps } = await import("firebase-admin/app");
  const { getFirestore: getAdminFirestore } = await import("firebase-admin/firestore");
  if (!getAdminApps().length) initAdminApp({ projectId: "radiofarm-fuesmen-staging" });
  await getAdminFirestore().doc(`${coleccion}/${id}`).set(data);
}

// 15 nombres exactos, confirmados por Pablo (23/11) -- no se leen de
// staging ni de producción, se escriben tal cual vinieron.
const ESTUDIOS_PRODUCCION = [
  "Amiloidosis",
  "Centellograma cerebral",
  "Centellograma con DTPA",
  "Centellograma de infección/inflamación",
  "Centellograma de paratiroides",
  "Centellograma de perfusión miocárdica",
  "Centellograma hepatobiliar",
  "Centellograma pulmonar",
  "Centellograma renal con DMSA",
  "Centellograma óseo",
  "Gammagrafía de tiroides",
  "Ganglio centinela",
  "Hemorragia digestiva con GR marcados",
  "Linfografia",
  "Tránsito Esófago-Gástrico",
];

async function main() {
  await prepararFixturesGlobales(); // deja logueado como PERSONAS.admin

  console.log("Sembrando catálogo de estudios...");
  await loguearComo(PERSONAS.admin); // allow write: if isAdmin() en /estudios/{id}
  // Idempotente: addEstudio genera un id nuevo cada vez (slug + timestamp,
  // ver estudios.js) -- sin este chequeo, correr el script dos veces sobre
  // datos YA importados (--import) duplicaría los 15 nombres. Se compara
  // por nombre exacto, no por id.
  const existentesSnap = await getDocs(collection(db, "estudios"));
  const nombresExistentes = new Set(existentesSnap.docs.map((d) => d.data().nombre));
  let creados = 0;
  for (const nombre of ESTUDIOS_PRODUCCION) {
    if (nombresExistentes.has(nombre)) continue;
    await addEstudio({ nombre });
    creados++;
  }
  console.log(`  ${creados} estudios nuevos, ${ESTUDIOS_PRODUCCION.length - creados} ya existían (sin duplicar).`);

  console.log("Sembrando fichas de ejemplo en SEDE_A...");
  // Idempotente: fichasUsadas es create-only (allow update,delete: if
  // false, firestore.rules:1348) -- un setDoc de vuelta sobre un id que ya
  // existe es un UPDATE para Firestore, y la regla lo rechaza siempre. Sin
  // este chequeo, correr el script dos veces rompía acá (confirmado antes
  // de este arreglo: permission-denied en la 2da corrida).
  const numeroAnulada = "9000001";
  if (!(await getDoc(fichaUsadaRef(SEDE_A, numeroAnulada, "1"))).exists()) {
    await setDoc(fichaUsadaRef(SEDE_A, numeroAnulada, "1"), {
      pacienteFicha: numeroAnulada, fichaIntentoNro: "1", sedeId: SEDE_A,
      pacienteFichaNum: Number(numeroAnulada), pacienteNombre: "Ejemplo Anulada",
      pacienteDni: "11111111", actaId: "semilla", tipo: "paciente",
    });
    await setDoc(anulaFichaRef(SEDE_A, numeroAnulada, "1"), {
      tipo: "anulacion", anulaId: `ficha_${SEDE_A}_${numeroAnulada}_1`, sedeId: SEDE_A,
      usuarioEmail: PERSONAS.admin.email, motivo: "Semilla de prueba -- estudio no realizado",
    });
  }

  // Ficha usada y VIGENTE (intento 1) -- para ver el bloqueo duro en acción
  // si se intenta emitir sobre este mismo número.
  const numeroVigente = "9000002";
  if (!(await getDoc(fichaUsadaRef(SEDE_A, numeroVigente, "1"))).exists()) {
    await setDoc(fichaUsadaRef(SEDE_A, numeroVigente, "1"), {
      pacienteFicha: numeroVigente, fichaIntentoNro: "1", sedeId: SEDE_A,
      pacienteFichaNum: Number(numeroVigente), pacienteNombre: "Ejemplo Vigente",
      pacienteDni: "22222222", actaId: "semilla", tipo: "paciente",
    });
  }

  console.log("Sembrando eluciones de ejemplo en SEDE_A...");
  // técnico (no admin): la regla de lectura de /actas/{id} exige
  // sedeAuditando para admin, o sede propia para técnico/administrativa
  // (firestore.rules:1011-1016) -- sin esto, el chequeo de abajo (list sin
  // sedeAuditando puesto) choca con permission-denied.
  await loguearComo(PERSONAS.tecnicoA);
  // Idempotente: chequea si YA hay alguna elución de ese lote antes de
  // crear nada más -- no hay índice por loteGenerador (no se crea ninguno
  // nuevo, confirmado en la investigación), así que se filtra en memoria
  // sobre el total de eluciones de la sede (volumen de semilla, chico).
  async function yaExisteElucionDeLote(lote) {
    const snap = await getDocs(query(collection(db, "actas"), where("tipo", "==", "elucion"), where("sedeId", "==", SEDE_A)));
    return snap.docs.some((d) => d.data().loteGenerador === lote);
  }
  function datosElucion(lote, overrides = {}) {
    return {
      sedeId: SEDE_A, sedeNombre: "FUESMEN Central", loteGenerador: lote,
      actividadEluida: 740, volumen: 10, usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
      ...overrides,
    };
  }
  const DATOS_GENERADOR = { actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" };

  // Lote A: primera (con los 4 datos) ANULADA + recarga (con los 4 datos
  // igual -- pedirDatos vuelve a dar true porque la única con datos quedó
  // anulada).
  const loteA = "9-00001";
  if (!(await yaExisteElucionDeLote(loteA))) {
    await loguearComo(PERSONAS.tecnicoA);
    await addActaElucion(datosElucion(loteA, { ...DATOS_GENERADOR, observacion: "Semilla -- primera (a anular)" }), true);
    const primeraSnap = await getDocs(query(collection(db, "actas"), where("tipo", "==", "elucion"), where("sedeId", "==", SEDE_A), where("loteGenerador", "==", loteA)));
    const primeraId = primeraSnap.docs[0].id;
    await loguearComo(PERSONAS.admin);
    await anularActaTransaction({ id: primeraId, sedeId: SEDE_A }, "Semilla -- anulación de ejemplo", PERSONAS.admin);
    await loguearComo(PERSONAS.tecnicoA);
    // Recarga: marcador ya existe -> esPrimeraVez=false para addActaElucion
    // (el 2do argumento), pero pedirDatos SÍ pide los 4 -- se los pasamos
    // en `data` igual, sin tocar el marcador.
    await addActaElucion(datosElucion(loteA, { ...DATOS_GENERADOR, observacion: "Semilla -- recarga con los 4 datos" }), false);
  }

  // Lote B: primera vigente CON datos + 2 eluciones normales (sin pedir
  // nada, pedirDatos=false para esas 2).
  const loteB = "9-00002";
  if (!(await yaExisteElucionDeLote(loteB))) {
    await loguearComo(PERSONAS.tecnicoA);
    await addActaElucion(datosElucion(loteB, { ...DATOS_GENERADOR, observacion: "Semilla -- primera vigente" }), true);
    await addActaElucion(datosElucion(loteB, { observacion: "Semilla -- elución normal 1" }), false);
    await addActaElucion(datosElucion(loteB, { observacion: "Semilla -- elución normal 2" }), false);
  }

  // Lote C: "viejo" -- sólo actividadCalibrada, SIN los otros 3 (simula una
  // primera elución de antes del 3/10). Se planta directo (bypass admin),
  // ya que el flujo normal de hoy exigiría los 4 si pedirDatos da true.
  const loteC = "9-00003";
  if (!(await yaExisteElucionDeLote(loteC))) {
    await plantarDirecto("actas", `semilla_elucion_${loteC}`, {
      tipo: "elucion", sedeId: SEDE_A, sedeNombre: "FUESMEN Central", loteGenerador: loteC,
      actividadEluida: 740, volumen: 10, actividadCalibrada: 1850,
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "Semilla -- lote viejo (sólo actividadCalibrada)",
      fecha: new Date("2026-09-15T10:00:00"),
    });
    await plantarDirecto("generadoresVistos", `${SEDE_A}_${loteC.toUpperCase()}`, {
      sedeId: SEDE_A, loteGenerador: loteC, usuarioEmail: PERSONAS.tecnicoA.email, actividadCalibrada: 1850,
      primeraFecha: new Date("2026-09-15T10:00:00"),
    });
  }

  console.log("Listo. Estudios:", ESTUDIOS_PRODUCCION.length, "-- fichas: 1 anulada (N° 9000001), 1 vigente (N° 9000002) -- eluciones: lote A (anulada+recarga), lote B (vigente+2 normales), lote C (viejo).");
  await cerrarConexiones();
}

main().catch(async (e) => {
  console.error("ERROR AL SEMBRAR --", e.message);
  await cerrarConexiones();
  process.exit(1);
});
