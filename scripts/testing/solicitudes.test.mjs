// Área D: flujo de solicitudes de acceso -- crear, aprobar, rechazar, y la
// carrera de doble solicitud simultánea (hallazgo #4, ya fijado en
// useAuth.js con un try/catch; acá se verifica el mecanismo de fondo).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { doc, deleteDoc } from "firebase/firestore";
import { PERSONAS, db, loguearComo, prepararFixturesGlobales, cerrarConexiones } from "./fixtures.mjs";
import { fetchRol, fetchSolicitud, crearSolicitud, aprobarSolicitud, eliminarSolicitud, eliminarRol } from "../../src/services/auth.js";

before(async () => { await prepararFixturesGlobales(); });
after(cerrarConexiones);

async function limpiarSinRol() {
  // roles/solicitudes sólo se pueden borrar siendo admin -- si el test
  // anterior dejó la sesión como sinRol (o técnico), estos deleteDoc
  // fallarían en silencio (.catch) y dejarían basura para el próximo test.
  await loguearComo(PERSONAS.admin);
  await deleteDoc(doc(db, "roles", PERSONAS.sinRol.email)).catch(() => {});
  await deleteDoc(doc(db, "solicitudes", PERSONAS.sinRol.email)).catch(() => {});
}

test("crear solicitud: usuario sin rol queda con una solicitud pendiente", async () => {
  await limpiarSinRol();
  await loguearComo(PERSONAS.sinRol);

  assert.equal(await fetchRol(PERSONAS.sinRol.email), null);
  assert.equal(await fetchSolicitud(PERSONAS.sinRol.email), null);

  await crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre);

  const solicitud = await fetchSolicitud(PERSONAS.sinRol.email);
  assert.ok(solicitud);
  assert.equal(solicitud.estado, "pendiente");
  assert.equal(solicitud.nombre, PERSONAS.sinRol.nombre);

  await limpiarSinRol();
});

test("doble solicitud simultánea: una de las dos escrituras falla, el doc final queda consistente", async () => {
  await limpiarSinRol();
  await loguearComo(PERSONAS.sinRol);

  const resultados = await Promise.allSettled([
    crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre),
    crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre),
  ]);
  const exitosos = resultados.filter((r) => r.status === "fulfilled");
  const fallidos = resultados.filter((r) => r.status === "rejected");
  // Firestore trata el segundo setDoc sobre un doc ya existente como
  // "update" (prohibido por la regla) -- por eso, a diferencia de los
  // "conflictos" de stock, acá SIEMPRE falla exactamente uno de los dos, no
  // es una carrera que pueda resolver las dos veces bien. Esto es justamente
  // lo que useAuth.js ahora atrapa con un try/catch (hallazgo #4).
  assert.equal(exitosos.length, 1, "sólo una de las dos creaciones debería tener éxito");
  assert.equal(fallidos.length, 1);
  assert.equal(fallidos[0].reason.code, "permission-denied");

  const solicitud = await fetchSolicitud(PERSONAS.sinRol.email);
  assert.ok(solicitud, "el doc final debería existir de todos modos");
  assert.equal(solicitud.estado, "pendiente");

  await limpiarSinRol();
});

test("aprobar solicitud: crea el rol y borra la solicitud", async () => {
  await limpiarSinRol();
  await loguearComo(PERSONAS.sinRol);
  await crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre);

  await loguearComo(PERSONAS.admin);
  await aprobarSolicitud(PERSONAS.sinRol.email, { nombre: PERSONAS.sinRol.nombre, rol: "tecnico", sede: "central" });

  const rol = await fetchRol(PERSONAS.sinRol.email);
  assert.ok(rol);
  assert.equal(rol.rol, "tecnico");

  const solicitud = await fetchSolicitud(PERSONAS.sinRol.email);
  assert.equal(solicitud, null, "la solicitud debería haberse borrado al aprobar");

  await eliminarRol(PERSONAS.sinRol.email);
});

test("rechazar solicitud: borra la solicitud y no otorga rol", async () => {
  await limpiarSinRol();
  await loguearComo(PERSONAS.sinRol);
  await crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre);

  await loguearComo(PERSONAS.admin);
  await eliminarSolicitud(PERSONAS.sinRol.email);

  const solicitud = await fetchSolicitud(PERSONAS.sinRol.email);
  assert.equal(solicitud, null);
  const rol = await fetchRol(PERSONAS.sinRol.email);
  assert.equal(rol, null, "rechazar no debería otorgar acceso");
});

test("aprobar y rechazar casi simultáneo sobre la misma solicitud: converge a un estado consistente", async () => {
  await limpiarSinRol();
  await loguearComo(PERSONAS.sinRol);
  await crearSolicitud(PERSONAS.sinRol.email, PERSONAS.sinRol.nombre);

  await loguearComo(PERSONAS.admin);
  const resultados = await Promise.allSettled([
    aprobarSolicitud(PERSONAS.sinRol.email, { nombre: PERSONAS.sinRol.nombre, rol: "tecnico", sede: "central" }),
    eliminarSolicitud(PERSONAS.sinRol.email),
  ]);
  assert.ok(resultados.every((r) => r.status === "fulfilled"), "ninguna de las dos operaciones debería lanzar sin manejar");

  const rol = await fetchRol(PERSONAS.sinRol.email);
  const solicitud = await fetchSolicitud(PERSONAS.sinRol.email);
  // aprobarSolicitud no chequea si la solicitud sigue viva antes de otorgar
  // el rol -- por diseño actual (hallazgo #10, diferido) esta carrera SIEMPRE
  // converge a "rol otorgado + solicitud borrada", nunca ambas cosas ni
  // ninguna. Lo que puede quedar engañoso es el toast que ve el admin que
  // "rechazó" -- eso es UX, no un problema de datos.
  assert.ok(rol, "el rol debería haberse otorgado");
  assert.equal(solicitud, null, "la solicitud debería haber quedado borrada");

  await eliminarRol(PERSONAS.sinRol.email);
});
