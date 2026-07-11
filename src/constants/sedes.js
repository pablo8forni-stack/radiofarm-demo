// Usado sólo por scripts/seed.mjs y services/firestore/seed.js para la
// siembra inicial. No se importa desde el resto de la app (las sedes reales
// viven en Firestore, administrables desde Configuración > Sedes activas).
export const SEDES = [
  { id: "central", nombre: "FUESMEN Central", short: "Central", principal: true },
  { id: "italiano", nombre: "C. Gamma Hospital Italiano", short: "Italiano" },
  { id: "espanol", nombre: "C. Gamma Hospital Español", short: "Español" },
  { id: "sanrafael", nombre: "C. Gamma San Rafael", short: "San Rafael" },
];
