// Bloqueo propio de la app (PIN + biometría opcional) -- independiente del
// bloqueo del propio celular, mismo criterio que apps de banco. TODO vive en
// localStorage del dispositivo, nunca sale de ahí: no hay backend propio
// (sin Cloud Functions), así que esto es una traba de acceso físico rápido,
// no un reemplazo de la seguridad real (Firebase Auth + reglas de
// Firestore). Ver hooks/useAppLock.js para la orquestación con React.

// 5 minutos EN SEGUNDO PLANO (no de inactividad en pantalla) -- justo lo
// pedido: no interrumpe un turno de trabajo activo, sí frena a alguien que
// agarra el celular después de un rato desatendido. Único lugar a tocar si
// más adelante se vuelve configurable.
export const TIMEOUT_MS = 5 * 60 * 1000;

const PBKDF2_ITERACIONES = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

// PBKDF2 vía Web Crypto nativo (sin librería) -- 100.000 iteraciones,
// balance razonable entre costo de fuerza bruta offline y tiempo de cálculo
// en un celular real (bien por debajo de 1s). Nunca se guarda el PIN en
// texto plano, sólo {salt, hash}.
async function hashPin(pin, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERACIONES, hash: "SHA-256" },
    keyMaterial, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

const pinKey = (uid) => `radiofarm_pin_${uid}`;

export function hayPinConfigurado(uid) {
  return localStorage.getItem(pinKey(uid)) != null;
}

export async function guardarPin(uid, pin) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  const hash = await hashPin(pin, saltBytes);
  localStorage.setItem(pinKey(uid), JSON.stringify({ salt, hash }));
}

export async function verificarPin(uid, pin) {
  const guardado = localStorage.getItem(pinKey(uid));
  if (!guardado) return false;
  const { salt, hash } = JSON.parse(guardado);
  const hashIntentado = await hashPin(pin, hexToBytes(salt));
  return hashIntentado === hash;
}

// Timestamp único (no por uid) -- refleja el último momento CONFIRMADO en
// primer plano en ESTE dispositivo, sin importar qué cuenta esté activa.
// localStorage sobrevive tanto a que iOS suspenda la página como a que la
// mate del todo y la vuelva a cargar de cero.
//
// Bug real encontrado en prueba de dispositivo (Android e iPhone, mismo
// resultado en los dos): marcar esto en el evento de SALIDA (hidden/
// pagehide) no sirve -- visibilitychange no dispara de forma confiable al
// cambiar de app con la pantalla prendida (ver w3c/page-visibility#59),
// muchos navegadores lo disparan recién en la PRÓXIMA acción del usuario.
// Eso significa que "hidden" y "visible" pueden llegar pegados uno al otro
// justo en el momento del REGRESO -- si "hidden" escribe la hora en ese
// instante, "visible" compara contra esa misma hora un instante después y
// nunca detecta que pasó tiempo. Segundo intento (también insuficiente en
// dispositivo real): un setInterval que arrancaba/paraba con
// visibilitychange -- mismo problema un nivel más arriba, si "hidden" no
// dispara el intervalo nunca se detiene. Diseño actual (ver
// hooks/useAppLock.js): un único intervalo que NUNCA se arranca/para por
// ningún evento, se auto-consulta cada tick leyendo
// document.visibilityState directamente (la propiedad, no el evento) --
// eso es fiable aunque la notificación de cambio no lo sea.
const ACTIVIDAD_KEY = "radiofarm_ultima_actividad";

export function marcarActividad() {
  localStorage.setItem(ACTIVIDAD_KEY, String(Date.now()));
}

// Sólo para diagnóstico (logs de useAppLock.js) -- null si nunca se
// registró actividad.
export function msDesdeUltimaActividad() {
  const ultima = localStorage.getItem(ACTIVIDAD_KEY);
  return ultima ? Date.now() - Number(ultima) : null;
}

// true también si nunca se registró actividad (ej. primera carga después de
// configurar el PIN en otra sesión) -- default seguro: ante la duda, pedir.
export function debeBloquear() {
  const ultima = localStorage.getItem(ACTIVIDAD_KEY);
  if (!ultima) return true;
  return Date.now() - Number(ultima) > TIMEOUT_MS;
}

// WebAuthn como gate LOCAL liviano -- ver nota de cabecera. Sólo Safari
// (iOS) y Chrome (Android) soportan el autenticador de plataforma; en
// cualquier otro navegador biometriaDisponible() da false y la opción ni se
// muestra (PIN sigue siendo la vía obligatoria).
//
// Bug real encontrado en prueba de dispositivo: isUserVerifyingPlatformAuthenticatorAvailable
// devuelve una Promise -- sólo comprobar que la función EXISTE (como hacía
// antes esta función, sin awaitear nada) no confirma que haya un
// autenticador de verdad disponible en este dispositivo puntual, sólo que
// el navegador soporta la API en general.
export async function biometriaDisponible() {
  if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

const biometriaKey = (uid) => `radiofarm_biometria_${uid}`;

export function hayBiometriaRegistrada(uid) {
  return localStorage.getItem(biometriaKey(uid)) != null;
}

export async function registrarBiometria(uid, nombreUsuario) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "RadioFarm" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: uid, displayName: nombreUsuario || uid },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  localStorage.setItem(biometriaKey(uid), JSON.stringify({ credentialId: bufferToBase64(cred.rawId) }));
}

export function borrarBiometria(uid) {
  localStorage.removeItem(biometriaKey(uid));
}

// Devuelve false tanto si el usuario cancela como si falla -- el llamador
// cae al campo de PIN en cualquiera de los dos casos, nunca se traba.
export async function verificarBiometria(uid) {
  const guardado = localStorage.getItem(biometriaKey(uid));
  if (!guardado) return false;
  const { credentialId } = JSON.parse(guardado);
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64ToBuffer(credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}
