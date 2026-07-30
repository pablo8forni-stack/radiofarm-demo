import { addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const mibgLoteCol = collection(db, "mibg_lote");
const actasCol = collection(db, "actas");

// MIBG (131I-MIBG) -- colección PROPIA, no vive dentro de actas como
// i131_vial: cada vial es una dosis completa para un único paciente, sin
// decaimiento/balance de volumen (ver nota en firestore.rules). Create-only,
// abierto a cualquier técnico de su sede (sin tieneAccesoI131()) -- registrar
// la llegada de un lote es un alta simple, sin lectura previa, offline-safe.
export function addMibgLote(data) {
  return addDoc(mibgLoteCol, { ...data, fecha: serverTimestamp() });
}

export function listenMibgLotes(callback, { esAdmin, sedeId } = {}) {
  const clausulas = [];
  if (!esAdmin) clausulas.push(where("sedeId", "==", sedeId));
  return onSnapshot(query(mibgLoteCol, ...clausulas), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// "Administrar" un lote a un paciente (Libro 2, tipo i131_mibg) -- transacción
// que lee mibg_lote (¿existe?) + actas (¿anulado?, ¿ya usado?) para poder
// devolver un mensaje claro en español en vez de un permission-denied crudo
// si alguien más ya lo usó/anuló un instante antes. El id determinístico
// `mibg_${loteId}` (allow update: false en /actas) sigue como red de
// seguridad server-side por si dos transacciones corren casi en simultáneo:
// aunque las dos pasen la validación de "no usado" acá, sólo una de las dos
// puede terminar de escribir en ese mismo id.
export function administrarMibgTransaction(loteId, dataActa) {
  const loteRef = doc(mibgLoteCol, loteId);
  const anulaLoteRef = doc(actasCol, `anula_${loteId}`);
  const usoRef = doc(actasCol, `mibg_${loteId}`);
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const loteSnap = await tx.get(loteRef);
      if (!loteSnap.exists()) throw new Error("Este lote de MIBG no existe.");
      const anulaSnap = await tx.get(anulaLoteRef);
      if (anulaSnap.exists()) throw new Error("Este lote de MIBG fue anulado -- no se puede usar.");
      const usoSnap = await tx.get(usoRef);
      if (usoSnap.exists()) throw new Error("Este lote ya fue administrado a otro paciente -- elegí otro.");
      tx.set(usoRef, { ...dataActa, tipo: "i131_mibg", mibgLoteId: loteId, fecha: serverTimestamp() });
    })
  );
}

