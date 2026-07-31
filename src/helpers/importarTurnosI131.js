import { TIPO_LABEL_I131 } from "../constants/tipoI131.js";
import { TIPOS_TURNO_VALIDOS } from "./turnosI131.js";

// Importación de turnos desde un archivo "Excel" (Parte C, uso regular, no
// script de una sola vez) -- a propósito NO se parsea un .xlsx real: la
// plantilla que se descarga (public/plantilla-turnos-i131.xlsx, servida tal
// cual) se completa cómoda en Excel, pero lo que este parser lee es el texto
// tab-delimited UTF-16LE que produce "Guardar como > Texto Unicode" (mismo
// encoding que ya usa descargarArchivo.js para todos los exports CSV de la
// app). Evita sumar una dependencia (xlsx/SheetJS) sólo para leer un formato
// que nosotros mismos generamos -- ver discusión de tamaño de bundle antes
// de esta implementación.
export const HEADERS_TURNOS_I131 = [
  "fechaTurno", "pacienteNombre", "pacienteDni", "telefono",
  "tipoDosis", "actividadPrevista", "obraSocial", "fechaBarrido", "notas",
];

// Acepta AAAA-MM-DD (lo que ya usa fechaTurno internamente) o DD/MM/AAAA
// (lo natural al tipear en Excel en AR) -- valida que la fecha exista de
// verdad (no sólo el formato: 31/02 se rechaza).
function parsearFechaFlexible(texto) {
  if (!texto) return null;
  let y, mo, d;
  let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [, y, mo, d] = m;
  else {
    m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) [, d, mo, y] = m;
  }
  if (!m) return null;
  const mes = mo.padStart(2, "0"), dia = d.padStart(2, "0");
  const fecha = new Date(`${y}-${mes}-${dia}T00:00:00`);
  if (Number.isNaN(fecha.getTime()) || fecha.getFullYear() !== +y || fecha.getMonth() + 1 !== +mo || fecha.getDate() !== +d) return null;
  return `${y}-${mes}-${dia}`;
}

function celda(cols, idx, campo) {
  return (cols[idx[campo]] ?? "").trim();
}

// Una fila por acta -- estado "error" (no se puede crear, campo obligatorio
// inválido/faltante) vs "advertencia" (se puede crear igual, pero algún dato
// secundario se descarta) vs "ok". `incluir` es el default del checkbox en
// la vista previa: tildado salvo que tenga error.
function validarFilaTurno(cols, idx, numeroFila) {
  const raw = Object.fromEntries(HEADERS_TURNOS_I131.map((campo) => [campo, celda(cols, idx, campo)]));
  if (Object.values(raw).every((v) => v === "")) return null; // fila en blanco (ej. al final del archivo)

  const errores = [];
  const advertencias = [];

  const fechaTurno = parsearFechaFlexible(raw.fechaTurno);
  if (!fechaTurno) errores.push("fechaTurno inválida o vacía (usá DD/MM/AAAA)");

  if (!raw.pacienteNombre) errores.push("falta pacienteNombre");

  const pacienteDni = raw.pacienteDni.replace(/[.\s-]/g, "");
  if (!pacienteDni || !/^\d+$/.test(pacienteDni)) errores.push("pacienteDni inválido");

  const tipoDosis = TIPOS_TURNO_VALIDOS.find((id) => TIPO_LABEL_I131[id].label.toLowerCase() === raw.tipoDosis.toLowerCase());
  if (!tipoDosis) {
    const validos = TIPOS_TURNO_VALIDOS.map((id) => TIPO_LABEL_I131[id].label).join(", ");
    errores.push(`tipoDosis "${raw.tipoDosis || "(vacío)"}" no reconocido -- valores válidos: ${validos}`);
  }

  let actividadPrevista = 0;
  if (raw.actividadPrevista) {
    const n = parseFloat(raw.actividadPrevista.replace(",", "."));
    if (Number.isNaN(n) || n < 0) advertencias.push("actividadPrevista no es un número válido, se guarda vacía");
    else actividadPrevista = n;
  }

  let fechaBarrido = "";
  if (raw.fechaBarrido) {
    const f = parsearFechaFlexible(raw.fechaBarrido);
    if (!f) advertencias.push("fechaBarrido inválida, se guarda vacía");
    else fechaBarrido = f;
  }

  const estado = errores.length ? "error" : advertencias.length ? "advertencia" : "ok";
  return {
    numeroFila, estado, errores, advertencias, incluir: estado !== "error",
    resumen: `${raw.pacienteNombre || "(sin nombre)"} · ${raw.tipoDosis || "—"} · ${raw.fechaTurno || "—"}`,
    datos: {
      fechaTurno: fechaTurno || "", pacienteNombre: raw.pacienteNombre, pacienteDni,
      telefono: raw.telefono, tipoDosis: tipoDosis || "", actividadPrevista,
      obraSocial: raw.obraSocial, fechaBarrido, notas: raw.notas,
    },
  };
}

// Primeros 2 bytes de cualquier .xlsx/.docx/.zip real ("PK") -- la plantilla
// SÍ es un .xlsx real (para completarse cómodo en Excel), pero el paso
// correcto antes de subirla es "Guardar como" > Texto Unicode (*.txt): si
// alguien sube el .xlsx tal cual, el archivo es un ZIP binario, no el texto
// tab-delimited que este parser entiende. Mensaje específico en vez de
// basura ilegible.
function esZipBinario(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// Mismo criterio que esZipBinario -- mirar los bytes reales en vez de asumir
// un formato fijo. "Guardar como > Texto Unicode" de Excel de escritorio
// siempre trae el BOM UTF-16LE (FF FE); el TSV que exportan las apps de
// planillas del celular viene en UTF-8, con o sin su propio BOM (EF BB BF).
// Sin BOM (el caso más común desde el celular) se asume UTF-8 por default --
// es una heurística, no una certeza, pero es estrictamente mejor que antes
// (que siempre asumía utf-16le y producía basura ilegible para cualquier
// archivo sin ese BOM puntual). Si la codificación adivinada fuera la
// incorrecta, el texto decodificado no va a matchear ningún encabezado
// esperado y la validación de "faltan columnas" de más abajo lo va a
// rechazar con un error claro -- nunca queda un dato mal cargado en
// silencio, sólo un archivo rechazado.
function detectarCodificacion(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"; // por completitud, rarísimo en la práctica
  return "utf-8"; // con o sin BOM (EF BB BF) -- TextDecoder("utf-8") descarta el BOM solo si está
}

export async function parsearArchivoTurnosI131(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (esZipBinario(bytes)) {
    throw new Error("Este archivo es el .xlsx tal cual, no el archivo de texto que espera el importador. En Excel: \"Guardar como\" → Texto Unicode (*.txt), y subí ese archivo.");
  }
  const texto = new TextDecoder(detectarCodificacion(bytes)).decode(bytes);
  const lineas = texto.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  if (lineas.length === 0) throw new Error("El archivo está vacío.");

  const headers = lineas[0].split("\t").map((h) => h.trim());
  const idx = {};
  for (const campo of HEADERS_TURNOS_I131) idx[campo] = headers.findIndex((h) => h.toLowerCase() === campo.toLowerCase());
  const faltantes = HEADERS_TURNOS_I131.filter((c) => idx[c] === -1);
  if (faltantes.length) {
    throw new Error(`El archivo no tiene las columnas esperadas (faltan: ${faltantes.join(", ")}). Descargá la plantilla de nuevo y no cambies los encabezados de la primera fila.`);
  }

  return lineas.slice(1)
    .map((linea, i) => validarFilaTurno(linea.split("\t"), idx, i + 2))
    .filter(Boolean);
}

// Clave fechaTurno+pacienteDni de una fila candidata (no "error" -- esos dos
// campos son justo los que estado "error" puede dejar vacíos/inválidos).
export function claveDuplicado(datos) {
  return `${datos.fechaTurno}|${datos.pacienteDni}`;
}

// Duplicados DENTRO del mismo archivo (ej. la misma fila pegada dos veces
// por error) -- comparación en memoria entre las filas ya parseadas, sin
// ninguna consulta a Firestore. El otro caso (ya existe un turno guardado de
// antes con este DNI+fecha) se resuelve aparte, contra la base -- ver
// existeTurno en services/firestore/turnos.js.
export function clavesDuplicadasEnArchivo(filas) {
  const conteo = new Map();
  for (const f of filas) {
    if (f.estado === "error") continue;
    const clave = claveDuplicado(f.datos);
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
  }
  return new Set([...conteo.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}
