import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalEmitirFicha } from "./ModalEmitirFicha.jsx";
import { crearEmisionFicha } from "../../services/firestore/emisionesFicha.js";

vi.mock("../../services/firestore/emisionesFicha.js", () => ({
  crearEmisionFicha: vi.fn(async () => {}),
}));

const ESTUDIOS_TEST = [{ id: "e1", nombre: "Amiloidosis" }, { id: "e2", nombre: "Centellograma óseo" }];
vi.mock("../../services/firestore/estudios.js", () => ({
  listenEstudios: (cb) => { cb(ESTUDIOS_TEST); return () => {}; },
}));

afterEach(cleanup);

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

describe("ModalEmitirFicha", () => {
  test("Emitir deshabilitado hasta completar N°/DNI/nombre/estudio", async () => {
    const user = userEvent.setup();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="x@x.com" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(true);

    await user.type(labelInput("N° de Ficha (VM RIS)"), "123");
    await user.type(labelInput("DNI"), "11111111");
    await user.type(labelInput("Nombre del paciente"), "Paciente Test");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(true);

    await user.selectOptions(labelInput("Estudio"), "e1");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(false);
  });

  test("N° con letras no habilita Emitir aunque el resto esté completo", async () => {
    const user = userEvent.setup();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="x@x.com" onClose={vi.fn()} />);
    await user.type(labelInput("N° de Ficha (VM RIS)"), "12a3");
    await user.type(labelInput("DNI"), "1");
    await user.type(labelInput("Nombre del paciente"), "N");
    await user.selectOptions(labelInput("Estudio"), "e1");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(true);
  });

  test("Estudio 'Otro...': exige el texto libre, no habilita con el selector solo", async () => {
    const user = userEvent.setup();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="x@x.com" onClose={vi.fn()} />);
    await user.type(labelInput("N° de Ficha (VM RIS)"), "123");
    await user.type(labelInput("DNI"), "1");
    await user.type(labelInput("Nombre del paciente"), "N");
    await user.selectOptions(labelInput("Estudio"), "__otro__");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(true);
    await user.type(labelInput("¿Cuál?"), "Estudio no listado");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(false);
  });

  test("éxito: nombre en MAYÚSCULA (onBlur) y DNI sólo recortado -- llama a crearEmisionFicha así", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEmitida = vi.fn();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="admin@x.com" onClose={onClose} onEmitida={onEmitida} />);
    await user.type(labelInput("N° de Ficha (VM RIS)"), "123");
    await user.type(labelInput("DNI"), " 11.111.111 ");
    await user.type(labelInput("Nombre del paciente"), "maría josé");
    await user.tab(); // dispara el onBlur de Nombre
    await user.selectOptions(labelInput("Estudio"), "e2");
    await user.click(screen.getByRole("button", { name: "Emitir" }));

    expect(crearEmisionFicha).toHaveBeenCalledWith({
      sedeId: "central", numero: "123",
      dni: " 11.111.111 ".trim(), // sólo trim -- NO se sacan los puntos (ver comentario del componente)
      nombre: "MARÍA JOSÉ", estudio: "Centellograma óseo", usuarioEmail: "admin@x.com",
      peso: "", talla: "",
    });
    expect(onEmitida).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("peso/talla opcionales: vacíos no bloquean el envío", async () => {
    const user = userEvent.setup();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="admin@x.com" onClose={vi.fn()} />);
    await user.type(labelInput("N° de Ficha (VM RIS)"), "123");
    await user.type(labelInput("DNI"), "1");
    await user.type(labelInput("Nombre del paciente"), "N");
    await user.selectOptions(labelInput("Estudio"), "e1");
    expect(screen.getByRole("button", { name: "Emitir" }).disabled).toBe(false);
  });

  test("error: muestra el mensaje de crearEmisionFicha, NO cierra el modal", async () => {
    crearEmisionFicha.mockRejectedValueOnce(new Error("Este N° de ficha ya tiene un acta vigente -- no se puede emitir."));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ModalEmitirFicha sedeId="central" usuarioEmail="admin@x.com" onClose={onClose} />);
    await user.type(labelInput("N° de Ficha (VM RIS)"), "123");
    await user.type(labelInput("DNI"), "1");
    await user.type(labelInput("Nombre del paciente"), "N");
    await user.selectOptions(labelInput("Estudio"), "e1");
    await user.click(screen.getByRole("button", { name: "Emitir" }));

    expect(await screen.findByText(/acta vigente/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
