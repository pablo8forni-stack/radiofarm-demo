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

vi.mock("../../services/firestore/mibgLotes.js", () => ({
  listenMibgLotes: (cb) => listenerCon(cb, []),
  addMibgLote: vi.fn(async () => {}),
}));

const catalogo = {
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false, farmIds: [], puntosReorden: {} } },
};
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central" };

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
