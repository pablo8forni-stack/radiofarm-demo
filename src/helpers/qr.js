export function parseQR(raw) {
  // Formato: nombre|dni|peso|talla|estudio|ficha -- el 6to campo es
  // opcional, lo agrega la herramienta externa de impresión de etiquetas
  // para pulseras nuevas. Un QR viejo de 5 campos (o cualquiera generado
  // antes de este cambio) sigue andando igual: parts[5] queda undefined.
  const parts = raw.split("|");
  if (parts.length >= 2)
    return {
      pacienteNombre: parts[0]?.trim() || "",
      pacienteDni: parts[1]?.trim() || "",
      peso: parseFloat(parts[2]) || "",
      talla: parseFloat(parts[3]) || "",
      estudio: parts[4]?.trim() || "",
      pacienteFicha: parts[5]?.trim() || "",
    };
  return null;
}
