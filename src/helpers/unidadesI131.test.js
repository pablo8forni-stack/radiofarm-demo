import { describe, test, expect } from "vitest";
import { mCiATextoMicroCi, microCiAMCi, volumenTotalDilucion, pareceErrorDeUnidad } from "./unidadesI131.js";

describe("mCiATextoMicroCi()", () => {
  test("0.0883 mCi -> '88.3 µCi'", () => {
    expect(mCiATextoMicroCi(0.0883)).toBe("88.3 µCi");
  });
  test("0.5 mCi -> '500.0 µCi'", () => {
    expect(mCiATextoMicroCi(0.5)).toBe("500.0 µCi");
  });
  test("1.2 mCi -> '1200.0 µCi'", () => {
    expect(mCiATextoMicroCi(1.2)).toBe("1200.0 µCi");
  });
  test("0 mCi -> '0.0 µCi'", () => {
    expect(mCiATextoMicroCi(0)).toBe("0.0 µCi");
  });
});

describe("microCiAMCi() -- conversión al guardar, sin artefactos de punto flotante", () => {
  test("88.3 µCi -> 0.0883 mCi exacto", () => {
    expect(microCiAMCi(88.3)).toBe(0.0883);
  });
  test("500 µCi -> 0.5 mCi", () => {
    expect(microCiAMCi(500)).toBe(0.5);
  });
  test("0 µCi -> 0 mCi", () => {
    expect(microCiAMCi(0)).toBe(0);
  });
});

describe("volumenTotalDilucion() -- suma sin artefactos de punto flotante", () => {
  test("0.61 + 100 -> 100.61 exacto (no 100.61000000000001)", () => {
    expect(volumenTotalDilucion(0.61, 100)).toBe(100.61);
  });
  test("0 + 0 -> 0", () => {
    expect(volumenTotalDilucion(0, 0)).toBe(0);
  });
  test("1.111 + 2.222 -> 3.333", () => {
    expect(volumenTotalDilucion(1.111, 2.222)).toBe(3.333);
  });
});

describe("pareceErrorDeUnidad()", () => {
  test("medida en µCi tipeada como mCi (relación ~977x) -- true", () => {
    expect(pareceErrorDeUnidad(88, 0.09)).toBe(true);
  });
  test("relación inversa (~1/977) -- también true", () => {
    expect(pareceErrorDeUnidad(0.09, 88)).toBe(true);
  });
  test("diferencia real chica (20%, ya cubierta por el aviso de 15%) -- false", () => {
    expect(pareceErrorDeUnidad(1.2, 1.0)).toBe(false);
  });
  test("calculada en 0 -- false (no hay relación que calcular)", () => {
    expect(pareceErrorDeUnidad(1, 0)).toBe(false);
  });
  test("medida en 0 -- false", () => {
    expect(pareceErrorDeUnidad(0, 1)).toBe(false);
  });
});
