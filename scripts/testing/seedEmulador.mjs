// Fase 2.1a (23/11) -- siembra datos de prueba en el EMULADOR LOCAL para
// poder abrir la app de verdad (`npm run dev` con VITE_USE_EMULATOR=1) y
// probar la pantalla de la administrativa a mano. NUNCA toca staging ni
// producción -- ver la guarda obligatoria más abajo.
//
// Uso (con el emulador ya corriendo aparte, `firebase emulators:start`):
//   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
//   node --env-file=.env.emulator scripts/testing/seedEmulador.mjs
import { setDoc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../../src/firebase.js";
import { PERSONAS, SEDE_A, loguearComo, prepararFixturesGlobales, cerrarConexiones } from "./fixtures.mjs";
import { fichaUsadaRef, anulaFichaRef } from "../../src/services/firestore/actas.js";
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

  console.log("Listo. Estudios:", ESTUDIOS_PRODUCCION.length, "-- fichas: 1 anulada (N° 9000001), 1 vigente (N° 9000002), SEDE_A.");
  await cerrarConexiones();
}

main().catch(async (e) => {
  console.error("ERROR AL SEMBRAR --", e.message);
  await cerrarConexiones();
  process.exit(1);
});
