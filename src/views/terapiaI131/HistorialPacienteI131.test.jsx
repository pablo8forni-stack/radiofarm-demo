// Bug real (Pablo, visto al arreglar el modal de Stock de viales): las 10
// consultas de actasPorPacienteDni corrían en un Promise.all envuelto en un
// único timeout -- si UNA fallaba o se colgaba, se perdían los resultados
// de las otras 9, y el modal mostraba a la vez un error crudo de Firebase Y
// "Sin registros de I-131 para este DNI" como si fuera un hallazgo
// confirmado. Reproducido en staging real con un técnico sin
// accesoTerapiaI131 (permission-denied en 2 de los 10 tipos) y con la red
// del browser cortada (persistencia offline sirve datos viejos en
// silencio, sin error). Estos tests cubren el rediseño: Promise.allSettled,
// timeout por consulta, aviso de incompleto, caja roja sólo si fallan las
// 10, y la marca de incompleto en el archivo descargado.
import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistorialPacienteI131 } from "./HistorialPacienteI131.jsx";

afterEach(cleanup);

let impl;
vi.mock("../../services/firestore/actas.js", () => ({
  actasPorPacienteDni: (tipo, params) => impl(tipo, params),
}));

let archivosDescargados = [];
vi.mock("../../helpers/descargarArchivo.js", () => ({
  descargarArchivo: (contenido, nombreArchivo, mime) => { archivosDescargados.push({ contenido, nombreArchivo, mime }); },
}));

const TODOS_LOS_TIPOS = [
  "i131_ablativa", "i131_dosis", "i131_barrido", "i131_dosis_barrido", "i131_mibg",
  "i131_captacion", "i131_centellograma", "i131_captacion_centellograma",
  "i131_captacion_resultado", "i131_seguimiento_fin",
];

function actaDe(tipo, i) {
  const base = { id: `${tipo}-${i}`, tipo, pacienteDni: "12345678", pacienteNombre: "Paciente Test", sedeNombre: "Central", fecha: new Date(2026, 0, i + 1), usuarioNombre: "Técnica Test" };
  // detalleFila (HistorialPacienteI131.jsx) exige campos puntuales según
  // el tipo -- sin esto cualquier tipo real de los 10 rompe el render.
  if (tipo === "i131_captacion_resultado") return { ...base, momento: "48h", porcentajeCaptacion: 12.5 };
  if (tipo === "i131_ablativa" || tipo === "i131_dosis") return { ...base, actividadAdministrada: 30, lote: "LOTE1" };
  if (tipo === "i131_mibg") return { ...base, actividadCalibrada: 20, numeroLote: "LOTE-MIBG" };
  return base;
}

// Por defecto, cada tipo resuelve con un acta propia -- sin fromCache. Los
// tests que necesitan que algún tipo falle/se cuelgue pisan `impl` antes de
// renderizar.
function implTodoOk(tipo) {
  return Promise.resolve({ docs: [actaDe(tipo, TODOS_LOS_TIPOS.indexOf(tipo))], fromCache: false });
}

beforeEach(() => {
  impl = implTodoOk;
  archivosDescargados = [];
});

async function abrir(props = {}) {
  render(
    <HistorialPacienteI131
      open dni="12345678" sedeId="central" esAdmin={false} onClose={vi.fn()} onToast={vi.fn()}
      {...props}
    />
  );
  await screen.findByText(/^\d+ registros?$/);
}

describe("HistorialPacienteI131 -- Promise.allSettled, timeout por consulta y avisos de incompleto/caché", () => {
  test("ninguna consulta falla: sin aviso, comportamiento normal", async () => {
    await abrir();

    expect(screen.getByText("10 registros")).toBeTruthy();
    expect(screen.queryByText(/Historial incompleto/)).toBeNull();
    expect(screen.queryByText(/caché/)).toBeNull();
    expect(screen.queryByText(/No se pudo leer el historial/)).toBeNull();
  });

  test("una consulta falla (permission-denied): aviso ámbar nombrando ese tipo, las otras 9 se muestran", async () => {
    impl = (tipo) => {
      if (tipo === "i131_seguimiento_fin") {
        const e = new Error("Missing or insufficient permissions.");
        e.code = "permission-denied";
        return Promise.reject(e);
      }
      return implTodoOk(tipo);
    };
    await abrir();

    expect(screen.getByText("9 registros")).toBeTruthy();
    const aviso = screen.getByText(/Historial incompleto/);
    expect(aviso.closest("div").textContent).toContain("Fin de seguimiento");
    expect(aviso.closest("div").textContent).toContain("1 de 10");
    // No la caja roja de fallo total.
    expect(screen.queryByText(/No se pudo leer el historial/)).toBeNull();
  });

  test("fallan las 10: caja roja traducida, sin '0 registros' ni 'Sin registros de I-131'", async () => {
    impl = () => {
      const e = new Error("Missing or insufficient permissions.");
      e.code = "permission-denied";
      return Promise.reject(e);
    };
    render(<HistorialPacienteI131 open dni="12345678" sedeId="central" esAdmin={false} onClose={vi.fn()} onToast={vi.fn()} />);

    expect(await screen.findByText(/No se pudo leer el historial/)).toBeTruthy();
    expect(screen.getByText(/No tiene permiso/i, { exact: false })).toBeTruthy();
    expect(screen.queryByText(/registros$/)).toBeNull();
    expect(screen.queryByText("Sin registros de I-131 para este DNI.")).toBeNull();
  });

  test("una consulta nunca responde: su propio timeout la cuenta como fallida, sin tirar las demás", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    impl = (tipo) => {
      if (tipo === "i131_mibg") return new Promise(() => {}); // nunca resuelve
      return implTodoOk(tipo);
    };
    render(<HistorialPacienteI131 open dni="12345678" sedeId="central" esAdmin={false} onClose={vi.fn()} onToast={vi.fn()} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });

    expect(screen.getByText("9 registros")).toBeTruthy();
    const aviso = screen.getByText(/Historial incompleto/);
    expect(aviso.closest("div").textContent).toContain("MIBG");
    vi.useRealTimers();
  });

  test("hubo caché (offline, persistencia local): aviso de posible desactualizado", async () => {
    impl = (tipo) => Promise.resolve({ docs: [actaDe(tipo, TODOS_LOS_TIPOS.indexOf(tipo))], fromCache: tipo === "i131_dosis" });
    await abrir();

    expect(screen.getByText("10 registros")).toBeTruthy();
    expect(screen.getByText(/caché de este dispositivo/)).toBeTruthy();
    expect(screen.queryByText(/Historial incompleto/)).toBeNull();
  });

  test("descarga: el archivo lleva la marca de incompleto en sus primeras filas", async () => {
    impl = (tipo) => {
      if (tipo === "i131_captacion_resultado") {
        const e = new Error("Missing or insufficient permissions.");
        e.code = "permission-denied";
        return Promise.reject(e);
      }
      return implTodoOk(tipo);
    };
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByText("↓ Descargar historial de este paciente"));

    expect(archivosDescargados).toHaveLength(1);
    const primerasLineas = archivosDescargados[0].contenido.split("\r\n").slice(0, 2).join("\n");
    expect(primerasLineas).toContain("AVISO: HISTORIAL INCOMPLETO");
    expect(primerasLineas).toContain("Resultado %Captación");
  });
});
