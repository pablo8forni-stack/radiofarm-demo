import { describe, test, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabElucion } from "./TabElucion.jsx";

let ACTAS = [];
let ANULACIONES = [];
let MARCADOR_EXISTE = false;
let ENTREGAR_ACTAS = true; // false simula "el listener todavía no trajo su primer snapshot"
let ENTREGAR_ANULACIONES = true;
// Guarda el callback de listenActas aunque ENTREGAR_ACTAS esté en false --
// para el test de timeout que necesita simular una entrega TARDÍA (el
// listener responde recién después de que ya venció el timeout de 15s).
let callbackActas = null;

vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (_tipo, cb) => { callbackActas = cb; if (ENTREGAR_ACTAS) cb(ACTAS); return () => {}; },
  listenAnulacionesActas: (cb) => { if (ENTREGAR_ANULACIONES) cb(ANULACIONES); return () => {}; },
  loteGeneradorYaRegistrado: vi.fn(async () => MARCADOR_EXISTE),
  addActaElucion: vi.fn(async () => {}),
  actasPorRango: vi.fn(async () => []),
  anularActaTransaction: vi.fn(async () => {}),
}));

afterEach(() => {
  cleanup();
  ACTAS = [];
  ANULACIONES = [];
  MARCADOR_EXISTE = false;
  ENTREGAR_ACTAS = true;
  ENTREGAR_ANULACIONES = true;
  callbackActas = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

const CATALOGO = { sedes: { central: { nombre: "FUESMEN Central", short: "Central", eluye: true } } };
const USUARIO = { nombre: "Tecnico Test", email: "tec@x.com", sede: "central" };
const USUARIO_ADMIN = { nombre: "Admin Test", email: "admin@x.com", sede: "central", sedeAuditando: "central" };

const LABEL_MO99 = "Actividad de Mo-99 calibrada (mCi)";

function actaElucion(overrides = {}) {
  return {
    id: "e1", tipo: "elucion", sedeId: "central", sedeNombre: "FUESMEN Central",
    loteGenerador: "1-11111", actividadEluida: 740, volumen: 10, usuarioNombre: "Tec", fecha: { toDate: () => new Date() },
    ...overrides,
  };
}

// Input.jsx no asocia <label> e <input> por htmlFor/id (mismo hallazgo ya
// documentado en ModalAnularActa.test.jsx) -- getByLabelText no funciona
// con este componente, hay que ubicar por el texto del <label> y su
// hermano siguiente.
function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

async function abrirFormYTiparLote(user, lote = "1-11111") {
  await user.click(screen.getByRole("button", { name: "+ Registrar elución" }));
  await user.type(labelInput("Lote/serie del generador"), lote);
  await user.tab(); // dispara onBlur -> normaliza y fija loteVerificado
}

describe("TabElucion -- pedirDatos (24/11)", () => {
  test("marcador NO existe -> pide los 4 datos", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = false;
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(await screen.findByText(LABEL_MO99, { selector: "label" })).toBeTruthy();
  });

  test("marcador existe + SIN vigente con datos -> pide los 4 datos igual", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = true;
    ACTAS = []; // nada vigente con actividadCalibrada para ese lote
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(await screen.findByText(LABEL_MO99, { selector: "label" })).toBeTruthy();
  });

  test("marcador existe + vigente CON datos -> NO pide los 4 datos", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = true;
    ACTAS = [actaElucion({ actividadCalibrada: 1850 })];
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    await screen.findByText("Actividad de Tc-99m eluida (mCi)", { selector: "label" }); // el form ya renderizó
    expect(screen.queryByText(LABEL_MO99, { selector: "label" })).toBeNull();
  });

  test("la vigente con datos está ANULADA -> vuelve a pedir los 4 datos", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = true;
    ACTAS = [actaElucion({ id: "e1", actividadCalibrada: 1850 })];
    ANULACIONES = [{ anulaId: "e1", motivo: "error de carga", sedeId: "central" }];
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(await screen.findByText(LABEL_MO99, { selector: "label" })).toBeTruthy();
  });
});

describe("TabElucion -- validación de fechas del generador (25/11)", () => {
  async function tiparDatosGenerador({ fechaCalibracion, fechaVencimiento }) {
    fireEvent.change(labelInput(LABEL_MO99), { target: { value: "1850" } });
    fireEvent.change(labelInput("Fecha de calibración"), { target: { value: fechaCalibracion } });
    fireEvent.change(labelInput("Fecha de vencimiento"), { target: { value: fechaVencimiento } });
    fireEvent.change(labelInput("Número de generador"), { target: { value: "240017992" } });
    fireEvent.change(labelInput("Actividad de Tc-99m eluida (mCi)"), { target: { value: "740" } });
    fireEvent.change(labelInput("Volumen (ml)"), { target: { value: "10" } });
  }

  test("vencimiento anterior a calibración -- mensaje bajo el campo y Guardar deshabilitado", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = false;
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    await screen.findByText(LABEL_MO99, { selector: "label" });

    await tiparDatosGenerador({ fechaCalibracion: "2026-11-08", fechaVencimiento: "2026-11-01" });

    expect(screen.getByText("La fecha de vencimiento no puede ser anterior a la de calibración.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(true);
  });

  test("vencimiento igual o posterior a calibración -- sin mensaje, Guardar habilitado", async () => {
    const user = userEvent.setup();
    MARCADOR_EXISTE = false;
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    await screen.findByText(LABEL_MO99, { selector: "label" });

    await tiparDatosGenerador({ fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08" });

    expect(screen.queryByText("La fecha de vencimiento no puede ser anterior a la de calibración.")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(false);
  });
});

describe("TabElucion -- subfila del generador (24/11)", () => {
  // jsdom no evalúa media queries -- la tabla desktop (hidden md:block) y
  // la tarjeta mobile (md:hidden) están las DOS en el DOM a la vez acá, así
  // que cualquier texto que aparezca en ambas vistas matchea 2 veces. Por
  // eso se usa getAllByText en vez de getByText para la subfila.
  test("elución con los 3 datos nuevos -- subfila presente con Generador/Calibrado/Vence (tabla + tarjeta)", async () => {
    ACTAS = [actaElucion({ actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" })];
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    const subfilas = await screen.findAllByText(/Generador N° 240017992/);
    expect(subfilas.length).toBe(2); // tabla + tarjeta
    expect(subfilas[0].textContent).toContain("Calibrado 01/11/2026");
    expect(subfilas[0].textContent).toContain("Vence 08/11/2026");
  });

  test("elución vieja con SÓLO actividadCalibrada -- SIN subfila (ya está en la columna)", async () => {
    ACTAS = [actaElucion({ actividadCalibrada: 1850 })];
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await screen.findAllByText(/1850/); // columna/tarjeta Act. calibrada sí está
    expect(screen.queryByText(/Generador N°/)).toBeNull();
    expect(screen.queryByText(/Calibrado/)).toBeNull();
  });

  test("elución ANULADA con los 3 datos -- la subfila sigue mostrándose, junto con la leyenda ANULADA", async () => {
    ACTAS = [actaElucion({ id: "e1", actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" })];
    ANULACIONES = [{ anulaId: "e1", motivo: "error de carga", sedeId: "central" }];
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO_ADMIN} esAdmin={true} onToast={vi.fn()} />);
    expect((await screen.findAllByText(/Generador N° 240017992/)).length).toBe(2);
    expect(screen.getAllByText(/ANULADA: error de carga/).length).toBe(2);
  });
});

describe("TabElucion -- listeners sin cargar (24/11)", () => {
  test("mientras listenActas no entregó el primer snapshot -- 'Cargando datos del lote...' y Guardar deshabilitado", async () => {
    const user = userEvent.setup();
    ENTREGAR_ACTAS = false; // listenAnulacionesActas sí entrega, pero actasCargadas queda en false
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(await screen.findByText("Cargando datos del lote...")).toBeTruthy();
    expect(screen.queryByText(LABEL_MO99, { selector: "label" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(true);
  });

  test("mientras listenAnulacionesActas no entregó el primer snapshot -- tampoco decide", async () => {
    const user = userEvent.setup();
    ENTREGAR_ANULACIONES = false;
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(await screen.findByText("Cargando datos del lote...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(true);
  });

  test("una vez que los dos listeners entregan -- decide normal (acá: marcador no existe -> pide datos)", async () => {
    const user = userEvent.setup();
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    await abrirFormYTiparLote(user);
    expect(screen.queryByText("Cargando datos del lote...")).toBeNull();
    expect(await screen.findByText(LABEL_MO99, { selector: "label" })).toBeTruthy();
  });
});

describe("TabElucion -- timeout de los listeners (24/11)", () => {
  // userEvent no es compatible con fake timers acá (su propio delay interno
  // usa setTimeout) -- estos 3 tests abren el form y tipean con fireEvent
  // directo, sin userEvent, para poder controlar el reloj a mano con
  // vi.advanceTimersByTimeAsync.
  function abrirFormYTiparLoteSync(lote = "1-11111") {
    fireEvent.click(screen.getByRole("button", { name: "+ Registrar elución" }));
    fireEvent.change(labelInput("Lote/serie del generador"), { target: { value: lote } });
    fireEvent.blur(labelInput("Lote/serie del generador"));
  }

  test("listenActas nunca entrega -- a los 15s aparece el aviso, pide los 4 datos y Guardar se habilita", async () => {
    vi.useFakeTimers();
    ENTREGAR_ACTAS = false; // listenAnulacionesActas sí entrega, pero actasCargadas queda en false para siempre
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    abrirFormYTiparLoteSync();

    expect(screen.getByText("Cargando datos del lote...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(screen.queryByText("Cargando datos del lote...")).toBeNull();
    expect(screen.getByText(/No se pudo verificar el historial de este lote/)).toBeTruthy();
    expect(screen.getByText(LABEL_MO99, { selector: "label" })).toBeTruthy(); // pedirDatos forzado a true
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(true); // todavía faltan los campos obligatorios

    // Completando los 4 datos del generador + los campos de siempre, Guardar
    // se habilita -- ya no lo bloquea listosParaDecidir (que ahora es true
    // por el timeout), sólo faltaba llenar el formulario.
    fireEvent.change(labelInput(LABEL_MO99), { target: { value: "1850" } });
    fireEvent.change(labelInput("Fecha de calibración"), { target: { value: "2026-11-01" } });
    fireEvent.change(labelInput("Fecha de vencimiento"), { target: { value: "2026-11-08" } });
    fireEvent.change(labelInput("Número de generador"), { target: { value: "240017992" } });
    fireEvent.change(labelInput("Actividad de Tc-99m eluida (mCi)"), { target: { value: "740" } });
    fireEvent.change(labelInput("Volumen (ml)"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Guardar elución" }).disabled).toBe(false);
  });

  test("listenActas entrega DESPUÉS del timeout -- recalcula normal y retira el aviso", async () => {
    vi.useFakeTimers();
    ENTREGAR_ACTAS = false;
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    abrirFormYTiparLoteSync();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/No se pudo verificar el historial de este lote/)).toBeTruthy();
    expect(screen.getByText(LABEL_MO99, { selector: "label" })).toBeTruthy();

    // El listener "tardío" responde ahora (mismo callback guardado al
    // suscribirse, nunca se desmontó el componente): hay una elución
    // vigente de ese lote con los 4 datos -> ya no hace falta pedirlos.
    expect(callbackActas).toBeTruthy();
    act(() => { callbackActas([actaElucion({ loteGenerador: "1-11111", actividadCalibrada: 1850 })]); });

    expect(screen.queryByText(/No se pudo verificar el historial de este lote/)).toBeNull();
    expect(screen.queryByText("Cargando datos del lote...")).toBeNull();
    expect(screen.queryByText(LABEL_MO99, { selector: "label" })).toBeNull();
  });

  test("caso normal (los 2 listeners entregan enseguida) -- nunca llega a armarse el timeout", async () => {
    vi.useFakeTimers();
    render(<TabElucion catalogo={CATALOGO} usuario={USUARIO} esAdmin={false} onToast={vi.fn()} />);
    abrirFormYTiparLoteSync();
    await act(async () => {}); // deja resolver el getDoc (promise real) de loteGeneradorYaRegistrado

    expect(screen.queryByText("Cargando datos del lote...")).toBeNull();
    expect(screen.getByText(LABEL_MO99, { selector: "label" })).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.queryByText(/No se pudo verificar el historial de este lote/)).toBeNull();
  });
});
