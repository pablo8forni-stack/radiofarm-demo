// Área B: anulación atómica de transferencias (ambos legs juntos), incluida
// la doble anulación y el conflicto de dos anulaciones simultáneas sobre la
// misma transferencia. Ejercita anularTransferenciaTransaction real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { doc, getDoc } from "firebase/firestore";
import {
  PERSONAS, SEDE_A, SEDE_B, FARM_ID, db,
  loguearComo, crearLoteDirecto, borrarLote,
  prepararFixturesGlobales, buscarLotePorNumero, buscarMovimientos, cerrarConexiones,
} from "./fixtures.mjs";
import { transferenciaTransaction } from "../../src/services/firestore/stock.js";
import { anularTransferenciaTransaction } from "../../src/services/firestore/movimientos.js";
import { FARMS_DEFAULT } from "../../src/constants/farmsSeed.js";
import { uid } from "../../src/helpers/id.js";

const FARM = FARMS_DEFAULT.find((f) => f.id === FARM_ID);
const NOMBRE_SEDE = { [SEDE_A]: "FUESMEN Central", [SEDE_B]: "C. Gamma Hospital Italiano" };

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

async function crearTransferenciaDePrueba(cantidadInicial, cantidadTransferida) {
  await loguearComo(PERSONAS.admin);
  const { loteId } = await crearLoteDirecto(SEDE_A, FARM_ID, cantidadInicial);
  await transferenciaTransaction({
    sedeOrigenId: SEDE_A, sedeOrigenNombre: NOMBRE_SEDE[SEDE_A],
    sedeDestinoId: SEDE_B, sedeDestinoNombre: NOMBRE_SEDE[SEDE_B],
    farm: FARM, loteId, cantidad: cantidadTransferida, observacion: "", usuario: PERSONAS.admin, operacionId: uid(),
  });
  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  const loteNum = origenSnap.data().lote;
  const movs = await buscarMovimientos("lote", loteNum);
  const movSalida = movs.find((m) => m.tipo === "transferencia_salida");
  const movEntrada = movs.find((m) => m.tipo === "transferencia_entrada");
  const destinoLote = await buscarLotePorNumero(SEDE_B, loteNum);
  return { loteId, loteNum, movSalida, movEntrada, destinoLoteId: destinoLote.id };
}

test("anular transferencia (desde la punta de salida): revierte stock en origen y destino, crea 2 anulaciones", async () => {
  const { loteId, loteNum, movSalida, movEntrada, destinoLoteId } = await crearTransferenciaDePrueba(8, 3);

  await anularTransferenciaTransaction(movSalida, "Test anulación", PERSONAS.admin, "Anula transferencia de prueba");

  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(origenSnap.data().cantidad, 8, "el origen debería recuperar su cantidad inicial");

  const destinoSnap = await getDoc(doc(db, "sedes", SEDE_B, "lotes", destinoLoteId));
  assert.equal(destinoSnap.data().cantidad, 0, "el destino debería quedar en 0");

  const anulaciones = (await buscarMovimientos("lote", loteNum)).filter((m) => m.tipo === "anulacion");
  assert.equal(anulaciones.length, 2, "debería haber una anulación por cada punta");
  assert.ok(anulaciones.some((a) => a.anulaId === movSalida.id));
  assert.ok(anulaciones.some((a) => a.anulaId === movEntrada.id));

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLoteId);
});

test("anular transferencia (desde la punta de entrada): funciona igual que desde la de salida", async () => {
  const { loteId, movEntrada, destinoLoteId } = await crearTransferenciaDePrueba(6, 2);

  await anularTransferenciaTransaction(movEntrada, "Test anulación", PERSONAS.admin, "Anula transferencia de prueba");

  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(origenSnap.data().cantidad, 6);
  const destinoSnap = await getDoc(doc(db, "sedes", SEDE_B, "lotes", destinoLoteId));
  assert.equal(destinoSnap.data().cantidad, 0);

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLoteId);
});

test("anular transferencia: rechaza si ya fue anulada", async () => {
  const { loteId, movSalida, destinoLoteId } = await crearTransferenciaDePrueba(5, 2);

  await anularTransferenciaTransaction(movSalida, "Primera anulación", PERSONAS.admin, "motivo");
  await assert.rejects(
    () => anularTransferenciaTransaction(movSalida, "Segunda anulación", PERSONAS.admin, "motivo"),
    (err) => /ya fue anulada/i.test(err.message)
  );

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLoteId);
});

test("anular transferencia: conflicto -- dos anulaciones simultáneas de la misma transferencia, una sola se aplica", async () => {
  const { loteId, movSalida, destinoLoteId } = await crearTransferenciaDePrueba(9, 4);

  const intento = () => anularTransferenciaTransaction(movSalida, "concurrente", PERSONAS.admin, "motivo");
  const resultados = await Promise.allSettled([intento(), intento()]);
  const exitosos = resultados.filter((r) => r.status === "fulfilled");
  const fallidos = resultados.filter((r) => r.status === "rejected");
  assert.equal(exitosos.length, 1, "sólo una de las dos anulaciones debería tener éxito");
  assert.equal(fallidos.length, 1);
  assert.match(fallidos[0].reason.message, /ya fue anulada|actividad/i);

  const origenSnap = await getDoc(doc(db, "sedes", SEDE_A, "lotes", loteId));
  assert.equal(origenSnap.data().cantidad, 9, "el stock debería revertirse una sola vez, no dos");

  await borrarLote(SEDE_A, loteId);
  await borrarLote(SEDE_B, destinoLoteId);
});
