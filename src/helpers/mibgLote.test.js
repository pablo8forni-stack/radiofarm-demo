import { describe, test, expect } from "vitest";
import { estadoMibgLote, lotesDelMes, lotesSinFecha, avisoLotesSinFecha } from "./mibgLote.js";

const ts = (iso) => ({ toDate: () => new Date(iso) });

describe("estadoMibgLote", () => {
  test("lote anulado -- 'anulado', sin importar si tiene uso", () => {
    const anulaciones = new Map([["lote1", { motivo: "error de carga" }]]);
    const usoPorLoteId = new Map([["lote1", { pacienteNombre: "Paciente" }]]);
    expect(estadoMibgLote("lote1", { anulaciones, usoPorLoteId })).toBe("anulado");
  });

  test("lote con uso activo -- 'usado'", () => {
    const usoPorLoteId = new Map([["lote1", { pacienteNombre: "Paciente" }]]);
    expect(estadoMibgLote("lote1", { anulaciones: new Map(), usoPorLoteId })).toBe("usado");
  });

  test("lote sin anulación ni uso -- 'disponible'", () => {
    expect(estadoMibgLote("lote1", { anulaciones: new Map(), usoPorLoteId: new Map() })).toBe("disponible");
  });
});

// Caso real reportado por Pablo (4/11): un lote de Lutecio-177 llegado y
// usado en septiembre seguía apareciendo en la impresión de octubre como
// "disponible" -- lotesPorSede (mibgLotes.js) nunca filtró por fecha, pese a
// lo que decía el comentario de GenerarActasImpresion.jsx. lotesDelMes es el
// filtro CLIENT-SIDE nuevo que lo corrige.
describe("lotesDelMes", () => {
  const MES_OCTUBRE = { desde: "2026-10-01", hasta: "2026-10-31" };

  test("lote llegado DENTRO del mes -- queda adentro", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-10-15T12:00:00") }];
    expect(lotesDelMes(lotes, MES_OCTUBRE).map((l) => l.id)).toEqual(["L1"]);
  });

  test("lote llegado el mes ANTERIOR -- bug real: no debe aparecer en octubre", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-09-11T12:00:00") }];
    expect(lotesDelMes(lotes, MES_OCTUBRE)).toEqual([]);
  });

  test("lote llegado el mes SIGUIENTE -- tampoco debe aparecer en octubre", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-11-01T00:30:00") }];
    expect(lotesDelMes(lotes, MES_OCTUBRE)).toEqual([]);
  });

  // Estos dos NO prueban nada contra UTC por sí solos -- tanto la fecha del
  // lote (ts(), sin offset) como el límite d0/d1 que arma lotesDelMes se
  // parsean con el MISMO new Date(string-sin-offset), en la zona horaria
  // que sea que corra el proceso: los dos lados se corren igual, así que
  // esto pasaría aunque el código comparara mal contra UTC. Son controles
  // de que el límite incluye las puntas (no un off-by-one), nada más -- la
  // prueba real contra UTC está en el test siguiente, con zona fijada.
  test("límite de mes: llega el ÚLTIMO día a última hora -- incluido, sin off-by-one", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-10-31T23:59:00") }];
    expect(lotesDelMes(lotes, MES_OCTUBRE).map((l) => l.id)).toEqual(["L1"]);
  });

  test("límite de mes: llega el PRIMER día a primera hora -- incluido, sin off-by-one", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-10-01T00:01:00") }];
    expect(lotesDelMes(lotes, MES_OCTUBRE).map((l) => l.id)).toEqual(["L1"]);
  });

  // Prueba real contra UTC, con la zona horaria del proceso FIJADA a
  // America/Argentina/Mendoza (UTC-3) -- la fecha del lote es un instante
  // UTC explícito (con "Z") elegido a propósito para que caiga en días
  // DISTINTOS según la zona: 2026-11-01T02:30:00Z es 31/10 23:30 en Mendoza
  // pero ya 1/11 en UTC. Si lotesDelMes comparara con fechas/componentes
  // UTC en vez de locales (bug real posible: toISOString().slice(0,10),
  // por ejemplo), este lote quedaría afuera de octubre -- con la
  // implementación actual (new Date(string local) para d0/d1, comparación
  // de instantes) queda adentro, que es lo correcto para un lote que
  // llegó un 31/10 a la noche hora Mendoza.
  test("límite de mes CON zona horaria real fijada (Mendoza): 31/10 23:30 local, ya 1/11 en UTC -- queda en octubre", () => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = "America/Argentina/Mendoza";
    try {
      const lotes = [{ id: "L1", fecha: { toDate: () => new Date("2026-11-01T02:30:00.000Z") } }];
      expect(lotesDelMes(lotes, MES_OCTUBRE).map((l) => l.id)).toEqual(["L1"]);
    } finally {
      process.env.TZ = tzOriginal;
    }
  });

  // Caso real encontrado en staging el 4/11: 298 lotes de prueba sin fecha
  // (del test harness, ver mibgLotes.js) aparecían repetidos en TODOS los
  // libros mensuales con la versión anterior de este código (que los
  // incluía con _sinFecha:true) -- decisión de Pablo: un lote sin fecha NO
  // entra a NINGÚN mes, nunca. Probado con 3 meses distintos a propósito,
  // no sólo uno, para no dejar pasar un "excluido sólo del mes default".
  test("lote SIN campo fecha -- EXCLUIDO de lotesDelMes, para CUALQUIER mes", () => {
    const lotes = [{ id: "L1", numeroLote: "X" }];
    expect(lotesDelMes(lotes, { desde: "2026-09-01", hasta: "2026-09-30" })).toEqual([]);
    expect(lotesDelMes(lotes, { desde: "2026-10-01", hasta: "2026-10-31" })).toEqual([]);
    expect(lotesDelMes(lotes, { desde: "2026-11-01", hasta: "2026-11-30" })).toEqual([]);
  });

  test("fecha como Date plano o string ISO (no sólo Timestamp con toDate) -- funciona igual", () => {
    const lotes = [
      { id: "L1", fecha: new Date("2026-10-15T12:00:00") },
      { id: "L2", fecha: "2026-10-16T12:00:00" },
    ];
    expect(lotesDelMes(lotes, MES_OCTUBRE).map((l) => l.id)).toEqual(["L1", "L2"]);
  });
});

describe("lotesSinFecha", () => {
  test("devuelve sólo los que no tienen fecha, sin importar ningún mes (no recibe desde/hasta)", () => {
    const lotes = [
      { id: "L1", fecha: ts("2026-10-15T12:00:00") },
      { id: "L2" },
      { id: "L3", fecha: ts("2026-01-01T00:00:00") },
      { id: "L4" },
    ];
    expect(lotesSinFecha(lotes).map((l) => l.id)).toEqual(["L2", "L4"]);
  });

  test("ninguno sin fecha -- lista vacía", () => {
    expect(lotesSinFecha([{ id: "L1", fecha: ts("2026-10-15T12:00:00") }])).toEqual([]);
  });

  // Partición sin duplicar ni perder ninguno entre lotesDelMes y
  // lotesSinFecha -- exactamente el chequeo que hubiera evitado el bug real
  // de staging si hubiera existido antes.
  test("conciliación: lotesDelMes + lotesSinFecha nunca duplican ni pierden un lote, para 3 meses distintos", () => {
    const lotes = [
      { id: "sep1", fecha: ts("2026-09-10T12:00:00") },
      { id: "oct1", fecha: ts("2026-10-05T12:00:00") },
      { id: "oct2", fecha: ts("2026-10-20T12:00:00") },
      { id: "sinfecha1" },
      { id: "sinfecha2" },
    ];
    const sinFecha = lotesSinFecha(lotes);
    expect(sinFecha.map((l) => l.id).sort()).toEqual(["sinfecha1", "sinfecha2"]);

    for (const [mes, esperados] of [
      [{ desde: "2026-09-01", hasta: "2026-09-30" }, ["sep1"]],
      [{ desde: "2026-10-01", hasta: "2026-10-31" }, ["oct1", "oct2"]],
      [{ desde: "2026-11-01", hasta: "2026-11-30" }, []],
    ]) {
      const delMes = lotesDelMes(lotes, mes);
      expect(delMes.map((l) => l.id).sort()).toEqual(esperados);
      // ningún lote del mes es también "sin fecha", y viceversa -- partición real
      expect(delMes.some((l) => sinFecha.includes(l))).toBe(false);
    }
  });
});

describe("avisoLotesSinFecha", () => {
  test("ninguno -- string vacío (no se muestra ningún cartel)", () => {
    expect(avisoLotesSinFecha([])).toBe("");
  });

  test("1 lote -- singular, sin 'y N más'", () => {
    expect(avisoLotesSinFecha([{ id: "L1", numeroLote: "TEST-abc" }]))
      .toBe("1 lote de Lutecio-177 sin fecha de llegada, no incluido en ningún libro mensual: revisar -- TEST-abc.");
  });

  test("5 lotes o menos -- se listan todos, sin 'y N más'", () => {
    const lotes = ["A", "B", "C", "D", "E"].map((n) => ({ id: n, numeroLote: `TEST-${n}` }));
    expect(avisoLotesSinFecha(lotes))
      .toBe("5 lotes de Lutecio-177 sin fecha de llegada, no incluidos en ningún libro mensual: revisar -- TEST-A, TEST-B, TEST-C, TEST-D, TEST-E.");
  });

  // Caso real de staging: 298 -- nunca hay que listarlos todos.
  test("más de 5 -- sólo los primeros 5 + 'y N más' (caso real: 298 en staging)", () => {
    const lotes = Array.from({ length: 298 }, (_, i) => ({ id: `id${i}`, numeroLote: `TEST-${i}` }));
    const texto = avisoLotesSinFecha(lotes);
    expect(texto).toBe(
      "298 lotes de Lutecio-177 sin fecha de llegada, no incluidos en ningún libro mensual: revisar -- TEST-0, TEST-1, TEST-2, TEST-3, TEST-4 y 293 más."
    );
  });

  test("sin numeroLote -- usa el id como respaldo", () => {
    const lotes = [{ id: "idSinNumero" }];
    expect(avisoLotesSinFecha(lotes)).toContain("idSinNumero");
  });
});
