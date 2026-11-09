// "Decaído" de I-131 (9/11) -- estados, "Ver anteriores" plegado, acceso a
// todo el historial, el vencimiento NUNCA filtra nada. La mecánica de
// decaimiento en sí (umbral, margen de ventana) ya está probada a fondo en
// decaimientoI131.test.js -- acá sólo se prueba que el componente la usa
// bien (qué se ve, qué queda plegado, qué sigue accesible).
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabStockViales } from "./TabStockViales.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function listenerCon(cb, datos = []) {
  cb(datos);
  return () => {};
}

let vialesParaTest = [];
vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (tipo, cb) => listenerCon(cb, []),
  listenActasSinLimite: (tipo, cb) => { if (tipo === "i131_vial") return listenerCon(cb, vialesParaTest); return listenerCon(cb, []); },
  listenActasDesdeFecha: (tipo, cb) => listenerCon(cb, []),
  actasDesdeFecha: vi.fn(async () => []),
  listenAnulacionesActas: (cb) => listenerCon(cb, []),
  addActaI131Vial: vi.fn(async () => {}),
  anularActaTransaction: vi.fn(async () => {}),
}));

const catalogo = { sedes: { central: { nombre: "FUESMEN Central", short: "Central" } } };
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central" };

const HOY = new Date("2026-11-09T12:00:00");
const DIA_MS = 24 * 60 * 60 * 1000;

function vial(overrides = {}) {
  return {
    id: "v1", sedeId: "central", lote: "I131-LOTE-1", categoria: "terapeutico",
    actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: HOY, fechaVencimiento: null,
    ...overrides,
  };
}

describe("TabStockViales -- vigentes visibles, decaídos plegados bajo 'Ver anteriores'", () => {
  test("un vial vigente se ve directo; uno decaído (actividad calibrada baja, muchos días) queda plegado", async () => {
    vialesParaTest = [
      vial({ id: "vigente", lote: "I131-VIGENTE", fechaCalibracion: HOY }),
      vial({ id: "decaido", lote: "I131-DECAIDO", actividadCalibrada: 5, fechaCalibracion: new Date(HOY.getTime() - 60 * DIA_MS) }),
    ];
    render(<TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);

    expect((await screen.findAllByText("I131-VIGENTE")).length).toBeGreaterThan(0);
    expect(screen.queryByText("I131-DECAIDO")).toBeNull(); // plegado por defecto
    expect(screen.getByRole("button", { name: "Ver anteriores (1)" })).toBeTruthy();
  });

  test("tocar 'Ver anteriores' muestra el decaído, con badge 'Decaído', y sigue siendo clickeable", async () => {
    const user = userEvent.setup();
    vialesParaTest = [vial({ id: "decaido", lote: "I131-DECAIDO", actividadCalibrada: 5, fechaCalibracion: new Date(HOY.getTime() - 60 * DIA_MS) })];
    render(<TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Ver anteriores/ }));
    expect((await screen.findAllByText("I131-DECAIDO")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Decaído").length).toBeGreaterThan(0);

    // Sigue siendo posible entrar al detalle y, si fuera admin, anular --
    // "Ver anteriores" nunca saca al vial de circulación, sólo lo pliega.
    await user.click(screen.getAllByText("I131-DECAIDO")[0]);
    expect(await screen.findByText(/Volver a viales/)).toBeTruthy();
  });
});

describe("TabStockViales -- la fecha de vencimiento NUNCA filtra ni oculta nada", () => {
  test("un vial VENCIDO pero vigente por decaimiento (poca actividad extraída, calibración reciente) sigue visible, sin pasar por 'Ver anteriores'", async () => {
    vialesParaTest = [vial({
      id: "vencido-no-decaido", lote: "I131-VENCIDO-VIGENTE",
      fechaCalibracion: HOY, fechaVencimiento: "2020-01-01", // vencido hace años
    })];
    render(<TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);

    // Visible de entrada (no plegado) -- el vencimiento es sólo informativo.
    expect((await screen.findAllByText("I131-VENCIDO-VIGENTE")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Ver anteriores/ })).toBeNull();
    expect(screen.getAllByText("Vencido").length).toBeGreaterThan(0); // se muestra, pero no oculta
  });
});

describe("TabStockViales -- Combinar viales nunca ofrece un vial decaído", () => {
  test("abrir el detalle de un vial vigente y 'Agregar otro vial' no incluye el decaído de la misma categoría", async () => {
    const user = userEvent.setup();
    vialesParaTest = [
      vial({ id: "vigente-A", lote: "I131-VIGENTE-A", fechaCalibracion: HOY }),
      vial({ id: "decaido-B", lote: "I131-DECAIDO-B", actividadCalibrada: 5, fechaCalibracion: new Date(HOY.getTime() - 60 * DIA_MS) }),
    ];
    render(<TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);
    await user.click((await screen.findAllByText("I131-VIGENTE-A"))[0]);

    await user.click(await screen.findByRole("button", { name: /\+ Nueva extracción/ }));
    await user.click(screen.getByText("+ Agregar otro vial"));

    const opciones = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opciones).not.toContain("I131-DECAIDO-B");
  });
});

describe("TabStockViales -- paginación/listado completo (ajuste A)", () => {
  test("usa listenActasSinLimite para los viales -- NO listenActas (limitado a 150)", async () => {
    const mod = await import("../../services/firestore/actas.js");
    const spySinLimite = vi.spyOn(mod, "listenActasSinLimite");
    const spyLimitado = vi.spyOn(mod, "listenActas");
    vialesParaTest = [vial()];
    render(<TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);
    await screen.findAllByText("I131-LOTE-1");

    expect(spySinLimite).toHaveBeenCalledWith("i131_vial", expect.anything(), expect.objectContaining({ sedeId: "central" }));
    expect(spyLimitado.mock.calls.some(([tipo]) => tipo === "i131_vial")).toBe(false);
  });
});
