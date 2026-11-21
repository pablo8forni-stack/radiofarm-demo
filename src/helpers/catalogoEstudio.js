// Mapeo de un texto crudo (QR de pulsera, futuro consumo de emisiones en
// Fase 2.2) al nombre EXACTO de catalogo.estudios -- nunca se usa el texto
// crudo tal cual, porque el generador de etiquetas externo puede no
// coincidir letra por letra con el catálogo (ej. manda "Renograma con DTPA",
// el catálogo dice "Centellograma con DTPA"). Normalización: trim,
// minúsculas, sin tildes (NFD) y espacios múltiples colapsados. Coincidencia
// exacta tras normalizar, nunca parcial.
function normalizar(texto) {
  return (texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

// nombresCatalogo: lista de nombres (no de documentos) -- el llamador extrae
// catalogo.estudios.map(e => e.nombre) antes de llamar. Devuelve el nombre
// EXACTO tal como está en nombresCatalogo, o null si no hay match. "Otro" no
// es un nombre del catálogo, así que un texto "Otro" nunca matchea acá -- el
// llamador lo trata igual que cualquier otro texto sin match.
export function matchEstudioCatalogo(texto, nombresCatalogo) {
  const normTexto = normalizar(texto);
  if (!normTexto) return null;
  return nombresCatalogo.find((nombre) => normalizar(nombre) === normTexto) || null;
}
