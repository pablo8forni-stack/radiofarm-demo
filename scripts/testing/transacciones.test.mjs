// Área A: las 3 transacciones atómicas (ingreso, egreso, transferencia) en
// casos normales y de conflicto (dos operaciones simultáneas sobre el mismo
// lote). Ejercita directamente las funciones reales de src/services/firestore/stock.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { doc, getDoc } from "firebase/firestore";
import {
  PERSONAS, SEDE_A, SEDE_B, FARM_ID, db,
  loguearComo, crearLoteDirecto, borrarLote, loteDePrueba,
  prepararFixturesGlobales, buscarLotePorNumero, buscarMovimientos, cerrarConexiones,
} from "./fixtures.mjs";
import { egresoTransaction, ingresoBatch, transferenciaTransaction } from "../../src/services/firestore/stock.js";
import { FARMS_DEFAULT } from "../../src/constants/farmsSeed.js";
import { uid } from "../../src/helpers/id.js";

const FARM = FARMS_DEFAULT.find((f) => f.id === FARM_ID);
const NOMBRE_SEDE = { [SEDE_A]: "FUESMEN Central", [SEDE_B]: "C. Gamma Hospital Italiano" };

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

test("ingreso: crea lote nuevo con la cantidad indicada y su movimiento", async () => {
  await loguearComo(PERSONAS.admin);
  const loteNum = loteDePrueba();

  await ingresoBatch({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, lote: loteNum,
    vencimiento: "2027-01-01", cantidad: 10, kits: null, proveedorNombre: "Proveedor Principal",
    observacion: "", usuario: PERSONAS.admin,
  });

  const lote = await buscarLotePorNumero(SEDE_A, loteNum);
  assert.ok(lote, "el lote debería existir");
  assert.equal(lote.cantidad, 10);

  const movs = await buscarMovimientos("lote", loteNum);
  const ingreso = movs.find((m) => m.tipo === "ingreso");
  assert.ok(ingreso, "debería haber un movimiento de ingreso");
  assert.equal(ingreso.cantidad, 10);
  assert.equal(ingreso.sedeId, SEDE_A);
  assert.equal(ingreso.loteId, lote.id);

  await borrarLote(SEDE_A, lote.id);
});

test("egreso: descuenta stock del lote en la propia sede del técnico", async () => {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, 5);

  await loguearComo(PERSONAS.tecnicoA);
  await egresoTransaction({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, loteId,
    cantidad: 2, motivo: "Estudio", observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
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
  const intento = () => egresoTransaction({
    sedeId: SEDE_A, sedeNombre: NOMBRE_SEDE[SEDE_A], farm: FARM, loteId,
    cantidad: 3, motivo: "Estudio", observacion: "", usuario: PERSONAS.tecnicoA, operacionId: uid(),
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
