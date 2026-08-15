import { useEffect, useState } from "react";
import { hayPinConfigurado, debeBloquear, marcarActividad, msDesdeUltimaActividad, TIMEOUT_MS } from "../helpers/appLock.js";

const TICK_MS = 20000;
const log = (...args) => console.log("[AppLock]", ...args);

// Orquesta el bloqueo propio de la app (ver helpers/appLock.js para el
// detalle de PIN/biometría/timestamp).
//
// SEGUNDO rediseño tras confirmar que el primero (marcar en un setInterval
// que arrancaba/paraba con visibilitychange) tampoco funcionó en
// dispositivo real -- el fallo lógico: el intervalo dependía del MISMO
// evento que ya sabíamos poco confiable para saber cuándo parar. Si
// "hidden" no dispara al cambiar de app, el intervalo nunca se detiene y
// sigue refrescando el timestamp durante todo el segundo plano.
//
// Ahora: un ÚNICO intervalo de 20s que NUNCA se arranca ni se para por
// ningún evento -- en cada tick se auto-consulta leyendo
// document.visibilityState directamente (la PROPIEDAD, no el evento de
// cambio -- eso sí es fiable aunque la notificación de cambio no lo sea).
// Sólo marca actividad si en ESE momento está realmente visible, y detecta
// la transición oculto→visible comparando contra lo que vio en el tick
// anterior, sin necesitar que nadie le avise. Cota de detección: 20s.
//
// visibilitychange/pageshow/focus quedan como atajo oportunista (chequeo
// inmediato si disparan) pero ya no son la garantía.
export function useAppLock(uid) {
  const [necesitaConfigurarPin, setNecesitaConfigurarPin] = useState(() => !hayPinConfigurado(uid));
  const [bloqueado, setBloqueado] = useState(() => hayPinConfigurado(uid) && debeBloquear());

  useEffect(() => {
    let visibleEnTickAnterior = document.visibilityState === "visible";

    function chequear(origen) {
      const visible = document.visibilityState;
      const ms = msDesdeUltimaActividad();
      const bloq = hayPinConfigurado(uid) && debeBloquear();
      log(`chequeo (${origen}) -- visibilityState=${visible}, ms desde última actividad=${ms}, debeBloquear=${bloq}`);
      if (bloq) setBloqueado(true);
    }

    function tick() {
      const visibleAhora = document.visibilityState === "visible";
      if (visibleAhora) {
        if (!visibleEnTickAnterior) {
          log("tick: detectó transición oculto -> visible (polling)");
          chequear("polling");
        }
        marcarActividad();
        log("tick: visible, marcó actividad");
      } else {
        log("tick: oculto, NO marca actividad (timestamp queda congelado)");
      }
      visibleEnTickAnterior = visibleAhora;
    }

    log(`iniciando -- TIMEOUT_MS=${TIMEOUT_MS}, TICK_MS=${TICK_MS}`);
    const intervalo = setInterval(tick, TICK_MS);

    function onVisibilityChange() {
      log(`evento visibilitychange -- document.visibilityState=${document.visibilityState}`);
      if (document.visibilityState === "visible") chequear("visibilitychange");
    }
    function onPageShow() { log("evento pageshow"); chequear("pageshow"); }
    function onFocus() { log("evento focus"); chequear("focus"); }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
    };
  }, [uid]);

  // Llamado por PantallaBloqueo tras PIN/biometría correcta.
  function desbloquear() {
    marcarActividad();
    setBloqueado(false);
  }

  // Llamado al terminar el setup inicial de PIN -- evita pedirlo de nuevo
  // apenas se acaba de crear.
  function terminarSetup() {
    marcarActividad();
    setNecesitaConfigurarPin(false);
    setBloqueado(false);
  }

  return { bloqueado, necesitaConfigurarPin, desbloquear, terminarSetup };
}
