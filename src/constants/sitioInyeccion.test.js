import { describe, test, expect } from "vitest";
import { SITIOS_INYECCION, etiquetaSitioInyeccion, etiquetaSitioInyeccionDeActa } from "./sitioInyeccion.js";

describe("etiquetaSitioInyeccion()", () => {
  test("código conocido -> su etiqueta", () => {
    expect(etiquetaSitioInyeccion("DMD")).toBe("Dorso mano derecha");
    expect(etiquetaSitioInyeccion("NR")).toBe("No registrado");
  });

  test("código inexistente o faltante -> '—' (nunca revienta, nunca el código crudo)", () => {
    expect(etiquetaSitioInyeccion("XYZ")).toBe("—");
    expect(etiquetaSitioInyeccion(undefined)).toBe("—");
    expect(etiquetaSitioInyeccion("")).toBe("—");
  });

  test("sin 'glúteo' en la lista (decisión de Pablo)", () => {
    expect(SITIOS_INYECCION.some((s) => /gl[uú]teo/i.test(s.etiqueta))).toBe(false);
  });
});

describe("etiquetaSitioInyeccionDeActa()", () => {
  test("acta sin sitioInyeccion (vieja) -> '—'", () => {
    expect(etiquetaSitioInyeccionDeActa({})).toBe("—");
    expect(etiquetaSitioInyeccionDeActa(null)).toBe("—");
  });

  test("código normal -> sólo la etiqueta", () => {
    expect(etiquetaSitioInyeccionDeActa({ sitioInyeccion: "PCD" })).toBe("Pliegue de codo derecho");
  });

  test("OTRO con texto libre -> etiqueta + texto", () => {
    expect(etiquetaSitioInyeccionDeActa({ sitioInyeccion: "OTRO", sitioInyeccionOtro: "Vena yugular externa" })).toBe("Otro: Vena yugular externa");
  });

  test("OTRO sin texto libre (dato malformado) -> sólo 'Otro', sin colgar un ': ' vacío", () => {
    expect(etiquetaSitioInyeccionDeActa({ sitioInyeccion: "OTRO" })).toBe("Otro");
  });
});
