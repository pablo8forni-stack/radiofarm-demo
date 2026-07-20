// Área C: las reglas nuevas rechazan lo que deben (probado con escrituras
// directas al SDK cliente, simulando a alguien saltándose la UI/consola del
// navegador -- exactamente el escenario que la regla tiene que cubrir, no la
// app). Incluye controles positivos para confirmar que la regla no es más
// restrictiva de lo debido.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  PERSONAS, SEDE_A, SEDE_B, FARM_ID, db, loguearComo, prepararFixturesGlobales, loteDePrueba, cerrarConexiones,
  crearLoteDirecto, borrarLote,
} from "./fixtures.mjs";

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

// Auditoría de seguridad: la regla de lotes no validaba contenido -- un
// técnico con su propia sesión (sin pasar por la UI) podía subir `cantidad`
// (crear stock de la nada) o cambiar lote/vencimiento/farmId de un lote
// existente. Estos tests ejercitan la regla directo con updateDoc, sin pasar
// por egresoTransaction, para aislar la regla en sí de la lógica de la app.
test("técnico NO puede subir la cantidad de un lote directamente", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId, ref } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => updateDoc(ref, { cantidad: 6 }));

  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("técnico NO puede cambiar farmId/lote/vencimiento de un lote (aunque la cantidad baje)", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId, ref } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => updateDoc(ref, { cantidad: 3, lote: "OTRO-LOTE" }));
  await assertPermissionDenied(() => updateDoc(ref, { vencimiento: "2099-01-01" }));

  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("control positivo: técnico SÍ puede bajar la cantidad de un lote de su sede (egreso directo)", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId, ref } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  await updateDoc(ref, { cantidad: 3 });
  const snap = await getDoc(ref);
  assert.equal(snap.data().cantidad, 3);

  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("control positivo: admin SÍ puede subir la cantidad de un lote (anulación/transferencia)", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId, ref } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);
  await updateDoc(ref, { cantidad: 8 });
  const snap = await getDoc(ref);
  assert.equal(snap.data().cantidad, 8);
  await borrarLote(SEDE_A, loteId);
});

// Auditoría de seguridad: las actas tienen nombre/DNI de pacientes (Libro 2)
// -- Ley 25.326. Antes cualquier técnico autenticado podía leer actas de
// CUALQUIER sede con su propia sesión (la regla vieja sólo pedía tieneAcceso()).
function actaBase(overrides = {}) {
  return { tipo: "marcacion", fecha: serverTimestamp(), farmId: FARM_ID, lote: loteDePrueba(), mciMarcacion: 10, ...overrides };
}

test("técnico NO puede leer un acta de otra sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_A, usuarioEmail: PERSONAS.tecnicoA.email }));

  await loguearComo(PERSONAS.tecnicoB); // sede italiano
  await assertPermissionDenied(() => getDoc(actaRef));
});

test("control positivo: técnico SÍ puede leer un acta de su propia sede", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_A, usuarioEmail: PERSONAS.tecnicoA.email }));
  const snap = await getDoc(actaRef);
  assert.ok(snap.exists());
});

test("control positivo: admin SÍ puede leer actas de cualquier sede", async () => {
  await loguearComo(PERSONAS.tecnicoB);
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.tecnicoB.email }));

  await loguearComo(PERSONAS.admin);
  const snap = await getDoc(actaRef);
  assert.ok(snap.exists());
});

// Anulación de actas: mismo criterio admin-only que movimientos (nunca update
// de la original -- actas sigue create-only, la anulación es un acta nueva
// tipo "anulacion" vinculada por anulaId).
test("técnico NO puede crear una anulación de acta directo, ni en su propia sede", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_A, usuarioEmail: PERSONAS.tecnicoA.email }));

  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "anulacion", fecha: serverTimestamp(), sedeId: SEDE_A,
      anulaId: actaRef.id, motivo: "Test", usuarioEmail: PERSONAS.tecnicoA.email,
    })
  );
});

test("control positivo: admin SÍ puede crear una anulación de acta", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_A, usuarioEmail: PERSONAS.tecnicoA.email }));

  await loguearComo(PERSONAS.admin);
  await addDoc(collection(db, "actas"), {
    tipo: "anulacion", fecha: serverTimestamp(), sedeId: SEDE_A,
    anulaId: actaRef.id, motivo: "Test", usuarioEmail: PERSONAS.admin.email,
  });
});

test("anulación de acta sin anulaId es rechazada (incluso siendo admin)", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "anulacion", fecha: serverTimestamp(), sedeId: SEDE_A,
      motivo: "Test", usuarioEmail: PERSONAS.admin.email,
    })
  );
});
