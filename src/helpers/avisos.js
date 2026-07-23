// Avisos locales (sonido + Notification API) para "nueva solicitud de acceso"
// y "stock por debajo del mínimo" -- SOLO mientras la app está abierta, sin
// Service Worker ni push real: new Notification(...) disparado desde JS del
// lado cliente. No sirve en iOS (window.Notification no existe ahí ni en
// Safari ni en la PWA instalada salvo vía Push API + Service Worker, fuera
// de alcance acá) -- avisosSoportados() lo detecta para que el resto de la
// app pueda ocultar el botón en vez de ofrecer algo que no va a andar.
//
// Todo lo demás (permiso, qué ya se avisó) vive en localStorage: es una
// preferencia por dispositivo, no un dato del sistema que tenga que
// sincronizarse entre dispositivos ni guardarse en Firestore.

const CLAVE_ACTIVADO = "radiofarm_avisos_activado";
const CLAVE_SOLICITUDES_VISTAS = "radiofarm_avisos_solicitudes_vistas";
const CLAVE_STOCK_BAJO_VISTAS = "radiofarm_avisos_stock_bajo_vistas";

export function avisosSoportados() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function avisosActivados() {
  return avisosSoportados() && Notification.permission === "granted" && localStorage.getItem(CLAVE_ACTIVADO) === "1";
}

let audioCtx = null;
function obtenerAudioCtx() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioContextCtor) audioCtx = new AudioContextCtor();
  }
  return audioCtx;
}

// Dos beeps cortos generados con osciladores -- sin depender de ningún
// archivo de audio ni de su licencia. Se llama también desde activarAvisos()
// para "desbloquear" el audio con el mismo click que pide permiso: los
// navegadores exigen un gesto del usuario antes de dejar reproducir sonido
// la primera vez, y así no hace falta un segundo gesto cuando llegue el
// primer aviso real.
export function reproducirTono() {
  const ctx = obtenerAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const ahora = ctx.currentTime;
  [{ t: 0, f: 880 }, { t: 0.18, f: 1175 }].forEach(({ t, f }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, ahora + t);
    gain.gain.exponentialRampToValueAtTime(0.2, ahora + t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ahora + t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ahora + t);
    osc.stop(ahora + t + 0.16);
  });
}

// Siempre atado a un click explícito (nunca se llama solo al loguearse) --
// pide permiso al navegador y guarda la preferencia local. Devuelve true si
// quedó activado.
export async function activarAvisos() {
  if (!avisosSoportados()) return false;
  reproducirTono();
  const permiso = await Notification.requestPermission();
  const activado = permiso === "granted";
  localStorage.setItem(CLAVE_ACTIVADO, activado ? "1" : "0");
  return activado;
}

export function desactivarAvisos() {
  localStorage.setItem(CLAVE_ACTIVADO, "0");
}

function leerSet(clave) {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? new Set(JSON.parse(raw)) : null; // null = primera vez que corre esto en este dispositivo
  } catch {
    return null;
  }
}

function guardarSet(clave, set) {
  try {
    localStorage.setItem(clave, JSON.stringify([...set]));
  } catch {
    // localStorage lleno o bloqueado (modo privado, etc.) -- sin esto no hay
    // forma de recordar qué ya se avisó, pero no es motivo para romper la
    // pantalla; el resto de la app sigue funcionando igual.
  }
}

function mostrarNotificacion(titulo, cuerpo) {
  reproducirTono();
  if (!avisosActivados()) return;
  try {
    new Notification(titulo, { body: cuerpo, icon: "/icon-192.png" });
  } catch {
    // Puede tirar si el permiso se revocó después de activarlo -- el sonido
    // ya sonó de todos modos, no es una falla completamente silenciosa.
  }
}

// Compara `clavesActuales` (lo que está en alerta AHORA) contra lo guardado
// la vez anterior en `claveAlmacen`, y llama construirAviso(clave) sólo para
// lo genuinamente nuevo -- nunca para lo que ya estaba, y nunca en la
// primerísima corrida en este dispositivo (ahí sólo siembra la base sin
// avisar nada, para no disparar un aviso por cada cosa que YA estaba
// pendiente antes de que alguien activara el feature). Lo que sale del
// conjunto actual se saca de lo guardado, así una futura recaída sí vuelve a
// avisar (comportamiento de flanco, no de nivel). El seguimiento se actualiza
// siempre, esté o no activado el aviso -- así, cuando se activa más
// adelante, no llueven avisos de todo lo que ya estaba pendiente en ese
// momento.
export function sincronizarYAvisar(claveAlmacen, clavesActuales, construirAviso) {
  const vistas = leerSet(claveAlmacen);
  const actuales = new Set(clavesActuales);
  if (vistas !== null) {
    for (const clave of actuales) {
      if (!vistas.has(clave)) {
        const aviso = construirAviso(clave);
        if (aviso) mostrarNotificacion(aviso.titulo, aviso.cuerpo);
      }
    }
  }
  guardarSet(claveAlmacen, actuales);
}

export const CLAVES_ALMACEN = { SOLICITUDES: CLAVE_SOLICITUDES_VISTAS, STOCK_BAJO: CLAVE_STOCK_BAJO_VISTAS };
