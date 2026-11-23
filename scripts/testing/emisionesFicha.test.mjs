// Fase 2.0 (23/11) -- Emisión de fichas: reglas nuevas en firestore.rules
// (emisionesFicha, emisionesFichaResueltas). Mismo estilo que reglas.test.mjs
// -- escrituras directas al SDK cliente, simulando a alguien saltándose la
// UI (todavía no existe: esta tanda sólo prueba reglas, no cliente).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, updateDoc, writeBatch, getDoc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { PERSONAS, SEDE_A, SEDE_B, db, loguearComo, prepararFixturesGlobales, fichaDePrueba, cerrarConexiones } from "./fixtures.mjs";
import { setRol } from "../../src/services/auth.js";
import { addMibgLote, administrarMibgTransaction } from "../../src/services/firestore/mibgLotes.js";
import { anularActaTransaction } from "../../src/services/firestore/actas.js";

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

function expiraEnA(dias) {
  return Timestamp.fromMillis(Date.now() + dias * 86400000);
}

// Sólo para plantar estado PREVIO que la regla de create no deja producir
// por las reglas normales (ej. un padre con expiraEn ya vencido -- la propia
// regla de create lo rechazaría hoy). Mismo patrón y misma justificación que
// bootstrapAdminEnEmulador en fixtures.mjs: SOLO habla con el emulador local
// (FIRESTORE_EMULATOR_HOST), nunca con un proyecto real -- no aplica la razón
// por la que se evita admin SDK para todo lo demás.
async function plantarDirecto(coleccion, id, data) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const { initializeApp: initAdminApp, getApps: getAdminApps } = await import("firebase-admin/app");
  const { getFirestore: getAdminFirestore, Timestamp: AdminTimestamp } = await import("firebase-admin/firestore");
  if (!getAdminApps().length) initAdminApp({ projectId: "radiofarm-fuesmen-staging" });
  // Timestamp del SDK cliente (firebase/firestore) y del admin
  // (firebase-admin/firestore) son clases DISTINTAS -- el admin SDK rechaza
  // la del cliente ("doesn't match the expected instance"). Se reconstruye
  // acá con la clase correcta para cualquier campo Timestamp que venga.
  const convertido = {};
  for (const [k, v] of Object.entries(data)) {
    convertido[k] = v && typeof v.toMillis === "function" ? AdminTimestamp.fromMillis(v.toMillis()) : v;
  }
  await getAdminFirestore().doc(`${coleccion}/${id}`).set(convertido);
}

function emisionId(sedeId, numero, v) { return `${sedeId}_${numero}_${v}`; }

function emisionBase(numero, overrides = {}) {
  return {
    sedeId: SEDE_A, numero, pacienteFichaNum: Number(numero), emisionVersion: "1",
    dni: "20111222", nombre: "Paciente Emision Test", estudio: "Centellograma",
    usuarioEmail: PERSONAS.administrativa.email,
    fichaIntentoObservado: "0",
    expiraEn: expiraEnA(60),
    ...overrides,
  };
}
async function crearEmision(e) {
  await setDoc(doc(db, "emisionesFicha", emisionId(e.sedeId, e.numero, e.emisionVersion)), e);
}

function fichaUsadaBase(numero, intentoNro, overrides = {}) {
  return {
    pacienteFicha: numero, fichaIntentoNro: intentoNro, sedeId: SEDE_A,
    pacienteFichaNum: Number(numero), pacienteNombre: "Paciente FichaUsada",
    pacienteDni: "20111222", actaId: "acta-test", tipo: "paciente",
    ...overrides,
  };
}
async function crearFichaUsadaDirecta(numero, intentoNro, overrides = {}) {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "fichasUsadas", `${SEDE_A}_${numero}_${intentoNro}`), fichaUsadaBase(numero, intentoNro, overrides));
}
async function anularFichaIntentoDirecto(numero, intentoNro) {
  await loguearComo(PERSONAS.admin);
  await setDoc(doc(db, "actas", `anula_ficha_${SEDE_A}_${numero}_${intentoNro}`), {
    tipo: "anulacion", anulaId: `ficha_${SEDE_A}_${numero}_${intentoNro}`, sedeId: SEDE_A,
    usuarioEmail: PERSONAS.admin.email, motivo: "anulación de prueba",
  });
}

function resueltasBase(emisionEntry, overrides = {}) {
  return {
    sedeId: emisionEntry.sedeId, numero: emisionEntry.numero, emisionVersion: emisionEntry.emisionVersion,
    usuarioEmail: PERSONAS.administrativa.email,
    vistoAdmin: false,
    expiraEn: emisionEntry.expiraEn,
    estado: "liberada", motivo: "liberación de prueba",
    fichaIntentoNroObservado: "0",
    ...overrides,
  };
}

// === A. Bloqueo duro (fichaEstadoObservadoValido / fichaSinActaVigente) ===

test("emisión: N° nunca usado, k='0' -- OK", async () => {
  await loguearComo(PERSONAS.administrativa);
  const numero = fichaDePrueba();
  await crearEmision(emisionBase(numero));
});

test("emisión: declara k='0' pero el N° YA se usó (fichasUsadas_1 existe, vigente) -- denegado", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { fichaIntentoObservado: "0" })));
});

test("emisión: acta vigente real, declara k='1' (vigente, no anulada) -- denegado", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { fichaIntentoObservado: "1" })));
});

test("emisión: acta anulada (fichasUsadas_1 + anula_ficha_1), declara k='1' -- OK", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { fichaIntentoObservado: "1" }));
});

test("emisión: declara k menor al real (existe _2, declara k='1') -- denegado", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await crearFichaUsadaDirecta(numero, "2");
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { fichaIntentoObservado: "1" })));
});

test("emisión: declara k mayor al real (sólo existe _1, declara k='3') -- denegado", async () => {
  const numero = fichaDePrueba();
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { fichaIntentoObservado: "3" })));
});

test("emisión: técnico/admin de otra sede -- denegado (entre sedes)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.tecnicoB); // técnico, no administrativa/admin -- y de sede B
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { sedeId: SEDE_B, usuarioEmail: PERSONAS.tecnicoB.email })));
});

// === B. Cadena de emisionVersion + desfasaje de TTL ===

test("emisión v2: v1 nunca se resolvió -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { emisionVersion: "1" }));
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { emisionVersion: "2" })));
});

test("emisión v2: v1 resuelta como 'cargada' Y LUEGO ANULADA ('estudio no realizado') -- OK (no exige 'liberada')", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { emisionVersion: "1" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1");
  await loguearComo(PERSONAS.tecnicoA);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, { estado: "cargada", usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }));
  // El N° sólo queda libre para reemitir cuando el acta se anula (ver
  // PROCESOS_OPERATIVOS.md) -- "cargada" sin anular todavía tiene acta
  // vigente, el bloqueo duro lo rechazaría (correctamente) si se probara acá.
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { emisionVersion: "2", fichaIntentoObservado: "1" }));
});

test("emisión v2: v1 resuelta como 'liberada' -- OK", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { emisionVersion: "1" });
  await crearEmision(e1);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1));
  await crearEmision(emisionBase(numero, { emisionVersion: "2" }));
});

test("emisión v3 (o v5) sobre N° SIN ninguna historia -- denegado (no hay padre que exista)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { emisionVersion: "3" })));
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { emisionVersion: "5" })));
});

test("desfasaje TTL: padre v1 YA VENCIDO (expiraEn en el pasado) sin hijo Resueltas -- v2 permitido", async () => {
  const numero = fichaDePrueba();
  const e1 = emisionBase(numero, { emisionVersion: "1", expiraEn: Timestamp.fromMillis(Date.now() - 86400000) });
  await plantarDirecto("emisionesFicha", emisionId(SEDE_A, numero, "1"), e1);
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { emisionVersion: "2" }));
});

test("sin desfasaje: padre v1 TODAVÍA VIGENTE (expiraEn futuro) sin hijo Resueltas -- v2 denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { emisionVersion: "1" })); // expiraEn a 60 días, futuro
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { emisionVersion: "2" })));
});

// === C. Ventana de expiraEn ===

test("expiraEn fuera de ventana (1 día) -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { expiraEn: expiraEnA(1) })));
});

test("expiraEn fuera de ventana (120 días) -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { expiraEn: expiraEnA(120) })));
});

test("expiraEn dentro de ventana (60 días) -- OK", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await crearEmision(emisionBase(numero, { expiraEn: expiraEnA(60) }));
});

// === D. Resueltas -- ruta 1 (administrativa/admin, liberación standalone) ===

test("liberación standalone: sin acta vigente -- OK", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { fichaIntentoNroObservado: "0" }));
});

test("liberación standalone: acta vigente con el MISMO DNI -- denegado (eso se resuelve como 'cargada')", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "30999888" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "30999888" });
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { fichaIntentoNroObservado: "1" }))
  );
});

test("liberación standalone: acta vigente con OTRO DNI -- OK (conflicto, no bloquea la liberación)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "30999888" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "11222333" });
  await loguearComo(PERSONAS.administrativa);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { fichaIntentoNroObservado: "1" }));
});

test("liberación standalone: técnico no puede usar esta ruta -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { fichaIntentoNroObservado: "0", usuarioEmail: PERSONAS.tecnicoA.email }))
  );
});

// === E. Resueltas -- ruta 2 (técnico, "cargada" simple, NO atómica) ===

test("'cargada' simple: fichasUsadas preexistente con DNI que coincide -- OK", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "40555666" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "40555666" });
  await loguearComo(PERSONAS.tecnicoA);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, { estado: "cargada", usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }));
});

test("'cargada' simple: fabricar sobre fichasUsadas preexistente de OTRO DNI -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "40555666" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "99888777" });
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { estado: "cargada", usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }))
  );
});

test("'cargada' simple: administrativa no puede usar esta ruta -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "40555666" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "40555666" });
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { estado: "cargada", fichaIntentoNroUsado: "1" }))
  );
});

// === F. Resueltas -- ruta 3 (técnico, "cargada con corrección", atómica) ===

test("'cargada con corrección': dniEmitido correcto, dniReal coincide con el acta hermana -- OK (batch atómico)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "50111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "50111299" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, {
      estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
      fichaIntentoNroUsado: "1", dniEmitido: "50111222", dniReal: "50111299",
    }));
  await batch.commit();
});

test("'cargada con corrección': dniEmitido NO coincide con el padre -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "50111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "50111299" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, {
      estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
      fichaIntentoNroUsado: "1", dniEmitido: "00000000", dniReal: "50111299",
    }));
  await assertPermissionDenied(() => batch.commit());
});

test("'cargada con corrección': dniReal NO coincide con el acta hermana real -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "50111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "50111299" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, {
      estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
      fichaIntentoNroUsado: "1", dniEmitido: "50111222", dniReal: "00000000",
    }));
  await assertPermissionDenied(() => batch.commit());
});

test("'cargada con corrección': SIN el fichasUsadas hermano en el batch -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "50111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, {
        estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
        fichaIntentoNroUsado: "1", dniEmitido: "50111222", dniReal: "50111299",
      }))
  );
});

test("'cargada con corrección': fichasUsadas hermano YA EXISTÍA de antes del batch -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "50111222" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "50111299" }); // preexistente, FUERA de este batch
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, {
        estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
        fichaIntentoNroUsado: "1", dniEmitido: "50111222", dniReal: "50111299",
      }))
  );
});

// === G. Resueltas -- ruta 4 (técnico, liberación por reasignación, atómica) ===

const MOTIVO_FIJO = "Ficha reasignada a otro paciente (confirmado por el técnico al cargar)";

test("liberación por reasignación: motivo fijo + hermano con DNI DISTINTO -- OK (batch atómico)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "60111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "70999888" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, { estado: "liberada", motivo: MOTIVO_FIJO, usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }));
  await batch.commit();
});

test("liberación por reasignación: motivo fijo pero MISMO DNI -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "60111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "60111222" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, { estado: "liberada", motivo: MOTIVO_FIJO, usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }));
  await assertPermissionDenied(() => batch.commit());
});

test("liberación por reasignación: motivo DISTINTO al fijo -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "60111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaId = `${SEDE_A}_${numero}_1`;
  const batch = writeBatch(db);
  batch.set(doc(db, "fichasUsadas", fichaId), fichaUsadaBase(numero, "1", { pacienteDni: "70999888" }));
  batch.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
    resueltasBase(e1, { estado: "liberada", motivo: "otro motivo cualquiera", usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }));
  await assertPermissionDenied(() => batch.commit());
});

test("liberación por reasignación: SIN hermano en el batch -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "60111222" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { estado: "liberada", motivo: MOTIVO_FIJO, usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }))
  );
});

// === H. vistoAdmin ===

test("vistoAdmin: create en true -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { vistoAdmin: true }))
  );
});

test("vistoAdmin: update false->true por administrativa de la sede -- OK", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  const ref = doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1"));
  await setDoc(ref, resueltasBase(e1));
  await updateDoc(ref, { vistoAdmin: true });
});

test("vistoAdmin: update true->false -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  const ref = doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1"));
  await setDoc(ref, resueltasBase(e1));
  await updateDoc(ref, { vistoAdmin: true });
  await assertPermissionDenied(() => updateDoc(ref, { vistoAdmin: false }));
});

test("vistoAdmin: update por técnico -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  const ref = doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1"));
  await setDoc(ref, resueltasBase(e1));
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() => updateDoc(ref, { vistoAdmin: true }));
});

test("vistoAdmin: update que además toca otro campo -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  const ref = doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1"));
  await setDoc(ref, resueltasBase(e1));
  await assertPermissionDenied(() => updateDoc(ref, { vistoAdmin: true, motivo: "otro texto" }));
});

// === I. Entre sedes ===

test("Resueltas: técnico de sede B apuntando a un padre de sede A -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoB);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { estado: "cargada", usuarioEmail: PERSONAS.tecnicoB.email, fichaIntentoNroUsado: "1" }))
  );
});

// === J. Correcciones del 23/11 (segunda vuelta) ===

test("emisión: técnico de la MISMA sede intenta emitir -- denegado (rol)", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.tecnicoA); // sede A, mismo lugar que administrativa/admin de PERSONAS
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { usuarioEmail: PERSONAS.tecnicoA.email })));
});

test("emisión: emisionVersion '6' -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() => crearEmision(emisionBase(numero, { emisionVersion: "6" })));
});

test("Resueltas: crear dos veces la misma resolución (mismo id) -- la segunda denegada", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1));
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { motivo: "otro motivo" }))
  );
});

test("Resueltas: expiraEn distinto al del padre -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { expiraEn: expiraEnA(61) }))
  );
});

test("vistoAdmin: administrativa de OTRA sede -- denegado", async () => {
  const numero = fichaDePrueba();
  const administrativaB = { email: "administrativa.italiano.test@radiofarm.local", nombre: "Administrativa Italiano Test", rol: "administrativa", sede: SEDE_B };
  await loguearComo(PERSONAS.admin); // sólo admin puede escribir roles/{email} de otra persona
  await setRol(administrativaB.email, { nombre: administrativaB.nombre, rol: administrativaB.rol, sede: administrativaB.sede });
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  const ref = doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1"));
  await setDoc(ref, resueltasBase(e1));
  await loguearComo(administrativaB);
  await assertPermissionDenied(() => updateDoc(ref, { vistoAdmin: true }));
});

test("liberación standalone: fichaIntentoNroObservado MENOR al real -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero); // padre creado ANTES de que exista historia (k='0', trivial)
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1"); // real: intento 1 anulado, sin acta vigente -- liberable de verdad
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { fichaIntentoNroObservado: "0" })) // declara "nunca usado", pero _1 existe
  );
});

test("liberación standalone: fichaIntentoNroObservado MAYOR al real -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero);
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1");
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.administrativa);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")), resueltasBase(e1, { fichaIntentoNroObservado: "2" })) // declara _2, pero no existe
  );
});

// === K. T2/T3 -- peor caso real combinado en UNA sola transacción ===
// Construye la cadena MIBG hasta intentoNro=4 anulado (igual que el ancla
// T1) para que el intento 5 sea la rama de 8 lecturas distintas de
// actaValida() -- y arma a mano, en una sola runTransaction, acta(intento5)
// + fichasUsadas(intento5) + emisionesFichaResueltas (opción b o c). No usa
// administrarMibgTransaction para el último paso porque esa función sólo
// escribe 2 documentos -- hace falta el 3ro en el MISMO commit.
async function construirCadenaMibgHastaIntento4(numero) {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-T2T3-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "mibg",
    numeroLote, proveedor: "Proveedor T2T3",
    actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const loteId = loteRef.id;
  const base = {
    sitioInyeccion: "DMD", sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: numero, pacienteNombre: "T2T3 Peor Caso", pacienteDni: "80111222",
    numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  };
  for (let n = 1; n <= 4; n++) {
    await administrarMibgTransaction(loteId, base);
    await loguearComo(PERSONAS.admin);
    await anularActaTransaction({ id: `mibg_${loteId}_${n}`, sedeId: SEDE_A, pacienteFicha: numero, fichaIntentoNro: String(n) }, "T2/T3 -- anulación de cadena", PERSONAS.admin);
    await loguearComo(PERSONAS.tecnicoA);
  }
  return { loteId, base };
}

test("T2: en UNA transacción, acta intentoNro=5 (8 lecturas) + fichasUsadas + Resueltas opción b -- acepta", async () => {
  const numero = fichaDePrueba();
  const { loteId, base } = await construirCadenaMibgHastaIntento4(numero);
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "80111222", fichaIntentoObservado: "4" }); // real: intentos 1-4 anulados
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaUsadaId = `${SEDE_A}_${numero}_5`;
  await runTransaction(db, async (tx) => {
    tx.set(doc(db, "actas", `mibg_${loteId}_5`), {
      ...base, tipo: "i131_mibg", mibgLoteId: loteId, intentoNro: "5", fichaIntentoNro: "5", fecha: serverTimestamp(),
    });
    tx.set(doc(db, "fichasUsadas", fichaUsadaId), fichaUsadaBase(numero, "5", { pacienteDni: "80111299", actaId: `mibg_${loteId}_5`, tipo: "i131_mibg" }));
    tx.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, {
        estado: "cargada_con_correccion", usuarioEmail: PERSONAS.tecnicoA.email,
        fichaIntentoNroUsado: "5", dniEmitido: "80111222", dniReal: "80111299",
      }));
  });
});

test("T3: en UNA transacción, acta intentoNro=5 (8 lecturas) + fichasUsadas + Resueltas opción c -- acepta", async () => {
  const numero = fichaDePrueba();
  const { loteId, base } = await construirCadenaMibgHastaIntento4(numero);
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "80111222", fichaIntentoObservado: "4" });
  await crearEmision(e1);
  await loguearComo(PERSONAS.tecnicoA);
  const fichaUsadaId = `${SEDE_A}_${numero}_5`;
  await runTransaction(db, async (tx) => {
    tx.set(doc(db, "actas", `mibg_${loteId}_5`), {
      ...base, tipo: "i131_mibg", mibgLoteId: loteId, intentoNro: "5", fichaIntentoNro: "5", fecha: serverTimestamp(),
      pacienteDni: "90999888", pacienteNombre: "Otro Paciente T2T3",
    });
    tx.set(doc(db, "fichasUsadas", fichaUsadaId), fichaUsadaBase(numero, "5", { pacienteDni: "90999888", pacienteNombre: "Otro Paciente T2T3", actaId: `mibg_${loteId}_5`, tipo: "i131_mibg" }));
    tx.set(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, {
        estado: "liberada", motivo: MOTIVO_FIJO, usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "5",
      }));
  });
});

test("'cargada' simple: fichasUsadas apuntado cuyo intento está ANULADO -- denegado", async () => {
  const numero = fichaDePrueba();
  await loguearComo(PERSONAS.administrativa);
  const e1 = emisionBase(numero, { dni: "40555666" });
  await crearEmision(e1);
  await crearFichaUsadaDirecta(numero, "1", { pacienteDni: "40555666" });
  await anularFichaIntentoDirecto(numero, "1");
  await loguearComo(PERSONAS.tecnicoA);
  await assertPermissionDenied(() =>
    setDoc(doc(db, "emisionesFichaResueltas", emisionId(SEDE_A, numero, "1")),
      resueltasBase(e1, { estado: "cargada", usuarioEmail: PERSONAS.tecnicoA.email, fichaIntentoNroUsado: "1" }))
  );
});
