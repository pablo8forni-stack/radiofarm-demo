// Cantidad fija = 1 para los motivos de marcación (Estudio, Control de
// calidad, Otro); el descarte (Vencimiento/Derrame) conserva el campo
// editable -- mismo criterio que exige firestore.rules del lado del
// servidor (movimientoValido/esMotivoDescarte). Caso real que motivó esto:
// una técnica hizo un egreso con cantidad = 2 y sólo pudo cargar una
// marcación -- el egreso real es siempre de un vial.
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalEgreso } from "./ModalEgreso.jsx";

afterEach(cleanup);

const farm = { id: "mibi", nombre: "MIBI (Sestamibi)" };
const lotes = [{ id: "l1", lote: "1-11111", cantidad: 10, vencimiento: "2027-01-01" }];
const usuario = { nombre: "Técnica Test", email: "tecnica@test.local" };

function labelField(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

test("motivo de marcación (Estudio, el default) -- no hay input de cantidad, queda fijo en 1 vial", () => {
  render(<ModalEgreso open farm={farm} lotes={lotes} usuario={usuario} onConfirm={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByText("Cantidad (viales)")).toBeNull();
  expect(screen.queryByText("1 vial")).not.toBeNull();
});

test("motivo de descarte (Vencimiento) -- el input de cantidad reaparece, editable", async () => {
  const user = userEvent.setup();
  render(<ModalEgreso open farm={farm} lotes={lotes} usuario={usuario} onConfirm={vi.fn()} onClose={vi.fn()} />);
  await user.selectOptions(labelField("Motivo"), "Vencimiento");
  expect(screen.queryByText("Cantidad (viales)")).not.toBeNull();
  expect(screen.queryByText("1 vial")).toBeNull();
});

test("confirmar con motivo de marcación -- onConfirm recibe cantidad: 1 siempre, sin importar el estado previo", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn(async () => {});
  render(<ModalEgreso open farm={farm} lotes={lotes} usuario={usuario} onConfirm={onConfirm} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 1, motivo: "Estudio" }));
});

test("confirmar con motivo de descarte y cantidad editada -- onConfirm recibe la cantidad elegida", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn(async () => {});
  render(<ModalEgreso open farm={farm} lotes={lotes} usuario={usuario} onConfirm={onConfirm} onClose={vi.fn()} />);
  await user.selectOptions(labelField("Motivo"), "Vencimiento");
  // click (no clear()): el propio Input hace select-all en el onFocus de un
  // number (ver Input.jsx) -- clear() deja el valor clampeado de nuevo en 1
  // (Math.max(1, parseInt("")||1)) antes de poder escribir nada, mismo
  // comportamiento que vería un técnico tipeando a mano.
  await user.click(labelField("Cantidad (viales)"));
  await user.keyboard("3");
  await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 3, motivo: "Vencimiento" }));
});

// Caso que motivó cantidadEfectiva en vez de enviar el estado `cantidad`
// crudo: si la técnica probó "Vencimiento" con cantidad 3 y después se dio
// cuenta de que el motivo real era "Estudio", el 3 que quedó en el estado NO
// se tiene que colar en el envío.
test("volver de descarte a motivo de marcación -- la cantidad vieja del descarte no se filtra al envío", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn(async () => {});
  render(<ModalEgreso open farm={farm} lotes={lotes} usuario={usuario} onConfirm={onConfirm} onClose={vi.fn()} />);
  await user.selectOptions(labelField("Motivo"), "Vencimiento");
  await user.click(labelField("Cantidad (viales)"));
  await user.keyboard("3");
  await user.selectOptions(labelField("Motivo"), "Estudio");
  await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 1, motivo: "Estudio" }));
});
