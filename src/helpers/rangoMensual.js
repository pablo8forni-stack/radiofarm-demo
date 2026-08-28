// A partir del valor de un <input type="month"> ("2026-08") calcula el
// primer y último día de ese mes calendario, en el mismo formato de fecha
// (YYYY-MM-DD) que ya usan actasPorRango/TabPacientes para "Ver todos" --
// mismo criterio, sólo que acá el rango es siempre un mes entero, nunca uno
// elegido a mano.
export function primerYUltimoDiaMes(mesISO) {
  const [anio, mes] = mesISO.split("-").map(Number);
  const desde = `${mesISO}-01`;
  // Día 0 del mes SIGUIENTE = último día del mes elegido (maneja
  // 28/29/30/31 sin tabla de casos -- Date lo resuelve solo).
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${mesISO}-${String(ultimoDia).padStart(2, "0")}`;
  return { desde, hasta };
}

// Nombre legible del mes para encabezados de impresión (ej. "Agosto 2026").
export function nombreMes(mesISO) {
  const [anio, mes] = mesISO.split("-").map(Number);
  const texto = new Date(anio, mes - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
