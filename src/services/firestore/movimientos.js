import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  limit,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const movimientosCol = collection(db, "movimientos");
const PAGINA = 150;

// Trae los últimos `PAGINA` movimientos (de una sede si esAdmin===false, o de
// la elegida en el filtro). El resto de los filtros (fármaco/tipo) se aplican
// client-side sobre esa página, igual que hacía la demo, para no depender de
// varios índices compuestos.
export function listenMovimientos(sedeId, callback) {
  const q = sedeId
    ? query(movimientosCol, where("sedeId", "==", sedeId), orderBy("fecha", "desc"), limit(PAGINA))
    : query(movimientosCol, orderBy("fecha", "desc"), limit(PAGINA));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Anula un movimiento revirtiendo su efecto sobre el stock. La comprobación
// de "no anulado todavía" se hace dentro de la misma transacción vía una
// query transaccional (tx.get(query)) sobre anulaId, para que dos anulaciones
// simultáneas del mismo movimiento no puedan colarse las dos.
export function anularMovimientoTransaction(mov, observacion, usuario, motivoLabel) {
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const yaAnuladoSnap = await tx.get(query(movimientosCol, where("anulaId", "==", mov.id)));
      if (!yaAnuladoSnap.empty) throw new Error("Este movimiento ya fue anulado.");

      const sid = mov.sedeId, fid = mov.farmId;
      const esEntrada = mov.tipo === "ingreso" || mov.tipo === "transferencia_entrada";
      let loteRef = null, loteData = null;

      if (mov.loteId) {
        loteRef = doc(db, "sedes", sid, "lotes", mov.loteId);
        const snap = await tx.get(loteRef);
        if (snap.exists()) loteData = snap.data();
      }
      if (!loteData) {
        // Lote no encontrado por id (p. ej. se creó en otra sede en una transferencia
        // vieja) -> buscar por número de lote, igual que la demo original.
        const porLote = await tx.get(query(collection(db, "sedes", sid, "lotes"), where("lote", "==", mov.lote), where("farmId", "==", fid)));
        if (!porLote.empty) {
          loteRef = porLote.docs[0].ref;
          loteData = porLote.docs[0].data();
        }
      }

      if (loteData) {
        const delta = esEntrada ? -mov.cantidad : mov.cantidad;
        tx.update(loteRef, { cantidad: Math.max(0, loteData.cantidad + delta) });
      } else if (!esEntrada) {
        // Egreso a anular cuyo lote ya no existe: recrearlo con la cantidad devuelta.
        tx.set(doc(collection(db, "sedes", sid, "lotes")), {
          farmId: fid, lote: mov.lote, vencimiento: "", cantidad: mov.cantidad, proveedorNombre: "", creadoEn: serverTimestamp(),
        });
      }

      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: mov.id,
        sedeId: sid, sedeNombre: mov.sedeNombre, farmId: fid, farmNombre: mov.farmNombre,
        cantidad: mov.cantidad, lote: mov.lote,
        motivo: motivoLabel || `Anula movimiento ${mov.id}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    })
  );
}
