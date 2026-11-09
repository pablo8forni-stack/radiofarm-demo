import { describe, test, expect } from "vitest";
import { estadoMibgLote, lotesDelMes, lotesSinFecha, avisoLotesSinFecha, normalizarNumeroLoteDosisUnica, loteVialYaExiste, numeroVialEsEnteroPositivo, ordenarLotesPorCarga, calibracionEsFutura } from "./mibgLote.js";

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
      // process.env.TZ = undefined NO lo borra -- Node coacciona a la
      // string literal "undefined" (ningún TZ real), y los tests de fecha
      // que corren después en el mismo proceso quedan en UTC en vez de la
      // zona real de la máquina -- bug real encontrado armando
      // calibracionEsFutura (pasaba aislado, fallaba en la suite completa
      // por esto mismo).
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
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

  // Caso real reportado por Pablo (9/11, staging): dos lotes cargados con
  // fechaHoraCalibracion FUTURA (27/11, cargados el 9/11). Verificado leyendo
  // el código (líneas 35-43 de este archivo): lotesDelMes SOLO mira `fecha`
  // (serverTimestamp, cuándo se cargó) -- fechaHoraCalibracion no aparece en
  // ningún lado de esta función. Libro 4 NO tiene el mismo problema que tuvo
  // el límite de 150: una calibración futura no saca ni mete ningún lote de
  // ningún mes, porque esta función nunca la mira.
  test("fechaHoraCalibracion FUTURA no afecta en absoluto -- lotesDelMes sólo mira `fecha`", () => {
    const lotes = [
      { id: "L1", fecha: ts("2026-11-09T10:00:00"), fechaHoraCalibracion: ts("2026-11-27T00:00:00") },
    ];
    // Cargado el 9/11 (fecha) -- entra a noviembre, sin importar que la
    // calibración (27/11) todavía no haya pasado.
    expect(lotesDelMes(lotes, { desde: "2026-11-01", hasta: "2026-11-30" }).map((l) => l.id)).toEqual(["L1"]);
    // Y NO entra a octubre, aunque alguien mirara (equivocadamente) la
    // calibración en vez de `fecha` -- confirma que el mes se decide
    // exclusivamente por `fecha`.
    expect(lotesDelMes(lotes, { desde: "2026-10-01", hasta: "2026-10-31" })).toEqual([]);
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

describe("normalizarNumeroLoteDosisUnica", () => {
  test("mayúscula + trim + espacios de sobra colapsados", () => {
    expect(normalizarNumeroLoteDosisUnica("  lps261101e-25  ")).toBe("LPS261101E-25");
    expect(normalizarNumeroLoteDosisUnica("lps 261101e - 25")).toBe("LPS 261101E - 25");
  });

  test("vacío o ausente -- no rompe", () => {
    expect(normalizarNumeroLoteDosisUnica("")).toBe("");
    expect(normalizarNumeroLoteDosisUnica(undefined)).toBe("");
  });
});

// Función PURA -- no depende de cómo un navegador real normalice
// <input type="number"> (eso lo decide el navegador, Pablo lo verifica en
// staging). Acá sólo importa qué hace esta función con un string dado,
// tal cual, sin pasar por ningún DOM.
describe("numeroVialEsEnteroPositivo", () => {
  test("'100' -- válido", () => {
    expect(numeroVialEsEnteroPositivo("100")).toBe(true);
  });

  test("'5' -- válido", () => {
    expect(numeroVialEsEnteroPositivo("5")).toBe(true);
  });

  // Caso puntual pedido por Pablo: como STRING, "1e2" no es dígitos puros
  // -- inválido para esta función, sin importar que Number("1e2") dé 100.
  test("'1e2' -- inválido (no son dígitos puros, sin importar su valor numérico)", () => {
    expect(numeroVialEsEnteroPositivo("1e2")).toBe(false);
  });

  test("'5.7' -- inválido (no es entero)", () => {
    expect(numeroVialEsEnteroPositivo("5.7")).toBe(false);
  });

  test("'0' -- inválido (no es > 0)", () => {
    expect(numeroVialEsEnteroPositivo("0")).toBe(false);
  });

  test("'-1' -- inválido (signo, no son dígitos puros)", () => {
    expect(numeroVialEsEnteroPositivo("-1")).toBe(false);
  });

  test("vacío -- inválido (responsabilidad de quien llama decidir si eso bloquea o no)", () => {
    expect(numeroVialEsEnteroPositivo("")).toBe(false);
  });

  test("con espacios de sobra -- se recortan antes de validar", () => {
    expect(numeroVialEsEnteroPositivo("  5  ")).toBe(true);
  });
});

// Caso real de Pablo (4/11): vial 5 y vial 6 de LPS261101E-25 eran
// indistinguibles en el picker -- este aviso (NO bloqueante) es lo que
// permite detectarlo al cargar.
describe("loteVialYaExiste", () => {
  const anulaciones = new Map();

  test("mismo lote (normalizado) + mismo vial + misma sede -- true", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: 5, sedeId: "central", anulaciones })).toBe(true);
  });

  // El caso pedido explícitamente: el lote NUEVO se tipea en minúscula, el
  // VIEJO ya está guardado en mayúscula (create-only, nunca se migra) --
  // tienen que seguir matcheando los dos lados.
  test("nuevo en minúscula contra uno viejo guardado en mayúscula -- siguen matcheando", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    expect(loteVialYaExiste(lotes, { numeroLote: "lps261101e-25", numeroVial: 5, sedeId: "central", anulaciones })).toBe(true);
  });

  test("mismo lote, VIAL distinto -- false (vial 6 no choca con vial 5)", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: 6, sedeId: "central", anulaciones })).toBe(false);
  });

  test("mismo lote y vial, pero el existente está ANULADO -- false", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    const anuladoMap = new Map([["L1", { motivo: "error de carga" }]]);
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: 5, sedeId: "central", anulaciones: anuladoMap })).toBe(false);
  });

  test("mismo lote y vial, pero OTRA sede -- false", () => {
    const lotes = [{ id: "L1", sedeId: "italiano", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: 5, sedeId: "central", anulaciones })).toBe(false);
  });

  test("lote viejo SIN numeroVial -- nunca choca (undefined !== cualquier número)", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25" }];
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: 5, sedeId: "central", anulaciones })).toBe(false);
  });

  test("sin numeroVial tipeado todavía (null) -- false, no hay nada que comparar", () => {
    const lotes = [{ id: "L1", sedeId: "central", numeroLote: "LPS261101E-25", numeroVial: 5 }];
    expect(loteVialYaExiste(lotes, { numeroLote: "LPS261101E-25", numeroVial: null, sedeId: "central", anulaciones })).toBe(false);
  });
});

// Caso real reportado por Pablo (9/11): dos lotes recién guardados aparecían
// "más abajo" en vez de arriba -- el sort viejo comparaba new Date(null)
// (fecha todavía pendiente de confirmar por el servidor), que da el epoch
// 1/1/1970, no NaN -- el lote más nuevo se trataba como el más viejo.
//
// Premisa corregida el mismo 9/11, con datos reales de staging: "null =
// recién guardado, pendiente" es FALSA para datos ya almacenados -- 322 de
// 341 lotes de Lutecio-177 en staging tenían `fecha` null de forma
// PERMANENTE (cargas de prueba viejas, numeroLote "TEST-xxxxxxxx"), no
// transitoria. Con el criterio "null = más nuevo", esos 322 ocupaban todo el
// techo del listado para siempre y un lote real de hoy quedaba en la
// posición 323 de 341. Arreglo real: listenMibgLotes ahora lee con
// `serverTimestamps: "estimate"` (mibgLotes.js) -- una escritura en vuelo ya
// NUNCA llega como null, así que null null sólo puede ser dato viejo
// incompleto, y ordenarLotesPorCarga lo manda al FINAL (el más viejo), no al
// principio.
describe("ordenarLotesPorCarga", () => {
  test("fechas reales distintas -- la más reciente primero", () => {
    const lotes = [
      { id: "L1", fecha: ts("2026-11-01T10:00:00") },
      { id: "L2", fecha: ts("2026-11-05T10:00:00") },
      { id: "L3", fecha: ts("2026-11-03T10:00:00") },
    ];
    expect(ordenarLotesPorCarga(lotes).map((l) => l.id)).toEqual(["L2", "L3", "L1"]);
  });

  test("fechas reales IGUALES -- desempate estable y determinístico por id", () => {
    const mismaFecha = ts("2026-11-05T10:00:00");
    const lotes = [
      { id: "L9", fecha: mismaFecha },
      { id: "L2", fecha: mismaFecha },
      { id: "L5", fecha: mismaFecha },
    ];
    const orden1 = ordenarLotesPorCarga(lotes).map((l) => l.id);
    const orden2 = ordenarLotesPorCarga([...lotes].reverse()).map((l) => l.id);
    expect(orden1).toEqual(["L2", "L5", "L9"]);
    expect(orden2).toEqual(orden1);
  });

  test("fecha null/ausente (dato viejo incompleto, NUNCA un pending-write real -- ver listenMibgLotes) -- va AL FINAL, no arriba ni como NaN", () => {
    const lotes = [
      { id: "con-fecha-real", fecha: ts("2026-11-01T10:00:00") },
      { id: "sin-fecha-1", fecha: null },
      { id: "otro-con-fecha-real", fecha: ts("2026-11-05T10:00:00") },
    ];
    expect(ordenarLotesPorCarga(lotes).map((l) => l.id)).toEqual(["otro-con-fecha-real", "con-fecha-real", "sin-fecha-1"]);
  });

  test("lote sin campo fecha en absoluto (undefined, no null) -- mismo tratamiento, al final", () => {
    const lotes = [{ id: "con-fecha" }, { id: "sin-fecha-en-absoluto" }];
    lotes[0].fecha = ts("2026-11-01T10:00:00");
    expect(ordenarLotesPorCarga(lotes).map((l) => l.id)).toEqual(["con-fecha", "sin-fecha-en-absoluto"]);
  });

  test("fecha corrupta (no parseable, ej. string sin sentido) -- mismo tratamiento, al final", () => {
    const lotes = [
      { id: "con-fecha-real", fecha: ts("2026-11-01T10:00:00") },
      { id: "fecha-corrupta", fecha: "no es una fecha" },
    ];
    expect(ordenarLotesPorCarga(lotes).map((l) => l.id)).toEqual(["con-fecha-real", "fecha-corrupta"]);
  });

  test("mezcla real (caso staging 9/11): muchos lotes sin fecha + un lote real de HOY -- el de hoy aparece primero", () => {
    const sinFecha = Array.from({ length: 10 }, (_, i) => ({ id: `TEST-sin-fecha-${i}`, fecha: null }));
    const lotes = [
      { id: "L1-viejo-real", fecha: ts("2026-10-01T10:00:00") },
      ...sinFecha,
      { id: "lote-de-hoy", fecha: ts("2026-11-09T14:05:01") },
    ];
    const orden = ordenarLotesPorCarga(lotes).map((l) => l.id);
    expect(orden[0]).toBe("lote-de-hoy");
    expect(orden.slice(-10)).toEqual(expect.arrayContaining(sinFecha.map((l) => l.id)));
  });

  test("desempate determinístico por id entre dos lotes AMBOS sin fecha", () => {
    const lotes = [{ id: "zzz", fecha: null }, { id: "aaa", fecha: null }];
    expect(ordenarLotesPorCarga(lotes).map((l) => l.id)).toEqual(["aaa", "zzz"]);
  });

  test("no muta el array recibido -- devuelve una copia", () => {
    const original = [{ id: "L1", fecha: ts("2026-11-01T10:00:00") }, { id: "L2", fecha: ts("2026-11-05T10:00:00") }];
    const copia = [...original];
    ordenarLotesPorCarga(original);
    expect(original).toEqual(copia);
  });

  test("control de mutación: invertir el sentido del sort rompe el test de 'más reciente primero'", () => {
    const lotes = [{ id: "L1", fecha: ts("2026-11-01T10:00:00") }, { id: "L2", fecha: ts("2026-11-05T10:00:00") }];
    const orden = ordenarLotesPorCarga(lotes).map((l) => l.id);
    expect(orden).not.toEqual(["L1", "L2"]); // si alguien invierte el sort, este assert lo detecta
    expect(orden).toEqual(["L2", "L1"]);
  });

  test("control de mutación: poner 'null arriba' (en vez de al final) rompe el test de null/ausente", () => {
    const lotes = [
      { id: "con-fecha-real", fecha: ts("2026-11-01T10:00:00") },
      { id: "sin-fecha", fecha: null },
    ];
    const orden = ordenarLotesPorCarga(lotes).map((l) => l.id);
    expect(orden).not.toEqual(["sin-fecha", "con-fecha-real"]); // "null arriba" -- el criterio viejo e incorrecto
    expect(orden).toEqual(["con-fecha-real", "sin-fecha"]);
  });
});

describe("calibracionEsFutura", () => {
  const ahora = new Date("2026-11-09T12:00:00");

  test("justo en el margen (+5min exacto) -- todavía NO es futura", () => {
    expect(calibracionEsFutura("2026-11-09T12:05:00", ahora, 5)).toBe(false);
  });

  test("1 minuto más allá del margen (+6min) -- SÍ es futura", () => {
    expect(calibracionEsFutura("2026-11-09T12:06:00", ahora, 5)).toBe(true);
  });

  test("fecha claramente futura (+2 horas) -- futura", () => {
    expect(calibracionEsFutura("2026-11-09T14:00:00", ahora, 5)).toBe(true);
  });

  test("fecha claramente pasada (-2 horas) -- no futura", () => {
    expect(calibracionEsFutura("2026-11-09T10:00:00", ahora, 5)).toBe(false);
  });

  test("exactamente 'ahora' -- no futura", () => {
    expect(calibracionEsFutura("2026-11-09T12:00:00", ahora, 5)).toBe(false);
  });

  test("vacío ('') -- false, nunca avisa sobre un campo sin completar", () => {
    expect(calibracionEsFutura("", ahora, 5)).toBe(false);
  });

  test("null/undefined -- false", () => {
    expect(calibracionEsFutura(null, ahora, 5)).toBe(false);
    expect(calibracionEsFutura(undefined, ahora, 5)).toBe(false);
  });

  test("inválido (string sin sentido, no parseable) -- false, no NaN hacia afuera", () => {
    expect(calibracionEsFutura("no es una fecha", ahora, 5)).toBe(false);
  });

  test("margen por defecto (sin pasar margenMin) -- usa 5", () => {
    expect(calibracionEsFutura("2026-11-09T12:04:00", ahora)).toBe(false); // +4min, dentro del margen default
    expect(calibracionEsFutura("2026-11-09T12:06:00", ahora)).toBe(true); // +6min, fuera del margen default
  });

  test("control de mutación: comparar sin el margen (> ahora directo) rompe el caso 'justo en el margen'", () => {
    const sinMargen = (fecha, ahoraRef) => {
      if (!fecha) return false;
      const d = new Date(fecha);
      if (Number.isNaN(d.getTime())) return false;
      return d.getTime() > ahoraRef.getTime(); // mutación: ignora margenMin
    };
    // +5min ya sería "futura" sin margen -- distinto del resultado real (false).
    expect(sinMargen("2026-11-09T12:05:00", ahora)).not.toBe(calibracionEsFutura("2026-11-09T12:05:00", ahora, 5));
  });
});
