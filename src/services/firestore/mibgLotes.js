import { addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

// Colección de lotes de dosis única -- nombre histórico "mibg_lote" (quedó
// así a propósito, ver isotopoId más abajo: cambiar el nombre de la
// colección hubiera exigido migrar los docs de MIBG ya en producción, y no
// hacía falta). Hoy sirve tanto a MIBG (Gestión I-131) como a Lutecio-177
// (Libro 4, Actas ARN) -- ver TabLoteDosisUnica.jsx.
const mibgLoteCol = collection(db, "mibg_lote");
const actasCol = collection(db, "actas");

// Alta simple, sin lectura previa -> offline-safe (se encola sola).
// isotopoId es obligatorio para altas nuevas (ver firestore.rules) -- los
// docs de MIBG ya en producción, de antes de este campo, se interpretan como
// 'mibg' por ausencia en el CLIENTE (ver estadoMibgLote/TabLoteDosisUnica),
// nunca se revalida ni se migra nada del lado servidor.
export function addMibgLote(data) {
  return addDoc(mibgLoteCol, { ...data, fecha: serverTimestamp() });
}

// sedeId scoping en el cliente igual que siempre; el filtro por isotopoId es
// SIEMPRE client-side (nunca where("isotopoId","==",...)) -- un where de
// igualdad no matchea los docs viejos de MIBG que no tienen el campo, así
// que filtrar server-side los haría desaparecer del listado.
export function listenMibgLotes(callback, { esAdmin, sedeId } = {}) {
  const clausulas = [];
  if (!esAdmin) clausulas.push(where("sedeId", "==", sedeId));
  return onSnapshot(query(mibgLoteCol, ...clausulas), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// "Administrar" un lote de dosis única a un paciente -- transacción que lee
// mibg_lote (¿existe?) + actas (¿anulado?, ¿ya usado?) para poder devolver un
// mensaje claro en español en vez de un permission-denied crudo si alguien
// más ya lo usó/anuló un instante antes. El id determinístico de la acta de
// uso (allow update: false en /actas) sigue como red de seguridad
// server-side por si dos transacciones corren casi en simultáneo: aunque las
// dos pasen la validación de "no usado" acá, sólo una de las dos puede
// terminar de escribir en ese mismo id.
//
// usoRef/tipo/campoLoteId varían según el isótopo -- MIBG usa su propio
// namespace de ids (mibg_${loteId}, tipo i131_mibg, campo mibgLoteId) desde
// antes de que existiera Lutecio-177, y se preserva tal cual para no tocar
// datos ya en producción. Lutecio-177 usa un namespace NUEVO (lote_${loteId},
// tipo paciente, campo loteDosisUnicaId) para no confundirse con el de MIBG.
function administrarLoteDosisUnicaTransaction(loteId, dataActa, { usoRef, tipo, campoLoteId }) {
  const loteRef = doc(mibgLoteCol, loteId);
  const anulaLoteRef = doc(actasCol, `anula_${loteId}`);
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const loteSnap = await tx.get(loteRef);
      if (!loteSnap.exists()) throw new Error("Este lote no existe.");
      const anulaSnap = await tx.get(anulaLoteRef);
      if (anulaSnap.exists()) throw new Error("Este lote fue anulado -- no se puede usar.");
      const usoSnap = await tx.get(usoRef);
      if (usoSnap.exists()) throw new Error("Este lote ya fue administrado a otro paciente -- elegí otro.");
      tx.set(usoRef, { ...dataActa, tipo, [campoLoteId]: loteId, fecha: serverTimestamp() });
    })
  );
}

export function administrarMibgTransaction(loteId, dataActa) {
  return administrarLoteDosisUnicaTransaction(loteId, dataActa, {
    usoRef: doc(actasCol, `mibg_${loteId}`), tipo: "i131_mibg", campoLoteId: "mibgLoteId",
  });
}

export function administrarLutecioTransaction(loteId, dataActa) {
  return administrarLoteDosisUnicaTransaction(loteId, dataActa, {
    usoRef: doc(actasCol, `lote_${loteId}`), tipo: "paciente", campoLoteId: "loteDosisUnicaId",
  });
}

// Anular la administración a un paciente y anular el LOTE son acciones
// INDEPENDIENTES (corrección de diseño: eran dos hechos distintos que la
// cascada original trataba como uno solo) -- el lote (llegada del vial:
// fecha, actividad calibrada) y la administración (Libro 2: dosis
// realmente inyectada, casi nunca igual a la calibrada por decaimiento) no
// tienen por qué anularse juntos. Anular sólo la acta usa
// anularActaTransaction directo (ver TabPacientes.jsx/TabRegistrosI131.jsx)
// -- el lote queda disponible automáticamente para reasignar, ya que la
// derivación de "usado" (estadoMibgLote) ignora actas anuladas. Anular sólo
// el lote (error de ingreso: número de lote mal tipeado, actividad de
// llegada mal cargada) usa el mismo anularActaTransaction directo desde
// TabLoteDosisUnica.jsx, sin tocar la acta del paciente.
