import { describe, test, expect } from "vitest";
import { normalizarDocumento } from "./documento.js";

describe("normalizarDocumento() -- Fase 2.1a, puede haber pasaportes, nunca valida sólo dígitos", () => {
  test("DNI con puntos y sin puntos son el mismo documento", () => {
    expect(normalizarDocumento("41.409.048")).toBe(normalizarDocumento("41409048"));
    expect(normalizarDocumento("41.409.048")).toBe("41409048");
  });

  test("pasaporte con espacio y minúscula es el mismo documento que en mayúscula sin espacio", () => {
    expect(normalizarDocumento("ab 123456")).toBe(normalizarDocumento("AB123456"));
    expect(normalizarDocumento("ab 123456")).toBe("AB123456");
  });

  test("documentos distintos NO coinciden", () => {
    expect(normalizarDocumento("41.409.048")).not.toBe(normalizarDocumento("41.409.049"));
    expect(normalizarDocumento("AB123456")).not.toBe(normalizarDocumento("AB123457"));
  });

  test("guiones también se sacan (pasaportes con guion)", () => {
    expect(normalizarDocumento("AB-123456")).toBe("AB123456");
  });

  test("no valida sólo dígitos -- letras quedan igual", () => {
    expect(normalizarDocumento("AB123456")).toBe("AB123456");
  });

  test("vacío/undefined/null no rompe", () => {
    expect(normalizarDocumento("")).toBe("");
    expect(normalizarDocumento(undefined)).toBe("");
    expect(normalizarDocumento(null)).toBe("");
  });

  test("trim de espacios al principio/final", () => {
    expect(normalizarDocumento("  41409048  ")).toBe("41409048");
  });
});
