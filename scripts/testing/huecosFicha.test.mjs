// Cartel de fichas faltantes (Libro 2) -- tests puros del cálculo de huecos
// y de fichas sospechosas (mal tipeadas), sin Firestore (ver
// src/helpers/huecosFicha.js). Reproducen con fechas controladas a mano los
// casos reales que Pablo confirmó: ventana de 48hs, ficha anulada sin
// recarga cuenta como hueco, descarte la excluye, descarte deshecho la
// vuelve a incluir, fichas aisladas (UMBRAL_SOSPECHA) excluidas de los
// huecos, tramos grandes (UMBRAL_SALTO_GRANDE) agrupados en vez de
// listados, MAX_HUECO_RAZONABLE como tope de seguridad.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularHuecos, calcularFichasSospechosas, calcularFichasSospechosasDelMes,
  formatearListaFichas, UMBRAL_SOSPECHA, UMBRAL_SALTO_GRANDE,
} from "../../src/helpers/huecosFicha.js";

const SEDE = "central";
const HORA = 60 * 60 * 1000;
const AHORA = new Date("2026-10-04T15:00:00Z");

function ficha(numero, horasAtras, intento = "1", overrides = {}) {
  return {
    sedeId: SEDE, pacienteFicha: String(numero), pacienteFichaNum: numero, fichaIntentoNro: intento,
    fecha: new Date(AHORA.getTime() - horasAtras * HORA),
    ...overrides,
  };
}

function anulacionFicha(numero, intento) {
  return { sedeId: SEDE, anulaId: `ficha_${SEDE}_${numero}_${intento}` };
}

function descarte(numero, horasAtras, intento = "1") {
  return { sedeId: SEDE, numero, intentoNro: intento, fecha: new Date(AHORA.getTime() - horasAtras * HORA) };
}

function anulacionDescarte(numero, intento) {
  return { sedeId: SEDE, anulaId: `descarte_${SEDE}_${numero}_${intento}` };
}

test("hueco simple: 105 y 106 faltan entre 104 y 107 (107 reciente)", () => {
  const fichasUsadas = [ficha(104, 10), ficha(107, 1)];
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, [105, 106]);
  assert.deepEqual(saltosGrandes, []);
});

test("sin ningún hueco: números consecutivos no generan nada", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 5), ficha(106, 1)];
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
});

test("menos de 2 fichas activas: no hay rango que evaluar, sin huecos", () => {
  assert.deepEqual(calcularHuecos([ficha(104, 1)], [], [], SEDE, AHORA), { huecos: [], saltosGrandes: [] });
  assert.deepEqual(calcularHuecos([], [], [], SEDE, AHORA), { huecos: [], saltosGrandes: [] });
});

test("ningún número por encima de la ficha más alta activa es hueco (no se detecta el final del día)", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 1)];
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
});

test("ventana de 48hs: si la ficha superior ya tiene 48hs o más, el hueco deja de reclamarse", () => {
  const fichasUsadas = [ficha(104, 60), ficha(107, 49)]; // 107 cargada hace 49hs
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, [], "con la superior a 49hs (>=48) el hueco ya no se reclama");
});

test("control positivo: con la ficha superior a menos de 48hs, el hueco SÍ se reclama", () => {
  const fichasUsadas = [ficha(104, 60), ficha(107, 47.9)];
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, [105, 106]);
});

test("ficha anulada sin recarga cuenta como hueco (mismo criterio que fichaIntentoHabilitado)", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 8, "1"), ficha(107, 1)];
  const anulaciones = [anulacionFicha(105, "1")];
  const { huecos } = calcularHuecos(fichasUsadas, anulaciones, [], SEDE, AHORA);
  assert.deepEqual(huecos, [105, 106]);
});

test("ficha anulada y SÍ recargada con un intento nuevo no cuenta como hueco", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 8, "1"), ficha(105, 2, "2"), ficha(107, 1)];
  const anulaciones = [anulacionFicha(105, "1")];
  const { huecos } = calcularHuecos(fichasUsadas, anulaciones, [], SEDE, AHORA);
  assert.deepEqual(huecos, [106]);
});

test("descarte vigente excluye el número del listado de huecos", () => {
  const fichasUsadas = [ficha(104, 10), ficha(107, 1)];
  const fichasDescartadas = [descarte(105, 5)];
  const { huecos } = calcularHuecos(fichasUsadas, [], fichasDescartadas, SEDE, AHORA);
  assert.deepEqual(huecos, [106], "105 está descartada, 106 sigue siendo un hueco real");
});

test("descarte deshecho (anulado) vuelve a incluir el número como hueco", () => {
  const fichasUsadas = [ficha(104, 10), ficha(107, 1)];
  const fichasDescartadas = [descarte(105, 5)];
  const anulaciones = [anulacionDescarte(105, "1")];
  const { huecos } = calcularHuecos(fichasUsadas, anulaciones, fichasDescartadas, SEDE, AHORA);
  assert.deepEqual(huecos, [105, 106]);
});

test("re-descartar después de deshacer (intentoNro 2) vuelve a excluir el número", () => {
  const fichasUsadas = [ficha(104, 10), ficha(107, 1)];
  const fichasDescartadas = [descarte(105, 5, "1"), descarte(105, 1, "2")];
  const anulaciones = [anulacionDescarte(105, "1")];
  const { huecos } = calcularHuecos(fichasUsadas, anulaciones, fichasDescartadas, SEDE, AHORA);
  assert.deepEqual(huecos, [106]);
});

test("varios huecos en rangos distintos, simultáneos", () => {
  const fichasUsadas = [ficha(100, 20), ficha(103, 10), ficha(104, 10), ficha(108, 1)];
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, [101, 102, 105, 106, 107]);
});

test("formatearListaFichas: texto neutro, sin nombres", () => {
  assert.equal(formatearListaFichas([104]), "104");
  assert.equal(formatearListaFichas([104, 107]), "104 y 107");
  assert.equal(formatearListaFichas([104, 105, 107]), "104, 105 y 107");
  assert.equal(formatearListaFichas([]), "");
});

// --- UMBRAL_SOSPECHA (40): fichas aisladas no definen huecos ---

test("una ficha aislada (dígitos de más) no define el techo de un hueco -- no fabrica huecos falsos", () => {
  // 104 y 105 son vecinas reales (distancia 1). 999999 está sola, a una
  // distancia enorme de 105 -- queda excluida como "aislada" antes de
  // formar pares, así que NO genera un hueco gigante entre 106 y 999998.
  const fichasUsadas = [ficha(104, 10), ficha(105, 9), ficha(999999, 1)];
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
  assert.deepEqual(saltosGrandes, []);
});

// Nota: para probar el límite EXACTO de aislamiento sin que
// UMBRAL_SALTO_GRANDE (15, bastante menor que 40) interfiera agrupando el
// tramo antes de llegar a la exclusión, uso calcularFichasSospechosas
// directo -- ahí "aislada sí/no" se ve sin pasar por la lógica de huecos.
test("justo en el umbral (distancia == 40) NO se considera aislada -- el umbral es estrictamente mayor", () => {
  const fichasUsadas = [ficha(100, 10), ficha(100 + UMBRAL_SOSPECHA, 1)]; // distancia exacta 40
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, [], "a distancia exacta 40 no se considera aislada todavía");
});

test("una unidad más del umbral (distancia == 41) SÍ se considera aislada -- ambos extremos, al no tener otro vecino", () => {
  const fichasUsadas = [ficha(100, 10), ficha(100 + UMBRAL_SOSPECHA + 1, 1)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, [100, 141], "100 y 141 son cada uno el único vecino del otro -- ambos quedan aislados");
});

// --- UMBRAL_SALTO_GRANDE (15): tramos grandes se agrupan, no se listan ---

test("un tramo de más de 15 faltantes se agrupa como 'salto grande', no se lista ficha por ficha", () => {
  // 100 y 101 son vecinas (no aisladas). 101 y 120 están a distancia 19
  // (> UMBRAL_SOSPECHA? no, 19 < 40, así que NINGUNA de las dos es
  // aislada) -- 18 faltantes, > UMBRAL_SALTO_GRANDE (15) -- se agrupa.
  const fichasUsadas = [ficha(100, 20), ficha(101, 10), ficha(120, 1)];
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
  assert.deepEqual(saltosGrandes, [{ inferior: 101, superior: 120, faltantes: 18 }]);
});

test("un tramo de exactamente 15 faltantes SÍ se lista completo (el umbral es estrictamente mayor)", () => {
  const fichasUsadas = [ficha(100, 20), ficha(101, 10), ficha(117, 1)]; // 15 faltantes (102..116)
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.equal(huecos.length, 15);
  assert.deepEqual(saltosGrandes, []);
});

test("un descarte NO reduce un salto grande por debajo del umbral -- sigue agrupado", () => {
  const fichasUsadas = [ficha(100, 20), ficha(101, 10), ficha(120, 1)];
  const fichasDescartadas = [descarte(105, 5)];
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], fichasDescartadas, SEDE, AHORA);
  assert.deepEqual(huecos, []);
  assert.deepEqual(saltosGrandes, [{ inferior: 101, superior: 120, faltantes: 18 }]);
});

// --- MAX_HUECO_RAZONABLE (500): tope de seguridad, ya no el mecanismo
// operativo principal (eso es UMBRAL_SALTO_GRANDE) -- hace falta un par
// de números que NO estén aislados entre sí (cada uno con otro vecino
// cercano) pero cuyo salto mutuo supere 500, para probarlo sin que la
// exclusión de aisladas lo intercepte antes.

test("bug real (Playwright/staging, 4/10): un salto astronómico ya ni siquiera llega a MAX_HUECO_RAZONABLE -- queda excluido antes, por aislado", () => {
  const fichasUsadas = [ficha(100, 60), ficha(9900000000000001, 1)];
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
  assert.deepEqual(saltosGrandes, [], "100 y el número gigante quedan aislados entre sí -- nunca llegan a formar un par");
});

test("tope de seguridad MAX_HUECO_RAZONABLE: un salto >500 entre dos números NO aislados (cada uno con otro vecino cercano) se ignora en silencio, ni se lista ni se agrupa", () => {
  const fichasUsadas = [
    ficha(100, 60), ficha(101, 55), // cluster bajo, vecinos entre sí (distancia 1)
    ficha(700, 10), ficha(701, 1), // cluster alto, vecinos entre sí (distancia 1)
  ];
  // 101 -> 700: 598 faltantes, supera MAX_HUECO_RAZONABLE (500).
  const { huecos, saltosGrandes } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, []);
  assert.deepEqual(saltosGrandes, [], "el tramo >500 se ignora directamente, no aparece ni como salto grande");
});

test("otra sede no se mezcla en el cálculo", () => {
  const fichasUsadas = [
    { ...ficha(104, 10), sedeId: "italiano" },
    { ...ficha(107, 1), sedeId: "italiano" },
  ];
  const { huecos } = calcularHuecos(fichasUsadas, [], [], SEDE, AHORA);
  assert.deepEqual(huecos, [], "fichasUsadas de otra sede no deben generar huecos para SEDE");
});

// --- calcularFichasSospechosas (aviso del cartel, vigente todo el día,
// vence a las 48hs -- Pablo, punto 3) ---

test("una ficha aislada reciente (<48hs) se marca sospechosa", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 9), ficha(999999, 1)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, [999999]);
});

test("una ficha NO aislada (con vecino cercano) nunca se marca sospechosa", () => {
  const fichasUsadas = [ficha(104, 10), ficha(105, 1)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, []);
});

test("el aviso de sospechosa VENCE a las 48hs -- un falso positivo no queda visible para siempre", () => {
  const fichasUsadas = [ficha(104, 60), ficha(999999, 49)]; // cargada hace 49hs
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, [], "pasadas las 48hs, deja de marcarse aunque nadie la haya anulado");
});

test("control positivo: una ficha aislada todavía dentro de las 48hs sigue marcada", () => {
  const fichasUsadas = [ficha(104, 60), ficha(999999, 47.9)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, [999999]);
});

test("sin ninguna otra ficha activa (sin referencia), no se evalúa -- nunca sospechosa", () => {
  const fichasUsadas = [ficha(104, 1)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, []);
});

test("anular el registro real hace que el aviso desaparezca solo (sin mecanismo nuevo)", () => {
  const fichasUsadas = [ficha(104, 10), ficha(999999, 1, "1")];
  const anulaciones = [anulacionFicha(999999, "1")];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, anulaciones, SEDE, AHORA);
  assert.deepEqual(sospechosas, [], "al anular el único intento de 999999, deja de estar activa -- no hay nada que marcar");
});

test("carga tardía legítima (ficha más baja, con otras fichas reales cerca de otro día) NO se marca sospechosa", () => {
  // Simula el caso real: hoy se cargaron 200/201, pero también se completa
  // tardíamente la 150 de un día anterior -- 150 tiene un vecino real (149)
  // a distancia 1, así que no es un número aislado aunque esté lejos de
  // 200/201 (lo más reciente).
  const fichasUsadas = [ficha(149, 72), ficha(150, 2), ficha(200, 1), ficha(201, 0.5)];
  const sospechosas = calcularFichasSospechosas(fichasUsadas, [], SEDE, AHORA);
  assert.deepEqual(sospechosas, []);
});

// --- calcularFichasSospechosasDelMes (control previo a la impresión
// mensual, Pablo punto 6/10) -- mismo núcleo, SIN ventana de tiempo, sobre
// actas ya cargadas en memoria (no fichasUsadas). ---

function actaDelMes(ficha, overrides = {}) {
  return { id: `acta-${ficha}`, pacienteFicha: String(ficha), ...overrides };
}

test("calcularFichasSospechosasDelMes: detecta una ficha aislada dentro del mes completo, sin ventana de tiempo", () => {
  const actas = [actaDelMes(104), actaDelMes(105), actaDelMes(999999)];
  const sospechosas = calcularFichasSospechosasDelMes(actas, new Map());
  assert.deepEqual(sospechosas, [999999]);
});

test("calcularFichasSospechosasDelMes: una acta anulada no cuenta ni como referencia ni como candidata", () => {
  const actas = [actaDelMes(104), actaDelMes(105, { id: "acta-105" }), actaDelMes(999999)];
  const anulaciones = new Map([["acta-105", { motivo: "Error" }]]);
  // Sin la 105 (anulada, no cuenta), 104 y 999999 quedan como único vecino
  // mutuo entre sí -- a esa distancia, las dos quedan aisladas.
  const sospechosas = calcularFichasSospechosasDelMes(actas, anulaciones);
  assert.deepEqual(sospechosas, [104, 999999]);
});

test("calcularFichasSospechosasDelMes: sin ninguna ficha aislada, lista vacía", () => {
  const actas = [actaDelMes(104), actaDelMes(105), actaDelMes(106)];
  const sospechosas = calcularFichasSospechosasDelMes(actas, new Map());
  assert.deepEqual(sospechosas, []);
});
