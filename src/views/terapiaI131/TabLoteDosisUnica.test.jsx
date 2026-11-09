// N° de vial (4/11): obligatorio en el FORMULARIO para Lutecio-177 (distingue
// viales de un mismo lote de producción, ver mibgLote.js#loteVialYaExiste),
// opcional para MIBG -- el servidor no lo exige en ninguno de los dos casos
// (campo opcional en firestore.rules, sin cambios ahí). Estos tests cubren
// sólo esa regla de UI, no el servicio real (mockeado).
import { describe, test, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabLoteDosisUnica } from "./TabLoteDosisUnica.jsx";

afterEach(cleanup);

function listenerCon(cb, datos = []) {
  cb(datos);
  return () => {};
}

vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (_tipo, cb) => listenerCon(cb, []),
  listenAnulacionesActas: (cb) => listenerCon(cb, []),
  anularActaTransaction: vi.fn(async () => {}),
}));

// estadoListadoLoteDosisUnica (paso 6, 9/11): default permisivo -- todo lote
// pasado resuelve "disponible" salvo que un test puntual lo sobrescriba con
// vi.spyOn. Los tests de ESTE bloque (N° de vial, mayúsculas, payload, etc.)
// nunca tienen lotes reales en listenMibgLotes (datos = [] por default), así
// que esta función ni siquiera llega a ejecutarse para ellos.
vi.mock("../../services/firestore/mibgLotes.js", () => ({
  listenMibgLotes: (cb) => listenerCon(cb, []),
  addMibgLote: vi.fn(async () => {}),
  estadoListadoLoteDosisUnica: vi.fn(async (lotes) => new Map(lotes.map((l) => [l.id, { estado: "disponible", uso: null, error: null }]))),
}));

const catalogo = {
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false, farmIds: [], puntosReorden: {} } },
};
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central" };
// Para los tests de esAdmin -- sin sedeAuditando, el componente muestra el
// aviso "Elegí qué sede vas a auditar" y nunca llega a renderizar la lista.
const usuarioAdmin = { nombre: "Admin Test", email: "admin@test.local", sede: "central", sedeAuditando: "central" };

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

async function completarCamposComunes(user) {
  await user.type(labelInput("N° de lote"), "LPS261101E-25");
  await user.type(labelInput("Proveedor"), "Tecnonuclear");
  await user.type(labelInput("Actividad calibrada (mCi)"), "150");
  await user.type(labelInput("Volumen (mL)"), "10");
  await user.type(labelInput("Fecha/hora de calibración"), "2026-11-01T10:00");
  await user.type(labelInput("Fecha de vencimiento"), "2027-01-01");
  await user.click(screen.getByRole("button", { name: "Sí, conforme" }));
}

function botonGuardar() {
  return screen.getByRole("button", { name: /Guardar lote/ });
}

async function reemplazar(user, input, valor) {
  await user.clear(input);
  if (valor !== "") await user.type(input, valor);
}

describe("TabLoteDosisUnica -- N° de vial obligatorio sólo para Lutecio-177", () => {
  test("Lutecio-177: 'Guardar lote' queda deshabilitado sin N° de vial, se habilita al completarlo", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);

    expect(botonGuardar().disabled).toBe(true);

    await user.type(labelInput("N° de vial"), "5");
    expect(botonGuardar().disabled).toBe(false);
  });

  test("Lutecio-177: N° de vial en 0 o negativo deja 'Guardar lote' deshabilitado, con aviso", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.type(labelInput("N° de vial"), "0");

    expect(botonGuardar().disabled).toBe(true);
    expect(screen.getByText(/N° de vial tiene que ser un número entero mayor a 0/)).toBeTruthy();
  });

  test("MIBG: 'Guardar lote' se habilita SIN N° de vial (opcional para este isótopo)", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);

    expect(botonGuardar().disabled).toBe(false);
  });

  // La validación en sí (incluido el caso "1e2") está testeada como función
  // PURA en mibgLote.test.js#numeroVialEsEnteroPositivo -- no depende de
  // cómo normalice un <input type="number"> del navegador real (eso no se
  // puede afirmar desde un test de componente en jsdom). Acá sólo se prueba
  // que el componente deshabilita y avisa para valores claramente
  // inválidos como string.
  test.each(["5.7", "0", "-1"])("Lutecio-177: N° de vial %s es inválido -- deshabilita y avisa", async (valorInvalido) => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.type(labelInput("N° de vial"), valorInvalido);

    expect(botonGuardar().disabled).toBe(true);
    expect(screen.getByText(/N° de vial tiene que ser un número entero mayor a 0/)).toBeTruthy();
  });

  test("Lutecio-177: N° de vial '5' es válido -- habilita, sin aviso", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.type(labelInput("N° de vial"), "5");

    expect(botonGuardar().disabled).toBe(false);
    expect(screen.queryByText(/N° de vial tiene que ser un número entero mayor a 0/)).toBeNull();
  });

  test("MIBG: la etiqueta del campo dice '(opcional)', a diferencia de Lutecio-177", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    expect(screen.getByText("N° de vial (opcional)")).toBeTruthy();

    cleanup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    expect(screen.getByText("N° de vial")).toBeTruthy();
    expect(screen.queryByText("N° de vial (opcional)")).toBeNull();
  });
});

// Bug real encontrado por Pablo: guardar() ya rechazaba <= 0 con un return
// silencioso, pero el botón seguía habilitado -- el usuario tocaba
// "Guardar lote" y no pasaba nada, sin ningún aviso. Ahora deshabilita y
// avisa, mismo patrón que el N° de vial.
describe("TabLoteDosisUnica -- actividad calibrada y volumen tienen que ser > 0", () => {
  test("actividad calibrada en 0 o negativa -- deshabilita 'Guardar lote' y avisa", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await reemplazar(user, labelInput("Actividad calibrada (mCi)"), "-5");

    expect(botonGuardar().disabled).toBe(true);
    expect(screen.getByText(/actividad calibrada tiene que ser mayor a 0/)).toBeTruthy();
  });

  test("volumen en 0 -- deshabilita 'Guardar lote' y avisa", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await reemplazar(user, labelInput("Volumen (mL)"), "0");

    expect(botonGuardar().disabled).toBe(true);
    expect(screen.getByText(/volumen tiene que ser mayor a 0/)).toBeTruthy();
  });
});

describe("TabLoteDosisUnica -- mayúsculas en N° de lote", () => {
  test("tipear en minúscula se ve en mayúscula EN VIVO (sin esperar blur)", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await user.type(labelInput("N° de lote"), "lps261101e-25");
    expect(labelInput("N° de lote").value).toBe("LPS261101E-25");
  });

  test("espacios de sobra se recortan al salir del campo (blur)", async () => {
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    const input = labelInput("N° de lote");
    await user.type(input, " LPS261101E-25 ");
    await user.tab(); // dispara blur
    expect(input.value).toBe("LPS261101E-25");
  });
});

describe("TabLoteDosisUnica -- payload real que recibe addMibgLote", () => {
  test("Lutecio-177 completo: numeroLote normalizado en mayúsculas, numeroVial como NÚMERO", async () => {
    const { addMibgLote } = await import("../../services/firestore/mibgLotes.js");
    addMibgLote.mockClear();
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await user.type(labelInput("N° de lote"), "lps261101e-25");
    await user.type(labelInput("Proveedor"), "Tecnonuclear");
    await user.type(labelInput("Actividad calibrada (mCi)"), "150");
    await user.type(labelInput("Volumen (mL)"), "10");
    await user.type(labelInput("Fecha/hora de calibración"), "2026-11-01T10:00");
    await user.type(labelInput("Fecha de vencimiento"), "2027-01-01");
    await user.click(screen.getByRole("button", { name: "Sí, conforme" }));
    await user.type(labelInput("N° de vial"), "5");
    await user.click(botonGuardar());

    expect(addMibgLote).toHaveBeenCalledTimes(1);
    const payload = addMibgLote.mock.calls[0][0];
    expect(payload.numeroLote).toBe("LPS261101E-25");
    expect(payload.numeroVial).toBe(5);
    expect(typeof payload.numeroVial).toBe("number");
  });

  test("MIBG sin N° de vial: el payload NO incluye numeroVial", async () => {
    const { addMibgLote } = await import("../../services/firestore/mibgLotes.js");
    addMibgLote.mockClear();
    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.click(botonGuardar());

    expect(addMibgLote).toHaveBeenCalledTimes(1);
    const payload = addMibgLote.mock.calls[0][0];
    expect("numeroVial" in payload).toBe(false);
  });
});

// Bug real encontrado por Pablo (parpadeo del aviso justo al tocar "Guardar
// lote"): listenMibgLotes es un onSnapshot EN VIVO -- Firestore lo dispara
// con el lote recién escrito (ya en el caché local) ANTES de que la
// promesa de addMibgLote resuelva. En ese instante, form.numeroLote/
// numeroVialNum todavía tienen lo recién tipeado (setForm(VACIO) corre
// después del await, al terminar guardar()), así que el lote que se está
// guardando se comparaba contra sí mismo y disparaba el aviso.
describe("TabLoteDosisUnica -- el aviso de vial duplicado no parpadea contra el propio lote que se está guardando", () => {
  test("control positivo: SIN guardado en curso, un lote YA existente con el mismo lote+vial sí muestra el aviso", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "existente", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LPS261101E-25", numeroVial: 5, fecha: new Date() },
    ]));

    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.type(labelInput("N° de vial"), "5");

    expect(screen.getByText(/Ya existe un lote activo con el mismo N° de lote y N° de vial/)).toBeTruthy();
  });

  test("mientras guardando=true, el propio lote recién escrito (ya visible vía el listener en vivo) NO dispara el aviso", async () => {
    let callbackEnVivo;
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => {
      callbackEnVivo = cb;
      cb([]);
      return () => {};
    });
    let resolverGuardado;
    vi.spyOn(mibgLotesMod, "addMibgLote").mockImplementation(() => new Promise((resolve) => { resolverGuardado = resolve; }));

    const user = userEvent.setup();
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await completarCamposComunes(user);
    await user.type(labelInput("N° de vial"), "5");
    await user.click(botonGuardar()); // addMibgLote queda PENDIENTE -- guardando=true

    // Simula lo que hace Firestore de verdad: el onSnapshot en vivo entrega
    // el lote recién escrito, ya en caché local, ANTES de que la promesa
    // de addMibgLote resuelva. act() fuerza a React a procesar el
    // setLotesTodos() y re-renderizar antes del assert de abajo -- sin
    // esto, el test podía pasar "de prestado" sin haber llegado a
    // recalcular vialDuplicado todavía.
    act(() => {
      callbackEnVivo([
        { id: "recien-guardado", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LPS261101E-25", numeroVial: 5, fecha: new Date() },
      ]);
    });

    expect(screen.queryByText(/Ya existe un lote activo con el mismo N° de lote y N° de vial/)).toBeNull();

    resolverGuardado();
  });
});

describe("TabLoteDosisUnica -- lotes viejos sin numeroVial no se rompen", () => {
  test("lote viejo sin numeroVial se lista sin 'Vial' en el texto, sin tirar error", async () => {
    const actasMod = await import("../../services/firestore/actas.js");
    vi.spyOn(actasMod, "listenActas").mockImplementation((_tipo, cb) => listenerCon(cb, []));
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-viejo", sedeId: "central", sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
        numeroLote: "lps260907a-25", proveedor: "Tecnonuclear", actividadCalibrada: 100, volumen: 8,
        fechaHoraCalibracion: new Date("2026-09-07T10:00:00"), fechaVencimiento: "2026-09-08",
        conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-09-07T09:00:00") },
      // numeroVial AUSENTE a propósito -- simula un lote cargado antes de este cambio.
    ]));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText(/lps260907a-25/i)).toBeTruthy();
    expect(screen.queryByText(/Vial undefined|Vial null/)).toBeNull();
  });
});

// Caso real reportado por Pablo (9/11, staging): dos lotes cargados como
// admin de Central con fechaHoraCalibracion FUTURA (27/11/2026, cargados el
// 9/11/2026). Verificado leyendo el código (TabLoteDosisUnica.jsx, el
// propio `lotesFiltrados`): filtra sólo por sede y ordena por `fecha`
// (serverTimestamp, cuándo se cargó) -- fechaHoraCalibracion no se usa para
// filtrar, agrupar ni ordenar en ningún lado de este listado. Este test lo
// confirma con datos reales: ambos lotes (uno con calibración futura, otro
// con calibración de hoy) tienen que aparecer en la lista.
describe("TabLoteDosisUnica -- fechaHoraCalibracion futura no saca al lote del listado", () => {
  test("lote con calibración FUTURA (27/11) y lote con calibración de HOY -- los dos entran al listado", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "lote-futuro", sedeId: "central", sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
        numeroLote: "LPS-FUTURO-25", numeroVial: 1, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
        fechaHoraCalibracion: new Date("2026-11-27T00:00:00"), fechaVencimiento: "2026-11-28",
        conformidad: true, usuarioNombre: "Admin Test", fecha: new Date("2026-11-09T10:00:00") },
      { id: "lote-hoy", sedeId: "central", sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
        numeroLote: "LPS-HOY-25", numeroVial: 2, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
        fechaHoraCalibracion: new Date("2026-11-09T10:00:00"), fechaVencimiento: "2026-11-10",
        conformidad: true, usuarioNombre: "Admin Test", fecha: new Date("2026-11-09T09:00:00") },
    ]));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText(/LPS-FUTURO-25/)).toBeTruthy();
    expect(screen.getByText(/LPS-HOY-25/)).toBeTruthy();
  });
});

// Orden de carga (decisión de Pablo, 9/11): el último cargado primero,
// incluido el caso de un lote recién guardado cuyo `fecha` (serverTimestamp)
// todavía es null en el snapshot local -- ver ordenarLotesPorCarga,
// helpers/mibgLote.js, y el test "más abajo" ahí mismo (función pura). Acá
// se confirma que el componente de verdad renderiza en ese orden.
describe("TabLoteDosisUnica -- orden de carga (el más nuevo arriba)", () => {
  test("tres lotes cargados en distinto orden se renderizan del más nuevo al más viejo", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    // A propósito en un orden que NO coincide con ningún criterio obvio
    // (ni por fecha ni por id) -- si el componente no ordenara nada, el
    // test fallaría igual que si ordenara al revés.
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      { id: "L-vieja", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LOTE-VIEJO", numeroVial: 1,
        proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date("2026-11-01T10:00:00"),
        fechaVencimiento: "2026-11-02", conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-11-01T10:00:00") },
      { id: "L-nueva", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LOTE-NUEVO", numeroVial: 2,
        proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date("2026-11-09T10:00:00"),
        fechaVencimiento: "2026-11-10", conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-11-09T10:00:00") },
      { id: "L-media", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LOTE-MEDIO", numeroVial: 3,
        proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date("2026-11-05T10:00:00"),
        fechaVencimiento: "2026-11-06", conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-11-05T10:00:00") },
    ]));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    const nombres = (await screen.findAllByText(/^LOTE-/)).map((el) => el.textContent);
    expect(nombres).toEqual(["LOTE-NUEVO · Vial 2", "LOTE-MEDIO · Vial 3", "LOTE-VIEJO · Vial 1"]);
  });

  // Premisa corregida el 9/11 con datos reales de staging: `fecha` null NO
  // es "recién guardado, pendiente" -- eso ya no puede pasar (listenMibgLotes
  // lee con serverTimestamps:"estimate", ver mibgLotes.js). Un null real es
  // dato viejo incompleto -- 322 de 341 lotes de Lutecio-177 en staging
  // (numeroLote "TEST-xxxxxxxx") tenían `fecha` null de forma PERMANENTE, y
  // con el criterio viejo ("null arriba") ocupaban todo el techo del listado
  // para siempre -- un lote real de hoy quedaba en la posición 323 de 341.
  test("muchos lotes con fecha null (dato viejo incompleto, caso real de staging) + un lote reciente con fecha real -- el reciente aparece primero, los null quedan al final", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    const viejosSinFecha = Array.from({ length: 8 }, (_, i) => ({
      id: `test-sin-fecha-${i}`, sedeId: "central", isotopoId: "lutecio177", numeroLote: `TEST-${i}`, numeroVial: i + 1,
      proveedor: "Prueba", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date("2026-09-23T00:00:00"),
      fechaVencimiento: "2026-09-24", conformidad: true, usuarioNombre: "Admin", fecha: null,
    }));
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [
      ...viejosSinFecha,
      { id: "lote-de-hoy", sedeId: "central", isotopoId: "lutecio177", numeroLote: "LOTE-DE-HOY", numeroVial: 99,
        proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date("2026-11-09T10:00:00"),
        fechaVencimiento: "2026-11-10", conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-11-09T14:05:01") },
    ]));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    const nombres = (await screen.findAllByText(/^(LOTE-DE-HOY|TEST-)/)).map((el) => el.textContent);
    expect(nombres[0]).toBe("LOTE-DE-HOY · Vial 99");
    expect(nombres.slice(1)).toEqual(expect.arrayContaining(viejosSinFecha.map((l) => `${l.numeroLote} · Vial ${l.numeroVial}`)));
  });
});

// Calibración futura (regla de negocio de Pablo, 9/11): aviso NO bloqueante.
// Fechas SIEMPRE relativas a "ahora" (+2h/-2h) -- nunca fijas, para que el
// test no se rompa solo con el correr del calendario. +-2h está muy por
// encima de cualquier margen de tolerancia (5min) y de cualquier demora
// real de ejecución del test, así que no hace falta pisar el reloj.
function aDatetimeLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0"), min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}
const AVISO_CALIBRACION_FUTURA = /La fecha\/hora de calibración es posterior a este momento/;

describe("TabLoteDosisUnica -- aviso de calibración futura (no bloqueante)", () => {
  test("Lutecio-177: calibración +2h en el futuro -- aviso visible, Guardar sigue habilitado", async () => {
    const user = userEvent.setup();
    const futura = aDatetimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000));
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await user.type(labelInput("N° de lote"), "LPS261101E-25");
    await user.type(labelInput("Proveedor"), "Tecnonuclear");
    await user.type(labelInput("Actividad calibrada (mCi)"), "150");
    await user.type(labelInput("Volumen (mL)"), "10");
    await user.type(labelInput("Fecha/hora de calibración"), futura);
    await user.type(labelInput("Fecha de vencimiento"), "2027-01-01");
    await user.click(screen.getByRole("button", { name: "Sí, conforme" }));
    await user.type(labelInput("N° de vial"), "5");

    expect(screen.getByText(AVISO_CALIBRACION_FUTURA)).toBeTruthy();
    expect(botonGuardar().disabled).toBe(false);
  });

  test("Lutecio-177: calibración -2h en el pasado -- sin aviso", async () => {
    const user = userEvent.setup();
    const pasada = aDatetimeLocal(new Date(Date.now() - 2 * 60 * 60 * 1000));
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await user.type(labelInput("Fecha/hora de calibración"), pasada);

    expect(screen.queryByText(AVISO_CALIBRACION_FUTURA)).toBeNull();
  });

  test("MIBG: calibración +2h en el futuro -- mismo aviso (componente compartido)", async () => {
    const user = userEvent.setup();
    const futura = aDatetimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000));
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="mibg" titulo="MIBG" descripcion="" placeholderLote="123-45678" />);
    await user.click(screen.getByRole("button", { name: "+ Registrar lote nuevo" }));
    await user.type(labelInput("Fecha/hora de calibración"), futura);

    expect(screen.getByText(AVISO_CALIBRACION_FUTURA)).toBeTruthy();
  });
});

// ===========================================================================
// Paso 6 (9/11): estado por lote del LISTADO (useEstadoListadoLotes), avisos
// de atención, "Reintentar", "Anular" deshabilitado mientras no se verificó,
// y paginación "Ver más". estadoListadoLoteDosisUnica se mockea por test con
// vi.spyOn -- lo que ya corre contra el emulador real está en
// scripts/testing/transacciones.test.mjs.
// ===========================================================================

function loteDeLista(overrides = {}) {
  return {
    id: "lote-1", sedeId: "central", sedeNombre: "FUESMEN Central", isotopoId: "lutecio177",
    numeroLote: "LPS-PASO6-25", numeroVial: 1, proveedor: "Tecnonuclear", actividadCalibrada: 150, volumen: 10,
    fechaHoraCalibracion: new Date("2026-11-01T10:00:00"), fechaVencimiento: "2026-11-02",
    conformidad: true, usuarioNombre: "Técnica Test", fecha: new Date("2026-11-01T10:00:00"),
    ...overrides,
  };
}

async function mockearListaConEstado(lotes, estadoFijo) {
  const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
  vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, lotes));
  vi.spyOn(mibgLotesMod, "estadoListadoLoteDosisUnica").mockImplementation(async (ls) =>
    new Map(ls.map((l) => [l.id, typeof estadoFijo === "function" ? estadoFijo(l) : estadoFijo]))
  );
  return mibgLotesMod;
}

describe("TabLoteDosisUnica -- paso 6: avisos de atención por estado", () => {
  test("'Vencido sin uso' -- badge + recuadro ámbar de atención", async () => {
    await mockearListaConEstado([loteDeLista()], { estado: "vencido-sin-uso", uso: null, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText("Vencido sin uso")).toBeTruthy();
    expect(screen.getByText(/venció sin ninguna administración registrada/i)).toBeTruthy();
  });

  test("'Sin vencimiento' (sin uso) -- mismo recuadro ámbar, texto específico (coherente con el bloqueo del picker del paso 5)", async () => {
    await mockearListaConEstado([loteDeLista({ fechaVencimiento: undefined })], { estado: "sin-vencimiento", uso: null, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText("Sin vencimiento")).toBeTruthy();
    expect(screen.getByText("No se puede administrar: falta la fecha de vencimiento del lote.")).toBeTruthy();
  });

  test("'Usado' -- sin recuadro de atención, muestra 'Usado en: Ficha...' con el uso de la lectura puntual", async () => {
    const uso = { id: "lote-1_1", pacienteFicha: "123", pacienteNombre: "Paciente Test", fecha: new Date("2026-11-01T11:00:00") };
    await mockearListaConEstado([loteDeLista()], { estado: "usado", uso, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText("Usado")).toBeTruthy();
    expect(screen.getByText(/Usado en: Ficha 123 · Paciente Test/)).toBeTruthy();
    expect(screen.queryByText(/venció sin ninguna administración/i)).toBeNull();
  });
});

describe("TabLoteDosisUnica -- paso 6: 'Verificando…' y 'No se pudo verificar' + Reintentar", () => {
  test("mientras la lectura puntual está en vuelo, muestra 'Verificando…'", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteDeLista()]));
    vi.spyOn(mibgLotesMod, "estadoListadoLoteDosisUnica").mockImplementation(() => new Promise(() => {})); // nunca resuelve

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText("Verificando…")).toBeTruthy();
  });

  test("si la lectura puntual falla -- 'No se pudo verificar' + botón Reintentar, que vuelve a pedirla", async () => {
    const user = userEvent.setup();
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteDeLista()]));
    const spy = vi.spyOn(mibgLotesMod, "estadoListadoLoteDosisUnica")
      .mockResolvedValueOnce(new Map([["lote-1", { estado: "no-verificable", uso: null, error: new Error("permission-denied") }]]));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    expect(await screen.findByText("No se pudo verificar")).toBeTruthy();
    const botonReintentar = screen.getByRole("button", { name: "Reintentar" });

    spy.mockResolvedValueOnce(new Map([["lote-1", { estado: "disponible", uso: null, error: null }]]));
    await user.click(botonReintentar);

    expect(await screen.findByText("Disponible")).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("TabLoteDosisUnica -- paso 6: 'Anular' deshabilitado mientras no se verificó el estado", () => {
  test("'Verificando…' -- el botón Anular está deshabilitado", async () => {
    const mibgLotesMod = await import("../../services/firestore/mibgLotes.js");
    vi.spyOn(mibgLotesMod, "listenMibgLotes").mockImplementation((cb) => listenerCon(cb, [loteDeLista()]));
    vi.spyOn(mibgLotesMod, "estadoListadoLoteDosisUnica").mockImplementation(() => new Promise(() => {}));

    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuarioAdmin} esAdmin onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    const botonAnular = await screen.findByRole("button", { name: "Anular" });
    expect(botonAnular.disabled).toBe(true);
  });

  test("'No se pudo verificar' -- el botón Anular sigue deshabilitado", async () => {
    await mockearListaConEstado([loteDeLista()], { estado: "no-verificable", uso: null, error: new Error("x") });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuarioAdmin} esAdmin onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    const botonAnular = await screen.findByRole("button", { name: "Anular" });
    expect(botonAnular.disabled).toBe(true);
  });

  test("'Disponible' (ya verificado) -- el botón Anular está habilitado", async () => {
    await mockearListaConEstado([loteDeLista()], { estado: "disponible", uso: null, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuarioAdmin} esAdmin onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    const botonAnular = await screen.findByRole("button", { name: "Anular" });
    expect(botonAnular.disabled).toBe(false);
  });
});

describe("TabLoteDosisUnica -- paso 6: paginación (30 por página + 'Ver más')", () => {
  function lotes(n) {
    return Array.from({ length: n }, (_, i) => loteDeLista({
      id: `lote-${i}`, numeroLote: `LPS-PAG-${String(i).padStart(3, "0")}`, numeroVial: i + 1,
      fecha: new Date(2026, 10, 1, 0, i), // orden determinístico, el de índice más alto es "más nuevo"
    }));
  }

  test("con 35 lotes, sólo se ven 30 -- aparece 'Ver 5 más'", async () => {
    await mockearListaConEstado(lotes(35), { estado: "disponible", uso: null, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);

    await screen.findByText(/LPS-PAG-034/); // el más nuevo, siempre visible
    expect(screen.queryAllByText(/^LPS-PAG-/).length).toBe(30);
    expect(screen.getByRole("button", { name: "Ver 5 más" })).toBeTruthy();
  });

  test("tocar 'Ver más' muestra los lotes restantes, sin re-pedir el estado de los primeros 30", async () => {
    const user = userEvent.setup();
    const mibgLotesMod = await mockearListaConEstado(lotes(35), { estado: "disponible", uso: null, error: null });
    render(<TabLoteDosisUnica catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} isotopoId="lutecio177" titulo="Lutecio-177" descripcion="" placeholderLote="LPS..." />);
    await screen.findByText(/LPS-PAG-034/);
    expect(mibgLotesMod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);
    const idsPrimeraCorrida = mibgLotesMod.estadoListadoLoteDosisUnica.mock.calls[0][0].map((l) => l.id);
    expect(idsPrimeraCorrida).toHaveLength(30);

    await user.click(screen.getByRole("button", { name: "Ver 5 más" }));

    await screen.findByText(/LPS-PAG-000/); // el más viejo, ahora visible
    expect(screen.queryByRole("button", { name: /Ver .* más/ })).toBeNull(); // ya no hay más
    expect(mibgLotesMod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    const idsSegundaCorrida = mibgLotesMod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id);
    expect(idsSegundaCorrida).toHaveLength(5); // SÓLO los 5 nuevos -- no se re-pidieron los 30 ya resueltos
  });
});
