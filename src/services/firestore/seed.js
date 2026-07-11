import { doc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { SEDES } from "../../constants/sedes.js";
import { FARMS_DEFAULT, SEDE_FARMS_DEFAULT, PROVEEDORES_DEFAULT } from "../../constants/farmsSeed.js";

// Siembra única del catálogo/sedes/proveedores por defecto -- sin stock ni
// movimientos falsos. Corre con el SDK de cliente bajo la sesión del admin
// logueado (las reglas ya permiten a un admin escribir farms/sedes/
// proveedores), así que no hace falta ninguna credencial elevada. Pensado
// para usarse una sola vez, contra un proyecto recién creado y vacío.
export function sembrarCatalogoInicial() {
  const batch = writeBatch(db);

  FARMS_DEFAULT.forEach((farm) => {
    batch.set(doc(db, "farms", farm.id), { nombre: farm.nombre, viales_x_kit: farm.viales_x_kit });
  });

  SEDES.forEach((sede) => {
    const farmIds = SEDE_FARMS_DEFAULT[sede.id] || [];
    batch.set(doc(db, "sedes", sede.id), {
      nombre: sede.nombre,
      short: sede.short,
      activo: !!sede.principal, // modo piloto: arranca sólo activa la sede principal
      principal: !!sede.principal,
      eliminada: false,
      farmIds,
      puntosReorden: Object.fromEntries(farmIds.map((fid) => [fid, 2])),
    });
  });

  PROVEEDORES_DEFAULT.forEach((prov) => {
    batch.set(doc(db, "proveedores", prov.id), { nombre: prov.nombre, contacto: prov.contacto, principal: !!prov.principal });
  });

  return batch.commit();
}
