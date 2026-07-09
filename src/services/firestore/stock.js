import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { uid } from "../../helpers/id.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const lotesRef = (sedeId, loteId) => doc(db, "sedes", sedeId, "lotes", loteId);
const movimientosCol = collection(db, "movimientos");

// Un solo listener de app entera sobre todos los lotes de todas las sedes,
// reagrupado a la forma {sedeId:{farmId:[lotes]}} — igual que el `estado.stock`
// de la demo, para no tener que reescribir las tablas que ya leen esa forma.
export function listenLotes(callback) {
  return onSnapshot(collectionGroup(db, "lotes"), (snap) => {
    const stock = {};
    snap.docs.forEach((d) => {
      const sedeId = d.ref.parent.parent.id;
      const { farmId, ...lote } = d.data();
      stock[sedeId] ??= {};
      stock[sedeId][farmId] ??= [];
      stock[sedeId][farmId].push({ id: d.id, ...lote });
    });
    callback(stock);
  });
}

// Ingreso: siempre crea un lote nuevo (no mergea), no depende de leer nada
// antes -> writeBatch, offline-safe (se encola y sincroniza solo).
export function ingresoBatch({ sedeId, sedeNombre, farm, lote, vencimiento, cantidad, kits, proveedorNombre, observacion, usuario }) {
  const batch = writeBatch(db);
  const nuevoLoteRef = doc(collection(db, "sedes", sedeId, "lotes"));
  batch.set(nuevoLoteRef, { farmId: farm.id, lote, vencimiento, cantidad, proveedorNombre, creadoEn: serverTimestamp() });
  const motivo = kits ? `Recepción (${kits} kit${kits > 1 ? "s" : ""} × ${farm.viales_x_kit} = ${cantidad} viales)` : "Recepción de pedido";
  batch.set(doc(movimientosCol), {
    fecha: serverTimestamp(), tipo: "ingreso", sedeId, sedeNombre,
    farmId: farm.id, farmNombre: farm.nombre, cantidad, lote, loteId: nuevoLoteRef.id,
    motivo, observacion, proveedorNombre, usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
  });
  return batch.commit();
}

// Egreso: requiere leer el stock real del lote antes de descontar -> runTransaction.
export function egresoTransaction({ sedeId, sedeNombre, farm, loteId, cantidad, motivo, observacion, usuario }) {
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const loteSnapshot = await tx.get(lotesRef(sedeId, loteId));
      if (!loteSnapshot.exists()) throw new Error("El lote ya no existe.");
      const loteData = loteSnapshot.data();
      if (loteData.cantidad < cantidad) throw new Error("Stock insuficiente para este egreso.");
      tx.update(lotesRef(sedeId, loteId), { cantidad: loteData.cantidad - cantidad });
      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "egreso", sedeId, sedeNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: loteData.lote, loteId,
        motivo, observacion, usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    })
  );
}

// Transferencia: lee y escribe lotes de dos sedes distintas en una sola
// transacción (Firestore no limita las transacciones a un solo documento),
// y crea los dos movimientos vinculados por grupoId.
export function transferenciaTransaction({ sedeOrigenId, sedeOrigenNombre, sedeDestinoId, sedeDestinoNombre, farm, loteId, cantidad, observacion, usuario }) {
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const origenRef = lotesRef(sedeOrigenId, loteId);
      const origenSnapshot = await tx.get(origenRef);
      if (!origenSnapshot.exists()) throw new Error("El lote ya no existe.");
      const origenData = origenSnapshot.data();
      if (origenData.cantidad < cantidad) throw new Error("Stock insuficiente para transferir.");

      // Busca en destino un lote con mismo número de lote y vencimiento para acreditar ahí.
      const destinoLotesSnap = await tx.get(collection(db, "sedes", sedeDestinoId, "lotes"));
      const existente = destinoLotesSnap.docs.find(
        (d) => d.data().farmId === farm.id && d.data().lote === origenData.lote && d.data().vencimiento === origenData.vencimiento
      );

      tx.update(origenRef, { cantidad: origenData.cantidad - cantidad });
      if (existente) {
        tx.update(existente.ref, { cantidad: existente.data().cantidad + cantidad });
      } else {
        tx.set(doc(collection(db, "sedes", sedeDestinoId, "lotes")), {
          farmId: farm.id, lote: origenData.lote, vencimiento: origenData.vencimiento,
          cantidad, proveedorNombre: origenData.proveedorNombre || "", creadoEn: serverTimestamp(),
        });
      }

      const grupoId = uid();
      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "transferencia_salida", grupoId,
        sedeId: sedeOrigenId, sedeNombre: sedeOrigenNombre, sedeRelacionada: sedeDestinoNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: origenData.lote,
        motivo: `Transferencia a ${sedeDestinoNombre}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "transferencia_entrada", grupoId,
        sedeId: sedeDestinoId, sedeNombre: sedeDestinoNombre, sedeRelacionada: sedeOrigenNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: origenData.lote,
        motivo: `Transferencia desde ${sedeOrigenNombre}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    })
  );
}
