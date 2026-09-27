import { describe, test, expect } from "vitest";
import { egresosDisponiblesParaMarcar } from "./egresosDisponiblesParaMarcar.js";

const ts = (iso) => ({ toDate: () => new Date(iso) });
const FARM = "farm1";

describe("egresosDisponiblesParaMarcar", () => {
  test("un egreso sin ninguna marcación asociada -- seleccionable", () => {
    const filas = egresosDisponiblesParaMarcar(
      [{ id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") }],
      FARM, [], [], new Map()
    );
    expect(filas).toEqual([{ id: "mov1", lote: "L1", fecha: expect.anything(), vencimiento: undefined, seleccionable: true }]);
  });

  test("un egreso con una marcación ACTIVA que lo referencia -- no seleccionable", () => {
    const filas = egresosDisponiblesParaMarcar(
      [{ id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") }],
      FARM, [],
      [{ id: "marcacion_mov1_1", egresoMovimientoId: "mov1" }],
      new Map()
    );
    expect(filas[0].seleccionable).toBe(false);
  });

  test("marcación que referencia el egreso pero está ANULADA -- vuelve a ser seleccionable", () => {
    const anulaciones = new Map([["marcacion_mov1_1", { anulaId: "marcacion_mov1_1" }]]);
    const filas = egresosDisponiblesParaMarcar(
      [{ id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") }],
      FARM, [],
      [{ id: "marcacion_mov1_1", egresoMovimientoId: "mov1" }],
      anulaciones
    );
    expect(filas[0].seleccionable).toBe(true);
  });

  test("egresos de otro farmId no entran en la lista", () => {
    const filas = egresosDisponiblesParaMarcar(
      [
        { id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") },
        { id: "mov2", farmId: "otroFarm", lote: "L9", fecha: ts("2026-09-27T10:00:00") },
      ],
      FARM, [], [], new Map()
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe("mov1");
  });

  test("egresos con motivo de descarte (Vencimiento/Derrame) siguen excluidos", () => {
    const filas = egresosDisponiblesParaMarcar(
      [
        { id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00"), motivo: "Vencimiento" },
        { id: "mov2", farmId: FARM, lote: "L2", fecha: ts("2026-09-27T10:00:00"), motivo: "Derrame / accidente" },
      ],
      FARM, [], [], new Map()
    );
    expect(filas).toHaveLength(0);
  });

  test("dos egresos del MISMO texto de lote, uno consumido y otro no -- ambos aparecen como filas separadas, cada uno con su propio seleccionable", () => {
    const filas = egresosDisponiblesParaMarcar(
      [
        { id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") },
        { id: "mov2", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T14:00:00") },
      ],
      FARM, [],
      [{ id: "marcacion_mov1_1", egresoMovimientoId: "mov1" }],
      new Map()
    );
    expect(filas).toHaveLength(2);
    const f1 = filas.find((f) => f.id === "mov1");
    const f2 = filas.find((f) => f.id === "mov2");
    expect(f1.seleccionable).toBe(false);
    expect(f2.seleccionable).toBe(true);
  });

  test("vencimiento se toma del stock actual por texto de lote, si existe", () => {
    const filas = egresosDisponiblesParaMarcar(
      [{ id: "mov1", farmId: FARM, lote: "L1", fecha: ts("2026-09-27T09:00:00") }],
      FARM, [{ lote: "L1", vencimiento: "2027-01-01" }], [], new Map()
    );
    expect(filas[0].vencimiento).toBe("2027-01-01");
  });

  test("sin egresos -- lista vacía", () => {
    expect(egresosDisponiblesParaMarcar([], FARM, [], [], new Map())).toEqual([]);
  });
});
