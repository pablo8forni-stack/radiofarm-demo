import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { ImprimibleLibro3Elucion } from "./ImprimibleLibro3Elucion.jsx";

const ts = { toDate: () => new Date("2026-11-24T19:00:00") };
const base = { fecha: ts, loteGenerador: "1-11111", actividadEluida: 740, volumen: 10, usuarioNombre: "Tec" };

function renderLibro(actas, anulaciones = new Map()) {
  return render(
    <ImprimibleLibro3Elucion actas={actas} anulaciones={anulaciones} sedeNombre="Central" mesTexto="Noviembre 2026" nombreResponsable="Resp" />
  );
}

describe("ImprimibleLibro3Elucion -- subfila del generador (24/11)", () => {
  test("acta con los 3 datos nuevos -- subfila presente", () => {
    const { container } = renderLibro([{ id: "a1", ...base, actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" }]);
    expect(container.textContent).toContain("Generador N° 240017992");
    expect(container.textContent).toContain("Calibrado 01/11/2026");
    expect(container.textContent).toContain("Vence 08/11/2026");
  });

  test("acta vieja con sólo actividadCalibrada -- SIN subfila", () => {
    const { container } = renderLibro([{ id: "a1", ...base, actividadCalibrada: 1850 }]);
    expect(container.textContent).not.toContain("Generador N°");
  });

  test("acta ANULADA con los 3 datos -- subfila tachada (line-through) y leyenda Anulado", () => {
    const anulaciones = new Map([["a1", { motivo: "error de carga" }]]);
    const { container } = renderLibro([{ id: "a1", ...base, actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" }], anulaciones);
    expect(container.textContent).toContain("Generador N° 240017992");
    expect(container.querySelector("td.line-through")).toBeTruthy();
    expect(container.textContent).toContain("Anulado");
  });

  test("fila y subfila quedan en el mismo <tbody> (para break-inside-avoid)", () => {
    const { container } = renderLibro([{ id: "a1", ...base, actividadCalibrada: 1850, fechaCalibracion: "2026-11-01", fechaVencimiento: "2026-11-08", numeroGenerador: "240017992" }]);
    const tbody = container.querySelector("tbody");
    expect(tbody.classList.contains("break-inside-avoid")).toBe(true);
    expect(tbody.querySelectorAll("tr").length).toBe(2);
  });
});
