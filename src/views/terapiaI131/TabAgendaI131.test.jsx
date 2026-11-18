// Paso B1 (9/11, decisión de Pablo): mismo mecanismo de normalización de
// nombre de paciente que TabPacientes.jsx (ver TabPacientes.test.jsx) --
// acá sólo se cubre el campo "Paciente" de la Agenda I-131: valor crudo
// durante el tipeo, normalización en blur y de nuevo en guardar().
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabAgendaI131 } from "./TabAgendaI131.jsx";

afterEach(cleanup);

vi.mock("../../services/firestore/turnos.js", () => ({
  listenTurnosSemana: (_sedeId, _inicio, _fin, cb) => { cb([]); return () => {}; },
  turnosDeSemana: vi.fn(async () => []),
  addTurno: vi.fn(async () => {}),
  updateTurno: vi.fn(async () => {}),
  deleteTurno: vi.fn(async () => {}),
  addTurnosBatch: vi.fn(async () => {}),
  existeTurno: vi.fn(async () => false),
}));

vi.mock("../../services/firestore/pedidosSemanales.js", () => ({
  listenPedidoSemanal: (_sedeId, _semana, cb) => { cb(null); return () => {}; },
  guardarPedidoSemanal: vi.fn(async () => {}),
}));

const catalogo = {
  sedes: { central: { nombre: "FUESMEN Central", short: "Central", activo: true, principal: true, eliminada: false } },
};
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local", sede: "central" };

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

describe("TabAgendaI131 -- normalización de nombre de paciente en MAYÚSCULA (paso B1)", () => {
  async function abrirNuevoTurno(user) {
    render(<TabAgendaI131 catalogo={catalogo} usuario={usuario} esAdmin={false} onToast={vi.fn()} />);
    await user.click(await screen.findByText("+ Nuevo turno"));
  }

  test("mientras se tipea, el valor crudo NO se transforma (se ve en mayúscula sólo por CSS)", async () => {
    const user = userEvent.setup();
    await abrirNuevoTurno(user);
    const pacienteInput = labelInput("Paciente");

    await user.type(pacienteInput, "maría   josé");
    // Mutación: si normalizarNombrePaciente se aplicara en onChange, el
    // valor ya estaría recortado/colapsado/en mayúscula ACÁ -- este assert
    // tiene que fallar si eso pasa.
    expect(pacienteInput.value).toBe("maría   josé");
    expect(pacienteInput.className).toContain("uppercase");

    fireEvent.blur(pacienteInput);
    expect(pacienteInput.value).toBe("MARÍA JOSÉ");
  });

  test("guardar() normaliza aunque el campo nunca haya pasado por blur (mutación: sacar la normalización de guardar() rompe este test)", async () => {
    const turnosMod = await import("../../services/firestore/turnos.js");
    const user = userEvent.setup();
    await abrirNuevoTurno(user);

    fireEvent.input(labelInput("DNI"), { target: { value: "30111222" } });
    // fireEvent.input (no userEvent.type + blur): el campo Paciente nunca
    // dispara el evento blur de React -- el caso real que guardar() tiene
    // que seguir cubriendo igual, "Y de nuevo al guardar".
    const pacienteInput = labelInput("Paciente");
    fireEvent.input(pacienteInput, { target: { value: "ana   gomez" } });
    expect(pacienteInput.value).toBe("ana   gomez");

    // fireEvent.click (no userEvent.click): dispara el onClick de React sin
    // simular el cambio de foco que un click real movería.
    fireEvent.click(screen.getByRole("button", { name: "Guardar turno" }));
    await vi.waitFor(() => expect(turnosMod.addTurno).toHaveBeenCalledTimes(1));
    expect(turnosMod.addTurno.mock.calls[0][0].pacienteNombre).toBe("ANA GOMEZ");
  });
});
