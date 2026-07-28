// Área C: las reglas nuevas rechazan lo que deben (probado con escrituras
// directas al SDK cliente, simulando a alguien saltándose la UI/consola del
// navegador -- exactamente el escenario que la regla tiene que cubrir, no la
// app). Incluye controles positivos para confirmar que la regla no es más
// restrictiva de lo debido.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
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

test("acta de paciente sin N° de ficha es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(),
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10,
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("acta de paciente con N° de ficha vacío es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(),
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "",
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("control positivo: técnico SÍ puede crear un acta de paciente con N° de ficha", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), {
    tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(),
    usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "4521", isotopoId: "tc99m",
    pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
  });
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("acta de paciente sin isotopoId es rechazada (siempre presente en actas nuevas)", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(),
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "4521",
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("acta de paciente Lutecio-177 sin médico responsable es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, lote: loteDePrueba(),
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "4521", isotopoId: "lu177",
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("control positivo: acta de paciente Lutecio-177 con médico responsable no necesita farmId", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), {
    tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, lote: "LU177-TEST",
    usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "4521", isotopoId: "lu177",
    medicoResponsable: "Dra. Test", pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
  });
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
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

// Libro 3 (Elución): actividadCalibrada sólo es obligatoria en la primera
// elución de cada lote/serie -- lo decide el marcador generadoresVistos (id
// determinístico sedeId_loteGenerador). Mismo criterio de sede que el resto
// de actas para crear el marcador.
function elucionBase(overrides = {}) {
  return {
    tipo: "elucion", fecha: serverTimestamp(), sedeId: SEDE_A,
    loteGenerador: `GEN-${loteDePrueba()}`, actividadEluida: 740, volumen: 10,
    usuarioEmail: PERSONAS.tecnicoA.email, ...overrides,
  };
}

test("elución de un lote nuevo SIN actividadCalibrada es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => addDoc(collection(db, "actas"), elucionBase()));
});

test("control positivo: elución de un lote nuevo CON actividadCalibrada se acepta", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await addDoc(collection(db, "actas"), elucionBase({ actividadCalibrada: 1850 }));
});

test("control positivo: elución de un lote YA visto no necesita actividadCalibrada", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = `GEN-${loteDePrueba()}`;
  await setDoc(doc(db, "generadoresVistos", `${SEDE_A}_${lote.toUpperCase()}`), {
    sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email,
  });

  await loguearComo(PERSONAS.tecnicoA);
  await addDoc(collection(db, "actas"), elucionBase({ loteGenerador: lote }));
});

// Regresión de un bug real: un teclado de celular autocapitalizó/autocorrigió
// distinto entre dos cargas del "mismo" lote ("Gen2026014" vs "gen2026014"),
// y como el id determinístico no normalizaba mayúsculas, el marcador de la
// primera nunca se encontraba en la segunda. El id tiene que ser insensible
// a mayúsculas/minúsculas.
test("control positivo: elución de un lote ya visto con otra capitalización tampoco necesita actividadCalibrada", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = `Gen${loteDePrueba()}`;
  await setDoc(doc(db, "generadoresVistos", `${SEDE_A}_${lote.toUpperCase()}`), {
    sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email,
  });

  await loguearComo(PERSONAS.tecnicoA);
  await addDoc(collection(db, "actas"), elucionBase({ loteGenerador: lote.toLowerCase() }));
});

test("técnico NO puede crear un marcador generadoresVistos de otra sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central
  const lote = `GEN-${loteDePrueba()}`;
  await assertPermissionDenied(() =>
    setDoc(doc(db, "generadoresVistos", `${SEDE_B}_${lote}`), {
      sedeId: SEDE_B, loteGenerador: lote, usuarioEmail: PERSONAS.tecnicoA.email,
    })
  );
});

// Terapia I-131: 6 tipos planos, no un campo "subtipo" -- ver nota larga en
// firestore.rules#actaValida. Ablativa/Dosis (mCi) y los 3 diagnósticos (µCi)
// exigen tieneAccesoI131() (admin o técnico con el flag accesoTerapiaI131);
// Barrido corporal no, cualquier técnico de la sede puede cargarlo. Médico
// responsable ya NO es requisito de ninguno de los 6 (se sacó del formulario).
function i131Base(tipo, overrides = {}) {
  return {
    tipo, fecha: serverTimestamp(), sedeId: SEDE_A,
    pacienteFicha: "9001", pacienteNombre: "Test I131", pacienteDni: "2",
    ...overrides,
  };
}

test("técnico sin accesoTerapiaI131 NO puede crear una Dosis terapéutica de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), i131Base("i131_dosis", {
      usuarioEmail: PERSONAS.tecnicoA.email, actividadAdministrada: 10, unidadActividad: "mCi", lote: "I131-TEST",
    }))
  );
});

test("técnico sin accesoTerapiaI131 NO puede crear una Dosis ablativa de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), i131Base("i131_ablativa", {
      usuarioEmail: PERSONAS.tecnicoA.email, actividadAdministrada: 150, unidadActividad: "mCi", lote: "I131-TEST",
    }))
  );
});

test("técnico sin accesoTerapiaI131 NO puede crear una Captación de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), i131Base("i131_captacion", {
      usuarioEmail: PERSONAS.tecnicoA.email, actividadAdministrada: 90, unidadActividad: "uCi",
    }))
  );
});

test("control positivo: técnico sin accesoTerapiaI131 SÍ puede crear un Barrido corporal de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_barrido", { usuarioEmail: PERSONAS.tecnicoA.email }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("Dosis terapéutica de I-131 con unidadActividad 'uCi' (en vez de 'mCi') es rechazada, aunque tenga el permiso", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), i131Base("i131_dosis", {
      usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 10, unidadActividad: "uCi", lote: "I131-TEST",
    }))
  );
});

test("Captación de I-131 con unidadActividad 'mCi' (en vez de 'uCi') es rechazada, aunque tenga el permiso", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), i131Base("i131_captacion", {
      usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 90, unidadActividad: "mCi",
    }))
  );
});

test("control positivo: técnico CON accesoTerapiaI131 SÍ puede crear una Dosis terapéutica de I-131", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_dosis", {
    usuarioEmail: PERSONAS.tecnicoA.email, actividadAdministrada: 10, unidadActividad: "mCi", lote: "I131-TEST",
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  // Deja el flag como estaba para no filtrar estado a otros tests del archivo.
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: false }, { merge: true });
});

test("control positivo: admin SÍ puede crear una Dosis ablativa de I-131 sin el flag", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_ablativa", {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 150, unidadActividad: "mCi", lote: "I131-TEST", indicacion: "Ca. de tiroides",
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("control positivo: admin SÍ puede crear una Captación de I-131 sin el flag", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_captacion", {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 90, unidadActividad: "uCi",
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("control positivo: admin SÍ puede crear un Centellograma de I-131, vinculado a una dosis", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisRef = await addDoc(collection(db, "actas"), i131Base("i131_dosis", {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 10, unidadActividad: "mCi", lote: "I131-TEST",
  }));
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_centellograma", {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 90, unidadActividad: "uCi", dosisActaId: dosisRef.id,
  }));
  const snap = await getDoc(ref);
  assert.equal(snap.data().dosisActaId, dosisRef.id);
});

test("control positivo: admin SÍ puede crear un registro de Captación y Centellograma de I-131", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), i131Base("i131_captacion_centellograma", {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadAdministrada: 100, unidadActividad: "uCi",
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

// Stock de viales I-131 (espacio de cálculo, Parte A): a diferencia del
// resto de las actas, acá ni la LECTURA queda abierta a cualquier técnico de
// la sede -- hace falta tieneAccesoI131() también (ver esTipoStockI131 y el
// allow read de /actas). "extraccion" no exige medicoResponsable ni farmId,
// pero sí una lista `viales` no vacía y los dos campos de actividad
// (calculada y medida, siempre por separado).
function vialBase(overrides = {}) {
  return {
    tipo: "i131_vial", fecha: serverTimestamp(), sedeId: SEDE_A,
    lote: "TEST-VIAL-1", categoria: "terapeutico", fechaCalibracion: new Date(),
    actividadCalibrada: 1000, volumenInicial: 10,
    ...overrides,
  };
}

function extraccionBase(vialId, overrides = {}) {
  return {
    tipo: "i131_extraccion", fecha: serverTimestamp(), sedeId: SEDE_A,
    viales: [{ vialId, mlExtraidos: 1 }],
    actividadCalculada: 90, actividadMedida: 88,
    ...overrides,
  };
}

test("técnico sin accesoTerapiaI131 NO puede crear un vial de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), vialBase({ usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

test("control positivo: admin SÍ puede crear un vial de I-131", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("vial de I-131 con actividadCalibrada 0 es rechazado (incluso siendo admin)", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, actividadCalibrada: 0 }))
  );
});

test("técnico sin accesoTerapiaI131 NO puede LEER un vial de I-131 de su propia sede", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), vialBase({ usuarioEmail: PERSONAS.admin.email }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("control positivo: técnico CON accesoTerapiaI131 SÍ puede crear y leer un vial de su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), vialBase({ usuarioEmail: PERSONAS.tecnicoA.email }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: false }, { merge: true });
});

test("técnico sin accesoTerapiaI131 NO puede crear una extracción de I-131", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), extraccionBase("vial-inexistente", { usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

test("extracción de I-131 sin viales (lista vacía) es rechazada, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), extraccionBase("x", { usuarioEmail: PERSONAS.admin.email, viales: [] }))
  );
});

test("extracción de I-131 sin actividadMedida es rechazada, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_extraccion", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.admin.email,
      viales: [{ vialId: "x", mlExtraidos: 1 }], actividadCalculada: 90,
      // actividadMedida deliberadamente ausente (no "undefined" -- el SDK
      // rechaza esa key antes de llegar al servidor con un error distinto).
    })
  );
});

test("control positivo: admin SÍ puede crear una extracción de I-131 combinando dos viales", async () => {
  await loguearComo(PERSONAS.admin);
  const v1 = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "V1" }));
  const v2 = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "V2" }));
  const ref = await addDoc(collection(db, "actas"), extraccionBase(v1.id, {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email,
    viales: [{ vialId: v1.id, mlExtraidos: 1 }, { vialId: v2.id, mlExtraidos: 0.5 }],
    vialIds: [v1.id, v2.id],
  }));
  const snap = await getDoc(ref);
  assert.equal(snap.data().viales.length, 2);
});

// Stock diagnóstico (Parte B): mismo tipo i131_vial, distinguido sólo por
// `categoria` -- no hay tipo de acta aparte, así que lo único que hace falta
// probar acá es que la regla exige un valor válido de la lista.
test("vial de I-131 sin categoria es rechazado (incluso siendo admin)", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_vial", fecha: serverTimestamp(), sedeId: SEDE_B,
      usuarioEmail: PERSONAS.admin.email, lote: "SIN-CATEGORIA",
      fechaCalibracion: new Date(), actividadCalibrada: 10, volumenInicial: 100,
    })
  );
});

test("vial de I-131 con categoria inválida es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, categoria: "otra" }))
  );
});

test("control positivo: admin SÍ puede crear un vial de I-131 categoría diagnóstico", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), vialBase({
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, categoria: "diagnostico", actividadCalibrada: 10, volumenInicial: 100,
  }));
  const snap = await getDoc(ref);
  assert.equal(snap.data().categoria, "diagnostico");
});

// Resultados de %Captación (Parte B): mismo gate estricto que Stock de
// viales (lectura y escritura, ver esTipoStockI131), vinculado por
// dosisActaId al registro diagnóstico original.
function resultadoCaptacionBase(overrides = {}) {
  return {
    tipo: "i131_captacion_resultado", fecha: serverTimestamp(), sedeId: SEDE_A,
    dosisActaId: "dosis-test", cuentasPaciente: 12500, fondo: 150,
    cuentasEstandar: 98000, volumenAdministrado: 1.2, porcentajeCaptacion: 13.29,
    ...overrides,
  };
}

test("técnico sin accesoTerapiaI131 NO puede crear un resultado de %Captación", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

test("resultado de %Captación sin dosisActaId es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId: "" }))
  );
});

test("resultado de %Captación con cuentasEstandar 0 es rechazado (denominador)", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, cuentasEstandar: 0 }))
  );
});

test("resultado de %Captación con volumenAdministrado 0 es rechazado (denominador)", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, volumenAdministrado: 0 }))
  );
});

test("control positivo: resultado de %Captación con cuentasPaciente/fondo en 0 es aceptado", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), resultadoCaptacionBase({
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, cuentasPaciente: 0, fondo: 0, porcentajeCaptacion: 0,
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("técnico sin accesoTerapiaI131 NO puede LEER un resultado de %Captación de su propia sede", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("control positivo: técnico CON accesoTerapiaI131 SÍ puede crear y leer un resultado de %Captación de su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.tecnicoA.email }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: false }, { merge: true });
});

// radioisotopos: mismo criterio que proveedores -- lectura para cualquiera
// con acceso, escritura sólo admin.
test("técnico NO puede escribir en radioisotopos", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => setDoc(doc(db, "radioisotopos", "test-iso"), { nombre: "Test" }));
});

test("control positivo: admin SÍ puede escribir en radioisotopos", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "radioisotopos", "test-iso"), { nombre: "Test" });
  const snap = await getDoc(doc(db, "radioisotopos", "test-iso"));
  assert.ok(snap.exists());
  await deleteDoc(doc(db, "radioisotopos", "test-iso"));
});

// estudios: mismo criterio -- lectura para cualquiera con acceso, escritura
// sólo admin. A diferencia de radioisotopos, el id no tiene significado
// especial (el acta guarda el nombre, no el id).
test("técnico NO puede escribir en estudios", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => setDoc(doc(db, "estudios", "test-estudio"), { nombre: "Test" }));
});

test("control positivo: admin SÍ puede escribir en estudios", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "estudios", "test-estudio"), { nombre: "Test" });
  const snap = await getDoc(doc(db, "estudios", "test-estudio"));
  assert.ok(snap.exists());
  await deleteDoc(doc(db, "estudios", "test-estudio"));
});
