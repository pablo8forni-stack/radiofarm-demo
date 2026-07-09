export function descargarArchivo(contenido, nombreArchivo, mime = "text/plain;charset=utf-8") {
  const prefijo = mime.startsWith("text/csv") ? "﻿" : "";
  const a = document.createElement("a");
  a.href = `data:${mime},${encodeURIComponent(prefijo + contenido)}`;
  a.download = nombreArchivo;
  a.click();
}
