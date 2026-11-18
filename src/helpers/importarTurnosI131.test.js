import { describe, test, expect } from "vitest";
import { parsearArchivoTurnosI131, HEADERS_TURNOS_I131 } from "./importarTurnosI131.js";

// Paso B1 (9/11, decisión de Pablo): un nombre en minúscula (o con espacios
// de más) en el archivo importado tiene que llegar normalizado -- mayúscula
// completa, recortado, espacios colapsados -- al documento que se guarda,
// mismo criterio que el resto de los puntos de entrada de pacienteNombre
// (ver normalizarNombrePaciente en formato.js).
function archivoTabulado(filas) {
  const texto = [HEADERS_TURNOS_I131.join("\t"), ...filas.map((f) => HEADERS_TURNOS_I131.map((c) => f[c] ?? "").join("\t"))].join("\n");
  return new Blob([texto], { type: "text/plain" });
}

describe("parsearArchivoTurnosI131() -- el nombre del paciente llega normalizado (paso B1)", () => {
  test("nombre en minúscula con espacios de más llega en MAYÚSCULA, recortado y colapsado", async () => {
    const archivo = archivoTabulado([{
      fechaTurno: "15/03/2026", pacienteNombre: "  maría   josé ", pacienteDni: "30111222",
      telefono: "2611234567", tipoDosis: "Ablativa I-131", actividadPrevista: "100",
      obraSocial: "OSEP", fechaBarrido: "", notas: "",
    }]);

    const filas = await parsearArchivoTurnosI131(archivo);

    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe("ok");
    expect(filas[0].datos.pacienteNombre).toBe("MARÍA JOSÉ");
  });

  test("'García Núñez' llega como 'GARCÍA NÚÑEZ' (acentos y ñ se conservan)", async () => {
    const archivo = archivoTabulado([{
      fechaTurno: "15/03/2026", pacienteNombre: "García Núñez", pacienteDni: "30111223",
      telefono: "", tipoDosis: "Ablativa I-131", actividadPrevista: "", obraSocial: "", fechaBarrido: "", notas: "",
    }]);

    const [fila] = await parsearArchivoTurnosI131(archivo);

    expect(fila.datos.pacienteNombre).toBe("GARCÍA NÚÑEZ");
  });
});
