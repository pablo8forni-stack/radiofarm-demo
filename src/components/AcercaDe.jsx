import { Modal } from "./ui/Modal.jsx";
import { fmtTs } from "../helpers/formato.js";

// __APP_BUILD_HASH__/__APP_BUILD_DATE__ los inyecta Vite en build time (ver
// vite.config.js) -- hash corto de git + fecha del build, sin depender de
// package.json#version (nunca se actualiza) ni de ningún paso manual de
// release.
export function AcercaDe({ open, onClose }) {
  return (
    <Modal open={open} title="Acerca de" onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center gap-3">
        <img src="/icon-192.png" alt="RadioFarm" className="w-16 h-16 rounded-2xl shadow-sm" />
        <div>
          <div className="text-base font-bold text-gray-800">RadioFarm</div>
          <div className="text-xs text-gray-400">FUESMEN · Sistema de Radiofármacos</div>
        </div>
        <div className="text-xs text-gray-500">
          Build {__APP_BUILD_HASH__} · {fmtTs(__APP_BUILD_DATE__)}
        </div>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          © 2026 Pablo Forni. Todos los derechos reservados — Ley 11.723 de Propiedad Intelectual
        </p>
      </div>
    </Modal>
  );
}
