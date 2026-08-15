import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal.jsx";
import { Btn } from "./ui/Btn.jsx";
import { Input } from "./ui/Input.jsx";
import {
  guardarPin, verificarPin, biometriaDisponible, hayBiometriaRegistrada,
  registrarBiometria, borrarBiometria,
} from "../helpers/appLock.js";

// A diferencia de PantallaBloqueo (el gate obligatorio), este SÍ es un
// modal normal y descartable -- acceso opcional desde el ícono de
// "Seguridad" del header, para cambiar el PIN o activar/desactivar
// Face ID/huella después del setup inicial (que ahora también la ofrece
// de entrada, ver PantallaBloqueo -- esto queda para cambiarla después).
export function ModalSeguridad({ open, usuario, onClose, onToast }) {
  const [pinActual, setPinActual] = useState("");
  const [pinNuevo, setPinNuevo] = useState("");
  const [pinConfirmar, setPinConfirmar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [biometriaOn, setBiometriaOn] = useState(() => hayBiometriaRegistrada(usuario.email));
  // biometriaDisponible() es async de verdad (awaitea la Promise real del
  // navegador, ver nota en helpers/appLock.js) -- null hasta saber la
  // respuesta real, no se muestra nada hasta entonces.
  const [puedeBiometria, setPuedeBiometria] = useState(null);

  useEffect(() => {
    if (open) biometriaDisponible().then(setPuedeBiometria);
  }, [open]);

  function limpiar() {
    setPinActual(""); setPinNuevo(""); setPinConfirmar("");
  }

  async function cambiarPin() {
    if (!(await verificarPin(usuario.email, pinActual))) { onToast("PIN actual incorrecto", "error"); return; }
    if (!/^\d{4,}$/.test(pinNuevo)) { onToast("El PIN nuevo debe tener al menos 4 dígitos", "error"); return; }
    if (pinNuevo !== pinConfirmar) { onToast("Los PIN nuevos no coinciden", "error"); return; }
    setGuardando(true);
    await guardarPin(usuario.email, pinNuevo);
    setGuardando(false);
    limpiar();
    onToast("PIN actualizado");
  }

  async function toggleBiometria() {
    if (biometriaOn) {
      borrarBiometria(usuario.email);
      setBiometriaOn(false);
      onToast("Face ID / huella desactivada");
    } else {
      try {
        await registrarBiometria(usuario.email, usuario.nombre);
        setBiometriaOn(true);
        onToast("Face ID / huella activada");
      } catch (e) {
        // Detalle real del error (no genérico) -- para diagnosticar sin
        // devtools remoto si vuelve a fallar en un dispositivo real.
        onToast(`No se pudo activar: ${e.name || "Error"} -- ${e.message || "sin detalle"}`, "error", 8000);
      }
    }
  }

  return (
    <Modal open={open} title="Seguridad" onClose={() => { limpiar(); onClose(); }} size="sm">
      <div className="flex flex-col gap-5">
        <p className="text-xs text-gray-400 leading-relaxed">
          Bloqueo propio de RadioFarm en este dispositivo -- independiente del bloqueo del celular. Se pide de nuevo después de un rato sin usar la app.
        </p>
        {puedeBiometria && (
          <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl p-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Face ID / huella</div>
              <div className="text-xs text-gray-400">Atajo rápido -- el PIN siempre sigue disponible</div>
            </div>
            <Btn size="sm" variant={biometriaOn ? "outline" : "primary"} onClick={toggleBiometria}>
              {biometriaOn ? "Desactivar" : "Activar"}
            </Btn>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-gray-800">Cambiar PIN</div>
          {/* type="text" + WebkitTextSecurity, no type="password" -- ver
              nota en PantallaBloqueo.jsx: cualquier input type="password"
              dispara el aviso de "¿guardar contraseña?" del navegador. */}
          <Input label="PIN actual" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
            value={pinActual} onChange={(e) => setPinActual(e.target.value.replace(/\D/g, ""))} />
          <Input label="PIN nuevo" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
            value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value.replace(/\D/g, ""))} />
          <Input label="Confirmar PIN nuevo" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" style={{ WebkitTextSecurity: "disc" }}
            value={pinConfirmar} onChange={(e) => setPinConfirmar(e.target.value.replace(/\D/g, ""))} />
          <Btn onClick={cambiarPin} disabled={!pinActual || !pinNuevo || !pinConfirmar || guardando}>
            {guardando ? "Guardando..." : "Cambiar PIN"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
