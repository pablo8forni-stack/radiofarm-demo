import { describe, test, expect } from "vitest";
import { calcularPedirDatos, loteTieneVigenteConDatos, textoSubfilaGenerador, vencimientoGeneradorValido } from "./elucionGenerador.js";

const SEDE_A = "central";

function acta(overrides = {}) {
  return { id: "a1", sedeId: SEDE_A, loteGenerador: "1-11111", actividadCalibrada: 1850, ...overrides };
}
function anulaciones(ids = []) {
  return new Map(ids.map((id) => [id, { anulaId: id }]));
}

describe("calcularPedirDatos() -- Fase elución (24/11)", () => {
  test("marcador no existe -> pide (primera vez de verdad)", () => {
    expect(calcularPedirDatos({ marcadorExiste: false, actas: [], anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(true);
  });

  test("marcador existe + SIN vigente con datos -> pide", () => {
    expect(calcularPedirDatos({ marcadorExiste: true, actas: [], anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(true);
  });

  test("marcador existe + vigente CON datos -> no pide", () => {
    const actas = [acta()];
    expect(calcularPedirDatos({ marcadorExiste: true, actas, anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(false);
  });

  test("la única elución con datos está ANULADA -> pide", () => {
    const actas = [acta({ id: "a1" })];
    expect(calcularPedirDatos({ marcadorExiste: true, actas, anulaciones: anulaciones(["a1"]), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(true);
  });

  test("lote viejo (sólo actividadCalibrada, vigente) -> no pide", () => {
    const actas = [acta({ fechaCalibracion: undefined, fechaVencimiento: undefined, numeroGenerador: undefined })];
    expect(calcularPedirDatos({ marcadorExiste: true, actas, anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(false);
  });

  test("actas de OTRA sede se ignoran -- pide igual", () => {
    const actas = [acta({ sedeId: "italiano" })];
    expect(calcularPedirDatos({ marcadorExiste: true, actas, anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(true);
  });

  test("variantes de escritura del mismo lote (con/sin guion, mayúscula) -- no pide", () => {
    const actas = [acta({ loteGenerador: "111111" })];
    expect(calcularPedirDatos({ marcadorExiste: true, actas, anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "1-11111" })).toBe(false);
  });

  test("sin loteGenerador declarado -- pide (no hay nada que buscar)", () => {
    expect(calcularPedirDatos({ marcadorExiste: true, actas: [acta()], anulaciones: anulaciones(), sedeId: SEDE_A, loteGenerador: "" })).toBe(true);
  });
});

describe("loteTieneVigenteConDatos()", () => {
  test("ninguna elución del lote -- false", () => {
    expect(loteTieneVigenteConDatos([], anulaciones(), SEDE_A, "1-11111")).toBe(false);
  });

  test("elución del lote sin actividadCalibrada (nunca tuvo datos) -- false", () => {
    const actas = [acta({ actividadCalibrada: null })];
    expect(loteTieneVigenteConDatos(actas, anulaciones(), SEDE_A, "1-11111")).toBe(false);
  });
});

describe("vencimientoGeneradorValido() -- Fase elución (25/11)", () => {
  test("vencimiento anterior a calibración -- inválido", () => {
    expect(vencimientoGeneradorValido("2026-11-08", "2026-11-01")).toBe(false);
  });

  test("vencimiento igual a calibración -- válido", () => {
    expect(vencimientoGeneradorValido("2026-11-01", "2026-11-01")).toBe(true);
  });

  test("vencimiento posterior a calibración -- válido", () => {
    expect(vencimientoGeneradorValido("2026-11-01", "2026-11-08")).toBe(true);
  });

  test("calibración vacía -- no valida esta regla (true)", () => {
    expect(vencimientoGeneradorValido("", "2026-11-08")).toBe(true);
  });

  test("vencimiento vacío -- no valida esta regla (true)", () => {
    expect(vencimientoGeneradorValido("2026-11-01", "")).toBe(true);
  });

  test("sin corrimiento: cruce de fin de mes comparado como string, no como Date", () => {
    expect(vencimientoGeneradorValido("2026-10-31", "2026-11-01")).toBe(true); // posterior, válido
    expect(vencimientoGeneradorValido("2026-11-01", "2026-10-31")).toBe(false); // anterior, inválido
  });
});

describe("textoSubfilaGenerador()", () => {
  test("acta con los 4 datos -- texto completo", () => {
    const texto = textoSubfilaGenerador({
      actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992",
    });
    expect(texto).toBe("Generador N° 240017992 · Mo-99 calibrada 1850 mCi · Calibrado 01/11/2026 · Vence 08/11/2026");
  });

  test("sin corrimiento de fecha: 2026-11-01 da 01/11/2026, no 31/10", () => {
    const texto = textoSubfilaGenerador({ fechaCalibracion: "2026-11-01" });
    expect(texto).toContain("01/11/2026");
  });

  test("sólo actividadCalibrada (lote viejo, sin los otros 3) -- null, no hay subfila", () => {
    expect(textoSubfilaGenerador({ actividadCalibrada: 1850 })).toBeNull();
  });

  test("sin ningún dato -- null", () => {
    expect(textoSubfilaGenerador({})).toBeNull();
  });

  test("falta numeroGenerador -- omite esa parte, mantiene el resto", () => {
    const texto = textoSubfilaGenerador({ fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08" });
    expect(texto).toBe("Calibrado 01/11/2026 · Vence 08/11/2026");
    expect(texto).not.toContain("Generador N°");
  });
});
