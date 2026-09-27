import { describe, test, expect } from "vitest";
import { dedupeLotesPorFarm } from "./dedupeLotesPorFarm.js";

const ts = (iso) => ({ toDate: () => new Date(iso) });
const FARM = "farm1";

describe("dedupeLotesPorFarm", () => {
  test("un solo lote marcado una vez -- una fila, seleccionable", () => {
    const filas = dedupeLotesPorFarm([{ farmId: FARM, lote: "L1", fecha: ts("2026-09-27T10:00:00") }], FARM, []);
    expect(filas).toEqual([{ id: "L1", lote: "L1", fecha: expect.anything(), vencimiento: undefined, seleccionable: true }]);
  });

  test("mismo lote repreparado (remarcado) el mismo día -- UNA sola fila, seleccionable, con la fecha más nueva", () => {
    const filas = dedupeLotesPorFarm(
      [
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") },
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T14:00:00") },
      ],
      FARM, []
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].fecha.toDate().toISOString()).toBe(new Date("2026-09-27T14:00:00").toISOString());
    expect(filas[0].seleccionable).toBe(true);
  });

  test("dos lotes DISTINTOS del mismo radiofármaco -- sólo el más reciente queda seleccionable, el otro no se oculta", () => {
    const filas = dedupeLotesPorFarm(
      [
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") },
        { farmId: FARM, lote: "L2", fecha: ts("2026-09-27T14:00:00") },
      ],
      FARM, []
    );
    expect(filas).toHaveLength(2);
    const l1 = filas.find((f) => f.lote === "L1");
    const l2 = filas.find((f) => f.lote === "L2");
    expect(l2.seleccionable).toBe(true);
    expect(l1.seleccionable).toBe(false);
  });

  test("tres marcaciones -- L1 temprano, L2 en el medio, L1 remarcado al final -- L1 (con la fecha nueva) queda seleccionable, L2 no", () => {
    const filas = dedupeLotesPorFarm(
      [
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T08:00:00") },
        { farmId: FARM, lote: "L2", fecha: ts("2026-09-27T10:00:00") },
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T15:00:00") },
      ],
      FARM, []
    );
    expect(filas).toHaveLength(2);
    const l1 = filas.find((f) => f.lote === "L1");
    const l2 = filas.find((f) => f.lote === "L2");
    expect(l1.seleccionable).toBe(true);
    expect(l2.seleccionable).toBe(false);
  });

  test("actas de otro farmId no entran en el cálculo", () => {
    const filas = dedupeLotesPorFarm(
      [
        { farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") },
        { farmId: "otroFarm", lote: "L9", fecha: ts("2026-09-27T23:00:00") },
      ],
      FARM, []
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].lote).toBe("L1");
  });

  test("vencimiento se toma del stock actual por texto de lote, si existe", () => {
    const filas = dedupeLotesPorFarm(
      [{ farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") }],
      FARM,
      [{ lote: "L1", vencimiento: "2027-01-01" }]
    );
    expect(filas[0].vencimiento).toBe("2027-01-01");
  });

  test("sin marcaciones -- lista vacía", () => {
    expect(dedupeLotesPorFarm([], FARM, [])).toEqual([]);
  });
});
