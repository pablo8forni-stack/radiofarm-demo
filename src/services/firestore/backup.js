import { collection, doc, getDoc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { SEDES } from "../../constants/sedes.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { hoy } from "../../helpers/formato.js";

const VERSION = 1;

// Backup completo (requisito 6): catálogo, sedes+stock, proveedores y roles.
// No incluye movimientos ni actas -> son inmutables, nunca hay nada que restaurar ahí.
export async function exportarBackup() {
  const [farmsSnap, proveedoresSnap, rolesSnap] = await Promise.all([
    getDocs(collection(db, "farms")),
    getDocs(collection(db, "proveedores")),
    getDocs(collection(db, "roles")),
  ]);

  const sedes = {};
  for (const s of SEDES) {
    const [sedeDoc, lotesSnap] = await Promise.all([
      getDoc(doc(db, "sedes", s.id)),
      getDocs(collection(db, "sedes", s.id, "lotes")),
    ]);
    sedes[s.id] = {
      ...(sedeDoc.exists() ? sedeDoc.data() : {}),
      lotes: lotesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }

  const backup = {
    version: VERSION,
    exportadoEn: new Date().toISOString(),
    farms: farmsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    sedes,
    proveedores: proveedoresSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    roles: rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };

  descargarArchivo(JSON.stringify(backup, null, 2), `radiofarm_backup_${hoy()}.json`, "application/json;charset=utf-8");
}

async function commitEnBloques(operaciones) {
  const TAMANO_BLOQUE = 450;
  for (let i = 0; i < operaciones.length; i += TAMANO_BLOQUE) {
    const batch = writeBatch(db);
    operaciones.slice(i, i + TAMANO_BLOQUE).forEach((op) => {
      if (op.tipo === "set") batch.set(op.ref, op.data);
      else batch.delete(op.ref);
    });
    await batch.commit();
  }
}

// Restauración completa: sobrescribe farms, sedes (config + lotes) y
// proveedores con lo que hay en el backup. Deliberadamente NO toca `roles`
// -- restaurar roles a ciegas podría dejar sin acceso a la persona que está
// ejecutando la restauración. Los accesos se administran desde la pestaña
// Usuarios, no desde el backup.
export async function importarBackup(backup) {
  if (!backup || backup.version !== VERSION) {
    throw new Error("El archivo de backup no es válido o es de una versión incompatible.");
  }

  const operaciones = [];

  const farmsActuales = await getDocs(collection(db, "farms"));
  farmsActuales.docs.forEach((d) => operaciones.push({ tipo: "delete", ref: d.ref }));
  (backup.farms || []).forEach((f) => {
    const { id, ...data } = f;
    operaciones.push({ tipo: "set", ref: doc(db, "farms", id), data });
  });

  const proveedoresActuales = await getDocs(collection(db, "proveedores"));
  proveedoresActuales.docs.forEach((d) => operaciones.push({ tipo: "delete", ref: d.ref }));
  (backup.proveedores || []).forEach((p) => {
    const { id, ...data } = p;
    operaciones.push({ tipo: "set", ref: doc(db, "proveedores", id), data });
  });

  for (const s of SEDES) {
    const sedeBackup = backup.sedes?.[s.id];
    if (!sedeBackup) continue;
    const { lotes = [], ...sedeData } = sedeBackup;
    operaciones.push({ tipo: "set", ref: doc(db, "sedes", s.id), data: sedeData });

    const lotesActuales = await getDocs(collection(db, "sedes", s.id, "lotes"));
    lotesActuales.docs.forEach((d) => operaciones.push({ tipo: "delete", ref: d.ref }));
    lotes.forEach((l) => {
      const { id, ...data } = l;
      operaciones.push({ tipo: "set", ref: doc(db, "sedes", s.id, "lotes", id), data });
    });
  }

  await commitEnBloques(operaciones);
}
