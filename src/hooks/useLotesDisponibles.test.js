// useLotesDisponibles -- orquestación sobre estadoPorLoteDosisUnica (que ya
// tiene sus propios tests contra el emulador real, scripts/testing/
// transacciones.test.mjs). Acá se mockea esa función: lo que se prueba es
// CUÁNDO el hook decide llamarla (anti-carrera, clave estable, refrescar,
// fail-closed), no el resultado real de Firestore.
import { describe, test, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useLotesDisponibles } from "./useLotesDisponibles.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

vi.mock("../services/firestore/mibgLotes.js", () => ({
  estadoPorLoteDosisUnica: vi.fn(),
  disponiblesDesdeEstadoPorLote: (lotes, estadoPorLoteId) =>
    lotes.filter((l) => estadoPorLoteId.get(l.id)?.estado === "disponible"),
}));

const estadoDisponible = (id) => new Map([[id, { estado: "disponible", uso: null, error: null }]]);

// Envuelve renderHook para quedarse con una foto de CADA render (no sólo el
// final vía result.current) -- lo que a Pablo le importa de "cargando
// derivado" es que nunca muestre un estado inconsistente (cargando=false con
// un resultado que no es el de la clave actual) en NINGÚN render intermedio,
// no sólo al final de un waitFor.
function renderHookConHistorial(hookFn, options) {
  const historial = [];
  const utils = renderHook((props) => {
    const valor = hookFn(props);
    historial.push({ cargando: valor.cargando, tamanoEstado: valor.estadoPorLote.size, disponibles: valor.disponibles.map((l) => l.id) });
    return valor;
  }, options);
  return { ...utils, historial };
}

describe("useLotesDisponibles -- cargando derivado, nunca desincronizado", () => {
  test("TODOS los renders durante la corrida muestran cargando=true -- incluido el primero, antes de que el efecto llegue a correr", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    let resolver;
    mibgLotesMod.estadoPorLoteDosisUnica.mockImplementation(() => new Promise((r) => { resolver = r; }));

    const { result, historial } = renderHookConHistorial(() => useLotesDisponibles([{ id: "L1" }], { anulaciones: new Map(), prefijo: "lote_" }));

    // Primer render (sincrónico, ANTES de que useEffect corra): claveResuelta
    // arranca en null, nunca puede coincidir con la clave actual -- cargando
    // ya es true sin depender de que ejecutar() haya alcanzado a setear nada.
    expect(historial[0]).toEqual({ cargando: true, tamanoEstado: 0, disponibles: [] });
    expect(result.current.cargando).toBe(true);

    await act(async () => { resolver(estadoDisponible("L1")); await Promise.resolve(); });

    // Cada render registrado hasta ahora (el primero, y cualquiera que haya
    // disparado el efecto) tiene que haber sido cargando=true -- recién el
    // ÚLTIMO, tras aplicarse el resultado, pasa a false.
    expect(historial.slice(0, -1).every((h) => h.cargando === true)).toBe(true);
    const ultimo = historial[historial.length - 1];
    expect(ultimo).toEqual({ cargando: false, tamanoEstado: 1, disponibles: ["L1"] });
  });
});

describe("useLotesDisponibles -- fail-closed: un error en la corrida nunca deja un lote como 'disponible' ni cargando pegado en true", () => {
  test("estadoPorLoteDosisUnica rechaza -- todos los candidatos quedan 'no-verificable', cargando termina en false", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    const errorFalso = new Error("falla simulada, no es un permission-denied por lote");
    mibgLotesMod.estadoPorLoteDosisUnica.mockRejectedValueOnce(errorFalso);

    const { result, historial } = renderHookConHistorial(() =>
      useLotesDisponibles([{ id: "L1" }, { id: "L2" }], { anulaciones: new Map(), prefijo: "lote_" })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));

    // Nunca "disponible" por descarte -- ninguno de los dos candidatos.
    expect(result.current.disponibles).toEqual([]);
    expect(result.current.estadoPorLote.get("L1").estado).toBe("no-verificable");
    expect(result.current.estadoPorLote.get("L2").estado).toBe("no-verificable");
    expect(result.current.estadoPorLote.get("L1").error).toBe(errorFalso);

    // cargando no se quedó pegado en true en NINGÚN render -- el último
    // registrado es false (la corrida se resolvió igual, pese al error).
    expect(historial[historial.length - 1].cargando).toBe(false);
  });
});

describe("useLotesDisponibles -- anti-carrera (token)", () => {
  test("una corrida vieja que resuelve DESPUÉS de una más nueva no pisa el resultado", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    let resolverVieja, resolverNueva;
    mibgLotesMod.estadoPorLoteDosisUnica
      .mockImplementationOnce(() => new Promise((r) => { resolverVieja = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolverNueva = r; }));

    const { result, rerender } = renderHook(
      ({ lotes }) => useLotesDisponibles(lotes, { anulaciones: new Map(), prefijo: "lote_" }),
      { initialProps: { lotes: [{ id: "L1" }] } }
    );

    // Cambia el conjunto de candidatos (clave distinta) ANTES de que la
    // corrida vieja resuelva -- dispara una segunda corrida.
    rerender({ lotes: [{ id: "L2" }] });

    // La corrida VIEJA (L1) resuelve DESPUÉS de la nueva (L2) -- no debería
    // pisar el resultado de la nueva, aunque llegue más tarde.
    await act(async () => { resolverNueva(estadoDisponible("L2")); await Promise.resolve(); });
    await act(async () => { resolverVieja(estadoDisponible("L1")); await Promise.resolve(); });

    expect(result.current.estadoPorLote.has("L2")).toBe(true);
    expect(result.current.estadoPorLote.has("L1")).toBe(false);
  });
});

describe("useLotesDisponibles -- refrescar() fuerza un recálculo", () => {
  test("refrescar() vuelve a llamar a estadoPorLoteDosisUnica aunque el conjunto no haya cambiado, y cargando vuelve a true de inmediato (antes de que la nueva corrida resuelva)", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    mibgLotesMod.estadoPorLoteDosisUnica.mockResolvedValueOnce(estadoDisponible("L1"));
    let resolverRefrescar;
    mibgLotesMod.estadoPorLoteDosisUnica.mockImplementationOnce(() => new Promise((r) => { resolverRefrescar = r; }));

    const { result } = renderHook(() => useLotesDisponibles([{ id: "L1" }], { anulaciones: new Map(), prefijo: "lote_" }));
    await waitFor(() => expect(result.current.cargando).toBe(false));

    // act() SÍNCRONO (no async/await) a propósito -- queremos el estado
    // INMEDIATO después de refrescar(), antes de que la promesa de la nueva
    // corrida (todavía controlada a mano, sin resolver) tenga chance de
    // asentarse. Si cargando fuera un booleano propio en vez de derivado de
    // claveResuelta, este assert no distinguiría "se olvidaron de ponerlo en
    // true" de "ya resolvió"; acá, al no haber resuelto nada todavía, sólo
    // puede ser true si la invalidación de claveResuelta funcionó de verdad.
    act(() => { result.current.refrescar(); });
    expect(result.current.cargando).toBe(true);
    expect(mibgLotesMod.estadoPorLoteDosisUnica).toHaveBeenCalledTimes(2);

    await act(async () => { resolverRefrescar(estadoDisponible("L1")); await Promise.resolve(); });
    expect(result.current.cargando).toBe(false);
  });
});

describe("useLotesDisponibles -- clave estable: no relanza si el conjunto de candidatos no cambió", () => {
  test("re-render con una lista NUEVA (otra referencia de array) pero los MISMOS ids -- NO relanza la lectura puntual", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    mibgLotesMod.estadoPorLoteDosisUnica.mockResolvedValue(estadoDisponible("L1"));

    const { rerender } = renderHook(
      ({ lotes, anulaciones }) => useLotesDisponibles(lotes, { anulaciones, prefijo: "lote_" }),
      { initialProps: { lotes: [{ id: "L1" }], anulaciones: new Map() } }
    );
    await waitFor(() => expect(mibgLotesMod.estadoPorLoteDosisUnica).toHaveBeenCalledTimes(1));

    // Misma clave (mismo id "L1", mismas anulaciones vacías) -- referencias
    // de array/Map NUEVAS a propósito, como haría un listener en vivo que
    // reemite sin cambios reales.
    rerender({ lotes: [{ id: "L1" }], anulaciones: new Map() });
    rerender({ lotes: [{ id: "L1", proveedor: "dato que no afecta la clave" }], anulaciones: new Map() });

    // Un solo microtask de margen para que, SI el hook relanzara, ya se vea.
    await act(async () => { await Promise.resolve(); });
    expect(mibgLotesMod.estadoPorLoteDosisUnica).toHaveBeenCalledTimes(1);
  });

  test("re-render con un id DISTINTO -- sí relanza", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    mibgLotesMod.estadoPorLoteDosisUnica.mockResolvedValue(new Map());

    const { rerender } = renderHook(
      ({ lotes }) => useLotesDisponibles(lotes, { anulaciones: new Map(), prefijo: "lote_" }),
      { initialProps: { lotes: [{ id: "L1" }] } }
    );
    await waitFor(() => expect(mibgLotesMod.estadoPorLoteDosisUnica).toHaveBeenCalledTimes(1));

    rerender({ lotes: [{ id: "L2" }] });
    await waitFor(() => expect(mibgLotesMod.estadoPorLoteDosisUnica).toHaveBeenCalledTimes(2));
  });

  test("rerender con id DISTINTO -- el render INMEDIATO ya tiene cargando=true (antes del efecto) y disponibles no arrastra lotes que ya no están en `lotes`", async () => {
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    mibgLotesMod.estadoPorLoteDosisUnica.mockResolvedValueOnce(estadoDisponible("L1"));
    let resolverSegunda;
    mibgLotesMod.estadoPorLoteDosisUnica.mockImplementationOnce(() => new Promise((r) => { resolverSegunda = r; }));

    const { rerender, historial } = renderHookConHistorial(
      ({ lotes }) => useLotesDisponibles(lotes, { anulaciones: new Map(), prefijo: "lote_" }),
      { initialProps: { lotes: [{ id: "L1" }] } }
    );
    await waitFor(() => expect(historial[historial.length - 1].cargando).toBe(false));
    expect(historial[historial.length - 1]).toEqual({ cargando: false, tamanoEstado: 1, disponibles: ["L1"] });

    const rendersAntes = historial.length;
    rerender({ lotes: [{ id: "L2" }] }); // L1 sale del conjunto, entra L2 -- rerender() de testing-library ya corre dentro de act(), sincrónico.

    // El render INMEDIATO (el del propio rerender, ANTES de que useEffect
    // llegue a disparar la segunda corrida) ya tiene que mostrar
    // cargando=true -- la clave cambió de "L1|" a "L2|" en este mismo
    // render, claveResuelta todavía en "L1|" (eso es lo que hace que
    // cargando sea un valor derivado, no algo que dependa de que el efecto
    // ya haya corrido). Y sobre todo: disponibles NO puede mostrar "L1" --
    // L1 ya no está en `lotes`, aunque estadoPorLote (todavía el viejo, con
    // L1 "disponible") no se haya reemplazado -- disponiblesDesdeEstadoPorLote
    // filtra siempre contra el `lotes` ACTUAL, nunca contra el mapa viejo.
    const inmediato = historial[rendersAntes];
    expect(inmediato.cargando).toBe(true);
    expect(inmediato.disponibles).toEqual([]);

    await act(async () => { resolverSegunda(estadoDisponible("L2")); await Promise.resolve(); });
    expect(historial[historial.length - 1]).toEqual({ cargando: false, tamanoEstado: 1, disponibles: ["L2"] });
  });
});

describe("useLotesDisponibles -- desmontaje mientras la corrida está en vuelo", () => {
  test("resolver DESPUÉS de desmontar no tira error ni warning", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mibgLotesMod = await import("../services/firestore/mibgLotes.js");
    let resolver;
    mibgLotesMod.estadoPorLoteDosisUnica.mockImplementation(() => new Promise((r) => { resolver = r; }));

    const { unmount } = renderHook(() => useLotesDisponibles([{ id: "L1" }], { anulaciones: new Map(), prefijo: "lote_" }));
    unmount();

    // La corrida sigue en vuelo (nadie la canceló -- no hay forma de
    // cancelar un getDoc ya en curso) -- resuelve DESPUÉS del desmontaje.
    // setEstadoPorLote/setClaveResuelta todavía se llaman sobre un
    // componente ya desmontado -- no debe explotar ni loguear nada.
    await expect(act(async () => {
      resolver(estadoDisponible("L1"));
      await Promise.resolve();
    })).resolves.not.toThrow();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
