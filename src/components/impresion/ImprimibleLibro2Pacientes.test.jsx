import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { ImprimibleLibro2Pacientes } from "./ImprimibleLibro2Pacientes.jsx";

const ts = { toDate: () => new Date("2026-09-24T19:00:00") };
const base = {
  fecha: ts, pacienteFicha: "100", pacienteNombre: "Perez Ana", pacienteDni: "1", tipo: "paciente", isotopoId: "tc99m",
  estudio: "Centellograma de tiroides", mciAdministrados: 5, usuarioNombre: "Tec",
};

function renderLibro(actas) {
  return render(
    <ImprimibleLibro2Pacientes
      actas={actas} anulaciones={new Map()} lotesPorId={new Map()} sedeNombre="Central" mesTexto="Septiembre 2026"
      nombreResponsable="Resp" catalogo={{ radioisotopos: [] }}
    />
  );
}

describe("ImprimibleLibro2Pacientes -- columna Radiofármaco/Lote", () => {
  test("acta con sinRadiofarmaco muestra 'Sin marcación de radiofármaco' (sin paréntesis) y no un '—' que se lea como olvido", () => {
    const { container } = renderLibro([{ id: "a1", ...base, sinRadiofarmaco: true }]);
    expect(container.textContent).toContain("Sin marcación de radiofármaco");
    expect(container.textContent).not.toContain("Tc-99m puro");
  });

  test("acta normal sigue mostrando radiofármaco (lote)", () => {
    const { container } = renderLibro([{ id: "a2", ...base, farmNombre: "MIBI (Sestamibi)", lote: "L123" }]);
    expect(container.textContent).toContain("MIBI (Sestamibi) (L123)");
    expect(container.textContent).not.toContain("Sin marcación de radiofármaco");
  });
});
