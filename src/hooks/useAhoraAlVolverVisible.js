import { useEffect, useState } from "react";

// Paso "decaído" de I-131 (9/11, ajuste F de Pablo) -- SIN timer. El estado
// de decaimiento ya se recalcula solo cada vez que cambian los datos (son
// listeners en vivo, cualquier escritura real dispara un re-render). El
// único caso que un simple re-render por datos no cubre es: la pestaña
// queda abierta sin ningún cambio de datos, pasa el tiempo, y al volver a
// mirarla el decaimiento mostrado quedó desactualizado porque nada forzó un
// re-render mientras tanto. Este hook sólo resuelve ESE caso puntual --
// vía visibilitychange, no un intervalo corriendo de fondo.
export function useAhoraAlVolverVisible() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    function alCambiarVisibilidad() {
      if (document.visibilityState === "visible") setAhora(new Date());
    }
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  }, []);
  return ahora;
}
