// Sitio de inyección (9/11): obligatorio para Tc-99m/MIBG/Lutecio-177 de
// ahora en adelante, NUNCA para I-131 oral. Lista PROVISORIA -- las técnicas
// pueden pedir cambios, por eso vive en una sola constante y no repartida
// por los formularios. Sin "glúteo" (decisión de Pablo). "NR" (No
// registrado) no se ofrece en carga normal -- sólo en la recarga de una
// acta anulada vieja que no traía el campo (ver permiteSitioNR en
// TabPacientes.jsx).
export const SITIOS_INYECCION = [
  { codigo: "DMD", etiqueta: "Dorso mano derecha" },
  { codigo: "DMI", etiqueta: "Dorso mano izquierda" },
  { codigo: "PCD", etiqueta: "Pliegue de codo derecho" },
  { codigo: "PCI", etiqueta: "Pliegue de codo izquierdo" },
  { codigo: "MUD", etiqueta: "Muñeca derecha" },
  { codigo: "MUI", etiqueta: "Muñeca izquierda" },
  { codigo: "OTRO", etiqueta: "Otro" },
  { codigo: "NA", etiqueta: "No aplica" },
  { codigo: "NR", etiqueta: "No registrado" },
];

const ETIQUETA_POR_CODIGO = new Map(SITIOS_INYECCION.map((s) => [s.codigo, s.etiqueta]));

// "—" para actas viejas (sin el campo) o un código que ya no exista en la
// lista -- nunca revienta, nunca muestra el código crudo.
export const etiquetaSitioInyeccion = (codigo) => ETIQUETA_POR_CODIGO.get(codigo) || "—";

// Misma etiqueta de arriba, pero a partir del acta completa -- cuando el
// código es OTRO, le agrega el texto libre (sitioInyeccionOtro) en vez de
// mostrar sólo "Otro" a secas. Un único lugar para esta regla, reusado por
// TabPacientes.jsx (listado y CSV), ImprimibleLibro2Pacientes.jsx e
// HistorialPacienteI131.jsx -- evita repetir el "si es OTRO, sumale el
// texto" en cada uno.
export const etiquetaSitioInyeccionDeActa = (acta) => {
  if (!acta?.sitioInyeccion) return "—";
  const base = etiquetaSitioInyeccion(acta.sitioInyeccion);
  return acta.sitioInyeccion === "OTRO" && acta.sitioInyeccionOtro ? `${base}: ${acta.sitioInyeccionOtro}` : base;
};
