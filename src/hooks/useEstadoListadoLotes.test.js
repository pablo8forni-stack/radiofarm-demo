// useEstadoListadoLotes -- orquestación sobre estadoListadoLoteDosisUnica
// (que ya tiene sus propios tests contra el emulador real, scripts/testing/
// transacciones.test.mjs). Acá se mockea esa función: lo que se prueba es
// CUÁNDO el hook decide llamarla -- paginación sin releer lo ya resuelto,
// invalidación puntual por anulación, invalidación puntual por el aviso del
// listener (ajuste A), reset al cambiar de sede/isótopo (ajuste D) y
// protección contra respuestas tardías (ajuste E) -- nunca el resultado real
// de Firestore.
import { describe, test, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useEstadoListadoLotes } from "./useEstadoListadoLotes.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

vi.mock("../services/firestore/mibgLotes.js", () => ({
  estadoListadoLoteDosisUnica: vi.fn(),
}));

const lote = (id) => ({ id, fechaVencimiento: "2027-06-01" });
const estadoDisponible = (id) => new Map([[id, { estado: "disponible", uso: null, error: null }]]);
const estadoUsado = (id, usoId) => new Map([[id, { estado: "usado", uso: { id: usoId, pacienteNombre: "Paciente Test" }, error: null }]]);

function propsBase(overrides = {}) {
  return {
    anulaciones: new Map(),
    prefijo: "lote_",
    idsConUsoSegunListener: new Set(),
    scopeKey: "central|lutecio177",
    ...overrides,
  };
}

describe("useEstadoListadoLotes -- primera carga y paginación", () => {
  test("primera carga: verifica todos los lotes visibles de una sola corrida", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([
      ["L1", { estado: "disponible", uso: null, error: null }],
      ["L2", { estado: "usado", uso: { id: "lote_L2_1" }, error: null }],
    ]));

    const { result, rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1"), lote("L2")] } }
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    rerender({ lotes: [lote("L1"), lote("L2")] });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[0][0].map((l) => l.id)).toEqual(["L1", "L2"]);
    expect(result.current.estadoPorLote.get("L1").estado).toBe("disponible");
    expect(result.current.estadoPorLote.get("L2").estado).toBe("usado");
  });

  test("'Ver más': sólo verifica los lotes NUEVOS -- los ya resueltos no se vuelven a leer", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1")] } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L2"));
    rerender({ lotes: [lote("L1"), lote("L2")] }); // "Ver más" -- L1 sigue, L2 es nuevo
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    // La segunda corrida sólo pide L2 -- L1, ya resuelto, no se vuelve a pasar.
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id)).toEqual(["L2"]);
  });
});

describe("useEstadoListadoLotes -- invalidación puntual por anulación nueva", () => {
  test("anulación cuyo anulaId coincide con el 'uso.id' cacheado de un lote -- re-verifica SÓLO ese lote", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([
      ["L1", { estado: "usado", uso: { id: "lote_L1_1" }, error: null }],
      ["L2", { estado: "usado", uso: { id: "lote_L2_1" }, error: null }],
    ]));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1"), lote("L2")], anulaciones: new Map() } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    // Anula el USO de L1 (no L2) -- anulaId == "lote_L1_1", el id del uso
    // que el hook ya tenía cacheado para L1.
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));
    const anulacionNueva = new Map([["lote_L1_1", { anulaId: "lote_L1_1", motivo: "Error" }]]);
    rerender({ lotes: [lote("L1"), lote("L2")], anulaciones: anulacionNueva });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id)).toEqual(["L1"]);
  });

  test("anulación cuyo anulaId es directamente el id de un lote visible -- ese lote se re-verifica (sale 'anulado' gratis, sin lectura extra desde el punto de vista del hook)", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1")], anulaciones: new Map() } }
    );
    await act(async () => { await Promise.resolve(); });

    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([["L1", { estado: "anulado", uso: null, error: null }]]));
    const anulacionDeLote = new Map([["L1", { anulaId: "L1", motivo: "Lote mal cargado" }]]);
    rerender({ lotes: [lote("L1")], anulaciones: anulacionDeLote });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id)).toEqual(["L1"]);
  });

  test("anulación que no coincide con ningún lote visible ni con ningún uso cacheado -- cero llamadas nuevas", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoUsado("L1", "lote_L1_1"));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1")], anulaciones: new Map() } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    // Anulación de una acta sin relación (otro tipo, otro lote).
    const anulacionAjena = new Map([["marcacion_de_otro_dia", { anulaId: "marcacion_de_otro_dia", motivo: "x" }]]);
    rerender({ lotes: [lote("L1")], anulaciones: anulacionAjena });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1); // sigue en 1 -- nada se disparó
  });
});

describe("useEstadoListadoLotes -- ajuste A: aviso del listener (idsConUsoSegunListener)", () => {
  test("uso nuevo cuyo lote estaba cacheado SIN uso (disponible) -- invalida y re-verifica SÓLO ese lote", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([
      ["L1", { estado: "disponible", uso: null, error: null }],
      ["L2", { estado: "usado", uso: { id: "lote_L2_1" }, error: null }],
    ]));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L1"), lote("L2")], idsConUsoSegunListener: new Set() } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    // listenActas avisa que ahora L1 tiene un uso -- L1 estaba "disponible"
    // (sin uso), así que SÍ dispara una re-verificación puntual.
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoUsado("L1", "lote_L1_1"));
    rerender({ lotes: [lote("L1"), lote("L2")], idsConUsoSegunListener: new Set(["L1"]) });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id)).toEqual(["L1"]);
  });

  test("uso nuevo de un lote que YA figuraba 'usado' -- no dispara ninguna lectura", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoUsado("L2", "lote_L2_1"));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes(props.lotes, propsBase(props)),
      { initialProps: { lotes: [lote("L2")], idsConUsoSegunListener: new Set() } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    // El listener "avisa" sobre L2 otra vez (ej. re-emisión) -- ya estaba
    // "usado", así que no tiene que disparar nada nuevo.
    rerender({ lotes: [lote("L2")], idsConUsoSegunListener: new Set(["L2"]) });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);
  });
});

describe("useEstadoListadoLotes -- Reintentar", () => {
  test("reintentar(loteId) re-verifica SÓLO ese lote, no toda la página visible", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([
      ["L1", { estado: "no-verificable", uso: null, error: new Error("boom") }],
      ["L2", { estado: "disponible", uso: null, error: null }],
    ]));

    const { result } = renderHook(() => useEstadoListadoLotes([lote("L1"), lote("L2")], propsBase()));
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));
    await act(async () => { result.current.reintentar("L1"); await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
    expect(mod.estadoListadoLoteDosisUnica.mock.calls[1][0].map((l) => l.id)).toEqual(["L1"]);
    expect(result.current.estadoPorLote.get("L2").estado).toBe("disponible"); // intacto, no se tocó
  });
});

describe("useEstadoListadoLotes -- ajuste D: el cache vive en el componente, se reinicia al desmontar o cambiar de sede/isótopo", () => {
  test("desmontar y montar de nuevo (misma sede/isótopo) vuelve a verificar desde cero", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

    const { unmount } = renderHook(() => useEstadoListadoLotes([lote("L1")], propsBase()));
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);
    unmount();

    const { result } = renderHook(() => useEstadoListadoLotes([lote("L1")], propsBase()));
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2); // instancia nueva, se reinició desde cero
    expect(result.current.estadoPorLote.get("L1").estado).toBe("disponible");
  });

  test("cambiar scopeKey (sede/isótopo) reinicia el cache -- vuelve a verificar el mismo loteId", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

    const { rerender } = renderHook(
      (props) => useEstadoListadoLotes([lote("L1")], propsBase({ scopeKey: props.scopeKey })),
      { initialProps: { scopeKey: "central|lutecio177" } }
    );
    await act(async () => { await Promise.resolve(); });
    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);

    // Mismo loteId "L1", pero ahora es otra sede (admin cambió sedeAuditando)
    // -- el estado viejo de "L1" (de la sede anterior) no puede quedar
    // mostrado como si fuera de la sede nueva.
    rerender({ scopeKey: "italiano|lutecio177" });
    await act(async () => { await Promise.resolve(); });

    expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(2);
  });
});

describe("useEstadoListadoLotes -- ajuste E: una respuesta tardía no pisa el estado nuevo", () => {
  test("cambiar de scope (sede/isótopo) mientras una verificación vieja todavía está en vuelo -- la respuesta vieja, al llegar después, no pisa nada", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    let resolverVieja;
    mod.estadoListadoLoteDosisUnica.mockImplementationOnce(() => new Promise((r) => { resolverVieja = r; }));

    const { result, rerender } = renderHook(
      (props) => useEstadoListadoLotes([lote("L1")], propsBase({ scopeKey: props.scopeKey })),
      { initialProps: { scopeKey: "central|lutecio177" } }
    );
    await act(async () => { await Promise.resolve(); }); // arranca la corrida vieja, todavía no resuelve

    // Cambia de sede ANTES de que la corrida vieja resuelva -- dispara una
    // corrida nueva (con su propia promesa, resuelta de inmediato).
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(new Map([["L1", { estado: "usado", uso: { id: "lote_L1_1" }, error: null }]]));
    rerender({ scopeKey: "italiano|lutecio177" });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.estadoPorLote.get("L1").estado).toBe("usado"); // la corrida nueva ya resolvió

    // Ahora resuelve la corrida VIEJA, de la sede anterior -- tiene que ser
    // descartada por completo, nunca pisar lo que ya puso la corrida nueva.
    await act(async () => { resolverVieja(estadoDisponible("L1")); await Promise.resolve(); });
    expect(result.current.estadoPorLote.get("L1").estado).toBe("usado"); // sigue igual, la tardía no pisó nada
  });

  test("reintentar el MISMO lote dos veces rápido -- sólo la verificación que arrancó última puede escribir el resultado", async () => {
    const mod = await import("../services/firestore/mibgLotes.js");
    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoUsado("L1", "lote_L1_1"));
    const { result } = renderHook(() => useEstadoListadoLotes([lote("L1")], propsBase()));
    await act(async () => { await Promise.resolve(); });

    let resolverPrimerReintento;
    mod.estadoListadoLoteDosisUnica.mockImplementationOnce(() => new Promise((r) => { resolverPrimerReintento = r; }));
    act(() => { result.current.reintentar("L1"); }); // primer reintento, queda colgado

    mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));
    await act(async () => { result.current.reintentar("L1"); await Promise.resolve(); }); // segundo reintento, resuelve antes
    expect(result.current.estadoPorLote.get("L1").estado).toBe("disponible");

    // El primer reintento (más viejo) resuelve DESPUÉS -- no puede pisar el
    // resultado del segundo, que arrancó más tarde.
    await act(async () => { resolverPrimerReintento(estadoUsado("L1", "lote_L1_1")); await Promise.resolve(); });
    expect(result.current.estadoPorLote.get("L1").estado).toBe("disponible"); // sigue igual
  });
});

// Ajuste C de Pablo: hoyISO tiene que ser LOCAL (getFullYear/getMonth/getDate
// -- hoy(), helpers/formato.js), nunca UTC/toISOString(). El hook llama
// hoy() dentro de verificarLotes -- este test lo confirma indirectamente,
// inspeccionando el hoyISO real que le llega a estadoListadoLoteDosisUnica,
// con el reloj pisado cerca de medianoche en Mendoza (mismo escenario ya
// usado en formato.test.js para hoy() mismo: 21:01 local ya es el día
// siguiente en UTC). Restauración de TZ con el mismo cuidado que ya se
// corrigió en mibgLote.test.js/formato.test.js -- process.env.TZ = undefined
// coacciona a la string "undefined", nunca lo borra.
describe("useEstadoListadoLotes -- ajuste C: hoyISO es fecha LOCAL, no UTC", () => {
  test("21:01 en Mendoza (ya es el día siguiente en UTC) -- hoyISO que recibe estadoListadoLoteDosisUnica es el día LOCAL", async () => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = "America/Argentina/Mendoza";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 1, 0)); // 7/11 21:01 local
    try {
      const mod = await import("../services/firestore/mibgLotes.js");
      mod.estadoListadoLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

      renderHook(() => useEstadoListadoLotes([lote("L1")], propsBase()));
      await act(async () => { await Promise.resolve(); });

      expect(mod.estadoListadoLoteDosisUnica).toHaveBeenCalledTimes(1);
      const { hoyISO } = mod.estadoListadoLoteDosisUnica.mock.calls[0][1];
      expect(hoyISO).toBe("2026-11-07"); // LOCAL -- si fuera UTC, sería "2026-11-08"
    } finally {
      vi.useRealTimers();
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });
});
