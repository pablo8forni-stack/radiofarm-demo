// Ajuste B (9/11, decaído I-131): un vial DECAÍDO trae su historial COMPLETO
// de extracciones a pedido (getDocs, una vez al abrir el detalle) -- nunca
// confía en la ventana de "vigentes" del padre, que a propósito puede no
// cubrirlo. Este archivo prueba justo esa separación.
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VialDetalle } from "./VialDetalle.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

// Input.jsx/Sel.jsx no asocian <label> con su control por htmlFor/id --
// mismo hallazgo ya documentado en otros *.test.jsx de este repo.
function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

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

describe("VialDetalle -- detalle de la dilución (25/11)", () => {
  test("vial viejo, SIN volumenAlicuota/volumenDiluyente -- se ve igual que siempre, sin paréntesis", async () => {
    render(<VialDetalle {...propsBase({ vial: vial({ volumenInicial: 10 }) })} />);
    await screen.findByText("I131-LOTE-1");
    expect(screen.getAllByText("10 mL").length).toBeGreaterThan(0);
    expect(screen.queryByText(/de dilución/)).toBeNull();
  });

  test("vial CON los 2 campos nuevos -- muestra el detalle de la dilución", async () => {
    render(<VialDetalle {...propsBase({ vial: vial({ volumenInicial: 100.61, volumenAlicuota: 0.61, volumenDiluyente: 100 }) })} />);
    await screen.findByText("I131-LOTE-1");
    expect(screen.getAllByText(/100\.61 mL \(0\.61 \+ 100 de dilución\)/).length).toBeGreaterThan(0);
  });
});

describe("VialDetalle -- extracciones en µCi, no mCi (25/11)", () => {
  test("preview de una extracción nueva -- 'Total calculado' en µCi", async () => {
    const user = userEvent.setup();
    // fechaCalibracion = ahora mismo -> dias prácticamente 0 (el test corre
    // en milisegundos), sin mezclar fake timers con userEvent (cuelga en
    // esta versión -- ver nota más abajo). actividadCalibrada 1000 mCi /
    // volumenInicial 10 mL = 100 mCi/mL a dias~0 -> 1 mL = 100 mCi = 100000 µCi.
    render(<VialDetalle {...propsBase({ vial: vial({ actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: new Date() }) })} />);
    await user.click(await screen.findByRole("button", { name: "+ Nueva extracción" }));
    await user.type(labelInput("mL extraídos"), "1");

    // "100000.0 µCi" aparece 2 veces (línea "Total calculado" + "Resultado"
    // del desglose de esta línea, al haber una sola) -- ambas en µCi.
    expect((await screen.findAllByText("100000.0 µCi")).length).toBeGreaterThanOrEqual(2);
    // La fila "Actividad calibrada" del desglose SIGUE en mCi (no cambia).
    expect(screen.getAllByText("1000 mCi").length).toBeGreaterThan(0);
  });

  test("historial de una extracción ya guardada -- Calculado/Medido/De este vial en µCi", async () => {
    const AHORA = new Date();
    const extraccion = {
      id: "ex1", fecha: AHORA, viales: [{ vialId: "v1", mlExtraidos: 1 }],
      actividadMedida: 0.09, actividadCalculada: 0.0883,
      desglosePorVial: [{ vialId: "v1", mlExtraidos: 1, mCiCalculado: 0.0883, actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: AHORA, diasTranscurridos: 0, concentracionMCiPorMl: 0.0883 }],
      usuarioNombre: "Técnica Test",
    };
    render(<VialDetalle {...propsBase({ extracciones: [extraccion] })} />);

    // "88.3 µCi" aparece 2 veces (línea "Calculado" + "Resultado" del
    // desglose congelado) -- ambas vienen del mismo valor guardado, 0.0883.
    expect((await screen.findAllByText("88.3 µCi")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("90.0 µCi")).toBeTruthy(); // Medido
    expect(screen.getByText(/1 mL → 88\.3 µCi/)).toBeTruthy(); // De este vial
    expect(screen.queryByText(/0\.0883 mCi/)).toBeNull();
    expect(screen.queryByText(/0\.09 mCi/)).toBeNull();
  });
});

describe("VialDetalle -- selector de unidad de 'Actividad medida' (25/11)", () => {
  const AHORA = new Date("2026-08-01T10:00:00");

  test("µCi por defecto -- tipear 88.3 muestra la conversión '= 0.0883 mCi' y así se guarda", async () => {
    const user = userEvent.setup();
    const mod = await import("../../services/firestore/actas.js");
    render(<VialDetalle {...propsBase({ vial: vial({ actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: AHORA }) })} />);
    await user.click(await screen.findByRole("button", { name: "+ Nueva extracción" }));
    await user.type(labelInput("mL extraídos"), "1");
    await user.type(labelInput("Actividad medida (activímetro)"), "88.3");

    expect(await screen.findByText("= 0.0883 mCi")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Guardar extracción" }));
    await waitFor(() => expect(mod.addActaI131Extraccion).toHaveBeenCalled());
    expect(mod.addActaI131Extraccion.mock.calls[0][0].actividadMedida).toBe(0.0883);
  });

  test("cambiar a mCi -- sin línea de conversión, el valor tipeado se guarda tal cual", async () => {
    const user = userEvent.setup();
    const mod = await import("../../services/firestore/actas.js");
    render(<VialDetalle {...propsBase({ vial: vial({ actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: AHORA }) })} />);
    await user.click(await screen.findByRole("button", { name: "+ Nueva extracción" }));
    await user.type(labelInput("mL extraídos"), "1");
    await user.selectOptions(screen.getAllByRole("combobox").find((s) => s.value === "uci"), "mci");
    await user.type(labelInput("Actividad medida (activímetro)"), "0.0883");

    expect(screen.queryByText(/^= /)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Guardar extracción" }));
    await waitFor(() => expect(mod.addActaI131Extraccion).toHaveBeenCalled());
    expect(mod.addActaI131Extraccion.mock.calls[0][0].actividadMedida).toBe(0.0883);
  });
});

describe("VialDetalle -- aviso de posible error de unidad (~1000x) (25/11)", () => {
  test("medida ~1000x distinta de la calculada -- aviso específico de unidad, además del de 15%", async () => {
    const user = userEvent.setup();
    // fechaCalibracion = ahora mismo -> dias~0, sin fake timers (ver nota en
    // el describe de arriba). 1000 mCi / 10 mL = 100 mCi/mL -> 1 mL = 100 mCi.
    render(<VialDetalle {...propsBase({ vial: vial({ actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: new Date() }) })} />);
    await user.click(await screen.findByRole("button", { name: "+ Nueva extracción" }));
    await user.type(labelInput("mL extraídos"), "1");
    // 100 µCi medidos (default) = 0.1 mCi -- relación 0.1/100 = 1/1000 con la calculada.
    await user.type(labelInput("Actividad medida (activímetro)"), "100");

    expect(await screen.findByText(/difiere del cálculo/)).toBeTruthy();
    expect(screen.getByText(/Parece un error de unidad/)).toBeTruthy();
  });

  test("diferencia real chica (no es error de unidad) -- sin el aviso específico", async () => {
    const user = userEvent.setup();
    render(<VialDetalle {...propsBase({ vial: vial({ actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: new Date() }) })} />);
    await user.click(await screen.findByRole("button", { name: "+ Nueva extracción" }));
    await user.type(labelInput("mL extraídos"), "1");
    await user.selectOptions(screen.getAllByRole("combobox").find((s) => s.value === "uci"), "mci");
    await user.type(labelInput("Actividad medida (activímetro)"), "80"); // 20% menos que 100 mCi calculado

    expect(await screen.findByText(/difiere del cálculo/)).toBeTruthy();
    expect(screen.queryByText(/Parece un error de unidad/)).toBeNull();
  });
});
