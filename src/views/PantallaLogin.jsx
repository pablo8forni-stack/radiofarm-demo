import { useState } from "react";
import { signInWithGoogle } from "../services/auth.js";

export function PantallaLogin() {
  const [error, setError] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    setEntrando(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch {
      setError("No se pudo iniciar sesión. Probá de nuevo.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">RadioFarm</h1>
        <p className="text-blue-300/60 text-sm mt-1">FUESMEN · Sistema de Radiofármacos</p>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-3xl p-8 w-full max-w-xs flex flex-col items-center gap-5">
        <p className="text-white/50 text-xs text-center uppercase tracking-widest font-semibold">Iniciá sesión con tu cuenta institucional</p>
        {error && <p className="text-red-400 text-xs text-center font-semibold">{error}</p>}
        <button
          onClick={entrar}
          disabled={entrando}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-700 font-semibold text-sm py-3 rounded-2xl hover:bg-gray-50 active:scale-[0.98] transition disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {entrando ? "Ingresando..." : "Iniciar sesión con Google"}
        </button>
      </div>
    </div>
  );
}
