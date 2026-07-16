// UTF-8 con BOM (con o sin "sep=;") le rompía las tildes/ñ a Excel en la
// descarga real pese a que los bytes generados eran correctos en las dos
// implementaciones probadas (data: URI y Blob con BOM en bytes explícitos) --
// aparentemente la detección de BOM UTF-8 de esa instancia de Excel no es
// confiable. UTF-16LE con BOM (FF FE) y tabulador como separador es el mismo
// formato que produce el propio "Guardar como texto Unicode" de Excel: lo
// reconoce de forma nativa sin depender de ninguna heurística de detección,
// y el tabulador no depende de la configuración regional de separador de
// listas como sí depende ";"/",", así que tampoco hace falta "sep=".
const BOM_UTF16LE = new Uint8Array([0xff, 0xfe]);

function aBytesUtf16LE(texto) {
  const bytes = new Uint8Array(texto.length * 2);
  for (let i = 0; i < texto.length; i++) {
    const code = texto.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >> 8;
  }
  return bytes;
}

export function descargarArchivo(contenido, nombreArchivo, mime = "text/plain;charset=utf-8") {
  const esCsv = mime.startsWith("text/csv");
  const partes = esCsv ? [BOM_UTF16LE, aBytesUtf16LE(contenido)] : [contenido];
  const blob = new Blob(partes, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
