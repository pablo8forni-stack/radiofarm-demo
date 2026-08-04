// Área C: las reglas nuevas rechazan lo que deben (probado con escrituras
// directas al SDK cliente, simulando a alguien saltándose la UI/consola del
// navegador -- exactamente el escenario que la regla tiene que cubrir, no la
// app). Incluye controles positivos para confirmar que la regla no es más
// restrictiva de lo debido.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import {
  PERSONAS, SEDE_A, SEDE_B, FARM_ID, db, loguearComo, prepararFixturesGlobales, loteDePrueba, fichaDePrueba, cerrarConexiones,
  crearLoteDirecto, borrarLote,
} from "./fixtures.mjs";
import { addActaI131Vial, addActaI131Extraccion } from "../../src/services/firestore/actas.js";

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
    usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: fichaDePrueba(), fichaIntentoNro: "1", isotopoId: "tc99m",
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

// Libro 4: Lutecio-177 ya no acepta lote de texto libre -- exige un lote
// registrado (mismo rigor que MIBG, ver mibgLoteBase/mibgActaBase más abajo
// para el flujo completo con id determinístico lote_${loteId}).
test("acta de paciente Lutecio-177 con médico responsable pero SIN loteDosisUnicaId es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, lote: "LU177-TEST",
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "4521", isotopoId: "lu177",
      medicoResponsable: "Dra. Test", pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
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

// N° de Ficha (Libro 2): secuencia correlativa asignada por VM RIS, propia
// de CADA SEDE -- corrección de alcance (esto NO es una secuencia global,
// ver nota larga en firestore.rules) -- ver helpers/fichaPaciente.js y
// firestore.rules#fichaUsadaValida/fichaIntentoHabilitado. fichaValida
// (formato, sólo dígitos) se aplica en las 5 ramas de actaValida() que
// tienen pacienteFicha -- se prueba acá con 'paciente' (tc99m) y con
// 'i131_barrido' (representativos; la función es compartida, no hace
// falta repetir en las 5).
function fichaUsadaId(sedeId, ficha, intentoNro) {
  return `${sedeId}_${ficha}_${intentoNro}`;
}
test("acta de paciente con N° de ficha no numérico es rechazada", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(),
      usuarioEmail: PERSONAS.tecnicoA.email, mciAdministrados: 10, pacienteFicha: "45B1", fichaIntentoNro: "1", isotopoId: "tc99m",
      pacienteNombre: "Test", pacienteDni: "1", estudio: "Test",
    })
  );
});

test("i131_barrido con N° de ficha no numérico es rechazado", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.tecnicoA.email, pacienteFicha: "45 21", fichaIntentoNro: "1",
      pacienteNombre: "Test", pacienteDni: "1",
    })
  );
});

test("i131_barrido con fichaIntentoNro fuera de 1..5 es rechazado", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.tecnicoA.email, pacienteFicha: fichaDePrueba(), fichaIntentoNro: "6",
      pacienteNombre: "Test", pacienteDni: "1",
    })
  );
});

// fichaIntentoHabilitado: mismo esquema de intento secuencial que
// mibg_${loteId}_${n} (ver nota larga en firestore.rules) -- bug real: un
// marcador único y fijo por número no dejaba ningún id libre para volver a
// guardar la acta después de anularla y corregirla. Acá se prueba con
// 'i131_barrido' (representativo del camino de alta simple/batch, no
// transaccional); MIBG/Lutecio-177 tienen su propia sección más abajo,
// donde el esquema corre DENTRO de una transacción ya existente.
function fichaUsadaDoc(ficha, intentoNro, overrides = {}) {
  return {
    pacienteFicha: ficha, pacienteFichaNum: parseInt(ficha, 10), fichaIntentoNro: intentoNro,
    pacienteNombre: "Paciente Ya Registrado", sedeId: SEDE_A,
    actaId: "test-acta-id", tipo: "paciente", fecha: serverTimestamp(),
    ...overrides,
  };
}
function anulacionFichaDoc(sedeId, ficha, intentoNro, overrides = {}) {
  return {
    tipo: "anulacion", anulaId: `ficha_${sedeId}_${ficha}_${intentoNro}`, sedeId,
    fecha: serverTimestamp(), motivo: "Test", usuarioNombre: "Admin", usuarioEmail: PERSONAS.admin.email,
    ...overrides,
  };
}

test("acta con N° de ficha que YA tiene el intento 1 ACTIVO es rechazada, aunque sea de otro tipo", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  await setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1"));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
      pacienteNombre: "Otro Paciente", pacienteDni: "2",
    })
  );
});

test("control positivo: acta con N° de ficha SIN marcador previo se acepta normalmente (intento 1)", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const ref = await addDoc(collection(db, "actas"), {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Nuevo", pacienteDni: "3",
  });
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

// Regresión del bug de ALCANCE (confirmado con el usuario real): dos sedes
// distintas usan el MISMO N° de Ficha para pacientes distintos, sin chocar
// -- antes de esta corrección esto se rechazaba (unicidad global), y era
// exactamente el comportamiento incorrecto. Prueba el fix real, no sólo la
// ausencia de un choque -- ambas actas tienen que quedar creadas.
test("control positivo: dos sedes distintas pueden usar el MISMO N° de Ficha sin chocar", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const refA = await addDoc(collection(db, "actas"), {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Central", pacienteDni: "1",
  });
  const refB = await addDoc(collection(db, "actas"), {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_B,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Italiano", pacienteDni: "2",
  });
  assert.ok((await getDoc(refA)).exists());
  assert.ok((await getDoc(refB)).exists());
});

// Regresión directa del bug reportado: anular la acta que usó el intento 1
// de una ficha (misma anulación genérica de siempre, actas/anula_ficha_...)
// tiene que liberar el intento 2 para esa MISMA ficha -- sin esto, el
// marcador único y fijo de la tanda anterior dejaba a la técnica sin poder
// volver a guardar tras corregir un error de DNI.
test("control positivo: anular la acta libera el intento 2 de la misma ficha", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const actaRef1 = doc(collection(db, "actas"));
  await setDoc(actaRef1, {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Uno", pacienteDni: "1",
  });
  await setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1", { pacienteNombre: "Paciente Uno", actaId: actaRef1.id, tipo: "i131_barrido" }));
  // anularActaTransaction real (services/firestore/actas.js) anula la
  // acta Y, en la misma transacción, el intento de ficha -- acá se simulan
  // los dos writes por separado, mismo resultado final.
  await setDoc(doc(db, "actas", `anula_${actaRef1.id}`), { tipo: "anulacion", anulaId: actaRef1.id, sedeId: SEDE_A, fecha: serverTimestamp(), motivo: "Error de DNI", usuarioNombre: "Admin", usuarioEmail: PERSONAS.admin.email });
  await setDoc(doc(db, "actas", `anula_ficha_${SEDE_A}_${ficha}_1`), anulacionFichaDoc(SEDE_A, ficha, "1"));

  const ref2 = await addDoc(collection(db, "actas"), {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "2",
    pacienteNombre: "Paciente Uno (DNI corregido)", pacienteDni: "10",
  });
  const snap2 = await getDoc(ref2);
  assert.ok(snap2.exists());
});

test("un intento 2 de ficha con el intento 1 activo (no anulado) es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  await setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1"));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
      usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "2",
      pacienteNombre: "Otro Paciente", pacienteDni: "2",
    })
  );
});

// NO hay test automatizado para "marcador fichasUsadas de antes de esta
// corrección (bare `{numero}` de la primera versión, o `{numero}_{intento}`
// sin sede de la segunda) sigue bloqueando" -- porque, a propósito, YA NO
// bloquea nada (ver nota larga en firestore.rules: honrarlos perpetuaría la
// unicidad global que se está corrigiendo). Mismo gap de siempre para
// simular un doc de una tanda anterior por SDK (fichaUsadaValida ya exige
// el formato de id vigente para CUALQUIER escritura nueva) -- sólo que acá
// el resultado esperado cambió: antes bloqueaban (verificado a mano),
// ahora no deberían bloquear nada (no hay forma de probarlo automatizado
// sin datos reales de antes de este fix, tampoco).

// Colección fichasUsadas -- marcador create-only, mismo patrón que
// generadoresVistos. La LECTURA sigue siendo GLOBAL (sin scoping por sede,
// ver nota en firestore.rules) -- eso no cambió con la corrección de
// alcance; lo que pasó a ser por sede es la UNICIDAD (la clave del id), no
// quién puede leer un marcador puntual.
test("control positivo: técnico SÍ puede crear un marcador fichasUsadas válido en su sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const ficha = fichaDePrueba();
  const ref = doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1"));
  await setDoc(ref, fichaUsadaDoc(ficha, "1", { usuarioEmail: PERSONAS.tecnicoA.email }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("fichasUsadas con id que no coincide con sedeId_pacienteFicha_fichaIntentoNro es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  await assertPermissionDenied(() =>
    setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1") + "X"), fichaUsadaDoc(ficha, "1"))
  );
});

test("fichasUsadas con pacienteFicha no numérico es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, "45B1", "1")), fichaUsadaDoc("45B1", "1"))
  );
});

test("fichasUsadas con fichaIntentoNro fuera de 1..5 es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  await assertPermissionDenied(() =>
    setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "6")), fichaUsadaDoc(ficha, "6"))
  );
});

test("fichasUsadas sin pacienteFichaNum es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const { pacienteFichaNum: _n, ...sinNum } = fichaUsadaDoc(ficha, "1");
  await assertPermissionDenied(() => setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), sinNum));
});

test("técnico NO puede crear un marcador fichasUsadas de OTRA sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const ficha = fichaDePrueba();
  await assertPermissionDenied(() =>
    setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_B, ficha, "1")), fichaUsadaDoc(ficha, "1", { sedeId: SEDE_B, usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

test("fichasUsadas no admite update ni delete (create-only)", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const ref = doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1"));
  await setDoc(ref, fichaUsadaDoc(ficha, "1"));
  await assertPermissionDenied(() => updateDoc(ref, { pacienteNombre: "Otro" }));
  await assertPermissionDenied(() => deleteDoc(ref));
});

test("control positivo: técnico de OTRA sede puede LEER un marcador fichasUsadas (lectura global -- la UNICIDAD es por sede, la lectura no)", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  await setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1", { sedeId: SEDE_A }));

  await loguearComo(PERSONAS.tecnicoB); // sede italiano == SEDE_B
  const snap = await getDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")));
  assert.ok(snap.exists(), "la lectura sigue siendo global -- cualquier sede tiene que poder ver el detalle de un marcador de otra, aunque ya no compitan por el mismo número");
});

// Integración de punta a punta del mecanismo real (crearActaConFicha en
// services/firestore/actas.js): acta + marcador en el MISMO batch. Un
// segundo batch con el mismo intento de ficha tiene que fallar ENTERO -- ni
// la acta ni el marcador quedan creados (atómico).
test("control positivo: batch acta+marcador de ficha (mecanismo real) se acepta, y un segundo batch con el mismo intento se rechaza entero", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();

  const batch1 = writeBatch(db);
  const actaRef1 = doc(collection(db, "actas"));
  batch1.set(actaRef1, {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Uno", pacienteDni: "1",
  });
  batch1.set(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1", { pacienteNombre: "Paciente Uno", actaId: actaRef1.id, tipo: "i131_barrido" }));
  await batch1.commit();
  assert.ok((await getDoc(actaRef1)).exists());
  assert.ok((await getDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")))).exists());

  const batch2 = writeBatch(db);
  const actaRef2 = doc(collection(db, "actas"));
  batch2.set(actaRef2, {
    tipo: "i131_barrido", fecha: serverTimestamp(), sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Dos", pacienteDni: "2",
  });
  batch2.set(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1", { pacienteNombre: "Paciente Dos", actaId: actaRef2.id, tipo: "i131_barrido" }));
  await assertPermissionDenied(() => batch2.commit());

  // Ni la segunda acta ni ningún cambio al marcador quedaron -- atómico.
  assert.equal((await getDoc(actaRef2)).exists(), false);
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")));
  assert.equal(fichaSnap.data().pacienteNombre, "Paciente Uno", "el marcador original no debería haber cambiado");
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
  await setDoc(doc(db, "actas", `anula_${actaRef.id}`), {
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

// Auditoría de seguridad, hallazgo #4b: antes la regla validaba anulaId
// (contenido) pero nunca el id DEL DOCUMENTO en sí -- vía SDK directo
// (addDoc, id al azar) se podía crear una anulación con forma válida que
// exists('anula_' + id) de las otras reglas nunca iba a encontrar.
test("anulación de acta con id que no es anula_${anulaId} es rechazada (bypass del id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const actaRef = await addDoc(collection(db, "actas"), actaBase({ sedeId: SEDE_A, usuarioEmail: PERSONAS.admin.email }));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), {
      tipo: "anulacion", fecha: serverTimestamp(), sedeId: SEDE_A,
      anulaId: actaRef.id, motivo: "Test", usuarioEmail: PERSONAS.admin.email,
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

// Auditoría de seguridad, hallazgo #6a: el toggle "Elución habilitada" de
// Configuración > Sedes activas sólo se chequeaba en la UI (puedeAbrirForm
// en TabElucion.jsx) -- una sede con eluye=false (recibe por delivery, no
// eluye su propio generador) podía igual crear actas de elución vía SDK
// directo. SEDE_B tiene eluye=false en los fixtures (sólo Central eluye,
// igual que en producción).
test("elución en una sede que no eluye (eluye=false) es rechazada, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), elucionBase({
      sedeId: SEDE_B, actividadCalibrada: 1850, usuarioEmail: PERSONAS.admin.email,
    }))
  );
});

test("control positivo: elución de un lote YA visto no necesita actividadCalibrada", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = `GEN-${loteDePrueba()}`;
  await setDoc(doc(db, "generadoresVistos", `${SEDE_A}_${lote.toUpperCase()}`), {
    sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email, actividadCalibrada: 1850,
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
    sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email, actividadCalibrada: 1850,
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

// Auditoría de seguridad, hallazgo #5 (mitigación, no cierre total -- ver
// nota larga en firestore.rules#generadorValido): antes el marcador sólo
// exigía sede propia, así que se podía pre-crear vía SDK directo y saltear
// la actividadCalibrada obligatoria de la primera elución real de ese
// generador. Ahora el marcador exige su PROPIA actividadCalibrada > 0
// (denormalizada, ver addActaElucion) y que el id tenga el formato exacto
// sedeId_LOTE -- sube el costo de fabricar uno falso, no lo hace imposible.
test("marcador generadoresVistos sin actividadCalibrada es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = `GEN-${loteDePrueba()}`;
  await assertPermissionDenied(() =>
    setDoc(doc(db, "generadoresVistos", `${SEDE_A}_${lote.toUpperCase()}`), {
      sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email,
    })
  );
});

test("marcador generadoresVistos con id que no matchea sedeId_LOTE es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = `GEN-${loteDePrueba()}`;
  await assertPermissionDenied(() =>
    setDoc(doc(db, "generadoresVistos", `${SEDE_A}_no-matchea`), {
      sedeId: SEDE_A, loteGenerador: lote, usuarioEmail: PERSONAS.admin.email, actividadCalibrada: 1850,
    })
  );
});

// Gestión I-131: 6 tipos planos, no un campo "subtipo" -- ver nota larga en
// firestore.rules#actaValida. Ablativa/Dosis (mCi) y los 3 diagnósticos (µCi)
// exigen tieneAccesoI131() (admin o técnico con el flag accesoTerapiaI131);
// Barrido corporal no, cualquier técnico de la sede puede cargarlo. Médico
// responsable ya NO es requisito de ninguno de los 6 (se sacó del formulario).
// pacienteFicha/fichaIntentoNro con default DINÁMICO (fichaDePrueba(), no
// un valor fijo): cada llamada usa un número propio, así los controles
// positivos de este bloque (que sí llegan a crear el marcador fichasUsadas)
// no chocan entre sí ni entre corridas -- ver fichaDePrueba en fixtures.mjs.
function i131Base(tipo, overrides = {}) {
  return {
    tipo, fecha: serverTimestamp(), sedeId: SEDE_A,
    pacienteFicha: fichaDePrueba(), fichaIntentoNro: "1", pacienteNombre: "Test I131", pacienteDni: "2",
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

// Regresión: addActaI131Vial/addActaI131Extraccion pasaban antes por
// crearActaConFicha (misma función que los 6 tipos de registro de paciente),
// que siempre intentaba escribir un marcador en fichasUsadas usando
// data.pacienteFicha/fichaIntentoNro -- campos que un vial/extracción nunca
// tienen. El SDK cliente rechaza cualquier set() con un campo undefined
// antes de llegar al servidor, así que esto nunca lo hubiera atrapado un
// test contra addDoc crudo (como el resto de este archivo): hace falta
// llamar la función real de src/ para reproducirlo.
test("addActaI131Vial (servicio real) no falla por pacienteFicha undefined", async () => {
  await loguearComo(PERSONAS.admin);
  await addActaI131Vial(vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "REGRESION-VIAL" }));
});

test("addActaI131Extraccion (servicio real) no falla por pacienteFicha undefined", async () => {
  await loguearComo(PERSONAS.admin);
  const v = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "REGRESION-EXT" }));
  await addActaI131Extraccion(extraccionBase(v.id, { sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email }));
});

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

// Un vial anulado no puede recibir extracciones nuevas (vialesI131NoAnulados)
// -- ver nota larga en firestore.rules. anularActaTransaction crea el
// marcador con id determinístico anula_${vialId}, mismo mecanismo que el
// resto de las actas.
test("extracción de I-131 sobre un vial anulado es rechazada, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  const v = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "ANULADO-1" }));
  await setDoc(doc(db, "actas", `anula_${v.id}`), {
    tipo: "anulacion", anulaId: v.id, sedeId: SEDE_B, fecha: serverTimestamp(),
    motivo: "Test", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin",
  });
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), extraccionBase(v.id, { sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email }))
  );
});

test("extracción de I-131 combinando dos viales donde UNO está anulado es rechazada", async () => {
  await loguearComo(PERSONAS.admin);
  const v1 = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "OK-1" }));
  const v2 = await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: "ANULADO-2" }));
  await setDoc(doc(db, "actas", `anula_${v2.id}`), {
    tipo: "anulacion", anulaId: v2.id, sedeId: SEDE_B, fecha: serverTimestamp(),
    motivo: "Test", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin",
  });
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), extraccionBase(v1.id, {
      sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email,
      viales: [{ vialId: v1.id, mlExtraidos: 1 }, { vialId: v2.id, mlExtraidos: 0.5 }],
      vialIds: [v1.id, v2.id],
    }))
  );
});

test("extracción de I-131 con más de 4 viales combinados es rechazada (tope fijo)", async () => {
  await loguearComo(PERSONAS.admin);
  const viales = [];
  for (let i = 0; i < 5; i++) {
    viales.push(await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: `TOPE-${i}` })));
  }
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), extraccionBase(viales[0].id, {
      sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email,
      viales: viales.map((v) => ({ vialId: v.id, mlExtraidos: 0.5 })),
      vialIds: viales.map((v) => v.id),
    }))
  );
});

test("control positivo: extracción de I-131 combinando 4 viales (el tope) es aceptada", async () => {
  await loguearComo(PERSONAS.admin);
  const viales = [];
  for (let i = 0; i < 4; i++) {
    viales.push(await addDoc(collection(db, "actas"), vialBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, lote: `CUATRO-${i}` })));
  }
  const ref = await addDoc(collection(db, "actas"), extraccionBase(viales[0].id, {
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email,
    viales: viales.map((v) => ({ vialId: v.id, mlExtraidos: 0.5 })),
    vialIds: viales.map((v) => v.id),
  }));
  const snap = await getDoc(ref);
  assert.equal(snap.data().viales.length, 4);
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
    dosisActaId: "dosis-test", momento: "hora",
    pacienteDni: "30111222", pacienteNombre: "Paciente Test",
    cuentasPaciente: 12500, fondo: 150,
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
  const dosisActaId = `dosis-ceros-${Date.now()}`;
  const ref = doc(db, "actas", `captacion_${dosisActaId}_hora`);
  await setDoc(ref, resultadoCaptacionBase({
    sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, dosisActaId, cuentasPaciente: 0, fondo: 0, porcentajeCaptacion: 0,
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("técnico sin accesoTerapiaI131 NO puede LEER un resultado de %Captación de su propia sede", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-lectura-${Date.now()}`;
  const ref = doc(db, "actas", `captacion_${dosisActaId}_hora`);
  await setDoc(ref, resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("control positivo: técnico CON accesoTerapiaI131 SÍ puede crear y leer un resultado de %Captación de su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const dosisActaId = `dosis-crear-leer-${Date.now()}`;
  const ref = doc(db, "actas", `captacion_${dosisActaId}_hora`);
  await setDoc(ref, resultadoCaptacionBase({ usuarioEmail: PERSONAS.tecnicoA.email, dosisActaId }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoTerapiaI131: false }, { merge: true });
});

test("resultado de %Captación con momento inválido es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, momento: "72h" }))
  );
});

test("resultado de %Captación sin pacienteDni es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, pacienteDni: "" }))
  );
});

// Control de secuencia (Parte C): el id determinístico
// captacion_${dosisActaId}_${momento} + allow update: false es lo que
// bloquea un segundo intento del mismo momento -- no hay validación de
// "ya existe" en la regla, es la colisión de id la que lo rechaza.
test("cargar el mismo momento dos veces para la misma dosis es rechazado (id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-dedup-${Date.now()}`;
  const ref = doc(db, "actas", `captacion_${dosisActaId}_hora`);
  await setDoc(ref, resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }));
  await assertPermissionDenied(() =>
    setDoc(ref, resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }))
  );
});

test("control positivo: los 3 momentos (hora/24h/48h) de una misma dosis se pueden cargar sin chocar entre sí", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-secuencia-${Date.now()}`;
  for (const momento of ["hora", "24h", "48h"]) {
    const ref = doc(db, "actas", `captacion_${dosisActaId}_${momento}`);
    await setDoc(ref, resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId, momento }));
    const snap = await getDoc(ref);
    assert.ok(snap.exists());
  }
});

// Auditoría de seguridad, hallazgo #4a: la regla validaba dosisActaId/
// momento (contenido) pero nunca el id DEL DOCUMENTO -- vía SDK directo
// (addDoc, id al azar) se podía crear un resultado con forma válida que
// esquivaba la protección real de "un momento por dosis" (choque de id).
test("resultado de %Captación con id que no es captacion_${dosisActaId}_${momento} es rechazado (bypass del id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-bypass-${Date.now()}`;
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }))
  );
});

// "Finalizar seguimiento" (Parte C): evento nuevo e inmutable vinculado por
// dosisActaId, nunca una edición del resultado 48h -- ver nota en
// addActaI131SeguimientoFin (services/firestore/actas.js).
function seguimientoFinBase(overrides = {}) {
  return {
    tipo: "i131_seguimiento_fin", fecha: serverTimestamp(), sedeId: SEDE_A,
    dosisActaId: "dosis-fin-test", pacienteDni: "30111222", pacienteNombre: "Paciente Test",
    ...overrides,
  };
}

test("técnico sin accesoTerapiaI131 NO puede crear un i131_seguimiento_fin", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), seguimientoFinBase({ usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

test("i131_seguimiento_fin sin dosisActaId es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId: "" }))
  );
});

test("i131_seguimiento_fin sin pacienteNombre es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, pacienteNombre: "" }))
  );
});

test("control positivo: admin SÍ puede finalizar el seguimiento de una dosis (id determinístico fin_${dosisActaId})", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-fin-ok-${Date.now()}`;
  const ref = doc(db, "actas", `fin_${dosisActaId}`);
  await setDoc(ref, seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

// Mismo patrón de una línea que #4a/#1, agregado al cierre de la tanda: sin
// esto, un cierre con id al azar se ve "finalizado" en pantalla (la acta
// existe con forma válida) pero exists('fin_' + dosisActaId) de la regla
// nunca lo ve, dejando pasar resultados de %Captación después del cierre.
test("i131_seguimiento_fin con id que no es fin_${dosisActaId} es rechazado (bypass del id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-fin-bypass-${Date.now()}`;
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }))
  );
});

test("finalizar el seguimiento dos veces para la misma dosis es rechazado (id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-fin-dup-${Date.now()}`;
  const ref = doc(db, "actas", `fin_${dosisActaId}`);
  await setDoc(ref, seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }));
  await assertPermissionDenied(() =>
    setDoc(ref, seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }))
  );
});

test("una vez finalizado el seguimiento de una dosis, no se puede cargar un nuevo resultado de %Captación para esa dosis", async () => {
  await loguearComo(PERSONAS.admin);
  const dosisActaId = `dosis-bloqueada-${Date.now()}`;
  await setDoc(doc(db, "actas", `fin_${dosisActaId}`), seguimientoFinBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId }));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), resultadoCaptacionBase({ usuarioEmail: PERSONAS.admin.email, dosisActaId, momento: "48h" }))
  );
});

// Agenda de turnos (Parte C): a diferencia de TODO lo demás en el sistema,
// turnos es una colección mutable de verdad -- create/update/delete
// habilitados, no create-only. Gate por accesoAgendaI131, permiso SEPARADO
// de accesoTerapiaI131 (ver firestore.rules#turnoValido).
function turnoBase(overrides = {}) {
  return {
    sedeId: SEDE_A, fechaTurno: "2026-08-03", pacienteNombre: "Test Turno", pacienteDni: "1",
    tipoDosis: "i131_dosis", estado: "confirmado",
    ...overrides,
  };
}

test("técnico sin accesoAgendaI131 NO puede crear un turno", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => addDoc(collection(db, "turnos"), turnoBase()));
});

test("turno con tipoDosis inválido es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() => addDoc(collection(db, "turnos"), turnoBase({ sedeId: SEDE_B, tipoDosis: "otra" })));
});

test("turno con estado inválido es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() => addDoc(collection(db, "turnos"), turnoBase({ sedeId: SEDE_B, estado: "otro" })));
});

test("control positivo: admin SÍ puede crear un turno sin el flag", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "turnos"), turnoBase({ sedeId: SEDE_B }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("control positivo: técnico CON accesoAgendaI131 (pero SIN accesoTerapiaI131) SÍ puede crear y leer un turno de su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true, accesoTerapiaI131: false }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "turnos"), turnoBase());
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("técnico sin accesoAgendaI131 NO puede LEER un turno de su propia sede", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "turnos"), turnoBase());

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("técnico CON accesoAgendaI131 NO puede editar un turno de otra sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });
  const ref = await addDoc(collection(db, "turnos"), turnoBase({ sedeId: SEDE_B }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => updateDoc(ref, { estado: "cancelado" }));

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("control positivo: técnico CON accesoAgendaI131 SÍ puede editar (reprogramar) un turno de su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "turnos"), turnoBase());
  await updateDoc(ref, { estado: "reprogramado", fechaTurno: "2026-08-10" });
  const snap = await getDoc(ref);
  assert.equal(snap.data().estado, "reprogramado");

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("técnico CON accesoAgendaI131 NO puede eliminar un turno de otra sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });
  const ref = await addDoc(collection(db, "turnos"), turnoBase({ sedeId: SEDE_B }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => deleteDoc(ref));

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("control positivo: técnico CON accesoAgendaI131 SÍ puede eliminar un turno de su sede (no es create-only)", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "turnos"), turnoBase());
  await deleteDoc(ref); // no debe tirar -- si tirara, el test fallaría acá mismo

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

// Simulación "Pedido semanal" (Agenda, Parte C) -- PROYECCIÓN de material
// que todavía no llegó, un solo doc por sede+semana con id determinístico
// sedeId_semana (no addDoc), mutable como turnos. Mismo gate/scoping que
// turnos (accesoAgendaI131), pero campos todos opcionales salvo sedeId/
// semana -- el pedido se completa de a poco durante la semana.
function pedidoSemanalRef(sedeId, semana) {
  return doc(db, "pedidosSemanales", `${sedeId}_${semana}`);
}
function pedidoSemanalBase(overrides = {}) {
  return { sedeId: SEDE_A, semana: "2026-08-03", ...overrides };
}

test("técnico sin accesoAgendaI131 NO puede crear un pedidoSemanal", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(pedidoSemanalRef(SEDE_A, "2026-08-03"), pedidoSemanalBase())
  );
});

test("pedidoSemanal sin semana es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    setDoc(pedidoSemanalRef(SEDE_B, "2026-08-03"), pedidoSemanalBase({ sedeId: SEDE_B, semana: "" }))
  );
});

test("pedidoSemanal con actividadEsperadaMartes no numérica es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    setDoc(pedidoSemanalRef(SEDE_B, "2026-08-03"), pedidoSemanalBase({ sedeId: SEDE_B, actividadEsperadaMartes: "500" }))
  );
});

test("pedidoSemanal con fechaHoraLlegadaJueves que no es timestamp es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    setDoc(pedidoSemanalRef(SEDE_B, "2026-08-03"), pedidoSemanalBase({ sedeId: SEDE_B, fechaHoraLlegadaJueves: "2026-08-06T10:00" }))
  );
});

test("control positivo: admin SÍ puede crear un pedidoSemanal con sólo sedeId+semana (resto opcional)", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = pedidoSemanalRef(SEDE_B, "2026-08-03");
  await setDoc(ref, pedidoSemanalBase({ sedeId: SEDE_B }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

// Auditoría de seguridad, hallazgo #3: resource.data.sedeId sobre un
// resource inexistente (semana sin pedido cargado todavía) daba
// permission-denied en vez de "no existe" para un técnico -- sólo se había
// probado como admin, porque isAdmin() cortocircuita antes de evaluar esa
// cláusula.
test("control positivo: técnico CON accesoAgendaI131 SÍ puede LEER (como 'no existe') un pedidoSemanal de una semana sin cargar en su sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = pedidoSemanalRef(SEDE_A, "2026-09-14"); // semana sin doc cargado
  const snap = await getDoc(ref);
  assert.equal(snap.exists(), false);

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("técnico sin accesoAgendaI131 NO puede LEER un pedidoSemanal de su propia sede", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = pedidoSemanalRef(SEDE_A, "2026-08-03");
  await setDoc(ref, pedidoSemanalBase());

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("técnico CON accesoAgendaI131 NO puede editar un pedidoSemanal de otra sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });
  const ref = pedidoSemanalRef(SEDE_B, "2026-08-03");
  await setDoc(ref, pedidoSemanalBase({ sedeId: SEDE_B }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => setDoc(ref, { actividadEsperadaMartes: 300 }, { merge: true }));

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("control positivo: técnico CON accesoAgendaI131 SÍ puede crear y luego corregir el pedidoSemanal de su sede (mutable, no create-only)", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });

  await loguearComo(PERSONAS.tecnicoA);
  const ref = pedidoSemanalRef(SEDE_A, "2026-08-03");
  await setDoc(ref, pedidoSemanalBase({ actividadEsperadaMartes: 400, fechaHoraLlegadaMartes: new Date() }), { merge: true });
  await setDoc(ref, { actividadEsperadaMartes: 350 }, { merge: true }); // corrige el número a medida que se conoce mejor la demanda
  const snap = await getDoc(ref);
  assert.equal(snap.data().actividadEsperadaMartes, 350);

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

test("técnico CON accesoAgendaI131 NO puede eliminar un pedidoSemanal de otra sede", async () => {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: true }, { merge: true });
  const ref = pedidoSemanalRef(SEDE_B, "2026-08-10");
  await setDoc(ref, pedidoSemanalBase({ sedeId: SEDE_B, semana: "2026-08-10" }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => deleteDoc(ref));

  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "roles", PERSONAS.tecnicoA.email), { accesoAgendaI131: false }, { merge: true });
});

// Lote de dosis única -- MIBG (131I-MIBG, neuroblastoma/feocromocitoma/
// paraganglioma) y Lutecio-177 (Libro 4, Teragnosis) comparten la misma
// colección mibg_lote (nombre histórico) y el mismo modelo, distinguidos por
// isotopoId. Abierto a CUALQUIER técnico con rol válido en su sede, SIN
// tieneAccesoI131() -- mismo criterio que Barrido corporal. mibg_lote es
// create-only (sin update/delete); la administración a un paciente usa un id
// determinístico -- mibg_${loteId}_${intentoNro} (tipo i131_mibg) para MIBG,
// lote_${loteId}_${intentoNro} (tipo paciente) para Lutecio-177, intentoNro
// acotado a 1..5, progresión estrictamente secuencial: crear el intento N
// (N>1) exige que el intento N-1 exista Y esté anulado (ver
// intentoHabilitado en firestore.rules) -- así sólo el intento activo más
// alto puede estar sin anular en cualquier momento, sin tocar el lote.
function mibgLoteBase(overrides = {}) {
  return {
    sedeId: SEDE_A, numeroLote: loteDePrueba(), proveedor: "IPEN",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-01-01", isotopoId: "mibg", conformidad: true, observacion: "",
    ...overrides,
  };
}

test("control positivo: técnico SIN accesoTerapiaI131 SÍ puede crear un lote de MIBG en su sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const ref = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("técnico NO puede crear un lote de MIBG en otra sede", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }))
  );
});

test("lote de MIBG sin numeroLote es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", numeroLote: "" }))
  );
});

test("lote de MIBG con actividadCalibrada 0 es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", actividadCalibrada: 0 }))
  );
});

test("lote de MIBG con fechaHoraCalibracion que no es timestamp es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", fechaHoraCalibracion: "2026-08-06T10:00" }))
  );
});

test("lote sin isotopoId es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  // undefined no es un valor válido para el SDK de Firestore (tira excepción
  // propia, no permission-denied) -- hay que OMITIR la clave, no pasarla en
  // undefined.
  const { isotopoId: _isotopoId, ...sinIsotopoId } = mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" });
  await assertPermissionDenied(() => addDoc(collection(db, "mibg_lote"), sinIsotopoId));
});

test("lote con isotopoId inválido es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", isotopoId: "otro" }))
  );
});

test("control positivo: lote con isotopoId 'lutecio177' es aceptado", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", isotopoId: "lutecio177" }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("lote 'No conforme' sin observación es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", conformidad: false, observacion: "" }))
  );
});

test("control positivo: lote 'No conforme' CON observación es aceptado", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({
    usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin", conformidad: false, observacion: "Vino con actividad menor a la pedida",
  }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("lote sin conformidad (ni sí ni no) es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const { conformidad: _conformidad, ...sinConformidad } = mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" });
  await assertPermissionDenied(() => addDoc(collection(db, "mibg_lote"), sinConformidad));
});

test("técnico NO puede LEER un lote de MIBG de otra sede", async () => {
  await loguearComo(PERSONAS.admin);
  const ref = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  await assertPermissionDenied(() => getDoc(ref));
});

test("mibg_lote no admite update ni delete (create-only)", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ref = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  await assertPermissionDenied(() => updateDoc(ref, { actividadCalibrada: 999 }));
  await assertPermissionDenied(() => deleteDoc(ref));
});

// pacienteFicha/fichaIntentoNro con default DINÁMICO -- mismo motivo que
// i131Base más arriba (evitar choques entre controles positivos).
function mibgActaBase(loteId, overrides = {}) {
  return {
    tipo: "i131_mibg", fecha: serverTimestamp(), sedeId: SEDE_A,
    pacienteFicha: fichaDePrueba(), fichaIntentoNro: "1", pacienteNombre: "Paciente MIBG", pacienteDni: "1",
    mibgLoteId: loteId,
    // actividadCalibrada: referencia denormalizada del lote (lo que llegó).
    // actividadAdministrada: lo que el técnico tipeó como realmente
    // inyectado -- corrección de diseño, antes se copiaba uno como si fuera
    // el otro.
    actividadCalibrada: 150, actividadAdministrada: 90,
    // intentoNro: número de intento acotado 1..5 -- ver comentario arriba y
    // intentoHabilitado en firestore.rules. Default "1" (primer intento);
    // los tests que reproducen el bug de re-administración lo pisan a "2".
    intentoNro: "1",
    ...overrides,
  };
}

test("control positivo: técnico SIN accesoTerapiaI131 SÍ puede administrar MIBG (crear i131_mibg)", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  const ref = doc(db, "actas", `mibg_${lote.id}_1`);
  await setDoc(ref, mibgActaBase(lote.id, { usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());

  // Y cualquier técnico de la sede puede LEERLA de vuelta, sin accesoTerapiaI131.
  const releido = await getDoc(ref);
  assert.ok(releido.exists());
});

// Corrección de diseño posterior a la auditoría v4: antes se copiaba
// actividadCalibrada (lo que llegó) como si fuera lo administrado. Ahora son
// dos campos, los dos obligatorios.
test("i131_mibg sin actividadAdministrada es rechazado, aunque tenga actividadCalibrada", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const { actividadAdministrada: _actividadAdministrada, ...sinActividadAdministrada } = mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" });
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${lote.id}_1`), sinActividadAdministrada)
  );
});

// Auditoría de seguridad, hallazgo #1: la regla validaba que el lote
// existiera/no estuviera anulado/fuera de la sede correcta, pero NUNCA que
// el id del ACTA fuera mibg_${mibgLoteId}_${intentoNro} -- toda la garantía
// anti-doble-administración descansa en ese id (allow update: false), pero
// antes de este fix sólo el cliente lo construía. Vía SDK directo (addDoc,
// id al azar) se podían crear N actas apuntando al mismo lote.
test("i131_mibg con id que no es mibg_${mibgLoteId}_${intentoNro} es rechazado (bypass del id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("i131_mibg sin mibgLoteId es rechazado, aunque sea admin", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase("", { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("i131_mibg con mibgLoteId de un lote inexistente es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", "mibg_no-existe_1"), mibgActaBase("no-existe", { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("i131_mibg con mibgLoteId de un lote de OTRA sede es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const loteDeB = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  // sedeId de la acta declarado como SEDE_A, pero el lote es de SEDE_B.
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${loteDeB.id}_1`), mibgActaBase(loteDeB.id, { sedeId: SEDE_A, usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("un lote de MIBG ya usado no se puede volver a administrar en el mismo intentoNro (choca con allow update:false)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const ref = doc(db, "actas", `mibg_${lote.id}_1`);
  await setDoc(ref, mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(ref, mibgActaBase(lote.id, { pacienteNombre: "Otro Paciente", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

// Bug real reportado en producción: con administrarLoteDosisUnicaTransaction
// buscando siempre intentoNro "1" fijo, anular la administración de un lote
// y volver a administrarlo chocaba contra ese mismo id ocupado para siempre
// (allow update:false). La regla debe rechazar un SEGUNDO intento mientras
// el primero sigue ACTIVO (sin anular) -- éste es ese caso.
test("un lote de MIBG con intentoNro 1 activo (no anulado) rechaza un intentoNro 2 (intentoHabilitado)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${lote.id}_2`), mibgActaBase(lote.id, { intentoNro: "2", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

// Regresión directa del bug reportado: anular el intento 1 debe liberar un
// intentoNro 2 legítimo para el MISMO lote, sin chocar contra intentoHabilitado.
test("control positivo: anular el intentoNro 1 de MIBG permite administrar un intentoNro 2 del mismo lote", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_mibg_${lote.id}_1`), anulacionDoc(`mibg_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const ref2 = doc(db, "actas", `mibg_${lote.id}_2`);
  await setDoc(ref2, mibgActaBase(lote.id, { intentoNro: "2", pacienteNombre: "Paciente MIBG (corregido)", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const snap = await getDoc(ref2);
  assert.ok(snap.exists());
});

// Caso COMBINADO -- el más caro en llamadas de esta rama: lote en
// intentoNro=2 (corrigiendo el 1) Y ficha en fichaIntentoNro=2 (mismo
// número de ficha reutilizado tras anular) A LA VEZ. Es la rama con más
// chequeos de intento apilados de todo el sistema (lote + ficha, además de
// mibg_lote/tieneAcceso/isAdmin) -- verificado empíricamente contra
// staging antes de esta tanda que no dispara el tope de document-access
// calls (ver esquema-intentos-lote-dosis-unica.md).
test("control positivo: lote en intentoNro=2 Y ficha en fichaIntentoNro=2 a la vez (caso combinado más caro)", async () => {
  await loguearComo(PERSONAS.admin);
  const ficha = fichaDePrueba();
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { pacienteFicha: ficha, fichaIntentoNro: "1", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "fichasUsadas", fichaUsadaId(SEDE_A, ficha, "1")), fichaUsadaDoc(ficha, "1", { pacienteNombre: "Paciente MIBG", actaId: `mibg_${lote.id}_1`, tipo: "i131_mibg" }));

  await setDoc(doc(db, "actas", `anula_mibg_${lote.id}_1`), anulacionDoc(`mibg_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));
  await setDoc(doc(db, "actas", `anula_ficha_${SEDE_A}_${ficha}_1`), anulacionFichaDoc(SEDE_A, ficha, "1"));

  const ref2 = doc(db, "actas", `mibg_${lote.id}_2`);
  await setDoc(ref2, mibgActaBase(lote.id, {
    intentoNro: "2", pacienteFicha: ficha, fichaIntentoNro: "2",
    pacienteNombre: "Paciente MIBG (corregido)", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin",
  }));
  const snap = await getDoc(ref2);
  assert.ok(snap.exists());
});

test("i131_mibg con intentoNro fuera de 1..5 es rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${lote.id}_6`), mibgActaBase(lote.id, { intentoNro: "6", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("un lote de MIBG anulado no se puede administrar", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  // Anulación del lote -- mismo mecanismo anula_${id} que el resto del sistema,
  // admin-only (ver rama 'anulacion' de actaValida()).
  await setDoc(doc(db, "actas", `anula_${lote.id}`), {
    tipo: "anulacion", anulaId: lote.id, sedeId: SEDE_A, fecha: serverTimestamp(),
    motivo: "Test: lote mal cargado", usuarioNombre: "Admin", usuarioEmail: PERSONAS.admin.email,
  });
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("técnico sin rol NO puede anular un lote de MIBG (admin-only, mismo patrón que todo el sistema)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `anula_${lote.id}`), {
      tipo: "anulacion", anulaId: lote.id, sedeId: SEDE_A, fecha: serverTimestamp(),
      motivo: "Intento sin ser admin", usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email,
    })
  );
});

// Corrección de diseño posterior a la auditoría v4: anular la administración
// a un paciente y anular el LOTE pasan a ser acciones INDEPENDIENTES (antes
// de esta corrección, una cascada obligatoria las ataba) -- el lote es la
// llegada del vial (fecha, actividad de llegada), la acta es la dosis
// realmente inyectada, dos hechos distintos. Ninguna de las dos anulaciones
// depende de la otra, en ningún orden.
function anulacionDoc(id, sedeId, motivo) {
  return { tipo: "anulacion", anulaId: id, sedeId, fecha: serverTimestamp(), motivo, usuarioNombre: "Admin", usuarioEmail: PERSONAS.admin.email };
}

// Hueco real encontrado en producción: anular un lote con una administración
// ACTIVA dejaba al paciente apuntando a un lote inválido, sin ningún aviso.
// Ahora se bloquea server-side (ver loteTieneAdministracionActiva en
// firestore.rules) -- primero hay que anular la acta del paciente en Libro
// 2, después sí se puede corregir el lote.
test("un lote de MIBG con administración activa NO se puede anular (el paciente quedaría con un lote inválido)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `anula_${lote.id}`), anulacionDoc(lote.id, SEDE_A, "Lote mal cargado"))
  );
});

// Mismo bloqueo pero con una corrección de por medio (intento 2 activo tras
// anular el 1) -- confirma que loteTieneAdministracionActiva encuentra el
// intento activo más alto, no sólo el primero.
test("un lote de MIBG con intento 2 activo (tras corregir el intento 1) tampoco se puede anular", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_mibg_${lote.id}_1`), anulacionDoc(`mibg_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_2`), mibgActaBase(lote.id, { intentoNro: "2", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `anula_${lote.id}`), anulacionDoc(lote.id, SEDE_A, "Lote mal cargado"))
  );
});

test("control positivo: anular un lote de MIBG SÍ se acepta después de anular la administración activa", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_mibg_${lote.id}_1`), anulacionDoc(`mibg_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const ref = doc(db, "actas", `anula_${lote.id}`);
  await setDoc(ref, anulacionDoc(lote.id, SEDE_A, "Lote mal cargado -- ahora sí, la administración ya está anulada"));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("control positivo: anular la acta de MIBG NO anula el lote (quedan independientes)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `mibg_${lote.id}_1`), mibgActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await setDoc(doc(db, "actas", `anula_mibg_${lote.id}_1`), anulacionDoc(`mibg_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const loteAnulaSnap = await getDoc(doc(db, "actas", `anula_${lote.id}`));
  assert.equal(loteAnulaSnap.exists(), false, "el lote no debería quedar anulado sólo porque se anuló la acta que lo usó");
});

// Libro 4 -- Lutecio-177: mismo lote de dosis única que MIBG (misma
// colección mibg_lote, isotopoId 'lutecio177'), pero la acta que lo
// "usa" es el 'paciente' de siempre (isotopoId 'lu177'), con su propio
// namespace de id determinístico -- lote_${loteId}_${intentoNro}, campo
// loteDosisUnicaId -- para no compartir el namespace mibg_${loteId} ya usado
// por MIBG en producción. Mismas garantías: bypass del id, sede, anulado,
// doble uso ACTIVO, intentoNro acotado. Anulación del lote y de la acta son
// independientes (ver anulacionDoc, arriba, en el bloque de MIBG).
// pacienteFicha/fichaIntentoNro con default DINÁMICO -- mismo motivo que
// i131Base/mibgActaBase más arriba (evitar choques entre controles
// positivos y entre corridas).
function lutecioActaBase(loteId, overrides = {}) {
  return {
    tipo: "paciente", fecha: serverTimestamp(), sedeId: SEDE_A, isotopoId: "lu177",
    pacienteFicha: fichaDePrueba(), fichaIntentoNro: "1", pacienteNombre: "Paciente Lutecio", pacienteDni: "2",
    medicoResponsable: "Dra. Test",
    // mciAdministrados: lo que el técnico tipeó como realmente inyectado.
    // actividadCalibrada: referencia denormalizada del lote (lo que llegó) --
    // corrección de diseño, antes no existía este segundo campo para Lutecio.
    mciAdministrados: 90, actividadCalibrada: 150,
    lote: "LU177-TEST", loteDosisUnicaId: loteId,
    // intentoNro: ver mibgActaBase, mismo esquema y mismo tope de 5.
    intentoNro: "1",
    ...overrides,
  };
}

test("control positivo: técnico SIN accesoTerapiaI131 SÍ puede administrar Lutecio-177 (Libro 4)", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  const ref = doc(db, "actas", `lote_${lote.id}_1`);
  await setDoc(ref, lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.tecnicoA.email, usuarioNombre: PERSONAS.tecnicoA.nombre }));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

// Corrección de diseño posterior a la auditoría v4: mismo criterio que MIBG
// -- actividadCalibrada (referencia del lote) es ahora un campo separado y
// obligatorio, ya no se confunde con mciAdministrados (lo que el técnico
// tipeó como realmente inyectado).
test("acta de Lutecio-177 sin actividadCalibrada es rechazada, aunque tenga mciAdministrados", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const { actividadCalibrada: _actividadCalibrada, ...sinActividadCalibrada } = lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" });
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `lote_${lote.id}_1`), sinActividadCalibrada)
  );
});

test("acta de Lutecio-177 con id que no es lote_${loteDosisUnicaId}_${intentoNro} es rechazada (bypass del id determinístico)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    addDoc(collection(db, "actas"), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("acta de Lutecio-177 con loteDosisUnicaId de un lote de OTRA sede es rechazada", async () => {
  await loguearComo(PERSONAS.admin);
  const loteDeB = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", sedeId: SEDE_B, usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `lote_${loteDeB.id}_1`), lutecioActaBase(loteDeB.id, { sedeId: SEDE_A, usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("un lote de Lutecio-177 ya usado no se puede volver a administrar en el mismo intentoNro (choca con allow update:false)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const ref = doc(db, "actas", `lote_${lote.id}_1`);
  await setDoc(ref, lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(ref, lutecioActaBase(lote.id, { pacienteNombre: "Otro Paciente", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

// Misma regresión que MIBG (ver bloque de arriba) para el namespace lote_.
test("un lote de Lutecio-177 con intentoNro 1 activo (no anulado) rechaza un intentoNro 2 (intentoHabilitado)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `lote_${lote.id}_2`), lutecioActaBase(lote.id, { intentoNro: "2", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("control positivo: anular el intentoNro 1 de Lutecio-177 permite administrar un intentoNro 2 del mismo lote", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_lote_${lote.id}_1`), anulacionDoc(`lote_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const ref2 = doc(db, "actas", `lote_${lote.id}_2`);
  await setDoc(ref2, lutecioActaBase(lote.id, { intentoNro: "2", pacienteNombre: "Paciente Lutecio (corregido)", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  const snap = await getDoc(ref2);
  assert.ok(snap.exists());
});

test("acta de Lutecio-177 con intentoNro fuera de 1..5 es rechazada", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `lote_${lote.id}_0`), lutecioActaBase(lote.id, { intentoNro: "0", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

test("un lote de Lutecio-177 anulado no se puede administrar", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_${lote.id}`), anulacionDoc(lote.id, SEDE_A, "Test: lote mal cargado"));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }))
  );
});

// Mismo bloqueo que MIBG (ver bloque de arriba), namespace lote_.
test("un lote de Lutecio-177 con administración activa NO se puede anular (el paciente quedaría con un lote inválido)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `anula_${lote.id}`), anulacionDoc(lote.id, SEDE_A, "Lote mal cargado"))
  );
});

test("un lote de Lutecio-177 con intento 2 activo (tras corregir el intento 1) tampoco se puede anular", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_lote_${lote.id}_1`), anulacionDoc(`lote_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));
  await setDoc(doc(db, "actas", `lote_${lote.id}_2`), lutecioActaBase(lote.id, { intentoNro: "2", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await assertPermissionDenied(() =>
    setDoc(doc(db, "actas", `anula_${lote.id}`), anulacionDoc(lote.id, SEDE_A, "Lote mal cargado"))
  );
});

test("control positivo: anular un lote de Lutecio-177 SÍ se acepta después de anular la administración activa", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `anula_lote_${lote.id}_1`), anulacionDoc(`lote_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const ref = doc(db, "actas", `anula_${lote.id}`);
  await setDoc(ref, anulacionDoc(lote.id, SEDE_A, "Lote mal cargado -- ahora sí, la administración ya está anulada"));
  const snap = await getDoc(ref);
  assert.ok(snap.exists());
});

test("control positivo: anular la acta de Lutecio-177 NO anula el lote (quedan independientes)", async () => {
  await loguearComo(PERSONAS.admin);
  const lote = await addDoc(collection(db, "mibg_lote"), mibgLoteBase({ isotopoId: "lutecio177", usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));
  await setDoc(doc(db, "actas", `lote_${lote.id}_1`), lutecioActaBase(lote.id, { usuarioEmail: PERSONAS.admin.email, usuarioNombre: "Admin" }));

  await setDoc(doc(db, "actas", `anula_lote_${lote.id}_1`), anulacionDoc(`lote_${lote.id}_1`, SEDE_A, "Dosis mal cargada, se corrige"));

  const loteAnulaSnap = await getDoc(doc(db, "actas", `anula_${lote.id}`));
  assert.equal(loteAnulaSnap.exists(), false, "el lote no debería quedar anulado sólo porque se anuló la acta que lo usó");
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
