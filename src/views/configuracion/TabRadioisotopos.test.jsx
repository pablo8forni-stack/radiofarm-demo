// Bug real investigado con Pablo: "+ Nuevo isótopo" siempre genera un id
// aleatorio -- nunca los 3 ids fijos (tc99m/lu177/i131) que el resto de la
// app reconoce (ver isotoposCasoDistinto en TabPacientes.jsx). Si alguien
// carga "Lutecio-177" a mano pensando que eso alcanza, el interruptor "¿Es
// un caso distinto a Tc-99m?" sigue sin ofrecerlo -- entrada inerte, sin
// ningún aviso. Estos tests cubren el bloqueo con variantes de tipeo, y que
// los 3 isótopos base queden protegidos de edición/borrado accidental (como
// pasó en esta misma investigación, por error, al limpiar datos de prueba).
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabRadioisotopos } from "./TabRadioisotopos.jsx";

afterEach(cleanup);

const addRadioisotopo = vi.fn(async () => {});
const updateRadioisotopo = vi.fn(async () => {});
const deleteRadioisotopo = vi.fn(async () => {});
const sembrarRadioisotoposBase = vi.fn(async () => {});

vi.mock("../../services/firestore/radioisotopos.js", () => ({
  addRadioisotopo: (...args) => addRadioisotopo(...args),
  updateRadioisotopo: (...args) => updateRadioisotopo(...args),
  deleteRadioisotopo: (...args) => deleteRadioisotopo(...args),
  sembrarRadioisotoposBase: (...args) => sembrarRadioisotoposBase(...args),
}));

const catalogoConLosTres = {
  radioisotopos: [
    { id: "tc99m", nombre: "Tc-99m" },
    { id: "lu177", nombre: "Lutecio-177" },
    { id: "i131", nombre: "I-131" },
    { id: "yodo123-9821", nombre: "Yodo-123" },
  ],
};

async function abrirYEscribir(user, nombre) {
  render(<TabRadioisotopos catalogo={catalogoConLosTres} onToast={vi.fn()} />);
  await user.click(screen.getByText("+ Nuevo isótopo", { exact: true }));
  const input = screen.getByPlaceholderText("Ej: Lutecio-177");
  await user.type(input, nombre);
  await user.click(screen.getByText("Agregar", { exact: true }));
}

describe("TabRadioisotopos -- '+ Nuevo isótopo' bloquea nombres que normalizan a un id base", () => {
  afterEach(() => { addRadioisotopo.mockClear(); });

  const variantes = [
    "Lutecio-177", "lutecio 177", "Lu-177",
    "I131", "i-131",
    "Tc99m", "TC-99m",
  ];

  for (const variante of variantes) {
    test(`bloquea "${variante}"`, async () => {
      const user = userEvent.setup();
      await abrirYEscribir(user, variante);

      expect(addRadioisotopo).not.toHaveBeenCalled();
      const mensaje = screen.getByText(/ya tienen su id especial reservado/);
      expect(mensaje).toBeTruthy();
      expect(mensaje.textContent).toContain("Restaurar isótopos base");
    });
  }

  test("un nombre normal (no reservado) SÍ se agrega", async () => {
    const user = userEvent.setup();
    await abrirYEscribir(user, "Galio-68");

    expect(addRadioisotopo).toHaveBeenCalledWith({ nombre: "Galio-68" });
    expect(screen.queryByText(/ya tienen su id especial reservado/)).toBeNull();
  });
});

describe("TabRadioisotopos -- los 3 isótopos base quedan protegidos de edición/borrado", () => {
  test("tc99m/lu177/i131 muestran 'Protegido' en vez de Editar/Quitar", () => {
    render(<TabRadioisotopos catalogo={catalogoConLosTres} onToast={vi.fn()} />);

    const protegidos = screen.getAllByText("Protegido", { exact: true });
    expect(protegidos).toHaveLength(3);
  });

  test("un isótopo NO base (ej. Yodo-123) conserva Editar/Quitar", async () => {
    render(<TabRadioisotopos catalogo={catalogoConLosTres} onToast={vi.fn()} />);

    const fila = screen.getByText("Yodo-123").closest(".justify-between");
    expect(fila.textContent).toContain("Editar");
    expect(fila.textContent).toContain("Quitar");
  });

  test("clickear 'Quitar'/'Editar' nunca se ofrece para un isótopo base (no hay botón que clickear)", () => {
    render(<TabRadioisotopos catalogo={catalogoConLosTres} onToast={vi.fn()} />);

    // Sólo debe haber 1 "Editar" y 1 "Quitar" en toda la pantalla (los del
    // único isótopo no protegido, Yodo-123) -- los 3 base no los ofrecen.
    expect(screen.getAllByText("Editar", { exact: true })).toHaveLength(1);
    expect(screen.getAllByText("Quitar", { exact: true })).toHaveLength(1);
  });
});
