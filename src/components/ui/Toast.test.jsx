import { useRef, useState } from "react";
import { describe, test, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { Toast } from "./Toast.jsx";

afterEach(cleanup);

// Harness que reproduce el patrón real de App.jsx: un ÚNICO slot de estado
// para el toast, reemplazado (nunca pasa por null) en cada llamada -- la
// única variable es si <Toast> se remonta con una key que cambie en CADA
// llamada (el arreglo real, Paso 1b) o no (el bug real, antes del Paso 1b).
// No se renderiza <App/> completo (requeriría mockear ~10 módulos --
// useAuth/useCatalogo/useAppLock/avisos/8 vistas -- fuera de proporción
// para este arreglo puntual) -- éste reproduce el mecanismo exacto del que
// depende el fix real (ver diff de App.jsx: mostrarToast + key={toast.key}).
function HostDeToast({ conKeyQueCambia }) {
  const [toast, setToast] = useState(null);
  const seqRef = useRef(0);
  function mostrar(m, t, d) {
    setToast({ m, t, d, key: conKeyQueCambia ? ++seqRef.current : "fija" });
  }
  return (
    <>
      <button onClick={() => mostrar("A corta", "info", 1000)}>mostrar A</button>
      <button onClick={() => mostrar("B larga (Paso T)", "info", 25000)}>mostrar B</button>
      {toast && <Toast key={toast.key} msg={toast.m} type={toast.t} duracion={toast.d} onDone={() => setToast(null)} />}
    </>
  );
}

describe("Toast -- reproducción del bug real (slot único sin remontar)", () => {
  test("B hereda el timer de A y se descarta antes de sus propios 25000ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<HostDeToast conKeyQueCambia={false} />);
    fireEvent.click(screen.getByText("mostrar A"));
    fireEvent.click(screen.getByText("mostrar B"));
    expect(screen.getByText("B larga (Paso T)")).toBeTruthy();

    // El tiempo de A (1000ms), NO el de B (25000ms).
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    // BUG real: sin remontar, el timer que vence es el de A -- se lo lleva
    // puesto a B, mucho antes de sus 25000ms.
    expect(screen.queryByText("B larga (Paso T)")).toBeNull();
    vi.useRealTimers();
  });
});

describe("Toast -- arreglo (Paso 1b): key incremental fuerza un remount real por cada toast nuevo", () => {
  test("B sigue visible pasado el tiempo de A, y se descarta en SU propio tiempo (25000ms)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<HostDeToast conKeyQueCambia />);
    fireEvent.click(screen.getByText("mostrar A"));
    fireEvent.click(screen.getByText("mostrar B"));

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // tiempo de A
    expect(screen.getByText("B larga (Paso T)")).toBeTruthy(); // sigue -- A ya no tiene nada que tumbar

    await act(async () => { await vi.advanceTimersByTimeAsync(24000); }); // completa los 25000ms de B
    expect(screen.queryByText("B larga (Paso T)")).toBeNull();
    vi.useRealTimers();
  });

  test("mismo texto dos veces seguidas -- la segunda reinicia el temporizador, no hereda el tiempo ya corrido de la primera", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<HostDeToast conKeyQueCambia />);
    fireEvent.click(screen.getByText("mostrar A")); // "A corta", 1000ms

    await act(async () => { await vi.advanceTimersByTimeAsync(700); }); // casi, no termina
    fireEvent.click(screen.getByText("mostrar A")); // MISMO texto, misma duración -- de nuevo

    // Si no hubiera reiniciado: 700 (ya corridos antes del 2do click) + 300
    // más completarían el 1000ms ORIGINAL. Con el reinicio, a los 300ms del
    // SEGUNDO click todavía le faltan 700ms propios.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText("A corta")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(700); }); // completa los 1000ms DEL SEGUNDO click
    expect(screen.queryByText("A corta")).toBeNull();
    vi.useRealTimers();
  });

  test("la duración personalizada (25000) se respeta -- no cae al default de 'info' (4000, DURACION_DEFAULT)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<HostDeToast conKeyQueCambia />);
    fireEvent.click(screen.getByText("mostrar B")); // duracion=25000

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); // el default de "info" ya habría vencido
    expect(screen.getByText("B larga (Paso T)")).toBeTruthy(); // sigue -- usó 25000, no el default

    await act(async () => { await vi.advanceTimersByTimeAsync(21000); }); // completa los 25000ms reales
    expect(screen.queryByText("B larga (Paso T)")).toBeNull();
    vi.useRealTimers();
  });
});
