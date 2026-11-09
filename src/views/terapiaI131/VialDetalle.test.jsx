// Ajuste B (9/11, decaído I-131): un vial DECAÍDO trae su historial COMPLETO
// de extracciones a pedido (getDocs, una vez al abrir el detalle) -- nunca
// confía en la ventana de "vigentes" del padre, que a propósito puede no
// cubrirlo. Este archivo prueba justo esa separación.
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { VialDetalle } from "./VialDetalle.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

vi.mock("../../services/firestore/actas.js", () => ({
  addActaI131Extraccion: vi.fn(async () => {}),
  actasDesdeFecha: vi.fn(async () => []),
}));

const catalogo = { sedes: { central: { nombre: "FUESMEN Central", short: "Central" } } };
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local" };

function vial(overrides = {}) {
  return {
    id: "v1", sedeId: "central", lote: "I131-LOTE-1", categoria: "terapeutico",
    actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: new Date("2026-08-01T10:00:00"),
    ...overrides,
  };
}

function propsBase(overrides = {}) {
  return {
    vial: vial(), estaDecaido: false, anulacionVial: null,
    todosLosViales: [], extracciones: [], extraccionesVinculadas: new Map(), anulaciones: new Map(),
    catalogo, usuario, esAdmin: false, onToast: vi.fn(), onVolver: vi.fn(), onAnular: vi.fn(),
    ...overrides,
  };
}

describe("VialDetalle -- vigente: usa la ventana compartida del padre (prop extracciones), sin pedir nada nuevo", () => {
  test("no llama a actasDesdeFecha cuando estaDecaido es false, y el volumen restante refleja la extracción de la prop", async () => {
    const mod = await import("../../services/firestore/actas.js");
    render(<VialDetalle {...propsBase({
      estaDecaido: false,
      extracciones: [{ id: "ex1", fecha: new Date(), viales: [{ vialId: "v1", mlExtraidos: 2 }], actividadMedida: 1, actividadCalculada: 1, usuarioNombre: "Técnica Test" }],
    })} />);
    await screen.findByText("I131-LOTE-1");
    expect(mod.actasDesdeFecha).not.toHaveBeenCalled();
    expect(screen.getAllByText(/8\.0 mL/).length).toBeGreaterThan(0); // 10 (inicial) - 2 extraído = 8 restante, viene de la prop
  });
});

describe("VialDetalle -- decaído (ajuste B): historial COMPLETO a pedido, aunque la ventana de 'vigentes' no lo cubra", () => {
  test("una extracción vieja, AUSENTE en la prop extracciones (ventana de vigentes), SÍ aparece -- viene del fetch propio", async () => {
    const mod = await import("../../services/firestore/actas.js");
    const extraccionVieja = {
      id: "ex-vieja", fecha: new Date("2026-08-02T10:00:00"),
      viales: [{ vialId: "v1", mlExtraidos: 3 }],
      actividadMedida: 50, actividadCalculada: 48,
      usuarioNombre: "Técnica Vieja",
    };
    mod.actasDesdeFecha.mockResolvedValue([extraccionVieja]);

    render(<VialDetalle {...propsBase({
      vial: vial(), estaDecaido: true,
      extracciones: [], // la ventana de "vigentes" del padre NO la tiene -- a propósito
      todosLosViales: [], // decaído: nunca se ofrece para combinar, lista vacía es correcta
    })} />);

    await waitFor(() => expect(mod.actasDesdeFecha).toHaveBeenCalledTimes(1));
    expect(mod.actasDesdeFecha).toHaveBeenCalledWith("i131_extraccion", expect.objectContaining({ sedeId: "central" }));
    // El margen de 1 día (ajuste C) -- desde = fechaCalibracion - 1 día.
    const llamada = mod.actasDesdeFecha.mock.calls[0][1];
    expect(llamada.desde.getTime()).toBe(vial().fechaCalibracion.getTime() - 24 * 60 * 60 * 1000);

    expect(await screen.findByText(/Técnica Vieja/)).toBeTruthy();
    expect(screen.getByText("Decaído")).toBeTruthy();
  });

  test("mientras carga el historial propio, muestra el aviso de carga -- nunca 'sin extracciones' prematuro", async () => {
    const mod = await import("../../services/firestore/actas.js");
    mod.actasDesdeFecha.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    render(<VialDetalle {...propsBase({ estaDecaido: true, extracciones: [] })} />);

    expect(await screen.findByText(/Cargando historial completo/)).toBeTruthy();
    expect(screen.getByText("Sin extracciones registradas de este vial todavía.")).toBeTruthy(); // mientras carga, lista vacía -- correcto, no hay dato todavía
  });

  test("si el fetch propio falla, no inventa remanente -- trata como sin extracciones (fail CERRADO)", async () => {
    const mod = await import("../../services/firestore/actas.js");
    mod.actasDesdeFecha.mockRejectedValue(new Error("boom"));
    render(<VialDetalle {...propsBase({ vial: vial({ volumenInicial: 5 }), estaDecaido: true, extracciones: [] })} />);

    await waitFor(() => expect(mod.actasDesdeFecha).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/5\.0 mL/).length).toBeGreaterThan(0)); // volumen restante = volumenInicial completo (nada descontado, a falta de dato real)
  });
});
