import { describe, test, expect, vi } from "vitest";
import { hoy } from "./formato.js";

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
      process.env.TZ = tzOriginal;
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
      process.env.TZ = tzOriginal;
    }
  });
});
