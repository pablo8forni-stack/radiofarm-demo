import { collection, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { hoy } from "../../helpers/formato.js";

const VERSION = 1;

// Backup completo (requisito 6): catálogo, sedes+stock, proveedores y roles.
// No incluye movimientos ni actas -> son inmutables, nunca hay nada que restaurar ahí.
export async function exportarBackup() {
  const [sedesSnap, farmsSnap, proveedoresSnap, rolesSnap] = await Promise.all([
    getDocs(collection(db, "sedes")),
    getDocs(collection(db, "farms")),
    getDocs(collection(db, "proveedores")),
    getDocs(collection(db, "roles")),
  ]);

  const sedes = {};
  for (const sedeDoc of sedesSnap.docs) {
    const lotesSnap = await getDocs(collection(db, "sedes", sedeDoc.id, "lotes"));
    sedes[sedeDoc.id] = {
      ...sedeDoc.data(),
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
//
// No se registra en `movimientos` -- esa colección es para movimiento físico
// de viales, no acciones administrativas. En cambio, queda trazada en
// `auditoria` como la ÚLTIMA operación del array `operaciones`: al ir en el
// último bloque de commitEnBloques, sólo se escribe si todos los bloques
// anteriores ya se aplicaron con éxito -- si el restore falla a mitad de
// camino, el registro de auditoría nunca llega a existir.
export async function importarBackup(backup, usuario) {
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

  for (const sedeId of Object.keys(backup.sedes || {})) {
    const { lotes = [], ...sedeData } = backup.sedes[sedeId];
    operaciones.push({ tipo: "set", ref: doc(db, "sedes", sedeId), data: sedeData });

    const lotesActuales = await getDocs(collection(db, "sedes", sedeId, "lotes"));
    lotesActuales.docs.forEach((d) => operaciones.push({ tipo: "delete", ref: d.ref }));
    lotes.forEach((l) => {
      const { id, ...data } = l;
      operaciones.push({ tipo: "set", ref: doc(db, "sedes", sedeId, "lotes", id), data });
    });
  }

  operaciones.push({
    tipo: "set",
    ref: doc(collection(db, "auditoria")),
    data: {
      fecha: serverTimestamp(),
      tipo: "restauracion_backup",
      usuarioNombre: usuario.nombre,
      usuarioEmail: usuario.email,
      detalle: {
        backupExportadoEn: backup.exportadoEn || "",
        backupVersion: backup.version,
        farms: (backup.farms || []).length,
        proveedores: (backup.proveedores || []).length,
        sedes: Object.keys(backup.sedes || {}).length,
      },
    },
  });

  await commitEnBloques(operaciones);
}
