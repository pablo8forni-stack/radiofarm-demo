// Área C: las reglas nuevas rechazan lo que deben (probado con escrituras
// directas al SDK cliente, simulando a alguien saltándose la UI/consola del
// navegador -- exactamente el escenario que la regla tiene que cubrir, no la
// app). Incluye controles positivos para confirmar que la regla no es más
// restrictiva de lo debido.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { PERSONAS, SEDE_A, SEDE_B, FARM_ID, db, loguearComo, prepararFixturesGlobales, loteDePrueba, cerrarConexiones } from "./fixtures.mjs";

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

async function assertPermissionDenied(fn) {
  try {
    await fn();
    assert.fail("se esperaba que la escritura fuera rechazada por las reglas");
  } catch (e) {
    assert.equal(e.code, "permission-denied", `código inesperado: ${e.code} (${e.message})`);
  }
}

function movimientoBase(overrides = {}) {
  return {
    fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, cantidad: 1, lote: loteDePrueba(),
    sedeNombre: "FUESMEN Central", farmNombre: "MIBI (Sestamibi)",
    usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre,
    ...overrides,
  };
}

test("técnico NO puede crear un movimiento tipo ingreso directo", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "ingreso", loteId: "x" }))
  );
});

test("técnico NO puede crear un movimiento tipo anulacion directo", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "anulacion", anulaId: "x" }))
  );
});

test("técnico NO puede crear un egreso con sedeId de otra sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central
  await assertPermissionDenied(() =>
    addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "egreso", sedeId: SEDE_B, loteId: "x" }))
  );
});

test("movimiento con cantidad 0 es rechazado", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "egreso", cantidad: 0, loteId: "x" }))
  );
});

test("movimiento con cantidad negativa es rechazado", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "egreso", cantidad: -1, loteId: "x" }))
  );
});

test("acta con mciAdministrados 0 es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 0,
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("acta con mciMarcacion 0 es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "marcacion", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.tecnicoA.email, mciMarcacion: 0,
    })
  );
});

// Controles positivos: si estos fallaran, la regla estaría siendo más
// restrictiva de lo debido (rompería egreso real de técnico, o cualquier
// operación de admin). Los docs que crean quedan en Firestore -- movimientos
// es create-only para todos, ni el admin los puede borrar (ver fixtures.mjs);
// se limpian con `npm run staging:reset` cuando haga falta.
test("control positivo: técnico SÍ puede crear un egreso válido en su propia sede", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await addDoc(collection(db, "movimientos"), movimientoBase({ tipo: "egreso", loteId: "x" }));
});

test("control positivo: admin SÍ puede crear ingreso y anulación directo", async () => {
  await loguearComo(PERSONAS.admin);
  await addDoc(collection(db, "movimientos"), movimientoBase({
    tipo: "ingreso", loteId: "x", usuarioEmail: PERSONAS.admin.email, usuarioNombre: PERSONAS.admin.nombre,
  }));
  await addDoc(collection(db, "movimientos"), movimientoBase({
    tipo: "anulacion", anulaId: "x", usuarioEmail: PERSONAS.admin.email, usuarioNombre: PERSONAS.admin.nombre,
  }));
});
