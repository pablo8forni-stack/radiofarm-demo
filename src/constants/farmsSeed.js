// Usado solo por scripts/seed.mjs para poblar Firestore la primera vez.
// No se importa desde la app en producción (el catálogo real vive en Firestore).
export const FARMS_DEFAULT = [
  { id: "mibi", nombre: "MIBI (Sestamibi)", viales_x_kit: 1 },
  { id: "osteobac", nombre: "Osteobac", viales_x_kit: 5 },
  { id: "cipro", nombre: "Ciprofloxacina", viales_x_kit: 1 },
  { id: "dmsa", nombre: "DMSA", viales_x_kit: 5 },
  { id: "dtpa", nombre: "DTPA", viales_x_kit: 5 },
  { id: "maa", nombre: "Macroagregados de Albúmina", viales_x_kit: 1 },
  { id: "fitato", nombre: "Fitato", viales_x_kit: 5 },
  { id: "neurobac", nombre: "Neurobac", viales_x_kit: 1 },
  { id: "trodat", nombre: "Trodat", viales_x_kit: 1 },
  { id: "pirofosfato", nombre: "Pirofosfato", viales_x_kit: 1 },
  { id: "estannoso", nombre: "Cloruro Estañoso", viales_x_kit: 5 },
];

export const SEDE_FARMS_DEFAULT = {
  central: FARMS_DEFAULT.map((f) => f.id),
  italiano: ["mibi", "osteobac", "dtpa", "maa", "fitato"],
  espanol: ["mibi", "osteobac", "dmsa", "dtpa", "trodat"],
  sanrafael: ["osteobac", "dtpa", "maa", "pirofosfato", "estannoso"],
};

export const PROVEEDORES_DEFAULT = [
  { id: "principal", nombre: "Proveedor Principal", contacto: "0800-555-0001", principal: true },
];
