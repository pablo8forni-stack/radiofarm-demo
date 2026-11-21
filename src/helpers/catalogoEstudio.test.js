import { describe, test, expect } from "vitest";
import { matchEstudioCatalogo } from "./catalogoEstudio.js";

const NOMBRES = ["Ecografía", "Centellograma con DTPA", "MIBI (Sestamibi)"];

describe("matchEstudioCatalogo()", () => {
  test("coincidencia exacta", () => {
    expect(matchEstudioCatalogo("Ecografía", NOMBRES)).toBe("Ecografía");
  });

  test("sin tilde / minúsculas -- devuelve el nombre EXACTO del catálogo, no el texto de entrada", () => {
    expect(matchEstudioCatalogo("ecografia", NOMBRES)).toBe("Ecografía");
  });

  test("espacios extra al principio/final y dobles en el medio", () => {
    expect(matchEstudioCatalogo("  Centellograma  con   DTPA  ", NOMBRES)).toBe("Centellograma con DTPA");
  });

  test("mayúsculas distintas", () => {
    expect(matchEstudioCatalogo("ECOGRAFÍA", NOMBRES)).toBe("Ecografía");
  });

  test("sin match -- texto que no está en el catálogo", () => {
    expect(matchEstudioCatalogo("Renograma con DTPA", NOMBRES)).toBeNull();
  });

  test("coincidencia parcial NO cuenta -- nunca matchea un substring", () => {
    expect(matchEstudioCatalogo("Centellograma", NOMBRES)).toBeNull();
  });

  test("texto vacío o sólo espacios -- null, nunca matchea el primer nombre por descarte", () => {
    expect(matchEstudioCatalogo("", NOMBRES)).toBeNull();
    expect(matchEstudioCatalogo("   ", NOMBRES)).toBeNull();
  });

  test("undefined/null -- null, no revienta", () => {
    expect(matchEstudioCatalogo(undefined, NOMBRES)).toBeNull();
    expect(matchEstudioCatalogo(null, NOMBRES)).toBeNull();
  });

  test("'Otro' nunca matchea -- no es un nombre del catálogo", () => {
    expect(matchEstudioCatalogo("Otro", NOMBRES)).toBeNull();
    expect(matchEstudioCatalogo("otro", NOMBRES)).toBeNull();
  });

  test("lista de nombres vacía -- null, no revienta", () => {
    expect(matchEstudioCatalogo("Ecografía", [])).toBeNull();
  });
});
