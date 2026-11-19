import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabRegistrosI131 } from "./TabRegistrosI131.jsx";

afterEach(cleanup);

function listenerCon(cb, datos = []) {
  cb(datos);
  return () => {};
}

let actasCaptacion = [];
let actasMibg = [];
let anulacionesParaTest = [];

vi.mock("../../services/firestore/actas.js", () => ({
  listenActas: (tipo, cb) => {
    if (tipo === "i131_captacion") return listenerCon(cb, actasCaptacion);
    if (tipo === "i131_mibg") return listenerCon(cb, actasMibg);
    return listenerCon(cb, []);
  },
  actasPorRango: vi.fn(async () => []),
  anularActaTransaction: vi.fn(async () => {}),
  listenAnulacionesActas: (cb) => listenerCon(cb, anulacionesParaTest),
}));

const catalogo = {
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false, farmIds: [], puntosReorden: {} } },
};
const admin = { nombre: "Admin Test", email: "admin@test.local", sede: "central", sedeAuditando: "central" };

const ACTA_CAPTACION = {
  id: "acta-i131-paso-t", tipo: "i131_captacion", sedeId: "central", pacienteFicha: "900",
  pacienteNombre: "Paciente I131 Test", pacienteDni: "40111222",
  fecha: new Date(), actividadAdministrada: 90, unidadActividad: "uCi", usuarioNombre: "Tec",
};

const ACTA_MIBG = {
  id: "acta-mibg-paso-t", tipo: "i131_mibg", sedeId: "central", pacienteFicha: "901",
  pacienteNombre: "Paciente MIBG Test", pacienteDni: "40111333",
  fecha: new Date(), mibgLoteId: "lote-mibg-paso-t", actividadCalibrada: 20, numeroLote: "MIBG-1", usuarioNombre: "Tec",
};

afterEach(() => { actasCaptacion = []; actasMibg = []; anulacionesParaTest = []; });

// Paso T (19/11): mismo gate que TabPacientes.jsx (ModalAnularActa.jsx,
// acta.pacienteFicha) -- este test cubre la pantalla de I-131, que NUNCA
// reabre un formulario (ver confirmarAnulacion en TabRegistrosI131.jsx):
// a diferencia de TabPacientes.jsx, acá el tipo elegido sólo cambia el
// toast, nunca reemplazaA (no se crea ninguna acta nueva desde esta
// pantalla).
describe("TabRegistrosI131 -- Paso T: tipo de anulación", () => {
  async function anular(user, tipoLabel) {
    actasCaptacion = [ACTA_CAPTACION];
    const onToast = vi.fn();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={onToast} />);
    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    await user.click(botonesAnular[0]);
    await user.type(screen.getByPlaceholderText("Ej: Error en la dosis cargada, paciente equivocado..."), "Motivo I131");
    await user.click(screen.getByRole("button", { name: tipoLabel }));
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));
    return onToast;
  }

  test("el selector de tipo de anulación aparece para un acta con ficha", async () => {
    actasCaptacion = [ACTA_CAPTACION];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    const user = userEvent.setup();
    await user.click(botonesAnular[0]);
    expect(screen.getByText("Tipo de anulación (obligatorio)")).toBeTruthy();
  });

  test("'Estudio no realizado' muestra el toast 'Ficha liberada: estudio no realizado.'", async () => {
    const user = userEvent.setup();
    const onToast = await anular(user, "Estudio no realizado (ficha liberada)");
    expect(onToast).toHaveBeenCalledWith("Ficha liberada: estudio no realizado.", "info", 8000);
  });

  test("'Error de carga' muestra el toast de siempre (volver a cargar en Libro 2)", async () => {
    const user = userEvent.setup();
    const onToast = await anular(user, "Error de carga (mismo paciente)");
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("volvé a cargarlo en Libro 2 (Pacientes) eligiendo I-131"),
      "info", 8000
    );
  });

  test("la fila muestra 'ANULADO (tipo): motivo'", async () => {
    actasCaptacion = [ACTA_CAPTACION];
    anulacionesParaTest = [{ id: "anula_acta-i131-paso-t", anulaId: "acta-i131-paso-t", motivo: "Motivo viejo", tipoAnulacion: "estudio_no_realizado" }];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    expect(await screen.findAllByText((_, el) => el?.textContent === "ANULADO (Estudio no realizado (ficha liberada)): Motivo viejo")).not.toHaveLength(0);
  });

  test("una anulación vieja sin tipo se ve como antes, sin paréntesis", async () => {
    actasCaptacion = [ACTA_CAPTACION];
    anulacionesParaTest = [{ id: "anula_acta-i131-paso-t", anulaId: "acta-i131-paso-t", motivo: "Motivo viejo" }];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    expect(await screen.findAllByText((_, el) => el?.textContent === "ANULADO: Motivo viejo")).not.toHaveLength(0);
  });

  // Punto 4 (notaExtra de MIBG, corregido): el lote NO se anula -- queda
  // disponible para reasignar sin ningún paso extra (confirmado por código,
  // ver usoActivoDeLote/estadoPorLoteDosisUnica en mibgLotes.js, que
  // excluyen la administración anulada del cálculo de "usado"). El texto
  // viejo decía lo contrario ("también anula el lote... nunca se
  // reutiliza") -- corregido.
  test("notaExtra de MIBG dice que el lote sigue disponible para reasignar (NO que se anula)", async () => {
    actasMibg = [ACTA_MIBG];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    const user = userEvent.setup();
    await user.click(botonesAnular[0]);
    expect(screen.getByText(/El lote físico sigue siendo válido/)).toBeTruthy();
    expect(screen.queryByText(/también anula el lote/)).toBeNull();
    expect(screen.queryByText(/nunca se reutiliza/)).toBeNull();
  });

  test("'Estudio no realizado' en MIBG: el toast agrega que el lote sigue disponible para reasignar", async () => {
    actasMibg = [ACTA_MIBG];
    const onToast = vi.fn();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={onToast} />);
    const botonesAnular = await screen.findAllByRole("button", { name: "Anular" });
    const user = userEvent.setup();
    await user.click(botonesAnular[0]);
    await user.type(screen.getByPlaceholderText("Ej: Error en la dosis cargada, paciente equivocado..."), "Motivo MIBG");
    await user.click(screen.getByRole("button", { name: "Estudio no realizado (ficha liberada)" }));
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    expect(onToast).toHaveBeenCalledWith("Ficha liberada: estudio no realizado. El lote sigue disponible para reasignar.", "info", 8000);
  });
});
