// Nombre de archivo único para los 4 Libros de Actas ARN -- PDF (impresión
// mensual, Configuración > Generar Actas) y CSV (exportación día/historial
// desde cada pantalla de Libro 1/2/3; Libro 4 no tiene CSV, no se genera
// ninguno acá). Antes cada Tab* armaba su propio nombre a mano, sin sede y
// con la fecha de "Ver todos" mal puesta (ver TabMarcacion.jsx/
// TabPacientes.jsx/TabElucion.jsx) -- un solo lugar para no repetir eso.
// Convención pedida por Pablo: Libro{N}-{Nombre}_{periodo}_{Sede}.{extension}
// Ej.: Libro4-Lutecio-177_octubre-2026_Central.pdf
const NOMBRES_LIBRO = {
  libro1: "Marcacion",
  libro2: "Pacientes",
  libro3: "Elucion",
  libro4: "Lutecio-177",
};

// Sin tildes/ñ (NFD + sacar los diacríticos combinados) y sin espacios, a
// partir del nombre CORTO de la sede (catalogo.sedes[id].short) -- nunca del
// nombre largo con el prefijo de la institución ("C. Gamma Hospital..."),
// que haría nombres de archivo larguísimos sin aportar nada que el propio
// contenido del libro no diga ya.
export function slugSede(sedeShort) {
  return (sedeShort || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");
}

// Tabla fija, NO toLocaleDateString(.., {month:"long"}) -- eso depende del
// motor ICU del navegador/WebView (puede faltar o dar otro idioma en un
// celular viejo/Android WebView recortado), y un nombre de archivo tiene
// que salir igual siempre. nombreMes() (rangoMensual.js) sí usa
// toLocaleDateString a propósito -- ahí es para el encabezado VISUAL del
// PDF, un navegador de escritorio real, no para esto.
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// mesISO: "2026-10" (mismo formato del <input type="month"> que ya usa
// GenerarActasImpresion.jsx). Mes en minúscula a propósito -- distinto de
// nombreMes() (rangoMensual.js), que SÍ capitaliza, pero para el encabezado
// visual del PDF (texto para leer en la hoja), no para un nombre de archivo.
export function periodoMes(mesISO) {
  const [anio, mes] = mesISO.split("-").map(Number);
  return `${MESES[mes - 1]}-${anio}`;
}

// libro: "libro1".."libro4". periodo: ya armado por quien llama (mes para
// PDF; día ISO o "completo" para CSV de Libro 1/2/3) -- esta función sólo
// junta las partes, no decide qué significa cada período.
export function nombreArchivoLibro({ libro, extension, periodo, sedeShort }) {
  const n = libro.replace("libro", "");
  return `Libro${n}-${NOMBRES_LIBRO[libro]}_${periodo}_${slugSede(sedeShort)}.${extension}`;
}
