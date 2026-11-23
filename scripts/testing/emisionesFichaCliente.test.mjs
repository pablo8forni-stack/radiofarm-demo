// Fase 2.1a (23/11) -- capa de servicio de emisión de fichas
// (src/services/firestore/emisionesFicha.js). A diferencia de
// emisionesFicha.test.mjs (que prueba las REGLAS con escrituras directas al
// SDK), este archivo prueba las FUNCIONES de cliente -- que son las que la
// pantalla de la administrativa va a llamar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, getDoc, deleteDoc, collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { PERSONAS, SEDE_A, SEDE_B, db, loguearComo, prepararFixturesGlobales, fichaDePrueba, cerrarConexiones } from "./fixtures.mjs";
import { fichaUsadaRef, anulaFichaRef } from "../../src/services/firestore/actas.js";
import { setSedeAuditando } from "../../src/services/auth.js";
import {
  emisionFichaRef, emisionResueltaRef,
  calcularFichaIntentoObservado, calcularProximaEmisionVersion,
  crearEmisionFicha, liberarEmisionStandalone,
} from "../../src/services/firestore/emisionesFicha.js";

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

// Mismo motivo y mismo alcance que el bypass de admin ya usado en
// emisionesFicha.test.mjs (medición de TTL): sólo para plantar estado que
// las reglas normales no dejan producir hoy (un padre ya vencido, o un
// huérfano de Resueltas sin su padre) -- SOLO contra el emulador local.
async function plantarDirecto(coleccion, id, data) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const { initializeApp: initAdminApp, getApps: getAdminApps } = await import("firebase-admin/app");
  const { getFirestore: getAdminFirestore, Timestamp: AdminTimestamp } = await import("firebase-admin/firestore");
  if (!getAdminApps().length) initAdminApp({ projectId: "radiofarm-fuesmen-staging" });
  const convertido = {};
  for (const [k, v] of Object.entries(data)) {
    convertido[k] = v && typeof v.toMillis === "function" ? AdminTimestamp.fromMillis(v.toMillis()) : v;
  }
  await getAdminFirestore().doc(`${coleccion}/${id}`).set(convertido);
}

async function crearFichaUsadaDirecta(numero, intentoNro, overrides = {}) {
  await loguearComo(PERSONAS.admin);
  await setDoc(fichaUsadaRef(SEDE_A, numero, intentoNro), {
    pacienteFicha: numero, fichaIntentoNro: intentoNro, sedeId: SEDE_A,
    pacienteFichaNum: Number(numero), pacienteNombre: "Cliente Test", pacienteDni: "1",
    actaId: "x", tipo: "paciente", ...overrides,
  });
}
async function anularFichaIntentoDirecto(numero, intentoNro) {
  await loguearComo(PERSONAS.admin);
  await setDoc(anulaFichaRef(SEDE_A, numero, intentoNro), {
    tipo: "anulacion", anulaId: `ficha_${SEDE_A}_${numero}_${intentoNro}`, sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, motivo: "anulación de prueba cliente",
  });
}

// === calcularFichaIntentoObservado / bloqueo duro ===

test("calcularFichaIntentoObservado: N° nunca usado -> k='0', no vigente", async () => {
  const numero = fichaDePrueba();
  const r = await calcularFichaIntentoObservado(SEDE_A, numero);
  assert.deepEqual(r, { k: "0", vigente: false });
});

test("calcularFichaIntentoObservado: intento 1 vigente -> k='1', vigente, con DNI", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "40111222" });
  const r = await calcularFichaIntentoObservado(SEDE_A, numero);
  assert.equal(r.k, "1");
  assert.equal(r.vigente, true);
  assert.equal(r.dni, "40111222");
});

test("calcularFichaIntentoObservado: intento 1 anulado -> k='1', no vigente", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  // Leer una anulación que SÍ existe exige la rama de administrativa/admin
  // de la regla de /actas/{actaId} (tipo=='anulacion', propia sede) --
  // a diferencia de una que no existe (resource==null, abierto a cualquiera
  // con tieneAcceso()). admin sin sedeAuditando no entra por ninguna rama;
  // administrativa sí, por su rama específica (Fase 1A).
  await loguearComo(PERSONAS.administrativa);
  const r = await calcularFichaIntentoObservado(SEDE_A, numero);
  assert.deepEqual(r, { k: "1", vigente: false });
});

test("crearEmisionFicha: bloqueo duro -- rechaza con acta vigente, mensaje claro", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await assert.rejects(
    () => crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email }),
    /acta vigente/
  );
});

test("crearEmisionFicha: sin acta vigente -- crea con fichaIntentoObservado correcto", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  const snap = await getDoc(emisionFichaRef(SEDE_A, numero, "1"));
  assert.equal(snap.data().fichaIntentoObservado, "1");
  assert.equal(snap.data().pacienteFichaNum, Number(numero));
});

// === calcularProximaEmisionVersion ===

test("calcularProximaEmisionVersion: nada existe -> v1", async () => {
  const numero = fichaDePrueba();
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: true, version: "1" });
});

test("calcularProximaEmisionVersion: v1 con resolución huérfana (sin padre) -- salta a v2", async () => {
  const numero = fichaDePrueba();
  // Huérfano: Resueltas_1 existe, emisionesFicha_1 NO -- simula que el
  // padre ya se limpió por TTL mientras la resolución sobrevivió.
  await plantarDirecto("emisionesFichaResueltas", `${SEDE_A}_${numero}_1`, {
    sedeId: SEDE_A, numero, emisionVersion: "1", usuarioEmail: PERSONAS.admin.email,
    vistoAdmin: false, expiraEn: Timestamp.fromMillis(Date.now() + 60 * 86400000),
    estado: "liberada", motivo: "x", fichaIntentoNroObservado: "0",
  });
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: true, version: "2" });
});

test("calcularProximaEmisionVersion: hueco -- v1 borrada (nada), v2 resuelta completa -- propone v3, nunca v1", async () => {
  const numero = fichaDePrueba();
  const expiraEn = Timestamp.fromMillis(Date.now() + 60 * 86400000);
  await plantarDirecto("emisionesFicha", `${SEDE_A}_${numero}_2`, {
    sedeId: SEDE_A, numero, pacienteFichaNum: Number(numero), emisionVersion: "2",
    dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.admin.email,
    fichaIntentoObservado: "0", expiraEn,
  });
  await plantarDirecto("emisionesFichaResueltas", `${SEDE_A}_${numero}_2`, {
    sedeId: SEDE_A, numero, emisionVersion: "2", usuarioEmail: PERSONAS.admin.email,
    vistoAdmin: false, expiraEn, estado: "liberada", motivo: "x", fichaIntentoNroObservado: "0",
  });
  // v1 nunca se crea -- "borrada" se simula simplemente no creándola.
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: true, version: "3" });
});

test("calcularProximaEmisionVersion: v más alta pendiente y no vencida -- bloquea, señala esa versión", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: false, motivo: "pendiente", version: "1" });
});

test("calcularProximaEmisionVersion: v más alta pendiente pero VENCIDA (desfasaje TTL) -- cuenta como resuelta", async () => {
  const numero = fichaDePrueba();
  await plantarDirecto("emisionesFicha", `${SEDE_A}_${numero}_1`, {
    sedeId: SEDE_A, numero, pacienteFichaNum: Number(numero), emisionVersion: "1",
    dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.admin.email,
    fichaIntentoObservado: "0", expiraEn: Timestamp.fromMillis(Date.now() - 86400000),
  });
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: true, version: "2" });
});

test("calcularProximaEmisionVersion: tope -- v5 ya ocupada sin resolver y vencida, siguiente sería 6", async () => {
  const numero = fichaDePrueba();
  for (let v = 1; v <= 5; v++) {
    const expiraEn = v < 5 ? Timestamp.fromMillis(Date.now() + 60 * 86400000) : Timestamp.fromMillis(Date.now() - 86400000);
    await plantarDirecto("emisionesFicha", `${SEDE_A}_${numero}_${v}`, {
      sedeId: SEDE_A, numero, pacienteFichaNum: Number(numero), emisionVersion: String(v),
      dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.admin.email,
      fichaIntentoObservado: "0", expiraEn,
    });
    if (v < 5) {
      await plantarDirecto("emisionesFichaResueltas", `${SEDE_A}_${numero}_${v}`, {
        sedeId: SEDE_A, numero, emisionVersion: String(v), usuarioEmail: PERSONAS.admin.email,
        vistoAdmin: false, expiraEn, estado: "liberada", motivo: "x", fichaIntentoNroObservado: "0",
      });
    }
  }
  // v5 vencida se cuenta como resuelta, pero la siguiente (6) supera el
  // tope de 5 versiones -- tope, no una v6 válida.
  const r = await calcularProximaEmisionVersion(SEDE_A, numero);
  assert.deepEqual(r, { ok: false, motivo: "tope" });
});

// === liberarEmisionStandalone ===

test("liberarEmisionStandalone: motivo vacío -- rechazado ANTES de escribir (sin red)", async () => {
  await loguearComo(PERSONAS.administrativa);
  await assert.rejects(
    () => liberarEmisionStandalone({ sedeId: SEDE_A, numero: fichaDePrueba(), emisionVersion: "1", motivo: "", usuarioEmail: PERSONAS.administrativa.email }),
    /motivo/
  );
});

test("liberarEmisionStandalone: motivo sólo espacios -- rechazado antes de escribir", async () => {
  await loguearComo(PERSONAS.administrativa);
  await assert.rejects(
    () => liberarEmisionStandalone({ sedeId: SEDE_A, numero: fichaDePrueba(), emisionVersion: "1", motivo: "    ", usuarioEmail: PERSONAS.administrativa.email }),
    /motivo/
  );
});

test("liberarEmisionStandalone: sin acta vigente -- libera, motivo recortado, fichaIntentoNroObservado correcto", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  await liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "  Ficha vencida sin usar  ", usuarioEmail: PERSONAS.administrativa.email });
  const snap = await getDoc(emisionResueltaRef(SEDE_A, numero, "1"));
  assert.equal(snap.data().motivo, "Ficha vencida sin usar");
  assert.equal(snap.data().fichaIntentoNroObservado, "0");
  assert.equal(snap.data().vistoAdmin, false);
});

test("liberarEmisionStandalone: acta vigente con OTRO DNI -- libera igual (conflicto, no bloquea)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "11111111", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "22222222" });
  await loguearComo(PERSONAS.administrativa);
  await liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "Reasignado a otro paciente", usuarioEmail: PERSONAS.administrativa.email });
  const snap = await getDoc(emisionResueltaRef(SEDE_A, numero, "1"));
  assert.equal(snap.data().estado, "liberada");
});

test("liberarEmisionStandalone: ya resuelta -- rechazada ANTES de escribir, no choca con permission-denied crudo", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  await liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "primera liberación", usuarioEmail: PERSONAS.administrativa.email });
  await assert.rejects(
    () => liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "segundo intento", usuarioEmail: PERSONAS.administrativa.email }),
    /ya fue resuelta/
  );
});

test("liberarEmisionStandalone: acta vigente con el MISMO DNI -- rechazada ANTES de escribir, mensaje claro", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "33333333", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.administrativa.email });
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "33333333" });
  await loguearComo(PERSONAS.administrativa);
  await assert.rejects(
    () => liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "x", usuarioEmail: PERSONAS.administrativa.email }),
    /mismo paciente/
  );
});

// === Query sedeId + pacienteFichaNum sobre fichasUsadas (para el listener por fila) ===

test("query where(sedeId, pacienteFichaNum) sobre fichasUsadas: permitida para la administrativa de su sede", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  const q = query(collection(db, "fichasUsadas"), where("sedeId", "==", SEDE_A), where("pacienteFichaNum", "==", Number(numero)));
  const snap = await getDocs(q); // si la regla no lo permite, esto tira permission-denied
  assert.equal(snap.size, 1);
});

test("query where(sedeId, pacienteFichaNum) sobre fichasUsadas: alguien de sede B consultando sede A -- permission-denied (aislamiento real)", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.tecnicoB); // sede B, consultando la query con sedeId de sede A
  const q = query(collection(db, "fichasUsadas"), where("sedeId", "==", SEDE_A), where("pacienteFichaNum", "==", Number(numero)));
  await assert.rejects(() => getDocs(q), (e) => e.code === "permission-denied");
});

// === Admin: con/sin sedeAuditando ===
// Hallazgo real (ver informe): isAdmin() SIN 'sedeAuditando' configurado no
// puede leer actas EXISTENTES (ni las de su propia sede) -- sólo
// 'administrativa' tiene una rama propia en /actas/{actaId} para eso
// (firestore.rules:1011-1016). Esto golpea a calcularFichaIntentoObservado
// en cuanto hay una anulación real para leer (ficha anulada), no en una
// ficha nunca usada (ahí el camino resource==null no pide ningún rol).

// IMPORTANTE sobre el orden: setSedeAuditando escribe de verdad en
// roles/{email} y queda así para el resto de la corrida (no hay rollback
// automático entre tests). Por eso el test "SIN sedeAuditando" va PRIMERO
// -- antes de que ningún otro test de este archivo le configure algo a
// PERSONAS.admin.
test("admin SIN sedeAuditando: calcularFichaIntentoObservado con una anulación real -- permission-denied (documentado, no se resuelve acá)", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.admin); // estado por defecto de PERSONAS.admin, sin sedeAuditando todavía
  await assert.rejects(
    () => calcularFichaIntentoObservado(SEDE_A, numero),
    (e) => e.code === "permission-denied"
  );
});

test("admin CON sedeAuditando==SEDE_A: calcularFichaIntentoObservado lee la anulación sin problema", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  const r = await calcularFichaIntentoObservado(SEDE_A, numero);
  assert.deepEqual(r, { k: "1", vigente: false });
});

test("admin CON sedeAuditando==SEDE_A: crearEmisionFicha y liberarEmisionStandalone funcionan de punta a punta", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await crearEmisionFicha({ sedeId: SEDE_A, numero, dni: "1", nombre: "N", estudio: "E", usuarioEmail: PERSONAS.admin.email });
  await liberarEmisionStandalone({ sedeId: SEDE_A, numero, emisionVersion: "1", motivo: "liberación de admin auditando", usuarioEmail: PERSONAS.admin.email });
  const snap = await getDoc(emisionResueltaRef(SEDE_A, numero, "1"));
  assert.equal(snap.data().estado, "liberada");
});
