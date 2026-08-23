// Buffer de diagnóstico en pantalla -- para poder ver logs sin cable ni
// inspector remoto (mismo problema que ya resolvimos para AppLock: no
// hay forma de ver la consola de Safari en iOS sin una Mac). Guarda en
// memoria Y en localStorage (sobrevive un reload completo de la página,
// justo el caso que más nos importa poder diagnosticar) -- buffer en
// anillo, tope de líneas para no crecer sin límite.
const KEY = "radiofarm_debug_logs";
const MAX_LINEAS = 300;

function leer() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

// Bug real encontrado (regresión más grave que la anterior, no se
// arreglaba ni refrescando): NINGÚN localStorage.setItem() de toda la
// app tenía manejo de excepción -- si el storage se llena (QuotaExceededError,
// muy plausible acá, es la propia herramienta de diagnóstico la que más
// datos acumula), la escritura tira sin capturar. A diferencia de la
// carrera de la vuelta anterior, esto NO se arregla con un refresh: los
// datos que llenan el storage siguen ahí después de recargar, así que el
// error se repite en cada carga -- encaja con "ni siquiera refrescando".
// Acá, ante quota llena, se descarta la mitad más vieja del buffer y se
// reintenta (en vez de tirar) hasta que entre o hasta vaciarlo del todo.
function guardarConReintento(key, arr) {
  let intento = arr;
  while (intento.length > 0) {
    try {
      localStorage.setItem(key, JSON.stringify(intento));
      return true;
    } catch {
      intento = intento.slice(Math.ceil(intento.length / 2));
    }
  }
  try { localStorage.removeItem(key); } catch { /* ni el removeItem anduvo -- nada más para hacer */ }
  return false;
}

export function registrarLog(linea) {
  const lineas = leer();
  const hora = new Date().toLocaleTimeString("es-AR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  lineas.push(`${hora} -- ${linea}`);
  while (lineas.length > MAX_LINEAS) lineas.shift();
  guardarConReintento(KEY, lineas);
}

export function obtenerLogsTexto() {
  return leer().join("\n");
}

export function limpiarLogs() {
  localStorage.removeItem(KEY);
}

// Frames capturados para diagnóstico visual (ver Html5QrcodeFallback.jsx).
//
// BUG REAL encontrado (2da vuelta de esta misma herramienta): el diseño
// original las guardaba SÓLO en memoria ("para este uso alcanza, no hace
// falta que sobrevivan un reload" -- supuesto que resultó falso en la
// práctica). Entre escanear con la cámara y volver a tocar el logo 7
// veces para abrir el visor puede pasar exactamente lo que ya probamos
// que pasa en iOS (ver AppLock): la página se recarga sola en segundo
// plano -- eso resetea este array a [] al mismo tiempo que el buffer de
// texto (localStorage, sobrevive) queda intacto. Encaja exacto con el
// síntoma reportado: las 3 líneas de log de "frame capturado" visibles,
// cero imágenes, ni siquiera el título condicional que sólo se muestra
// si el array no está vacío -- el array estaba vacío al abrir el visor,
// no es que las imágenes estuvieran ahí y no se renderizaran.
//
// Fix: persistir también en localStorage, mismo patrón que el log de
// texto. Para que el tamaño no dependa de la resolución de cada cámara
// (una imagen sin comprimir puede pesar mucho más que las ~300 líneas de
// texto juntas), Html5QrcodeFallback.jsx capa la resolución del canvas
// ANTES de generar el dataURL -- ver nota ahí.
const KEY_IMAGENES = "radiofarm_debug_imagenes";
// 6, no 3 -- cada captura ahora guarda 2 imágenes (frame completo +
// recorte agrandado, ver capturarFrame en Html5QrcodeFallback.jsx), y
// siguen siendo hasta 3 capturas por sesión -- sin este ajuste, la mitad
// de cada par se perdería empujada afuera del anillo por la otra mitad.
const MAX_IMAGENES = 6;

function leerImagenes() {
  try {
    return JSON.parse(localStorage.getItem(KEY_IMAGENES) || "[]");
  } catch {
    return [];
  }
}

// Confirma que el DATO en sí quedó guardado (no sólo que la función se
// llamó) -- devuelve el tamaño real en bytes de lo que se persistió, para
// poder loguearlo aparte (ver capturarFrame en Html5QrcodeFallback.jsx).
export function registrarImagen(dataUrl, etiqueta) {
  const hora = new Date().toLocaleTimeString("es-AR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let imagenes = [...leerImagenes(), { dataUrl, etiqueta, hora }];
  while (imagenes.length > MAX_IMAGENES) imagenes.shift();
  // Las imágenes son lo más pesado de todo lo que guarda esta app en
  // localStorage -- si ni sacando las más viejas entra, guardarConReintento
  // termina descartando el buffer entero antes de intentar romper algo.
  guardarConReintento(KEY_IMAGENES, imagenes);
  const guardado = leerImagenes();
  const ok = guardado.some((img) => img.dataUrl === dataUrl);
  return { ok, bytes: dataUrl.length, totalEnBuffer: guardado.length };
}

export function obtenerImagenes() {
  return leerImagenes();
}

export function limpiarImagenes() {
  localStorage.removeItem(KEY_IMAGENES);
}
