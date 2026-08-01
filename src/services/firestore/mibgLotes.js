import { addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";
import { fmtTs } from "../../helpers/formato.js";
import { fichaUsadaRef, fichaUsadaBareRef, datosFichaUsada, anulaFichaRef } from "./actas.js";

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
// El id de la acta de uso NO es fijo por lote (`${prefijo}${loteId}`) --
// eso fue el diseño original y tenía un bug real: al desacoplar la
// anulación de la acta y del lote, un lote anulado-y-corregido no tenía
// ningún id libre donde guardar la segunda administración, porque allow
// update:false deja el primer id ocupado para siempre aunque esté anulado.
// Ahora el id lleva un número de intento acotado (1..5, ver CAP_INTENTOS,
// mismo tope que la regla server-side): se busca el primer intento libre
// (no existe todavía) o anulado-y-liberable... en realidad un intento
// anulado NO se reutiliza (cada intento es su propia acta inmutable) -- se
// busca el primer número SIN acta creada todavía, y de paso se verifica
// que ningún intento anterior siga activo (existe y no anulado), que es la
// garantía real de "nunca dos administraciones activas del mismo lote".
//
// usoRef/tipo/campoLoteId varían según el isótopo -- MIBG usa su propio
// namespace de ids (mibg_${loteId}_${n}, tipo i131_mibg, campo mibgLoteId)
// desde antes de que existiera Lutecio-177. Lutecio-177 usa un namespace
// NUEVO (lote_${loteId}_${n}, tipo paciente, campo loteDosisUnicaId) para no
// confundirse con el de MIBG.
const CAP_INTENTOS = 5;
const CAP_FICHA_INTENTOS = 5;

function administrarLoteDosisUnicaTransaction(loteId, dataActa, { prefijo, tipo, campoLoteId }) {
  const loteRef = doc(mibgLoteCol, loteId);
  const anulaLoteRef = doc(actasCol, `anula_${loteId}`);
  const legacyUsoRef = doc(actasCol, `${prefijo}${loteId}`);
  const legacyAnulaRef = doc(actasCol, `anula_${prefijo}${loteId}`);
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const loteSnap = await tx.get(loteRef);
      if (!loteSnap.exists()) throw new Error("Este lote no existe.");
      const anulaSnap = await tx.get(anulaLoteRef);
      if (anulaSnap.exists()) throw new Error("Este lote fue anulado -- no se puede usar.");

      // N° de Ficha (Libro 2): único en TODA la institución, mismo esquema
      // de intento secuencial que el lote (ver firestore.rules#
      // fichaIntentoHabilitado) -- dentro de la MISMA transacción en vez
      // de un batch (ya hay una transacción abierta para el lote/intento).
      // dataActa.pacienteFicha llega ya normalizado desde TabPacientes.jsx.
      const fichaBareSnap = await tx.get(fichaUsadaBareRef(dataActa.pacienteFicha));
      if (fichaBareSnap.exists()) {
        const u = fichaBareSnap.data();
        throw new Error(`Este N° de Ficha ya fue usado el ${fmtTs(u.fecha)} para el paciente ${u.pacienteNombre}.`);
      }
      let fichaIntentoNro = null;
      for (let n = 1; n <= CAP_FICHA_INTENTOS; n++) {
        const fichaSnap = await tx.get(fichaUsadaRef(dataActa.pacienteFicha, String(n)));
        if (!fichaSnap.exists()) { fichaIntentoNro = String(n); break; }
        const fichaAnulaSnap = await tx.get(anulaFichaRef(dataActa.pacienteFicha, String(n)));
        if (!fichaAnulaSnap.exists()) {
          const u = fichaSnap.data();
          throw new Error(`Este N° de Ficha ya fue usado el ${fmtTs(u.fecha)} para el paciente ${u.pacienteNombre}.`);
        }
      }
      if (!fichaIntentoNro) throw new Error("Este N° de Ficha ya tuvo demasiadas correcciones -- contactá soporte.");

      // Compatibilidad con actas de antes de este esquema (id sin sufijo
      // _n) -- si alguna quedara activa, sigue bloqueando una nueva
      // administración, sin necesitar migrar ningún dato existente.
      const legacyUsoSnap = await tx.get(legacyUsoRef);
      if (legacyUsoSnap.exists()) {
        const legacyAnulaSnap = await tx.get(legacyAnulaRef);
        if (!legacyAnulaSnap.exists()) throw new Error("Este lote ya fue administrado a otro paciente -- elegí otro.");
      }

      for (let n = 1; n <= CAP_INTENTOS; n++) {
        const usoRef = doc(actasCol, `${prefijo}${loteId}_${n}`);
        const usoSnap = await tx.get(usoRef);
        if (!usoSnap.exists()) {
          tx.set(usoRef, { ...dataActa, tipo, [campoLoteId]: loteId, intentoNro: String(n), fichaIntentoNro, fecha: serverTimestamp() });
          tx.set(fichaUsadaRef(dataActa.pacienteFicha, fichaIntentoNro), datosFichaUsada({ ...dataActa, fichaIntentoNro }, tipo, usoRef.id));
          return;
        }
        const anulaUsoSnap = await tx.get(doc(actasCol, `anula_${prefijo}${loteId}_${n}`));
        if (!anulaUsoSnap.exists()) throw new Error("Este lote ya fue administrado a otro paciente -- elegí otro.");
      }
      throw new Error("Este lote ya tuvo demasiadas correcciones de administración -- contactá soporte.");
    })
  );
}

export function administrarMibgTransaction(loteId, dataActa) {
  return administrarLoteDosisUnicaTransaction(loteId, dataActa, {
    prefijo: "mibg_", tipo: "i131_mibg", campoLoteId: "mibgLoteId",
  });
}

export function administrarLutecioTransaction(loteId, dataActa) {
  return administrarLoteDosisUnicaTransaction(loteId, dataActa, {
    prefijo: "lote_", tipo: "paciente", campoLoteId: "loteDosisUnicaId",
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
