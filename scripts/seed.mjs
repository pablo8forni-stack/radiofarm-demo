// Script de una sola corrida: puebla farms/sedes/proveedores con el catálogo
// y la configuración de la demo -- SIN stock ni movimientos falsos (el stock
// real se carga desde cero en producción, vía Ingreso desde la app).
//
// Uso:
//   1. En la consola de Firebase: Configuración del proyecto > Cuentas de
//      servicio > Generar nueva clave privada. Guardar el JSON como
//      serviceAccountKey.json en la raíz del repo (ya está en .gitignore).
//   2. Crear a mano el primer admin en la consola de Firebase, doc
//      roles/{tu-email-en-minusculas} = { nombre, rol: "admin", sede: "central" }.
//   3. node scripts/seed.mjs
//
// Usa firebase-admin (no el SDK de cliente) porque necesita saltarse las
// reglas de seguridad para la carga inicial -- nunca se importa desde src/.

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FARMS_DEFAULT, SEDE_FARMS_DEFAULT, PROVEEDORES_DEFAULT } from "../src/constants/farmsSeed.js";
import { SEDES } from "../src/constants/sedes.js";

const serviceAccount = JSON.parse(readFileSync(new URL("../serviceAccountKey.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function seed() {
  const batch = db.batch();

  for (const farm of FARMS_DEFAULT) {
    batch.set(db.collection("farms").doc(farm.id), { nombre: farm.nombre, viales_x_kit: farm.viales_x_kit });
  }

  for (const sede of SEDES) {
    batch.set(db.collection("sedes").doc(sede.id), {
      nombre: sede.nombre,
      short: sede.short,
      activo: !!sede.principal, // arranca sólo activa la sede principal, igual que el modo piloto
      principal: !!sede.principal,
      eliminada: false,
      farmIds: SEDE_FARMS_DEFAULT[sede.id] || [],
      puntosReorden: Object.fromEntries((SEDE_FARMS_DEFAULT[sede.id] || []).map((fid) => [fid, 2])),
    });
  }

  for (const prov of PROVEEDORES_DEFAULT) {
    batch.set(db.collection("proveedores").doc(prov.id), {
      nombre: prov.nombre, contactoTelefono: prov.contactoTelefono || "", principal: !!prov.principal,
    });
  }

  await batch.commit();
  console.log(`Catálogo sembrado: ${FARMS_DEFAULT.length} radiofármacos, ${SEDES.length} sedes, ${PROVEEDORES_DEFAULT.length} proveedores.`);
  console.log("Stock, movimientos y actas quedan vacíos -- se cargan desde la app.");
}

seed().catch((err) => {
  console.error("Error al sembrar Firestore:", err);
  process.exit(1);
});
