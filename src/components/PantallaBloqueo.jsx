import { useEffect, useState } from "react";
import { Btn } from "./ui/Btn.jsx";
import { Input } from "./ui/Input.jsx";
import {
  guardarPin, verificarPin, biometriaDisponible, hayBiometriaRegistrada, registrarBiometria, verificarBiometria,
} from "../helpers/appLock.js";

// Overlay a pantalla completa, a propósito SIN botón de cerrar ni click
// afuera (a diferencia de Modal.jsx, que sí es descartable) -- acá no
// corresponde, es el gate obligatorio. Tres pasos posibles: setup del PIN
// (primera vez en este dispositivo, no se puede omitir), oferta de
// biometría (opcional, sólo aparece una vez, apenas se crea el PIN -- ver
// nota de bug real más abajo) y desbloqueo.
export function PantallaBloqueo({ usuario, necesitaConfigurarPin, onDesbloquear, onTerminarSetup }) {
  const [paso, setPaso] = useState(necesitaConfigurarPin ? "pin" : "desbloqueo");
  const [pin, setPin] = useState("");
  const [pinConfirmar, setPinConfirmar] = useState("");
  const [error, setError] = useState("");
  const [intentosFallidos, setIntentosFallidos] = useState(0);
  const [verificando, setVerificando] = useState(false);
  const [mostrarOlvido, setMostrarOlvido] = useState(false);
  // biometriaDisponible() es async de verdad (awaitea la Promise real del
  // navegador, ver nota en helpers/appLock.js) -- se resuelve una vez al
  // montar, null mientras tanto (no se muestra nada hasta saber la
  // respuesta real).
  const [biometriaDisp, setBiometriaDisp] = useState(null);

  useEffect(() => {
    biometriaDisponible().then(setBiometriaDisp);
  }, []);

  const puedeBiometriaUnlock = paso === "desbloqueo" && biometriaDisp && hayBiometriaRegistrada(usuario.email);

  async function intentarBiometria() {
    setVerificando(true);
    const ok = await verificarBiometria(usuario.email);
    setVerificando(false);
    if (ok) onDesbloquear();
    // Si cancela o falla, se queda en el campo de PIN -- no es un intento
    // de PIN fallido, no suma al freno de 3 intentos.
  }

  // Ofrece Face ID/huella apenas aparece la pantalla de DESBLOQUEO (no en
  // el paso de setup), mismo criterio que apps de banco -- con botón para
  // reintentar si se cancela.
  useEffect(() => {
    if (puedeBiometriaUnlock) intentarBiometria();
    // eslint-disable-next-line
  }, [puedeBiometriaUnlock]);

  async function confirmarSetup() {
    setError("");
    if (!/^\d{4,}$/.test(pin)) { setError("El PIN debe tener al menos 4 dígitos, sólo números."); return; }
    if (pin !== pinConfirmar) { setError("Los dos PIN no coinciden."); return; }
    // guardarPin ahora puede tirar (storage lleno, ver appLock.js) -- antes
    // no había try/catch acá, así que un error hubiera quedado como
    // promesa rechazada sin manejar: la pantalla no avanzaba y tampoco
    // mostraba nada, indistinguible de una app trabada.
    try {
      await guardarPin(usuario.email, pin);
    } catch (e) {
      setError(e.message || "No se pudo guardar el PIN.");
      return;
    }
    // Bug real encontrado en prueba de dispositivo: la oferta de
    // biometría vivía sólo en ModalSeguridad (un ícono aparte del header)
    // -- nadie tenía motivo para descubrirlo apenas terminaba de crear el
    // PIN, así que en la práctica nunca se activaba. Ahora se ofrece acá
    // mismo, en el momento en que importa -- si el dispositivo no la
    // soporta, se salta directo (biometriaDisp === false).
    if (biometriaDisp) setPaso("biometria");
    else onTerminarSetup();
  }

  async function activarBiometria() {
    setError("");
    setVerificando(true);
    try {
      await registrarBiometria(usuario.email, usuario.nombre);
      onTerminarSetup();
    } catch (e) {
      // Detalle real del error (no genérico) -- para poder diagnosticar
      // sin devtools remoto si vuelve a fallar en un dispositivo real.
      setError(`No se pudo activar: ${e.name || "Error"} -- ${e.message || "sin detalle"}`);
      setVerificando(false);
    }
  }

  async function intentarPin() {
    setError("");
    setVerificando(true);
    const ok = await verificarPin(usuario.email, pin);
    setVerificando(false);
    if (ok) { onDesbloquear(); return; }
    setPin("");
    const nuevosFallidos = intentosFallidos + 1;
    if (nuevosFallidos >= 3) {
      setIntentosFallidos(0);
      setError("PIN incorrecto. Esperá unos segundos...");
      setVerificando(true);
      await new Promise((r) => setTimeout(r, 2000));
      setVerificando(false);
      setError("PIN incorrecto.");
    } else {
      setIntentosFallidos(nuevosFallidos);
      setError("PIN incorrecto.");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6 gap-6">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">RadioFarm</h1>
        <p className="text-blue-300/60 text-xs mt-1">
          {paso === "pin" ? "Configurá un PIN de acceso" : paso === "biometria" ? "Un paso más (opcional)" : "Ingresá tu PIN para continuar"}
        </p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4">
        {paso === "pin" && (
          <>
            <p className="text-white/50 text-xs text-center leading-relaxed">
              Se usa para volver a entrar a RadioFarm después de un rato sin usarla -- independiente del bloqueo del celular. Sólo vos lo conocés, no se guarda en ningún servidor.
            </p>
            {/* type="text" + WebkitTextSecurity (no type="password") a
                propósito -- bug real: cualquier input type="password"
                dispara el aviso de "¿guardar contraseña?" del navegador,
                sin importar el autocomplete que se le ponga -- si el PIN
                quedara en el gestor de contraseñas del celular, anularía
                el propósito del bloqueo. WebkitTextSecurity da el mismo
                enmascarado visual (puntos) sin esa señal. */}
            <div className="[&_label]:text-white/70 [&_input]:bg-white/10 [&_input]:text-white [&_input]:border-white/20">
              <Input label="Nuevo PIN (mín. 4 dígitos)" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
            </div>
            <div className="[&_label]:text-white/70 [&_input]:bg-white/10 [&_input]:text-white [&_input]:border-white/20">
              <Input label="Confirmar PIN" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
                value={pinConfirmar} onChange={(e) => setPinConfirmar(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
            </div>
            {error && <p className="text-red-400 text-xs text-center font-semibold">{error}</p>}
            <Btn onClick={confirmarSetup} disabled={!pin || !pinConfirmar}>Guardar PIN</Btn>
          </>
        )}

        {paso === "biometria" && (
          <>
            <p className="text-white/50 text-xs text-center leading-relaxed">
              PIN listo. ¿Querés activar Face ID / huella como atajo rápido en este dispositivo? El PIN siempre va a seguir disponible.
            </p>
            {error && <p className="text-red-400 text-xs text-center font-semibold break-words">{error}</p>}
            <Btn onClick={activarBiometria} disabled={verificando}>{verificando ? "Activando..." : "Activar Face ID / huella"}</Btn>
            <button onClick={onTerminarSetup} disabled={verificando} className="text-white/50 text-xs hover:text-white/70 transition disabled:opacity-40">
              Ahora no
            </button>
          </>
        )}

        {paso === "desbloqueo" && (
          <>
            <div className="[&_label]:text-white/70 [&_input]:bg-white/10 [&_input]:text-white [&_input]:border-white/20">
              <Input label="PIN" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && pin && intentarPin()} placeholder="••••" autoFocus />
            </div>
            {error && <p className="text-red-400 text-xs text-center font-semibold">{error}</p>}
            <Btn onClick={intentarPin} disabled={!pin || verificando}>{verificando ? "Verificando..." : "Desbloquear"}</Btn>
            {puedeBiometriaUnlock && (
              <button onClick={intentarBiometria} disabled={verificando}
                className="text-blue-300 text-xs font-semibold hover:text-blue-200 transition disabled:opacity-40">
                Usar Face ID / huella
              </button>
            )}
            {!mostrarOlvido ? (
              <button onClick={() => setMostrarOlvido(true)} className="text-white/40 text-xs hover:text-white/60 transition">
                ¿Olvidaste tu PIN?
              </button>
            ) : (
              <p className="text-white/40 text-[11px] text-center leading-relaxed">
                El PIN vive sólo en este dispositivo, no hay forma de recuperarlo a distancia. Borrá los datos del sitio en el navegador (o reinstalá la app desde la pantalla de inicio) para configurar uno nuevo -- tu sesión y los datos de RadioFarm no se ven afectados.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
