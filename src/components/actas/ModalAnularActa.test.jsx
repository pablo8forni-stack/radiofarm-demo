import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalAnularActa } from "./ModalAnularActa.jsx";

afterEach(cleanup);

// Paso T (19/11): el selector de tipo de anulación depende SOLO de
// acta.pacienteFicha -- ya presente en Tc-99m/Lutecio-177 ("paciente") y
// los 8 subtipos de I-131 oral (incluido MIBG), ausente en elución,
// marcación y los dos anuladores de lotes (mibg_lote/lote_dosis_unica). No
// hace falta levantar cada pantalla real: este test cubre el gate
// directamente sobre el modal compartido por las 7.
const ACTA_CON_FICHA = { id: "a1", fecha: new Date(), pacienteFicha: "123" };
const ACTA_SIN_FICHA = { id: "a2", fecha: new Date() };

// Input.jsx no asocia <label> e <input> por htmlFor/id (confirmado
// probando getByLabelText, que no los encuentra) -- mismo helper que ya usa
// TabPacientes.test.jsx para este mismo componente.
function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

describe("ModalAnularActa -- tipo de anulación", () => {
  test("acta CON pacienteFicha (Tc-99m/MIBG/I-131): muestra el selector, Confirmar deshabilitado sin elegir tipo", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ModalAnularActa acta={ACTA_CON_FICHA} resumen="Paciente Test" onConfirm={onConfirm} onClose={() => {}} />);

    expect(screen.getByText("Tipo de anulación (obligatorio)")).toBeTruthy();
    await user.type(labelInput("Motivo de la anulación (obligatorio)"), "Test");
    expect(screen.getByRole("button", { name: "Confirmar anulación" }).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Error de carga (mismo paciente)" }));
    expect(screen.getByRole("button", { name: "Confirmar anulación" }).disabled).toBe(false);
  });

  test("acta SIN pacienteFicha (elución/marcación/lotes): no muestra el selector, Confirmar se habilita sólo con motivo", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ModalAnularActa acta={ACTA_SIN_FICHA} resumen="Movimiento Test" onConfirm={onConfirm} onClose={() => {}} />);

    expect(screen.queryByText("Tipo de anulación (obligatorio)")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar anulación" }).disabled).toBe(true);
    await user.type(labelInput("Motivo de la anulación (obligatorio)"), "Test");
    expect(screen.getByRole("button", { name: "Confirmar anulación" }).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));
    expect(onConfirm).toHaveBeenCalledWith(ACTA_SIN_FICHA, "Test", null);
  });

  test("elige 'Estudio no realizado' y confirma: onConfirm recibe ese tipo", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ModalAnularActa acta={ACTA_CON_FICHA} resumen="Paciente Test" onConfirm={onConfirm} onClose={() => {}} />);

    await user.type(labelInput("Motivo de la anulación (obligatorio)"), "No vino");
    await user.click(screen.getByRole("button", { name: "Estudio no realizado (ficha liberada)" }));
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    expect(onConfirm).toHaveBeenCalledWith(ACTA_CON_FICHA, "No vino", "estudio_no_realizado");
  });
});
