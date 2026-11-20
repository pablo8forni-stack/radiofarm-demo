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
vi.mock("../../helpers/descargarArchivo.js", () => ({ descargarArchivo: vi.fn() }));

function labelInput(label) {
  return screen.getByText(label, { selector: "label" }).nextElementSibling;
}

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

// Paso CSV con anuladas (19/11): mismo cambio que TabPacientes.jsx, en el
// CSV de Gestión I-131 (sin "Sitio de inyección" -- I-131 oral nunca lo
// lleva, así que la última columna "vigente" se llama "Actividad
// administrada (vigente)", no "Dosis/Actividad (vigente)").
describe("TabRegistrosI131 -- Paso CSV con anuladas", () => {
  const ACTA_VIGENTE_CSV = {
    id: "acta-i131-csv-vigente", tipo: "i131_captacion", sedeId: "central", pacienteFicha: "960",
    pacienteNombre: "Paciente CSV Vigente", pacienteDni: "1", fecha: new Date(),
    actividadAdministrada: 90, unidadActividad: "uCi", usuarioNombre: "Tec",
  };
  const ACTA_ANULADA_CSV = {
    id: "acta-i131-csv-anulada", tipo: "i131_captacion", sedeId: "central", pacienteFicha: "961",
    pacienteNombre: "Paciente CSV Anulado", pacienteDni: "2", fecha: new Date(),
    actividadAdministrada: 90, unidadActividad: "uCi", usuarioNombre: "Tec",
  };
  // Subtipo ORAL (no MIBG) en intento 2, SIN reemplazaA -- simula ficha
  // liberada ("estudio no realizado") y reasignada a OTRO paciente: el
  // intento 2 existe, pero no reemplaza nada de este registro.
  const ACTA_ORAL_INTENTO2_SIN_REEMPLAZAA = {
    id: "acta-i131-csv-intento2", tipo: "i131_captacion", sedeId: "central", pacienteFicha: "962", fichaIntentoNro: "2",
    pacienteNombre: "Paciente CSV Distinto", pacienteDni: "3", fecha: new Date(),
    actividadAdministrada: 50, unidadActividad: "uCi", usuarioNombre: "Tec",
  };
  // MIBG recargado con "error de carga" DESDE TabPacientes.jsx (no desde
  // esta pantalla) -- la acta corregida vuelve a listarse acá porque
  // i131_mibg es uno de los 8 TIPOS_I131 de este archivo. Confirma que
  // "Reemplaza" NO queda siempre vacío en I-131 -- sólo en los 7 subtipos
  // orales, que nunca pasan por ese flujo.
  const ACTA_MIBG_RECARGA = {
    id: "acta-mibg-csv-recarga", tipo: "i131_mibg", sedeId: "central", pacienteFicha: "963", fichaIntentoNro: "2",
    pacienteNombre: "Paciente MIBG Recargado", pacienteDni: "4", fecha: new Date(),
    mibgLoteId: "lote-mibg-csv", actividadCalibrada: 20, numeroLote: "MIBG-2", usuarioNombre: "Tec",
    reemplazaA: "acta-mibg-csv-original",
  };

  function columnas(contenido) {
    const [header, fila] = contenido.split("\r\n");
    return { columnasHeader: header.split("\t"), columnasFila: fila.split("\t") };
  }
  function porHeader(columnasHeader, columnasFila, nombre) {
    return columnasFila[columnasHeader.indexOf(nombre)];
  }

  test("header termina en Estado/Tipo de anulación/Motivo de anulación/Reemplaza/Actividad administrada (vigente)", async () => {
    actasCaptacion = [ACTA_VIGENTE_CSV];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(columnasHeader.slice(-5)).toEqual(["Estado", "Tipo de anulación", "Motivo de anulación", "Reemplaza", "Actividad administrada (vigente)"]);
  });

  test("fila vigente: Estado=Vigente, los 3 de anulación vacíos, Actividad (vigente) = Actividad administrada", async () => {
    actasCaptacion = [ACTA_VIGENTE_CSV];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Estado")).toBe("Vigente");
    expect(porHeader(columnasHeader, columnasFila, "Tipo de anulación")).toBe("");
    expect(porHeader(columnasHeader, columnasFila, "Motivo de anulación")).toBe("");
    expect(porHeader(columnasHeader, columnasFila, "Reemplaza")).toBe("");
    expect(porHeader(columnasHeader, columnasFila, "Actividad administrada (vigente)")).toBe(porHeader(columnasHeader, columnasFila, "Actividad administrada"));
  });

  test("fila anulada con tipo: Estado=Anulada, Tipo=etiqueta, Motivo=motivo, Actividad (vigente) vacío", async () => {
    actasCaptacion = [ACTA_ANULADA_CSV];
    anulacionesParaTest = [{ id: "anula_acta-i131-csv-anulada", anulaId: "acta-i131-csv-anulada", motivo: "Motivo real", tipoAnulacion: "estudio_no_realizado" }];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Estado")).toBe("Anulada");
    expect(porHeader(columnasHeader, columnasFila, "Tipo de anulación")).toBe("Estudio no realizado (ficha liberada)");
    expect(porHeader(columnasHeader, columnasFila, "Motivo de anulación")).toBe("Motivo real");
    expect(porHeader(columnasHeader, columnasFila, "Actividad administrada (vigente)")).toBe("");
  });

  test("fila anulada SIN tipo (acta vieja): Estado=Anulada, Tipo vacío, Motivo presente", async () => {
    actasCaptacion = [ACTA_ANULADA_CSV];
    anulacionesParaTest = [{ id: "anula_acta-i131-csv-anulada", anulaId: "acta-i131-csv-anulada", motivo: "Motivo de antes" }];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Estado")).toBe("Anulada");
    expect(porHeader(columnasHeader, columnasFila, "Tipo de anulación")).toBe("");
    expect(porHeader(columnasHeader, columnasFila, "Motivo de anulación")).toBe("Motivo de antes");
  });

  test("'Reemplaza' vacío en un subtipo ORAL en intento 2 sin reemplazaA (ficha reasignada a otro paciente)", async () => {
    actasCaptacion = [ACTA_ORAL_INTENTO2_SIN_REEMPLAZAA];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Reemplaza")).toBe("");
  });

  // Confirma (no asume) la afirmación "en I-131 la columna queda vacía":
  // cierto para los 7 subtipos orales, FALSO para i131_mibg -- un MIBG
  // recargado con "error de carga" desde TabPacientes.jsx SÍ trae
  // reemplazaA, y esa acta vuelve a listarse en esta misma pantalla.
  test("'Reemplaza' SÍ aparece en una fila de MIBG recargada con reemplazaA (vuelve a listarse acá)", async () => {
    actasMibg = [ACTA_MIBG_RECARGA];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Reemplaza")).toBe("Ficha 963, intento 1");
  });

  test("export por rango: acta anulada cuya anulación es POSTERIOR al rango sigue saliendo 'Anulada'", async () => {
    const actasMod = await import("../../services/firestore/actas.js");
    vi.spyOn(actasMod, "actasPorRango").mockImplementation(async (tipo) => (tipo === "i131_captacion" ? [ACTA_ANULADA_CSV] : []));
    anulacionesParaTest = [{ id: "anula_acta-i131-csv-anulada", anulaId: "acta-i131-csv-anulada", motivo: "Anulada después", tipoAnulacion: "error_carga", fecha: new Date("2026-12-31") }];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ver todos" }));
    await user.type(labelInput("Desde"), "2026-11-01");
    await user.type(labelInput("Hasta"), "2026-11-10");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText(/Se encontraron 1 registro/);
    await user.click(screen.getByRole("button", { name: "↓ Descargar CSV" }));

    expect(descargarArchivo).toHaveBeenCalledTimes(1);
    const { columnasHeader, columnasFila } = columnas(descargarArchivo.mock.calls[0][0]);
    expect(porHeader(columnasHeader, columnasFila, "Estado")).toBe("Anulada");
  });

  // Guard (punto 3): reemplazaA presente pero fichaIntentoNro ausente o no
  // numérico -- "Reemplaza" vacío, nunca "intento NaN".
  test("'Reemplaza' vacío (nunca 'intento NaN') si reemplazaA está pero fichaIntentoNro falta o no es numérico", async () => {
    actasMibg = [
      { ...ACTA_MIBG_RECARGA, id: "acta-mibg-sin-intento", fichaIntentoNro: undefined },
      { ...ACTA_MIBG_RECARGA, id: "acta-mibg-intento-no-numerico", fichaIntentoNro: "dos" },
    ];
    const { descargarArchivo } = await import("../../helpers/descargarArchivo.js");
    const user = userEvent.setup();
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "↓ CSV" }));
    const contenido = descargarArchivo.mock.calls[0][0];
    const [header, ...filas] = contenido.split("\r\n");
    const columnasHeader = header.split("\t");
    for (const fila of filas) {
      const valor = porHeader(columnasHeader, fila.split("\t"), "Reemplaza");
      expect(valor).toBe("");
      expect(valor).not.toContain("NaN");
    }
  });

  // Punto 1: carrera de carga del Map de anulaciones -- ver comentario
  // largo equivalente en TabPacientes.test.jsx.
  test("'↓ CSV' queda deshabilitado con label '(verificando...)' antes del primer snapshot de anulaciones", async () => {
    const actasMod = await import("../../services/firestore/actas.js");
    vi.spyOn(actasMod, "listenAnulacionesActas").mockImplementationOnce(() => () => {});
    actasCaptacion = [ACTA_VIGENTE_CSV];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);

    const boton = await screen.findByRole("button", { name: "↓ CSV (verificando...)" });
    expect(boton.disabled).toBe(true);
  });

  test("'↓ CSV' queda deshabilitado con label '(error)' si el listener de anulaciones falla", async () => {
    const actasMod = await import("../../services/firestore/actas.js");
    vi.spyOn(actasMod, "listenAnulacionesActas").mockImplementationOnce((_cb, _opts, onError) => {
      onError(new Error("permission-denied"));
      return () => {};
    });
    actasCaptacion = [ACTA_VIGENTE_CSV];
    render(<TabRegistrosI131 catalogo={catalogo} usuario={admin} esAdmin onToast={vi.fn()} />);

    const boton = await screen.findByRole("button", { name: "↓ CSV (error)" });
    expect(boton.disabled).toBe(true);
  });
});
