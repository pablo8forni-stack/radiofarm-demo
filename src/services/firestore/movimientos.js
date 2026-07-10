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
  if (mov.tipo === "transferencia_salida" || mov.tipo === "transferencia_entrada") {
    throw new Error("Esta es una transferencia: usá 'Anular transferencia' para anular ambas puntas juntas.");
  }
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

// Anula una transferencia completa (ambas puntas) en una sola transacción.
// Recibe cualquiera de los dos movimientos vinculados (salida o entrada) y
// busca el par por grupoId dentro de la propia transacción -- así no depende
// de qué sede esté filtrada en el Historial ni de cuál de las dos filas se
// haya clickeado. Revierte el stock de origen y destino juntos, y crea los
// dos movimientos de anulación (uno por cada punta) o ninguno.
export function anularTransferenciaTransaction(mov, observacion, usuario, motivoLabel) {
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const parSnap = await tx.get(query(movimientosCol, where("grupoId", "==", mov.grupoId)));
      const par = parSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const movSalida = par.find((m) => m.tipo === "transferencia_salida");
      const movEntrada = par.find((m) => m.tipo === "transferencia_entrada");
      if (!movSalida || !movEntrada) throw new Error("No se encontró el par completo de esta transferencia.");

      const yaAnuladaSnap = await tx.get(query(movimientosCol, where("anulaId", "in", [movSalida.id, movEntrada.id])));
      if (!yaAnuladaSnap.empty) throw new Error("Esta transferencia ya fue anulada.");

      async function ubicarLote(m) {
        const porLote = await tx.get(query(collection(db, "sedes", m.sedeId, "lotes"), where("lote", "==", m.lote), where("farmId", "==", m.farmId)));
        return porLote.empty ? null : { ref: porLote.docs[0].ref, data: porLote.docs[0].data() };
      }

      const origen = await ubicarLote(movSalida);
      const destino = await ubicarLote(movEntrada);

      // El destino sí tiene que existir y tener stock suficiente: si no,
      // revertir a ciegas dejaría cantidades negativas o crearía stock de la
      // nada -- se corta la anulación entera en vez de hacerla a medias.
      if (!destino) throw new Error("El lote de destino ya no existe; no se puede revertir automáticamente.");
      const cantidadDestino = destino.data.cantidad - movEntrada.cantidad;
      if (cantidadDestino < 0) throw new Error("El lote de destino ya no tiene suficiente stock para revertir la transferencia.");
      tx.update(destino.ref, { cantidad: cantidadDestino });

      if (origen) {
        tx.update(origen.ref, { cantidad: origen.data.cantidad + movSalida.cantidad });
      } else {
        tx.set(doc(collection(db, "sedes", movSalida.sedeId, "lotes")), {
          farmId: movSalida.farmId, lote: movSalida.lote, vencimiento: "", cantidad: movSalida.cantidad, proveedorNombre: "", creadoEn: serverTimestamp(),
        });
      }

      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: movSalida.id,
        sedeId: movSalida.sedeId, sedeNombre: movSalida.sedeNombre, farmId: movSalida.farmId, farmNombre: movSalida.farmNombre,
        cantidad: movSalida.cantidad, lote: movSalida.lote,
        motivo: motivoLabel || `Anula transferencia ${mov.grupoId}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      tx.set(doc(movimientosCol), {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: movEntrada.id,
        sedeId: movEntrada.sedeId, sedeNombre: movEntrada.sedeNombre, farmId: movEntrada.farmId, farmNombre: movEntrada.farmNombre,
        cantidad: movEntrada.cantidad, lote: movEntrada.lote,
        motivo: motivoLabel || `Anula transferencia ${mov.grupoId}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    })
  );
}
