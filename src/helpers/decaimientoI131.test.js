// "Decaído" de I-131 (9/11, decisión de Pablo): actividad restante < 0,5 mCi
// -- un solo umbral, terapéutico y diagnóstico por igual. Puede quedar
// volumen y estar decaído igual (NO es lo mismo que "agotado por volumen",
// ver estaDecaido vs. estadoDecaimientoVial.volumenRestante <= 0). Nada de
// esto existía antes de esta ronda -- primer archivo de test de este módulo.
import { describe, test, expect } from "vitest";
import {
  UMBRAL_DECAIDO_I131_MCI, MARGEN_VENTANA_DIAS_I131,
  decaidoPorTeorica, estadoDecaimientoVial, estaDecaidaExtraccion, fechaMenosMargenDias,
} from "./decaimientoI131.js";

const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-11-09T12:00:00");

// fechaCalibracion == AHORA (días transcurridos == 0) -- Math.exp(0) es
// EXACTAMENTE 1 en IEEE754, así que actividadTeorica(a0, 0) == a0 sin
// ningún error de redondeo. Así se puede probar el umbral en un valor
// EXACTO (0,50 mCi justo) sin pelearse con la imprecisión de invertir la
// fórmula exponencial (log/exp) para "despejar" los días.
function vialConActividadHoy(actividadCalibradaMCi) {
  return { id: "v1", actividadCalibrada: actividadCalibradaMCi, volumenInicial: 10, fechaCalibracion: AHORA };
}

describe("decaidoPorTeorica -- umbral exacto, SIN pasar extracciones", () => {
  test("0,49 mCi (bajo el umbral) -- decaído", () => {
    expect(decaidoPorTeorica(vialConActividadHoy(0.49), AHORA)).toBe(true);
  });
  test("0,50 mCi EXACTO -- NO decaído (estrictamente MENOR, no menor-o-igual)", () => {
    expect(decaidoPorTeorica(vialConActividadHoy(0.50), AHORA)).toBe(false);
  });
  test("0,51 mCi (sobre el umbral) -- no decaído", () => {
    expect(decaidoPorTeorica(vialConActividadHoy(0.51), AHORA)).toBe(false);
  });
});

describe("estadoDecaimientoVial -- puede quedar volumen y estar decaído igual", () => {
  test("vial con volumen SIN extraer (volumenRestante == volumenInicial) pero muchos días -- decaído de verdad, no por volumen", () => {
    // Actividad chica (vida corta hasta decaer) + muchos días, SIN ninguna
    // extracción -- volumenRestante queda intacto, igual decae.
    const vial = { id: "v2", actividadCalibrada: 5, volumenInicial: 10, fechaCalibracion: new Date(AHORA.getTime() - 60 * DIA_MS) };
    const estado = estadoDecaimientoVial(vial, [], AHORA);
    expect(estado.volumenRestante).toBe(10); // nada extraído
    expect(estado.estaDecaido).toBe(true); // decaído por tiempo, no por volumen
  });

  test("vial vigente con 150+ extracciones de OTROS viales de por medio -- sigue calculando bien el propio remanente", () => {
    const vial = { id: "v3", actividadCalibrada: 1000, volumenInicial: 10, fechaCalibracion: new Date(AHORA.getTime() - 2 * DIA_MS) };
    const ruido = Array.from({ length: 160 }, (_, i) => ({ id: `ruido-${i}`, viales: [{ vialId: `otro-vial-${i}`, mlExtraidos: 1 }] }));
    const extraccionDeV3 = { id: "ex-v3", viales: [{ vialId: "v3", mlExtraidos: 3 }] };
    const estado = estadoDecaimientoVial(vial, [...ruido, extraccionDeV3], AHORA);
    expect(estado.volumenRestante).toBe(7); // 10 - 3, el ruido de otros viales no afecta
    expect(estado.estaDecaido).toBe(false); // 2 días, actividad calibrada alta -- sigue vigente
  });
});

describe("estaDecaidaExtraccion -- decae desde su propia actividad congelada, prioriza actividadMedida", () => {
  test("usa actividadMedida si está -- extracción reciente con actividad alta, no decaída", () => {
    const extraccion = { actividadMedida: 50, actividadCalculada: 1, fecha: new Date(AHORA.getTime() - 1 * DIA_MS) };
    expect(estaDecaidaExtraccion(extraccion, AHORA)).toBe(false);
  });
  test("extracción vieja con actividadMedida chica -- decaída", () => {
    const extraccion = { actividadMedida: 2, fecha: new Date(AHORA.getTime() - 60 * DIA_MS) };
    expect(estaDecaidaExtraccion(extraccion, AHORA)).toBe(true);
  });
  test("sin actividadMedida -- usa actividadCalculada", () => {
    const extraccion = { actividadCalculada: 2, fecha: new Date(AHORA.getTime() - 60 * DIA_MS) };
    expect(estaDecaidaExtraccion(extraccion, AHORA)).toBe(true);
  });
  test("sin actividadMedida NI actividadCalculada (dato malformado) -- falla ABIERTO, nunca decaída", () => {
    const extraccion = { fecha: new Date(AHORA.getTime() - 200 * DIA_MS) };
    expect(estaDecaidaExtraccion(extraccion, AHORA)).toBe(false);
  });
});

describe("fechaMenosMargenDias -- ajuste C, margen de 1 día", () => {
  test("resta exactamente MARGEN_VENTANA_DIAS_I131 (1) día", () => {
    const fecha = new Date("2026-11-09T18:00:00"); // fechaCalibracion típica (datetime-local, tarde)
    const resultado = fechaMenosMargenDias(fecha);
    expect(resultado.getTime()).toBe(fecha.getTime() - DIA_MS);
    expect(MARGEN_VENTANA_DIAS_I131).toBe(1);
  });

  // Escenario real del ajuste C: fechaCalibracion tipeada tarde en el día
  // (ej. 18:00), pero la extracción (serverTimestamp, nunca tipeada) ocurre
  // el MISMO día calendario, más temprano (ej. 10:00) -- sin margen,
  // extraccion.fecha(10:00) >= fechaCalibracion(18:00) sería FALSO y la
  // excluiría de la ventana. Con el margen de 1 día, queda incluida.
  test("extracción el MISMO día, antes de la hora tipeada de calibración -- el margen la deja dentro de la ventana", () => {
    const fechaCalibracionTarde = new Date("2026-11-09T18:00:00");
    const fechaExtraccionTemprano = new Date("2026-11-09T10:00:00");
    const desde = fechaMenosMargenDias(fechaCalibracionTarde);
    expect(fechaExtraccionTemprano.getTime() >= desde.getTime()).toBe(true);
    // Control: SIN el margen, este mismo caso fallaría (lo que el margen corrige).
    expect(fechaExtraccionTemprano.getTime() >= fechaCalibracionTarde.getTime()).toBe(false);
  });
});

describe("UMBRAL_DECAIDO_I131_MCI -- un solo valor, igual para las 2 categorías", () => {
  test("es exactamente 0.5", () => {
    expect(UMBRAL_DECAIDO_I131_MCI).toBe(0.5);
  });
});
