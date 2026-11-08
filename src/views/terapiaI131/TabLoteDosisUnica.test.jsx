// N° de vial (4/11): obligatorio en el FORMULARIO para Lutecio-177 (distingue
// viales de un mismo lote de producción, ver mibgLote.js#loteVialYaExiste),
// opcional para MIBG -- el servidor no lo exige en ninguno de los dos casos
// (campo opcional en firestore.rules, sin cambios ahí). Estos tests cubren
// sólo esa regla de UI, no el servicio real (mockeado).
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
