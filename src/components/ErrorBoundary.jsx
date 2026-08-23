import { Component } from "react";
import { registrarLog } from "../helpers/debugLog.js";

// Nunca hubo un Error Boundary en esta app -- hueco real, ya anotado más
// de una vez en comentarios de código durante el diagnóstico del escáner
// QR ("sin Error Boundary, tira toda la app abajo"). Un Error Boundary
// tiene que ser una clase (no hay equivalente con hooks todavía) -- es la
// única forma de atrapar una excepción que ocurre DENTRO del ciclo de
// render/reconciliación de React (a diferencia de un try/catch común, que
// sólo atrapa lo que pasa en el código propio, no lo que React hace
// puertas adentro al desmontar/actualizar el árbol).
//
// Motivo concreto de por qué hace falta esto ahora: encontramos que la
// pantalla en blanco al cerrar el escáner QR puede seguir pasando incluso
// DESPUÉS de esperar a que stop()/clear() terminen bien (confirmado con
// log real) -- si algo se rompe un paso más allá, en la propia
// reconciliación de React al desmontar, hoy no hay manera de verlo ni de
// evitar que tire toda la app. Este componente cumple dos roles a la vez:
// (1) muestra una pantalla de recuperación en vez de blanco puro (ya no
// hace falta forzar el cierre de la app), y (2) loguea el error real
// (mensaje, stack, componentStack) en el mismo buffer que ya se puede ver
// con el gesto de 7 taps -- la próxima vez que esto pase, vamos a tener
// evidencia directa de qué fue, no otra hipótesis.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    try {
      registrarLog(`[ErrorBoundary] excepción atrapada: ${error?.name || "Error"} -- ${error?.message || error}`);
      if (error?.stack) registrarLog(`[ErrorBoundary] stack: ${String(error.stack).slice(0, 800)}`);
      if (errorInfo?.componentStack) registrarLog(`[ErrorBoundary] componentStack: ${String(errorInfo.componentStack).slice(0, 800)}`);
    } catch {
      // Ni loguear el error debe poder tirar otro error -- si esto falla,
      // no hay nada más que hacer acá.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[200] bg-gray-50 flex flex-col items-center justify-center p-6 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-800">Algo salió mal</h1>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">
            La pantalla se quedó trabada -- ya quedó registrado en los logs de diagnóstico (7 taps en el logo, una vez que vuelvas a entrar). No hace falta forzar el cierre de la app.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-700 transition"
        >
          Volver a cargar
        </button>
      </div>
    );
  }
}
