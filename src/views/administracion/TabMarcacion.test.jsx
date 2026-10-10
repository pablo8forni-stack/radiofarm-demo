// Mismo bug real reportado por Pablo que en TabPacientes.jsx (ver su test
// correspondiente): el texto de "Ver todo el stock" estaba DENTRO del
// <label> que envuelve el <input>, y el casillero queda pegado (gap-1,
// 4px) justo debajo del selector de Lote -- tocar el texto, o un poco por
// debajo del selector, tildaba la excepción sin querer. CasilleroExcepcion
// separa el texto a un <span> sin interacción.
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabMarcacion } from "./TabMarcacion.jsx";

afterEach(cleanup);

function listenerCon(cb, datos = []) {
  cb(datos);
  return () => {};
}

let egresadosHoyParaTest = [];
let marcacionesParaTest = [];
// A diferencia de los otros listeners de este mock (una sola llamada,
// "foto" fija), este guarda el callback para poder simular un cambio EN
// VIVO (como el listener real de Firestore) -- necesario para probar que
// la restauración al destildar la excepción se omite si el egreso elegido
// fue consumido por otra marcación MIENTRAS la excepción estaba activa.
let marcacionesCallbacks = [];
function dispararMarcaciones(datos) {
  marcacionesParaTest = datos;
  marcacionesCallbacks.forEach((cb) => cb(datos));
}

vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (_tipo, cb) => {
    marcacionesCallbacks.push(cb);
    cb(marcacionesParaTest);
    return () => { marcacionesCallbacks = marcacionesCallbacks.filter((c) => c !== cb); };
  },
  listenAnulacionesActas: (cb) => listenerCon(cb, []),
  addActaMarcacion: vi.fn(async () => {}),
  actasPorRango: vi.fn(async () => []),
  anularActaTransaction: vi.fn(async () => {}),
}));

vi.mock("../../services/firestore/movimientos.js", () => ({
  listenMovimientosEgresoHoy: (_sedeId, cb) => listenerCon(cb, egresadosHoyParaTest),
}));

const catalogo = {
  farms: [{ id: "mibi", nombre: "MIBI (Sestamibi)", viales_x_kit: null }],
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false, farmIds: ["mibi"], puntosReorden: {} } },
  stock: { central: { mibi: [{ lote: "LOTE1", cantidad: 10, vencimiento: "2026-12-31" }] } },
  proveedores: [],
  estudios: [],
  radioisotopos: [],
};
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central" };

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}
function botonLote() {
  return screen.getByRole("combobox", { name: "Lote" });
}
async function elegirLotePorTexto(user, textoInicial) {
  await user.click(botonLote());
  await user.click(await screen.findByRole("option", { name: new RegExp("^" + textoInicial) }));
}

describe("TabMarcacion -- 'Ver todo el stock' (CasilleroExcepcion): sólo el cuadradito activa la excepción", () => {
  afterEach(() => { egresadosHoyParaTest = []; marcacionesParaTest = []; marcacionesCallbacks = []; });

  async function abrirFormularioYElegirEgreso(user) {
    egresadosHoyParaTest = [{ id: "mov1", farmId: "mibi", lote: "LOTE1", fecha: new Date(), motivo: "Marcación" }];
    render(<TabMarcacion catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);
    await user.click(await screen.findByText("+ Registrar marcación"));
    await user.selectOptions(labelInput("Radiofármaco"), "mibi");
    await elegirLotePorTexto(user, "LOTE1");
  }

  test("tocar el texto 'Ver todo el stock' NO activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirEgreso(user);

    await user.click(screen.getByText("Ver todo el stock (excepcional)"));

    expect(screen.queryByText("Esta marcación se guardará SIN un egreso que la respalde.")).toBeNull();
    expect(botonLote().textContent).toMatch(/^LOTE1/);
  });

  test("tocar el cuadradito SÍ activa la excepción, y muestra el aviso", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirEgreso(user);

    const checkbox = screen.getByLabelText("Ver todo el stock (excepcional)");
    await user.click(checkbox);

    expect(screen.getByText("Esta marcación se guardará SIN un egreso que la respalde.")).toBeTruthy();
  });

  test("Espacio con foco en el cuadradito también activa la excepción", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirEgreso(user);

    const checkbox = screen.getByLabelText("Ver todo el stock (excepcional)");
    checkbox.focus();
    await user.keyboard(" ");

    expect(screen.getByText("Esta marcación se guardará SIN un egreso que la respalde.")).toBeTruthy();
  });

  test("restauración válida: tildar y destildar sin cambiar nada más devuelve el mismo egreso", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirEgreso(user);

    const checkbox = screen.getByLabelText("Ver todo el stock (excepcional)");
    await user.click(checkbox);
    await user.click(checkbox);

    expect(botonLote().textContent).toMatch(/^LOTE1/);
  });

  test("restauración omitida: si el egreso elegido ya fue consumido por otra marcación mientras la excepción estaba activa, el campo queda vacío", async () => {
    const user = userEvent.setup();
    await abrirFormularioYElegirEgreso(user);

    const checkbox = screen.getByLabelText("Ver todo el stock (excepcional)");
    await user.click(checkbox);
    // Mientras la excepción está activa, otra marcación consume ese mismo
    // egreso (mov1) -- egresosDisponibles ya no lo ofrece como seleccionable.
    await act(async () => {
      dispararMarcaciones([{ id: "otra", tipo: "marcacion", farmId: "mibi", lote: "LOTE1", egresoMovimientoId: "mov1" }]);
    });
    await user.click(checkbox);

    expect(botonLote().textContent).toContain("Seleccionar lote...");
  });
});
