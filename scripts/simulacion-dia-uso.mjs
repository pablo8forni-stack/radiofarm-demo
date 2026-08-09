// Script de UN SOLO USO: simula un día de uso real de RadioFarm (Libro 2 +
// Libro 3/Elución + MIBG/Lutecio-177) con 10 técnicos trabajando EN
// PARALELO -- cada uno en su propio proceso de Node (ver
// simulacion-tecnico-worker.mjs), con los mismos 11 onSnapshot que abre
// Libro 2 en la app real, para medir el impacto real en el gráfico de uso
// de Firestore de staging (escrituras Y lecturas, incluidas las que
// generan los listeners -- la fuente dominante real, no las escrituras en
// sí). Usa sólo funciones reales de src/services/firestore/*.js.
//
// SIEMPRE contra staging -- fixtures.mjs aborta solo si el proyecto activo
// no es radiofarm-fuesmen-staging. Correr con:
//   node --env-file=.env.staging scripts/simulacion-dia-uso.mjs
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SEDE_A, PERSONAS, loguearComo, cerrarConexiones } from "./testing/fixtures.mjs";
import { setRol } from "../src/services/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER = join(__dirname, "simulacion-tecnico-worker.mjs");

const N_TECNICOS = 10;
const tecnicos = Array.from({ length: N_TECNICOS }, (_, i) => {
  const index = i + 1;
  return {
    index,
    email: `tecnico-sim-${String(index).padStart(2, "0")}@radiofarm.local`,
    nombre: `Técnico Simulado ${index}`,
    // Mitad con 3, mitad con 4 -- no los 10 haciendo exactamente lo mismo.
    nPacientes: index % 2 === 1 ? 4 : 3,
    hacerElucion: index === 1,
    hacerMibg: index === 2,
    hacerLutecio: index === 3,
  };
});

// roles/{email} se puede precargar ANTES de que la cuenta de Auth exista
// (mismo patrón que prepararFixturesGlobales en fixtures.mjs) -- cada
// worker crea su propia cuenta de Auth al loguearse por primera vez.
async function provisionar() {
  await loguearComo(PERSONAS.admin);
  for (const t of tecnicos) {
    await setRol(t.email, { nombre: t.nombre, rol: "tecnico", sede: SEDE_A });
  }
  await cerrarConexiones();
}

function correrTecnico(tarea) {
  return new Promise((resolve) => {
    const child = fork(WORKER, [JSON.stringify(tarea)], { stdio: "inherit" });
    let resultado = null;
    child.on("message", (m) => { resultado = m; });
    child.on("exit", (code) => {
      resolve(resultado || { index: tarea.index, nombre: tarea.nombre, escrituras: 0, erroresEscritura: 1, fatal: `proceso salió con code ${code} sin reportar` });
    });
  });
}

async function main() {
  console.log(`Provisionando ${N_TECNICOS} técnicos de simulación (sede Central)...`);
  await provisionar();

  console.log("Lanzando los 10 técnicos EN PARALELO (procesos independientes, listeners de Libro 2 abiertos)...\n");
  const inicio = Date.now();
  const resultados = await Promise.all(tecnicos.map(correrTecnico));
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  resultados.sort((a, b) => a.index - b.index);
  const totalEscrituras = resultados.reduce((s, r) => s + r.escrituras, 0);
  const totalErrores = resultados.reduce((s, r) => s + r.erroresEscritura, 0);

  console.log("\n=== Resultado por técnico ===");
  resultados.forEach((r) => {
    const tarea = tecnicos.find((t) => t.index === r.index);
    const rol = [tarea.hacerElucion && "elución×4", tarea.hacerMibg && "MIBG", tarea.hacerLutecio && "Lutecio-177"].filter(Boolean).join("+") || "sólo pacientes";
    console.log(`  ${r.nombre} (${tarea.nPacientes} pacientes, ${rol}): ${r.escrituras} escrituras${r.erroresEscritura ? ` -- ${r.erroresEscritura} ERRORES` : ""}${r.fatal ? ` (fatal: ${r.fatal})` : ""}`);
  });

  console.log(`\n=== Total ===`);
  console.log(`${totalEscrituras} escrituras confirmadas, ${totalErrores} errores, corrida completa en ${segundos}s.`);
  console.log(`Lecturas: revisá Firebase Console > radiofarm-fuesmen-staging > Firestore Database > Uso, ahí está el número real (incluye listeners + reglas, que este script no puede medir desde el cliente).`);
}

main().catch((e) => { console.error("Error fatal en el orquestador:", e); process.exit(1); });
