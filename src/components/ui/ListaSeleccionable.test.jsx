import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListaSeleccionable } from "./ListaSeleccionable.jsx";

afterEach(cleanup);

const OPCIONES = [
  { value: "L1", label: "L1 · Venc: 01/01/2027", disabled: true, disabledHint: "ya no es la marcación más reciente" },
  { value: "L2", label: "L2 · Venc: 01/01/2027" },
];

describe("ListaSeleccionable", () => {
  test("clickear una opción deshabilitada no elige nada ni cierra con ese valor", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ListaSeleccionable label="Lote" value="" onChange={onChange} options={OPCIONES} />);

    await user.click(screen.getByRole("combobox"));
    const deshabilitada = screen.getByRole("option", { name: /L1.*ya no es la marcación más reciente/ });
    expect(deshabilitada.getAttribute("aria-disabled")).toBe("true");
    await user.click(deshabilitada);

    expect(onChange).not.toHaveBeenCalled();
    // la lista sigue abierta (un click en una opción deshabilitada no hace nada, ni cierra)
    expect(screen.getByRole("listbox")).not.toBe(null);
  });

  test("clickear una opción habilitada elige y cierra", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ListaSeleccionable label="Lote" value="" onChange={onChange} options={OPCIONES} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /^L2/ }));

    expect(onChange).toHaveBeenCalledWith("L2");
    expect(screen.queryByRole("listbox")).toBe(null);
  });

  test("teclado: ArrowDown abre la lista y salta la opción deshabilitada; Enter elige la resaltada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ListaSeleccionable label="Lote" value="" onChange={onChange} options={OPCIONES} />);

    const boton = screen.getByRole("combobox");
    await user.click(boton); // enfoca (mismo mecanismo que un click real) -- se abre acá
    await user.keyboard("{Escape}"); // cierra sin elegir, el foco queda en el botón
    expect(screen.queryByRole("listbox")).toBe(null);

    await user.keyboard("{ArrowDown}"); // reabre desde cerrado -- resalta la primera HABILITADA (L2, salta L1)
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    expect(boton.getAttribute("aria-activedescendant")).toMatch(/-opt-L2$/);

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("L2");
    expect(screen.queryByRole("listbox")).toBe(null);
    // el foco nunca salió del botón (patrón aria-activedescendant)
    expect(document.activeElement).toBe(boton);
  });

  test("teclado: Escape cierra sin elegir nada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ListaSeleccionable label="Lote" value="" onChange={onChange} options={OPCIONES} />);

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).not.toBe(null);
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBe(null);
  });

  test("con un value ya elegido que ahora es la opción deshabilitada, el botón lo sigue mostrando (no se borra solo)", () => {
    render(<ListaSeleccionable label="Lote" value="L1" onChange={() => {}} options={OPCIONES} />);
    expect(screen.getByRole("combobox").textContent).toContain("L1 · Venc: 01/01/2027");
  });
});
