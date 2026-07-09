export function parseQR(raw) {
  // Formato: nombre|dni|peso|talla|estudio
  const parts = raw.split("|");
  if (parts.length >= 2)
    return {
      pacienteNombre: parts[0]?.trim() || "",
      pacienteDni: parts[1]?.trim() || "",
      peso: parseFloat(parts[2]) || "",
      talla: parseFloat(parts[3]) || "",
      estudio: parts[4]?.trim() || "",
    };
  return null;
}
