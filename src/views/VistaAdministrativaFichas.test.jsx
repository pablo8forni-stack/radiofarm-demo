import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VistaAdministrativaFichas } from "./VistaAdministrativaFichas.jsx";
import { liberarEmisionStandalone, listenEmisionesFicha, listenEmisionesResueltas, listenFichaUsadaEstado } from "../services/firestore/emisionesFicha.js";

vi.mock("../services/firestore/actas.js", () => ({
  listenAnulacionesActas: (cb) => { cb([]); return () => {}; },
}));
vi.mock("../services/firestore/fichasDescartadas.js", () => ({
  listenFichasUsadasRecientes: (_sedeId, cb) => { cb([]); return () => {}; },
  listenFichasDescartadas: (_sedeId, cb) => { cb([]); return () => {}; },
}));
vi.mock("../components/actas/CartelFichasFaltantes.jsx", () => ({
  CartelFichasFaltantes: () => null,
}));
vi.mock("../components/actas/ModalEmitirFicha.jsx", () => ({
  ModalEmitirFicha: ({ onClose }) => <div data-testid="modal-emitir"><button onClick={onClose}>cerrar-stub</button></div>,
}));

let EMISIONES = [];
let RESUELTAS = [];
let ESTADOS_FICHA = {}; // numero -> {k, vigente, dni}

vi.mock("../services/firestore/emisionesFicha.js", () => ({
  listenEmisionesFicha: vi.fn((_sedeId, cb) => { cb(EMISIONES); return () => {}; }),
  listenEmisionesResueltas: vi.fn((_sedeId, cb) => { cb(RESUELTAS); return () => {}; }),
  listenFichaUsadaEstado: vi.fn((_sedeId, numero, cb) => { cb(ESTADOS_FICHA[numero] || { k: "0", vigente: false }); return () => {}; }),
  calcularFichaIntentoObservado: vi.fn(async (_sedeId, numero) => ESTADOS_FICHA[numero] || { k: "0", vigente: false }),
  liberarEmisionStandalone: vi.fn(async () => {}),
}));

// Bandera de funcionalidad (23/11): prendida por defecto para no tener que
// repetirlo en cada test existente -- el test específico de "apagada" la
// pisa con otro vi.stubEnv puntual.
beforeEach(() => {
  vi.stubEnv("VITE_EMISION_FICHAS_HABILITADA", "1");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  EMISIONES = [];
  RESUELTAS = [];
  ESTADOS_FICHA = {};
  vi.clearAllMocks();
});

const USUARIO_ADMINISTRATIVA = { email: "administrativa@x.com", nombre: "Admin Test", rol: "administrativa", sede: "central" };

function emisionBase(overrides = {}) {
  return {
    id: "central_111_1", sedeId: "central", numero: "111", pacienteFichaNum: 111, emisionVersion: "1",
    dni: "11111111", nombre: "Paciente Uno", estudio: "Amiloidosis", usuarioEmail: "administrativa@x.com",
    ...overrides,
  };
}

describe("VistaAdministrativaFichas -- emisión de fichas (Fase 2.1a)", () => {
  test("fila pendiente: Badge 'Pendiente' + botón Liberar", async () => {
    EMISIONES = [emisionBase()];
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(await screen.findByText("Pendiente")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Liberar" })).toBeTruthy();
  });

  test("fila con acta vigente y MISMO DNI: Badge 'Cargada', SIN botón Liberar", async () => {
    EMISIONES = [emisionBase()];
    ESTADOS_FICHA["111"] = { k: "1", vigente: true, dni: "11111111" };
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(await screen.findByText("Cargada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Liberar" })).toBeNull();
  });

  test("fila con acta vigente y OTRO DNI: Badge 'N° usado por otro paciente', CON botón Liberar", async () => {
    EMISIONES = [emisionBase()];
    ESTADOS_FICHA["111"] = { k: "1", vigente: true, dni: "99999999" };
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(await screen.findByText("N° usado por otro paciente")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Liberar" })).toBeTruthy();
  });

  test("fila liberada: Badge 'Liberada' con el motivo tal cual", async () => {
    EMISIONES = [emisionBase()];
    RESUELTAS = [{ id: "central_111_1", estado: "liberada", motivo: "Ficha vencida sin usar" }];
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(await screen.findByText("Liberada")).toBeTruthy();
    expect(screen.getByText("Ficha vencida sin usar")).toBeTruthy();
  });

  test("Liberar: contador de caracteres, deshabilitado sin motivo, llama a liberarEmisionStandalone con motivo recortado", async () => {
    const user = userEvent.setup();
    EMISIONES = [emisionBase()];
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Liberar" }));

    const motivoInput = screen.getByText("Motivo (obligatorio)", { selector: "label" }).nextElementSibling;
    expect(screen.getByRole("button", { name: "Confirmar" }).disabled).toBe(true);
    await user.type(motivoInput, "  Vencida  ");
    expect(screen.getByText("11/300")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar" }).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(liberarEmisionStandalone).toHaveBeenCalledWith({
      sedeId: "central", numero: "111", emisionVersion: "1", motivo: "  Vencida  ", usuarioEmail: "administrativa@x.com",
    });
  });

  test("Liberar: permission-denied muestra el mensaje de carrera, no un error crudo", async () => {
    const user = userEvent.setup();
    EMISIONES = [emisionBase()];
    const err = new Error("boom");
    err.code = "permission-denied";
    liberarEmisionStandalone.mockRejectedValueOnce(err);
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Liberar" }));
    const motivoInput = screen.getByText("Motivo (obligatorio)", { selector: "label" }).nextElementSibling;
    await user.type(motivoInput, "x");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/estado de esta ficha cambió/)).toBeTruthy();
  });

  test("admin SIN sedeAuditando: aviso naranja visible", async () => {
    render(<VistaAdministrativaFichas usuario={{ email: "admin@x.com", rol: "admin", sede: "central" }} onToast={vi.fn()} />);
    expect(await screen.findByText(/Sede en auditoría/)).toBeTruthy();
  });

  test("admin CON sedeAuditando==su sede: sin aviso", async () => {
    render(<VistaAdministrativaFichas usuario={{ email: "admin@x.com", rol: "admin", sede: "central", sedeAuditando: "central" }} onToast={vi.fn()} />);
    expect(screen.queryByText(/Sede en auditoría/)).toBeNull();
  });

  test("Emitir ficha: abre el modal", async () => {
    const user = userEvent.setup();
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Emitir ficha" }));
    expect(screen.getByTestId("modal-emitir")).toBeTruthy();
  });

  test("bandera APAGADA: no renderiza la sección NI abre ningún listener de emisionesFicha", async () => {
    vi.stubEnv("VITE_EMISION_FICHAS_HABILITADA", "0");
    EMISIONES = [emisionBase()];
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(screen.queryByText("Emisión de fichas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Emitir ficha" })).toBeNull();
    expect(listenEmisionesFicha).not.toHaveBeenCalled();
    expect(listenEmisionesResueltas).not.toHaveBeenCalled();
    expect(listenFichaUsadaEstado).not.toHaveBeenCalled();
  });

  test("bandera sin definir (default, como en producción): tampoco renderiza ni escucha", async () => {
    vi.stubEnv("VITE_EMISION_FICHAS_HABILITADA", undefined);
    render(<VistaAdministrativaFichas usuario={USUARIO_ADMINISTRATIVA} onToast={vi.fn()} />);
    expect(screen.queryByText("Emisión de fichas")).toBeNull();
    expect(listenEmisionesFicha).not.toHaveBeenCalled();
  });
});
