// Reproduce de forma determinística la carrera real encontrada con
// evidencia de Firebase Console en TabPacientes.jsx#resolverYSetFichaEstado:
// precargarSugerenciaFicha dispara un chequeo con la ficha SUGERIDA al
// abrir el formulario (llamada A); si la técnica sobreescribe de inmediato
// con la ficha REAL de un paciente atrasado, arranca una segunda consulta
// (llamada B) mientras la primera sigue en vuelo. Nada garantiza el orden
// en que Firestore responde -- si B (la que importa) resuelve ANTES que A
// (ya obsoleta), una implementación sin guard deja que la respuesta tardía
// de A pise el resultado bueno de B.
//
// No depende de timing real de red ni de setTimeout -- usa promesas
// controladas a mano (crearDiferida) para forzar el orden de resolución
// exacto que se quiere probar, sin margen para que "por suerte" salga bien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearGuardDeSecuencia } from "../../src/helpers/guardSecuencia.js";

function crearDiferida() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

// Misma forma que resolverYSetFichaEstado: empezar() al arrancar, await del
// trabajo async, esVigente(miId) antes de aplicar el resultado.
async function simularChequeo(guard, deferida, aplicarResultado) {
  const miId = guard.empezar();
  const resultado = await deferida.promesa;
  if (!guard.esVigente(miId)) return;
  aplicarResultado(resultado);
}

test("guard de secuencia: una respuesta tardía de la llamada vieja (A) no pisa el resultado de la llamada nueva (B) que ya resolvió", async () => {
  const guard = crearGuardDeSecuencia();
  let estadoAplicado = null;
  const aplicar = (r) => { estadoAplicado = r; };

  const llamadaA = crearDiferida(); // ficha SUGERIDA -- arranca primero
  const llamadaB = crearDiferida(); // ficha REAL -- arranca después

  // A arranca primero (empezar() le asigna el id más chico).
  const promesaA = simularChequeo(guard, llamadaA, aplicar);
  // B arranca después (empezar() le asigna el id más nuevo) -- mientras A
  // sigue en vuelo, exactamente como precargarSugerenciaFicha seguida de
  // inmediato por el blur de la técnica con la ficha real.
  const promesaB = simularChequeo(guard, llamadaB, aplicar);

  // B resuelve PRIMERO a propósito -- la consulta de la ficha real llega
  // antes que la de la sugerida, aunque haya arrancado después.
  llamadaB.resolver("atrasoDetectado=true (ficha real)");
  await promesaB;
  assert.equal(estadoAplicado, "atrasoDetectado=true (ficha real)", "el resultado de B (la llamada más nueva) debe quedar aplicado");

  // A resuelve DESPUÉS -- llega tarde. Sin el guard, esto pisaría el
  // resultado bueno de B con el de una ficha que ya no es la que está en
  // pantalla (el bug real encontrado en Firebase Console).
  llamadaA.resolver("atrasoDetectado=false (ficha sugerida, obsoleta)");
  await promesaA;
  assert.equal(estadoAplicado, "atrasoDetectado=true (ficha real)", "la respuesta tardía de A (obsoleta) NO debe pisar el resultado de B");
});

test("guard de secuencia: sin superposición, una sola llamada siempre queda vigente y aplica su resultado", async () => {
  const guard = crearGuardDeSecuencia();
  let estadoAplicado = null;
  const aplicar = (r) => { estadoAplicado = r; };

  const llamada = crearDiferida();
  const promesa = simularChequeo(guard, llamada, aplicar);
  llamada.resolver("atrasoDetectado=true");
  await promesa;

  assert.equal(estadoAplicado, "atrasoDetectado=true", "una única llamada sin ninguna otra en vuelo debe aplicar su propio resultado");
});

test("guard de secuencia: tres llamadas superpuestas -- sólo la última en arrancar puede quedar vigente, sin importar el orden de resolución", async () => {
  const guard = crearGuardDeSecuencia();
  let estadoAplicado = null;
  const aplicar = (r) => { estadoAplicado = r; };

  const llamada1 = crearDiferida();
  const llamada2 = crearDiferida();
  const llamada3 = crearDiferida();

  const promesa1 = simularChequeo(guard, llamada1, aplicar);
  const promesa2 = simularChequeo(guard, llamada2, aplicar);
  const promesa3 = simularChequeo(guard, llamada3, aplicar);

  // Resuelven en un orden distinto al que arrancaron (2, luego 1, luego 3).
  llamada2.resolver("resultado-2");
  await promesa2;
  assert.equal(estadoAplicado, null, "2 no es la última en arrancar -- no debe aplicar nada");

  llamada1.resolver("resultado-1");
  await promesa1;
  assert.equal(estadoAplicado, null, "1 tampoco es la última en arrancar -- no debe aplicar nada");

  llamada3.resolver("resultado-3");
  await promesa3;
  assert.equal(estadoAplicado, "resultado-3", "3 es la última en arrancar -- su resultado es el único que debe quedar aplicado");
});
