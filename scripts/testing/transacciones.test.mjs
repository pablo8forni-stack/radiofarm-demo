// Área A: las 3 transacciones atómicas (ingreso, egreso, transferencia) en
// casos normales y de conflicto (dos operaciones simultáneas sobre el mismo
// lote). Ejercita directamente las funciones reales de src/services/firestore/stock.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import {
  PERSONAS, SEDE_A, SEDE_B, FARM_ID, db,
  loguearComo, crearLoteDirecto, borrarLote, loteDePrueba, fichaDePrueba,
  prepararFixturesGlobales, buscarLotePorNumero, buscarMovimientos, cerrarConexiones,
} from "./fixtures.mjs";
import { egresoTransaction, ingresoBatch, transferenciaTransaction } from "../../src/services/firestore/stock.js";
import { addMibgLote, administrarMibgTransaction, administrarLutecioTransaction, usoActivoDeLote, estadoPorLoteDosisUnica, lotesDisponiblesParaAdministrar, listenMibgLotes } from "../../src/services/firestore/mibgLotes.js";
import { addActaPaciente, addActaI131Barrido, anularActaTransaction, anulacionesPorSede } from "../../src/services/firestore/actas.js";
import { lotesDelMes } from "../../src/helpers/mibgLote.js";
import { setSedeAuditando } from "../../src/services/auth.js";
import { hoy } from "../../src/helpers/formato.js";
import { FARMS_DEFAULT } from "../../src/constants/farmsSeed.js";
import { uid } from "../../src/helpers/id.js";

const FARM = FARMS_DEFAULT.find((f) => f.id === FARM_ID);
const NOMBRE_SEDE = { [SEDE_A]: "FUESMEN Central", [SEDE_B]: "C. Gamma Hospital Italiano" };

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

test("ingreso: crea lote nuevo con la cantidad indicada y su movimiento", async () => {
  await loguearComo(PERSONAS.admin);
  const loteNum = loteDePrueba();

  const { loteId, movimientoId } = await ingresoBatch({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, lote: loteNum,
    vencimiento: "2027-01-01", cantidad: 10, kits: null, proveedorNombre: "Proveedor Principal",
    observacion: "", usuario: PERSONAS.admin,
  });

  // getDoc por id directo, NO buscarLotePorNumero/buscarMovimientos (queries)
  // -- bug real encontrado: batch.commit() resuelto no garantiza que una
  // query posterior ya refleje la escritura (fallaba ~1 de cada 8 veces),
  // mientras que un getDoc por id conocido es inmediato. ingresoBatch ya
  // devuelve el loteId y el movimientoId (los conoce localmente desde antes
  // de escribir).
  const loteSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.ok(loteSnap.exists(), "el lote debería existir");
  const lote = { id: loteSnap.id, ...loteSnap.data() };
  assert.equal(lote.cantidad, 10);

  const movSnap = await getDoc(doc(db, "movimientos", movimientoId));
  assert.ok(movSnap.exists(), "debería haber un movimiento de ingreso");
  const ingreso = { id: movSnap.id, ...movSnap.data() };
  assert.equal(ingreso.tipo, "ingreso");
  assert.equal(ingreso.cantidad, 10);
  assert.equal(ingreso.sedeId, SEDE_A);
  assert.equal(ingreso.loteId, lote.id);

  await borrarLote(SEDE_A, lote.id);
});

test("egreso: descuenta stock del lote en la propia sede del técnico", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  // motivo "Vencimiento" (descarte), no "Estudio" -- firestore.rules exige
  // cantidad == 1 para los motivos de marcación (ver movimientoValido/
  // esMotivoDescarte), así que un cantidad > 1 con "Estudio" ahora sería
  // rechazado por las reglas. El descarte conserva cantidad libre, que es
  // justo lo que este test necesita para probar la resta de stock de más
  // de un vial por transacción.
  await egresoTransaction({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, loteId,
    cantidad: 2, motivo: "Vencimiento", observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
  });

  const snap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(snap.data().cantidad, 3);

  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("egreso: conflicto -- dos egresos simultáneos sobre el mismo lote cuya suma excede el stock", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  // Cada intento con su propio operacionId: son dos operaciones concurrentes
  // distintas (dos técnicos casi al mismo tiempo), no un reintento de la
  // misma -- si compartieran operacionId, la idempotencia haría que el
  // segundo sea un no-op silencioso en vez de rechazar por stock insuficiente.
  // motivo "Vencimiento" (descarte) -- mismo motivo que el test anterior,
  // misma razón: cantidad > 1 con "Estudio" ya no pasa la regla del servidor.
  const intento = () => egresoTransaction({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, loteId,
    cantidad: 3, motivo: "Vencimiento", observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
  });

  const resultados = await Promise.allSettled([intento(), intento()]);
  const exitosos = resultados.filter((r) => r.status === "fulfilled");
  const fallidos = resultados.filter((r) => r.status === "rejected");
  assert.equal(exitosos.length, 1, "sólo uno de los dos egresos debería tener éxito");
  assert.equal(fallidos.length, 1);
  assert.match(fallidos[0].reason.message, /insuficiente|actividad/i);

  const snap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(snap.data().cantidad, 2, "sólo se debería haber descontado una vez (5-3=2)");

  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("transferencia: descuenta en origen y acredita en destino, vinculados por grupoId", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 8);

  await transferenciaTransaction({
    sedeOrigenId: SEDE_A, sedeOrigenNombre: NOMBRE_SEDE[SEDE_A],
    sedeDestinoId: SEDE_B, sedeDestinoNombre: NOMBRE_SEDE[SEDE_B],
    farm: FARM, loteId, cantidad: 3, observacion: "", usuario: PERSONAS.admin, operacionId: uid(),
  });

  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(origenSnap.data().cantidad, 5);
  const loteNum = origenSnap.data().lote;

  const movs = await buscarMovimientos("lote", loteNum);
  const salida = movs.find((m) => m.tipo === "transferencia_salida");
  const entrada = movs.find((m) => m.tipo === "transferencia_entrada");
  assert.ok(salida && entrada, "deberían existir ambos movimientos de la transferencia");
  assert.equal(salida.grupoId, entrada.grupoId);
  assert.equal(entrada.sedeId, SEDE_B);
  assert.equal(entrada.cantidad, 3);

  const destinoLote = await buscarLotePorNumero(SEDE_B, loteNum);
  assert.ok(destinoLote, "debería haberse creado/acreditado el lote en destino");
  assert.equal(destinoLote.cantidad, 3);

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLote.id);
});

// Aislamiento entre sedes (2026-11-03): la regla de lectura de movimientos
// ahora exige resource==null || isAdmin() || miRol().sede==resource.data.sedeId
// -- egresoTransaction hace tx.get(movimientoRef) sobre un movimiento que la
// PRIMERA vez no existe todavía (idempotencia). Sin el guard resource==null,
// esto rompía para cualquier técnico -- este test lo cubre explícito, no
// sólo de rebote en el resto de la suite.
test("aislamiento entre sedes: egreso técnico, primer intento (tx.get sobre movimiento inexistente) sigue funcionando", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);
  await loguearComo(PERSONAS.tecnicoA);
  await egresoTransaction({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, loteId, cantidad: 1,
    motivo: "Estudio", observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
  });
  const snap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(snap.data().cantidad, 4);
  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

// Control: un técnico intentando transferir sigue rechazado -- ya lo estaba
// desde antes (la regla de `lotes` exige isAdmin() para el incremento en
// destino), el cambio de aislamiento entre sedes no abre ni cierra nada
// nuevo acá, pero lo deja probado explícito en esta tanda.
test("aislamiento entre sedes: técnico intentando transferenciaTransaction sigue rechazado", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 8);
  await loguearComo(PERSONAS.tecnicoA);
  await assert.rejects(() => transferenciaTransaction({
    sedeOrigenId: SEDE_A, sedeOrigenNombre: NOMBRE_SEDE[SEDE_A],
    sedeDestinoId: SEDE_B, sedeDestinoNombre: NOMBRE_SEDE[SEDE_B],
    farm: FARM, loteId, cantidad: 3, observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
  }));
  await loguearComo(PERSONAS.admin);
  await borrarLote(SEDE_A, loteId);
});

test("transferencia: conflicto -- dos transferencias simultáneas desde el mismo lote cuya suma excede el stock", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  // Mismo motivo que en el conflicto de egreso: operacionId distinto por
  // intento, porque son dos operaciones concurrentes, no un reintento.
  const intento = () => transferenciaTransaction({
    sedeOrigenId: SEDE_A, sedeOrigenNombre: NOMBRE_SEDE[SEDE_A],
    sedeDestinoId: SEDE_B, sedeDestinoNombre: NOMBRE_SEDE[SEDE_B],
    farm: FARM, loteId, cantidad: 3, observacion: "", usuario: PERSONAS.admin, operacionId: uid(),
  });

  const resultados = await Promise.allSettled([intento(), intento()]);
  const exitosos = resultados.filter((r) => r.status === "fulfilled");
  const fallidos = resultados.filter((r) => r.status === "rejected");
  assert.equal(exitosos.length, 1, "sólo una de las dos transferencias debería tener éxito");
  assert.equal(fallidos.length, 1);
  assert.match(fallidos[0].reason.message, /insuficiente|actividad/i);

  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(origenSnap.data().cantidad, 2, "sólo se debería haber descontado una vez (5-3=2)");
  const loteNum = origenSnap.data().lote;

  const destinoLote = await buscarLotePorNumero(SEDE_B, loteNum);
  assert.ok(destinoLote);
  assert.equal(destinoLote.cantidad, 3, "el destino debería haberse acreditado una sola vez");

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLote.id);
});

// Regresión directa de un bug real en producción: administrarMibgTransaction/
// administrarLutecioTransaction (mibgLotes.js) leen actas/anula_{loteId}
// para saber si el lote ya fue anulado ANTES de que ese marcador exista
// nunca (primera administración de un lote recién llegado) -- la regla de
// actas explotaba sobre resource.data.sedeId con resource==null, y como
// isAdmin() era el único camino que no evaluaba esa cláusula, el bug nunca
// se vio probando como admin (todos los tests de este archivo, hasta acá,
// corren como PERSONAS.admin). Estos dos SÍ corren como PERSONAS.tecnicoA
// a propósito -- es la única forma de que este test hubiera fallado antes
// del fix.
test("MIBG: técnico (no admin) SÍ puede administrar un lote recién llegado", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const numeroLote = `TEST-MIBG-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "mibg",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const ficha = fichaDePrueba();
  await administrarMibgTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test MIBG", pacienteDni: "1",
    numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const usoSnap = await getDoc(doc(db, "actas", `mibg_${loteRef.id}_1`));
  assert.ok(usoSnap.exists());
  assert.equal(usoSnap.data().pacienteFicha, ficha);
});

test("Lutecio-177: técnico (no admin) SÍ puede administrar un lote recién llegado", async () => {
  await loguearComo(PERSONAS.tecnicoA); // sede central == SEDE_A
  const numeroLote = `TEST-LU-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Lutecio", pacienteDni: "2",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const usoSnap = await getDoc(doc(db, "actas", `lote_${loteRef.id}_1`));
  assert.ok(usoSnap.exists());
  assert.equal(usoSnap.data().pacienteFicha, ficha);
});

// mibg_lote también tenía el mismo hueco (resource==null sin guard) en su
// propio primer tx.get -- este test cubre ese lado (loteId inexistente,
// mensaje amigable en vez de permission-denied crudo), aunque no fue el
// que disparó el bug original.
test("MIBG: administrar un loteId inexistente da el mensaje amigable, no permission-denied crudo", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  await assert.rejects(
    () => administrarMibgTransaction("id-inexistente-12345", {
      sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
      pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Test", pacienteDni: "9",
      numeroLote: "X", actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
    }),
    /no existe/i
  );
});

// Fase 1B: pacienteDni en fichasUsadas -- ejercita las 4 transacciones de
// carga REALES (no reglas en crudo) con y sin el campo, confirmando que
// datosFichaUsada (actas.js) lo propaga tal cual en el marcador. I-131 usa
// i131_barrido como representativo: los 8 tipos comparten exactamente la
// misma función addActaI131()/crearActaConFicha(), sólo cambia el string
// `tipo` -- no hay lógica distinta por tipo que probar acá.
test("Tc-99m (addActaPaciente): CON pacienteDni, el marcador fichasUsadas lo tiene", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ficha = fichaDePrueba();
  await addActaPaciente({
    sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(), mciAdministrados: 10,
    pacienteFicha: ficha, fichaIntentoNro: "1", isotopoId: "tc99m",
    pacienteNombre: "Paciente Test Tc99m", pacienteDni: "11111111", estudio: "Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email,
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.equal(fichaSnap.data().pacienteDni, "11111111");
});

test("Tc-99m (addActaPaciente): SIN pacienteDni (cliente viejo), el marcador se crea igual, sin el campo", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ficha = fichaDePrueba();
  await addActaPaciente({
    sedeId: SEDE_A, farmId: FARM_ID, lote: loteDePrueba(), mciAdministrados: 10,
    pacienteFicha: ficha, fichaIntentoNro: "1", isotopoId: "tc99m",
    pacienteNombre: "Paciente Test Tc99m Viejo", estudio: "Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email,
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.ok(fichaSnap.exists());
  assert.equal(fichaSnap.data().pacienteDni, undefined);
});

test("I-131 (addActaI131Barrido, representativo de los 8 tipos): CON pacienteDni, el marcador lo tiene", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ficha = fichaDePrueba();
  await addActaI131Barrido({
    sedeId: SEDE_A, pacienteFicha: ficha, fichaIntentoNro: "1",
    pacienteNombre: "Paciente Test I131", pacienteDni: "22222222",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email,
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.equal(fichaSnap.data().pacienteDni, "22222222");
});

// A diferencia de Tc-99m/Lutecio-177 (tipo "paciente"), i131_barrido YA
// exige pacienteDni como obligatorio en actaValida() (firestore.rules) --
// esto es PRE-EXISTENTE, de antes de la Fase 1B, no algo que haya cambiado
// acá. Un "cliente viejo sin DNI" no es un caso real posible para I-131:
// el acta misma lo rechaza antes de llegar a fichasUsadas. Este test
// documenta eso (rechazo, no éxito) en vez de fingir un escenario que no
// puede pasar.
test("I-131 (addActaI131Barrido): SIN pacienteDni es rechazado -- ya era obligatorio en el acta antes de la 1B", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const ficha = fichaDePrueba();
  await assert.rejects(() =>
    addActaI131Barrido({
      sedeId: SEDE_A, pacienteFicha: ficha, fichaIntentoNro: "1",
      pacienteNombre: "Paciente Test I131 Sin DNI",
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email,
    })
  );
});

test("MIBG: CON pacienteDni, el marcador fichasUsadas lo tiene", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-MIBG-DNI-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "mibg",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarMibgTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test MIBG DNI", pacienteDni: "33333333",
    numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.equal(fichaSnap.data().pacienteDni, "33333333");
});

// MIBG usa tipo "i131_mibg" (administrarMibgTransaction, ver mibgLotes.js),
// que TAMBIÉN exige pacienteDni obligatorio en actaValida() desde antes de
// la Fase 1B -- mismo caso que I-131 arriba, no un caso real posible.
test("MIBG: SIN pacienteDni es rechazado -- ya era obligatorio en el acta antes de la 1B", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-MIBG-SINDNI-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "mibg",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await assert.rejects(() =>
    administrarMibgTransaction(loteRef.id, {
      sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
      pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Test MIBG Sin DNI",
      numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
    })
  );
});

test("Lutecio-177: CON pacienteDni, el marcador fichasUsadas lo tiene", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-DNI-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Lutecio DNI", pacienteDni: "44444444",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.equal(fichaSnap.data().pacienteDni, "44444444");
});

test("Lutecio-177: SIN pacienteDni (cliente viejo), el marcador se crea igual", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-SINDNI-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Lutecio Viejo",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const fichaSnap = await getDoc(doc(db, "fichasUsadas", `${SEDE_A}_${ficha}_1`));
  assert.ok(fichaSnap.exists());
  assert.equal(fichaSnap.data().pacienteDni, undefined);
});

// Libro 4 (4/11): bug real donde un lote de Lutecio-177 llegado y usado en
// un mes aparecía "disponible" en la impresión de CUALQUIER otro mes,
// porque el uso se buscaba adentro de actasLibro2 (ya recortada al mes que
// se está imprimiendo) en vez de sin acotar por fecha. usoActivoDeLote
// (mibgLotes.js) es el reemplazo -- estos tests lo ejercitan directo,
// contra Firestore real (emulador), no con mocks.
test("usoActivoDeLote: encuentra la administración real de un lote, sin acotar por fecha", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-USO-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Uso Activo", pacienteDni: "33333333",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const uso = await usoActivoDeLote(loteRef.id, { prefijo: "lote_", anulaciones: new Map() });
  assert.ok(uso, "debería encontrar el uso");
  assert.equal(uso.pacienteNombre, "Paciente Test Uso Activo");
  assert.equal(uso.id, `lote_${loteRef.id}_1`);
});

test("usoActivoDeLote: lote sin administración -- null (disponible)", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote: `TEST-LU-SINUSO-${Date.now()}`, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const uso = await usoActivoDeLote(loteRef.id, { prefijo: "lote_", anulaciones: new Map() });
  assert.equal(uso, null);
});

// Caso pedido por Pablo: una anulación es un acta APARTE con su propia
// fecha, que puede caer en un mes distinto del de la administración que
// anula -- acá se cruza con anulaciones armadas por una consulta REAL sin
// acotar por fecha (anulacionesPorSede), igual que GenerarActasImpresion.jsx,
// para confirmar que un uso anulado nunca queda como "usado" sin importar
// en qué mes se haya anulado.
test("usoActivoDeLote: uso ANULADO -- excluido, vuelve a estar disponible", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-ANULADO-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Uso Anulado", pacienteDni: "44444444",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const usoId = `lote_${loteRef.id}_1`;
  const usoSnap = await getDoc(doc(db, "actas", usoId));
  // Anular ACTAS es admin-only (actaValida en firestore.rules, d.tipo ==
  // 'anulacion' exige isAdmin() siempre, a diferencia de movimientos donde
  // el técnico también puede anular en su propia sede) -- PERSONAS.admin
  // tiene la misma sede (SEDE_A) que el lote. Leer actas como admin exige
  // sedeAuditando puesta (sedeAuditando = sede que el admin está MIRANDO
  // ahora, distinto de sede = sede de trabajo donde registra -- ver
  // firestore.rules) -- sin sedeAuditando puesta, anulacionesPorSede
  // fallaría con permission-denied.
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: usoId, ...usoSnap.data() }, "Error de carga", PERSONAS.admin);

  const anulaciones = new Map((await anulacionesPorSede(SEDE_A)).map((a) => [a.anulaId, a]));
  assert.ok(anulaciones.has(usoId), "la anulación debería estar en la consulta sin acotar por fecha");

  const uso = await usoActivoDeLote(loteRef.id, { prefijo: "lote_", anulaciones });
  assert.equal(uso, null, "un uso anulado no debe contar como administración activa");
});

// Pedido por Pablo: flujo de CORRECCIÓN completo -- administrar, anular esa
// administración (error de carga real, no de lote), administrar de nuevo
// (intentoNro 2) con el dato corregido. usoActivoDeLote tiene que devolver
// el intento 2 (el paciente CORREGIDO), nunca null (el lote no está
// "disponible", tiene una administración activa) ni el intento 1 anulado.
test("usoActivoDeLote: flujo de corrección -- anular intento 1 y administrar intento 2 -- devuelve el intento 2 corregido", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-CORRECCION-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const fichaIntento1 = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaIntento1, pacienteNombre: "Paciente MAL Tipeado", pacienteDni: "66666666",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const usoId1 = `lote_${loteRef.id}_1`;
  const usoSnap1 = await getDoc(doc(db, "actas", usoId1));

  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: usoId1, ...usoSnap1.data() }, "Paciente mal tipeado", PERSONAS.admin);

  await loguearComo(PERSONAS.tecnicoA);
  const fichaIntento2 = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaIntento2, pacienteNombre: "Paciente Corregido", pacienteDni: "77777777",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const anulaciones = new Map((await anulacionesPorSede(SEDE_A)).map((a) => [a.anulaId, a]));
  const uso = await usoActivoDeLote(loteRef.id, { prefijo: "lote_", anulaciones });
  assert.ok(uso, "debería encontrar una administración activa -- el lote NO está disponible");
  assert.equal(uso.id, `lote_${loteRef.id}_2`, "debe ser el intento 2, no el 1 (anulado)");
  assert.equal(uso.pacienteNombre, "Paciente Corregido");
});

// Pipeline real de Libro 4 (lotesDelMes + usoActivoDeLote juntos, como los
// usa GenerarActasImpresion.jsx). No se puede backdatear `fecha` de un lote
// (addMibgLote siempre pone serverTimestamp(), ver mibgLotes.js), así que
// este test cubre "mismo mes" end-to-end contra Firestore real; el límite
// de mes/zona horaria en sí ya está cubierto por separado en
// src/helpers/mibgLote.test.js (lotesDelMes, sin necesitar Firestore).
test("Libro 4 -- pipeline real: lote de este mes con uso activo sale 'usado', con lotesDelMes + usoActivoDeLote", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TEST-LU-PIPELINE-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Proveedor Test",
    actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
    fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const ficha = fichaDePrueba();
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: ficha, pacienteNombre: "Paciente Test Pipeline", pacienteDni: "55555555",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const hoy = new Date();
  const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const hasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  const todosLosLotes = [{ id: loteRef.id, isotopoId: "lutecio177", fecha: new Date() }];
  const lotesLutecio = lotesDelMes(todosLosLotes, { desde, hasta });
  assert.equal(lotesLutecio.length, 1, "el lote debería quedar dentro del mes actual");

  const usoPorLoteId = new Map();
  for (const l of lotesLutecio) {
    const uso = await usoActivoDeLote(l.id, { prefijo: "lote_", anulaciones: new Map() });
    if (uso) usoPorLoteId.set(l.id, uso);
  }
  assert.ok(usoPorLoteId.has(loteRef.id));
  assert.equal(usoPorLoteId.get(loteRef.id).pacienteNombre, "Paciente Test Pipeline");
});

// ===========================================================================
// estadoPorLoteDosisUnica / lotesDisponiblesParaAdministrar (4/11, plan del
// selector de lote disponible) -- TODOS estos tests corren contra el
// emulador REAL (escrituras/lecturas reales), nunca con un Map armado a
// mano, como pidió Pablo explícitamente. Helper chico para no repetir
// anulacionesPorSede+Map en cada test.
// ===========================================================================
async function anulacionesComoMapa(sedeId) {
  return new Map((await anulacionesPorSede(sedeId)).map((a) => [a.anulaId, a]));
}

// Reproduce EXACTAMENTE el caso real (lote de septiembre reapareciendo en
// noviembre) con el código NUEVO -- a diferencia del selector viejo
// (listenActas con limit 150), usoActivoDeLote es un lookup puntual por id,
// nunca una query de colección, así que el ruido de otras actas no puede
// empujarlo fuera de ninguna ventana. Mismas 160 actas que la reproducción
// del límite de 150 (confirmada antes, con el selector VIEJO, como bug
// real) -- acá se prueba que el helper NUEVO no lo reproduce.
test("estadoPorLoteDosisUnica: lote usado + 160 actas 'paciente' MÁS NUEVAS -- NO aparece disponible (el bug del límite 150 queda resuelto)", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `SELECTOR150-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Selector 150", pacienteDni: "1",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  const base = Date.now();
  for (let i = 0; i < 160; i++) {
    await addActaPaciente({
      sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
      pacienteFicha: `${base}${String(i).padStart(4, "0")}`.slice(-15), fichaIntentoNro: "1",
      pacienteNombre: `Paciente Ruido Selector ${i}`, pacienteDni: `${91000000 + i}`,
      isotopoId: "tc99m", sinRadiofarmaco: true, mciAdministrados: 10,
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
    });
  }

  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const { disponibles } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(disponibles.length, 0, "el lote usado NO debería aparecer disponible, con o sin 160 actas de ruido de por medio");
});

test("estadoPorLoteDosisUnica: uso ANULADO -- el lote reaparece como disponible (flujo de corrección)", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `SELECTOR-ANULUSO-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Selector Anulado", pacienteDni: "2",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const usoId = `lote_${loteRef.id}_1`;
  const usoSnap = await getDoc(doc(db, "actas", usoId));
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: usoId, ...usoSnap.data() }, "Error de carga", PERSONAS.admin);

  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const { disponibles } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.deepEqual(disponibles.map((l) => l.id), [loteRef.id], "con el uso anulado, el lote tiene que volver a estar disponible");
});

test("estadoPorLoteDosisUnica: lote ANULADO (no la administración) -- nunca disponible", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `SELECTOR-ANULOTE-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: loteRef.id, sedeId: SEDE_A }, "Lote mal cargado", PERSONAS.admin);

  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const estado = await estadoPorLoteDosisUnica([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteRef.id).estado, "anulado");
});

test("estadoPorLoteDosisUnica: vencido INCLUSIVE desde el día del EXP -- no disponible; vence mañana -- sí disponible", async () => {
  const anulaciones = new Map();
  const hoyISO = hoy();
  const manana = new Date(); manana.setDate(manana.getDate() + 1);
  const mananaISO = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, "0")}-${String(manana.getDate()).padStart(2, "0")}`;

  const estado = await estadoPorLoteDosisUnica(
    [
      { id: "vence-hoy", fechaVencimiento: hoyISO },
      { id: "vence-mañana", fechaVencimiento: mananaISO },
    ],
    { anulaciones, prefijo: "lote_", hoyISO }
  );
  assert.equal(estado.get("vence-hoy").estado, "vencido", "vence HOY mismo -- ya no disponible, inclusive");
  assert.equal(estado.get("vence-mañana").estado, "disponible");
});

// fechaVencimiento es OBLIGATORIO en firestore.rules#mibgLoteValido (ningún
// camino de la app real puede crear un lote sin él) -- para probar este
// caso contra un documento REAL (no un mapa a mano), se escribe directo con
// firebase-admin, bypaseando las reglas, SOLO contra el emulador local
// (nunca contra staging/producción -- guardado explícito más abajo). Mismo
// patrón ya usado en fixtures.mjs#bootstrapAdminEnEmulador para simular
// datos reales malformados (ej. de un esquema viejo).
async function crearLoteSinVencimientoDirecto(sedeId, numeroLote) {
  if (process.env.USE_FIRESTORE_EMULATOR !== "1") {
    throw new Error("crearLoteSinVencimientoDirecto sólo corre contra el emulador local -- nunca contra staging/producción.");
  }
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "radiofarm-fuesmen-staging" });
  const ref = getFirestore().collection("mibg_lote").doc();
  await ref.set({
    sedeId, isotopoId: "lutecio177", numeroLote, proveedor: "Tecnonuclear",
    actividadCalibrada: 150, volumen: 10, conformidad: true,
    usuarioEmail: PERSONAS.tecnicoA.email,
    // fechaVencimiento DELIBERADAMENTE ausente.
  });
  return ref.id;
}

test("estadoPorLoteDosisUnica: lote SIN fechaVencimiento (dato malformado real) -- 'sin-vencimiento', nunca 'disponible' en silencio", async () => {
  const loteId = await crearLoteSinVencimientoDirecto(SEDE_A, `SINVENC-${Date.now()}`);
  const anulaciones = new Map();
  const estado = await estadoPorLoteDosisUnica([{ id: loteId, fechaVencimiento: undefined }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteId).estado, "sin-vencimiento");
});

test("estadoPorLoteDosisUnica: sede ajena -- un lote de OTRA sede nunca llega a la función (lo saca el query de sede, igual que listenMibgLotes)", async () => {
  await loguearComo(PERSONAS.tecnicoB); // SEDE_B
  const numeroLoteB = `SELECTOR-SEDEB-${Date.now()}`;
  await addMibgLote({
    sedeId: SEDE_B, sedeNombre: "C. Gamma Hospital Italiano", isotopoId: "lutecio177",
    numeroLote: numeroLoteB, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoB.nombre, usuarioEmail: PERSONAS.tecnicoB.email, observacion: "",
  });

  await loguearComo(PERSONAS.tecnicoA); // SEDE_A
  const numeroLoteA = `SELECTOR-SEDEA-${Date.now()}`;
  const loteARef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote: numeroLoteA, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  // Mismo query que listenMibgLotes -- scopeado a SEDE_A, igual que la app real.
  const snapA = await getDocs(query(collection(db, "mibg_lote"), where("sedeId", "==", SEDE_A)));
  const lotesSedeA = snapA.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.numeroLote === numeroLoteA);

  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const { disponibles } = await lotesDisponiblesParaAdministrar(lotesSedeA, { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.deepEqual(disponibles.map((l) => l.id), [loteARef.id]);
  assert.ok(!disponibles.some((l) => l.numeroLote === numeroLoteB), "el lote de SEDE_B nunca debería aparecer -- ni siquiera llegó a la función");
});

test("estadoPorLoteDosisUnica: MIBG con el mismo criterio (prefijo 'mibg_') -- usado no aparece, uso anulado reaparece", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `SELECTOR-MIBG-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "mibg",
    numeroLote, proveedor: "IPEN", actividadCalibrada: 20, volumen: 2,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarMibgTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Selector MIBG", pacienteDni: "3",
    numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  let anulaciones = await anulacionesComoMapa(SEDE_A);
  let { disponibles } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "mibg_", hoyISO: hoy() });
  assert.equal(disponibles.length, 0, "usado -- no disponible");

  const usoId = `mibg_${loteRef.id}_1`;
  const usoSnap = await getDoc(doc(db, "actas", usoId));
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: usoId, ...usoSnap.data() }, "Error de carga", PERSONAS.admin);

  anulaciones = await anulacionesComoMapa(SEDE_A);
  ({ disponibles } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "mibg_", hoyISO: hoy() }));
  assert.deepEqual(disponibles.map((l) => l.id), [loteRef.id], "uso anulado -- vuelve a estar disponible");
});

// Mismo escenario ya confirmado antes (ver test de usoActivoDeLote, sede
// desalineada): si sedeAuditando del admin no coincide con la sede real de
// la acta de uso, getDoc rechaza con permission-denied real. El helper
// tiene que fallar CERRADO -- ese lote queda en noVerificables, nunca en
// disponibles.
test("estadoPorLoteDosisUnica: admin con sedeAuditando en OTRA sede -- el lote queda 'no-verificable', NUNCA 'disponible'", async () => {
  await loguearComo(PERSONAS.tecnicoA); // SEDE_A
  const numeroLote = `SELECTOR-NOVERIF-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente No Verificable", pacienteDni: "4",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_B); // DESALINEADO a propósito

  const estado = await estadoPorLoteDosisUnica([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones: new Map(), prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteRef.id).estado, "no-verificable");
  assert.ok(estado.get(loteRef.id).error, "tiene que guardar el error real, para poder mostrar un mensaje claro");

  const { disponibles, noVerificables } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones: new Map(), prefijo: "lote_", hoyISO: hoy() });
  assert.equal(disponibles.length, 0, "nunca disponible por default -- falla CERRADO");
  assert.deepEqual(noVerificables.map((l) => l.id), [loteRef.id]);

  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
});

// ===========================================================================
// Verificación explícita como TÉCNICO de su propia sede (no admin) -- pedido
// de Pablo (9/11): todos los tests de arriba usan tecnicoA para ESCRIBIR
// (addMibgLote/administrarLutecioTransaction), pero varios dejan la sesión
// logueada como admin (tras anularActaTransaction, que exige isAdmin() --
// ver actaValida() en firestore.rules) en el momento de LEER
// estadoPorLoteDosisUnica/lotesDisponiblesParaAdministrar. Estos 5 tests
// relogean explícitamente como tecnicoA (o tecnicoB) ANTES de cada lectura,
// para confirmar contra el emulador real que el técnico mismo -- no sólo el
// admin -- puede resolver los 5 estados sin permission-denied.
// ===========================================================================

test("TÉCNICO (no admin): lote disponible (nunca usado) -- 'disponible', leído logueado como técnico", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TECNICO-DISPONIBLE-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  // Sigue logueado como tecnicoA -- la lectura ocurre con esa sesión.
  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const estado = await estadoPorLoteDosisUnica([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteRef.id).estado, "disponible");
});

test("TÉCNICO (no admin): lote usado -- 'usado' con el uso real, leído logueado como técnico", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TECNICO-USADO-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Técnico Usado", pacienteDni: "11",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  // Sigue logueado como tecnicoA -- la lectura ocurre con esa sesión.
  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const estado = await estadoPorLoteDosisUnica([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteRef.id).estado, "usado");
  assert.equal(estado.get(loteRef.id).uso?.pacienteNombre, "Paciente Técnico Usado");
});

test("TÉCNICO (no admin): uso ANULADO (por admin) -- el técnico lo vuelve a ver 'disponible'", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TECNICO-USOANUL-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  await administrarLutecioTransaction(loteRef.id, {
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central",
    pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Técnico Uso Anulado", pacienteDni: "12",
    peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
    isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Test",
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });
  const usoId = `lote_${loteRef.id}_1`;
  const usoSnap = await getDoc(doc(db, "actas", usoId));

  // Anular EXIGE isAdmin() (actaValida(), firestore.rules) -- el técnico no
  // puede hacerlo, por eso acá cambia a admin sólo para este paso.
  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: usoId, ...usoSnap.data() }, "Error de carga", PERSONAS.admin);

  // Vuelve a loguearse como TÉCNICO antes de leer -- a diferencia del test
  // equivalente de arriba (uso ANULADO, sin relogear), acá la lectura real
  // ocurre con la sesión del técnico, no la del admin.
  await loguearComo(PERSONAS.tecnicoA);
  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const { disponibles } = await lotesDisponiblesParaAdministrar([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.deepEqual(disponibles.map((l) => l.id), [loteRef.id], "con el uso anulado, el técnico tiene que volver a ver el lote disponible");
});

test("TÉCNICO (no admin): lote ANULADO (por admin) -- el técnico lo ve 'anulado', nunca disponible", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const numeroLote = `TECNICO-LOTEANUL-${Date.now()}`;
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  await loguearComo(PERSONAS.admin);
  await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  await anularActaTransaction({ id: loteRef.id, sedeId: SEDE_A }, "Lote mal cargado", PERSONAS.admin);

  // Vuelve a loguearse como TÉCNICO antes de leer.
  await loguearComo(PERSONAS.tecnicoA);
  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const estado = await estadoPorLoteDosisUnica([{ id: loteRef.id, fechaVencimiento: "2027-06-01" }], { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.equal(estado.get(loteRef.id).estado, "anulado");
});

test("TÉCNICO (no admin): lote de OTRA sede -- el query de sede lo excluye, Y la regla rechaza un intento de lectura directa por id", async () => {
  await loguearComo(PERSONAS.tecnicoB); // SEDE_B
  const numeroLoteB = `TECNICO-SEDEB-${Date.now()}`;
  const loteBRef = await addMibgLote({
    sedeId: SEDE_B, sedeNombre: "C. Gamma Hospital Italiano", isotopoId: "lutecio177",
    numeroLote: numeroLoteB, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoB.nombre, usuarioEmail: PERSONAS.tecnicoB.email, observacion: "",
  });

  await loguearComo(PERSONAS.tecnicoA); // SEDE_A
  const numeroLoteA = `TECNICO-SEDEA-${Date.now()}`;
  const loteARef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote: numeroLoteA, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-06-01", conformidad: true,
    usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
  });

  // Mismo query que listenMibgLotes -- scopeado a SEDE_A: el lote de SEDE_B
  // ni siquiera llega a estadoPorLoteDosisUnica.
  const snapA = await getDocs(query(collection(db, "mibg_lote"), where("sedeId", "==", SEDE_A)));
  const lotesSedeA = snapA.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.numeroLote === numeroLoteA);
  const anulaciones = await anulacionesComoMapa(SEDE_A);
  const { disponibles } = await lotesDisponiblesParaAdministrar(lotesSedeA, { anulaciones, prefijo: "lote_", hoyISO: hoy() });
  assert.deepEqual(disponibles.map((l) => l.id), [loteARef.id]);
  assert.ok(!disponibles.some((l) => l.numeroLote === numeroLoteB), "el lote de SEDE_B nunca debería aparecer -- ni siquiera llegó a la función");

  // Chequeo de la REGLA en sí, no sólo del query: un intento directo de leer
  // por id el mibg_lote de SEDE_B, logueado como tecnicoA, tiene que
  // rechazar con permission-denied (mibg_lote: 'tecnico' exige
  // resource.data.sedeId == miRol().sede, ver firestore.rules).
  try {
    await getDoc(doc(db, "mibg_lote", loteBRef.id));
    assert.fail("se esperaba permission-denied al leer directo un mibg_lote de otra sede");
  } catch (e) {
    assert.equal(e.code, "permission-denied", `código inesperado: ${e.code} (${e.message})`);
  }
});

test("disponiblesDesdeEstadoPorLote / lotesDisponiblesParaAdministrar: orden por vencimiento, el que vence antes primero", async () => {
  await loguearComo(PERSONAS.tecnicoA);
  const lotes = [];
  for (const [sufijo, vencimiento] of [["C", "2027-03-01"], ["A", "2027-01-01"], ["B", "2027-02-01"]]) {
    const numeroLote = `SELECTOR-ORDEN-${sufijo}-${Date.now()}`;
    const loteRef = await addMibgLote({
      sedeId: SEDE_A, sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
      numeroLote, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
      fechaHoraCalibracion: new Date(), fechaVencimiento: vencimiento, conformidad: true,
      usuarioNombre: PERSONAS.tecnicoA.nombre, usuarioEmail: PERSONAS.tecnicoA.email, observacion: "",
    });
    lotes.push({ id: loteRef.id, fechaVencimiento: vencimiento });
  }

  const { disponibles } = await lotesDisponiblesParaAdministrar(lotes, { anulaciones: new Map(), prefijo: "lote_", hoyISO: hoy() });
  assert.deepEqual(disponibles.map((l) => l.fechaVencimiento), ["2027-01-01", "2027-02-01", "2027-03-01"]);
});

// Caso real de staging (9/11): la premisa "fecha null = recién guardado,
// pendiente" resultó falsa para datos ya almacenados (322/341 lotes de
// Lutecio-177 con fecha null PERMANENTE, nunca pending). El arreglo real fue
// en listenMibgLotes (mibgLotes.js): leer con serverTimestamps:"estimate" --
// este test confirma, contra el emulador real, que la PRIMERA emisión de un
// lote recién escrito (todavía sin ack del servidor) ya trae una fecha
// estimada, nunca null.
test("listenMibgLotes: la primera emisión de un lote recién escrito (todavía sin confirmar por el servidor) NO trae fecha null", async () => {
  await loguearComo(PERSONAS.admin);
  const loteNum = loteDePrueba();

  let unsub;
  const primeraEmisionConElLote = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("timeout esperando la primera emisión con el lote nuevo")), 10000);
    unsub = listenMibgLotes((lotes) => {
      const encontrado = lotes.find((l) => l.numeroLote === loteNum);
      if (encontrado) { clearTimeout(timeoutId); resolve(encontrado); }
    }, { sedeId: SEDE_A });
  });

  // SIN await -- a propósito: el listener ya está activo (arriba) antes de
  // que la escritura exista siquiera, para poder observar la emisión desde
  // el caché local (la escritura pendiente, previa al ack del servidor),
  // que es justo lo que este test necesita capturar.
  addMibgLote({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], isotopoId: "lutecio177",
    numeroLote: loteNum, proveedor: "Prueba", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-01-01", conformidad: true,
    usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "",
  });

  const lote = await primeraEmisionConElLote;
  unsub();

  assert.notEqual(lote.fecha, null, "fecha no debería ser null en la primera emisión -- serverTimestamps:'estimate' tiene que devolver una fecha estimada");
  assert.ok(lote.fecha, "fecha tiene que ser un valor truthy (Timestamp estimado), no null/undefined");
});

// Pregunta de Pablo, SOLO VERIFICACIÓN (no se arregla nada acá): el picker
// de TabPacientes.jsx ya bloquea del lado del cliente que un admin con
// sedeAuditando distinta de su sede de trabajo pueda elegir un lote
// (sedeAuditandoDistinta, sin ofrecer ninguno) -- esto prueba qué pasa si
// administrarMibgTransaction/administrarLutecioTransaction se llamaran
// igual (otro cliente, un bug futuro, etc.), contra el emulador real, no
// por lectura de código. administrarLoteDosisUnicaTransaction (mibgLotes.js)
// hace tx.get(loteRef) sobre mibg_lote -- ese read, para un admin, sólo lo
// permite firestore.rules si resource.data.sedeId == sedeAuditando.
test("administrarMibgTransaction: admin con sedeAuditando en OTRA sede -- resultado real contra el emulador", async () => {
  await loguearComo(PERSONAS.admin);
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], isotopoId: "mibg",
    numeroLote: loteDePrueba(), proveedor: "Prueba", actividadCalibrada: 20, volumen: 2,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-01-01", conformidad: true,
    usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "",
  });

  await setSedeAuditando(PERSONAS.admin.email, SEDE_B); // DESALINEADO a propósito, igual que el caso real
  try {
    // Resultado real confirmado contra el emulador: rechaza -- pero con el
    // mensaje AMIGABLE de conMensajeDeContingencia (helpers/erroresRed.js),
    // no el "permission-denied" crudo -- confirma que la causa real es de
    // permisos (tx.get(loteRef) sobre mibg_lote, gateado por sedeAuditando
    // para un admin), sin asumir el formato exacto del mensaje.
    await assert.rejects(
      () => administrarMibgTransaction(loteRef.id, {
        sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A],
        pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Admin Desalineado MIBG", pacienteDni: "SEDEDESALIN1",
        usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "",
      }),
      /no tiene permiso/i
    );
  } finally {
    await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  }
});

test("administrarLutecioTransaction: admin con sedeAuditando en OTRA sede -- resultado real contra el emulador", async () => {
  await loguearComo(PERSONAS.admin);
  const loteRef = await addMibgLote({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], isotopoId: "lutecio177",
    numeroLote: loteDePrueba(), proveedor: "Prueba", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date(), fechaVencimiento: "2027-01-01", conformidad: true,
    usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "",
  });

  await setSedeAuditando(PERSONAS.admin.email, SEDE_B);
  try {
    // Mismo motivo/mismo formato de mensaje que MIBG -- ver comentario ahí.
    await assert.rejects(
      () => administrarLutecioTransaction(loteRef.id, {
        sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A],
        pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Admin Desalineado Lutecio", pacienteDni: "SEDEDESALIN2",
        peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
        isotopoId: "lu177", lote: loteRef.id, medicoResponsable: "Dr. Test",
        usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "",
      }),
      /no tiene permiso/i
    );
  } finally {
    await setSedeAuditando(PERSONAS.admin.email, SEDE_A);
  }
});
