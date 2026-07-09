export const hoy = () => new Date().toISOString().slice(0, 10);

export const fmtF = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// Acepta tanto ISO string como Firestore Timestamp (tiene .toDate()).
export const fmtTs = (fecha) => {
  if (!fecha) return "—";
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("es-AR")} ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
};

export const diasV = (f) => {
  if (!f) return null;
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(f + "T00:00:00") - h) / 86400000);
};

// Fecha de un doc de Firestore (Timestamp o ISO) a "YYYY-MM-DD" en horario local.
export const fmtFechaISO = (fecha) => {
  if (!fecha) return "";
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
