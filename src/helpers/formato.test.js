import { describe, test, expect, vi } from "vitest";
import { hoy, normalizarNombrePaciente } from "./formato.js";

// hoy() es el "hoyISO" real que usa el resto de la app (actasPorRango,
// lotesDelMes, y ahora estadoPorLoteDosisUnica/mibgLotes.js para el
// vencimiento) -- estos tests confirman, con la zona horaria de Mendoza
// FIJADA y el reloj del sistema pisado, que nunca cruza de día por culpa
// de UTC. Ver el comentario propio de hoy() (formato.js) para el caso real
// que motivó esto: después de las 21:00 en Argentina (UTC-3), toISOString()
// ya cae en el día siguiente.
describe("hoy() -- fecha LOCAL (Mendoza), nunca por toISOString/UTC", () => {
  test("20:59 -- sigue siendo el mismo día, en Mendoza y en UTC (caso sin riesgo, control)", () => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = "America/Argentina/Mendoza";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 20, 59, 0)); // mes 10 = noviembre (0-index)
    try {
      expect(hoy()).toBe("2026-11-07");
    } finally {
      vi.useRealTimers();
      // process.env.TZ = undefined NO lo borra -- Node coacciona a la
      // string literal "undefined" (ningún TZ real), y los tests de fecha
      // que corran después en el mismo proceso quedan en UTC en vez de la
      // zona real de la máquina.
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });

  test("21:01 -- hoy() sigue dando el día LOCAL correcto, aunque en UTC ya sea el día siguiente", () => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = "America/Argentina/Mendoza";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 1, 0));
    try {
      expect(hoy()).toBe("2026-11-07");
      // Control: confirma que el caso real que motivó hoy() de verdad
      // ocurre a esta hora -- si esto alguna vez dejara de ser cierto
      // (cambio de offset de Argentina, etc.), el test de arriba no
      // estaría probando nada real.
      expect(new Date(2026, 10, 7, 21, 1, 0).toISOString().slice(0, 10)).toBe("2026-11-08");
    } finally {
      vi.useRealTimers();
      // Ver comentario equivalente en el test de arriba.
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });
});

// Paso B1 (9/11, decisión de Pablo): nombres de pacientes en MAYÚSCULA
// COMPLETA de ahora en adelante -- VM RIS ya entrega los nombres así.
describe("normalizarNombrePaciente() -- mayúscula completa, locale es (acentos y ñ)", () => {
  test("'García Núñez' -> 'GARCÍA NÚÑEZ'", () => {
    expect(normalizarNombrePaciente("García Núñez")).toBe("GARCÍA NÚÑEZ");
  });

  test("'  maría   josé ' -> 'MARÍA JOSÉ' (recorta puntas y colapsa espacios dobles)", () => {
    expect(normalizarNombrePaciente("  maría   josé ")).toBe("MARÍA JOSÉ");
  });

  // ñ y acento en posiciones distintas (principio/medio/final de palabra) --
  // .toLocaleUpperCase("es"), no .toUpperCase() liso, es lo que garantiza
  // que ninguno de estos se corrompa en cualquier entorno/navegador.
  test("ñ y vocales acentuadas en distintas posiciones no se corrompen", () => {
    expect(normalizarNombrePaciente("ñandú")).toBe("ÑANDÚ");
    expect(normalizarNombrePaciente("peña")).toBe("PEÑA");
    expect(normalizarNombrePaciente("áéíóú")).toBe("ÁÉÍÓÚ");
  });

  test("string vacío o sólo espacios -> string vacío", () => {
    expect(normalizarNombrePaciente("")).toBe("");
    expect(normalizarNombrePaciente("   ")).toBe("");
  });

  test("undefined/null -> string vacío (mismo fallback que el resto de los helpers de formato)", () => {
    expect(normalizarNombrePaciente(undefined)).toBe("");
    expect(normalizarNombrePaciente(null)).toBe("");
  });
});
