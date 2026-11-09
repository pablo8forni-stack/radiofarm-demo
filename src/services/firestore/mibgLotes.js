import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";
import { fmtTs } from "../../helpers/formato.js";
import { fichaUsadaRef, datosFichaUsada, anulaFichaRef } from "./actas.js";

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

// sedeId siempre obligatorio server-side, admin incluido (ver
// listenActas/actas.js para el mismo criterio) -- para admin, sedeId tiene
// que ser sedeAuditando, no usuario.sede. El filtro por isotopoId es SIEMPRE
// client-side (nunca where("isotopoId","==",...)) -- un where de igualdad
// no matchea los docs viejos de MIBG que no tienen el campo, así que
// filtrar server-side los haría desaparecer del listado.
//
// data({ serverTimestamps: "estimate" }) -- sin esto, `fecha` (siempre
// serverTimestamp(), ver addMibgLote) llega como `null` mientras la
// escritura está pendiente de confirmar (la primera emisión del listener,
// desde el caché local, ANTES del ack del servidor). Con "estimate", esa
// primera emisión ya trae una fecha aproximada (el reloj local al momento
// de escribir) en vez de null -- real para ESTE caso transitorio. No afecta
// a lotesSinFecha/lotesDelMes (Libro 4): esas dos leen de lotesPorSede
// (getDocs puntual, nunca ven un pending-write en la práctica), no de este
// listener.
export function listenMibgLotes(callback, { sedeId } = {}) {
  return onSnapshot(query(mibgLoteCol, where("sedeId", "==", sedeId)), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })));
  });
}

// Mismo dato que listenMibgLotes pero puntual (getDocs, no listener) -- para
// la impresión mensual (ver components/impresion/), que arma el documento
// una vez. Sin acotar por fecha -- el llamador filtra por mes/isótopo según
// necesite: ImprimibleLibro2Pacientes busca por id sin importar cuándo
// llegó el lote (necesita encontrar CUALQUIER lote vinculado a una acta,
// sea de este mes o no); GenerarActasImpresion.jsx filtra por mes recién
// client-side, con lotesDelMes (helpers/mibgLote.js) -- este getDocs en sí
// NUNCA filtró por fecha, pese a lo que decía antes este comentario.
export async function lotesPorSede(sedeId) {
  const snap = await getDocs(query(mibgLoteCol, where("sedeId", "==", sedeId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// Uso ACTIVO (no anulado) de UN lote de dosis única (MIBG o Lutecio-177),
// sin acotar por fecha -- a diferencia de buscarlo adentro de un listado de
// actas ya recortado a un mes (actasLibro2 en GenerarActasImpresion.jsx),
// esto encuentra la administración real del lote sin importar en qué mes
// haya pasado, cruzando contra el mismo id determinístico que ya usa
// administrarLoteDosisUnicaTransaction (`${prefijo}${loteId}_${n}`, intentos
// 1..CAP_INTENTOS) en vez de escanear toda la colección `actas` por tipo --
// CAP_INTENTOS lecturas puntuales por lote, nunca una query sin límite.
// anulaciones: Map anulaId -> doc, SIN acotar por fecha (ver
// anulacionesPorSede) -- así un uso anulado en un mes distinto del mes que
// se está imprimiendo también queda excluido acá, no sólo el anulado dentro
// del mismo mes. No busca el id legacy sin sufijo `_n` (ver comentario más
// abajo) -- INFERENCIA, no confirmada con datos reales: Lutecio-177 es un
// namespace nuevo (`lote_`), nunca tuvo el esquema viejo sin sufijo, así que
// no debería hacer falta para este caso.
// onLectura: callback OPCIONAL (paso 6, 9/11) -- se llama una vez por cada
// getDoc real que esta función hace, sólo para que los tests contra el
// emulador puedan contar lecturas reales en vez de suponerlas (pedido
// explícito de Pablo). undefined por default -- ningún llamador existente
// (estadoPorLoteDosisUnica, GenerarActasImpresion.jsx) lo pasa, así que su
// comportamiento queda exactamente igual.
export async function usoActivoDeLote(loteId, { prefijo, anulaciones, onLectura }) {
  for (let n = 1; n <= CAP_INTENTOS; n++) {
    const usoSnap = await getDoc(doc(actasCol, `${prefijo}${loteId}_${n}`));
    onLectura?.();
    if (usoSnap.exists() && !anulaciones.has(usoSnap.id)) {
      return { id: usoSnap.id, ...usoSnap.data() };
    }
  }
  return null;
}

// Estado real de CADA lote de dosis única (MIBG o Lutecio-177) -- "anulado"/
// "sin-vencimiento"/"vencido" se resuelven LOCALMENTE primero, sin ninguna
// lectura (anulaciones y fechaVencimiento ya están en memoria) -- sólo los
// que sobreviven ese filtro (inventario vivo real, no todo el histórico
// acumulado) pagan el costo de usoActivoDeLote. Esto es lo que evita el
// N+1 real: nunca se hacen lecturas puntuales de más de los candidatos que
// de verdad podrían estar disponibles.
//
// hoyISO: STRING "YYYY-MM-DD" de fecha LOCAL (ver hoy(), helpers/formato.js
// -- nunca toISOString(), que convierte a UTC antes de recortar y corre el
// día después de las 21:00 en Argentina). Lo arma el llamador (nunca
// `new Date()` acá adentro) para que esta función sea pura en el tiempo:
// testeable sin pisar el reloj del sistema.
//
// Vencido = INCLUSIVE desde el día del EXP (decisión de Pablo, 4/11): el
// lote deja de estar disponible EL MISMO día de su fechaVencimiento, no al
// día siguiente -- por eso la comparación es `<= hoyISO`, no `< hoyISO`.
//
// "no-verificable": usoActivoDeLote puede rechazar con permission-denied
// real si sedeAuditando (admin) no coincide con la sede de la acta de uso
// -- confirmado contra el emulador real, no inferido (ver transacciones.
// test.mjs). FALLA CERRADO a propósito: ese lote NUNCA cae en "disponible"
// por default, se marca aparte para que el llamador avise, no lo oferte.
export async function estadoPorLoteDosisUnica(lotes, { anulaciones, prefijo, hoyISO }) {
  const estadoPorLoteId = new Map();
  const porVerificarUso = [];
  for (const l of lotes) {
    if (anulaciones.has(l.id)) { estadoPorLoteId.set(l.id, { estado: "anulado", uso: null, error: null }); continue; }
    if (!l.fechaVencimiento) { estadoPorLoteId.set(l.id, { estado: "sin-vencimiento", uso: null, error: null }); continue; }
    if (l.fechaVencimiento <= hoyISO) { estadoPorLoteId.set(l.id, { estado: "vencido", uso: null, error: null }); continue; }
    porVerificarUso.push(l);
  }

  const resultados = await Promise.allSettled(porVerificarUso.map((l) => usoActivoDeLote(l.id, { prefijo, anulaciones })));
  porVerificarUso.forEach((l, i) => {
    const r = resultados[i];
    if (r.status === "rejected") { estadoPorLoteId.set(l.id, { estado: "no-verificable", uso: null, error: r.reason }); return; }
    estadoPorLoteId.set(l.id, r.value ? { estado: "usado", uso: r.value, error: null } : { estado: "disponible", uso: null, error: null });
  });
  return estadoPorLoteId;
}

// Vista "sólo disponibles" sobre estadoPorLoteDosisUnica -- sin ninguna
// lectura nueva, es pura derivación en memoria. Orden: el que vence antes,
// primero (decisión de Pablo).
export function disponiblesDesdeEstadoPorLote(lotes, estadoPorLoteId) {
  return lotes
    .filter((l) => estadoPorLoteId.get(l.id)?.estado === "disponible")
    .sort((a, b) => (a.fechaVencimiento || "").localeCompare(b.fechaVencimiento || ""));
}

// Helper de conveniencia para quien sólo necesita la lista de disponibles
// (TabPacientes.jsx, picker de administrar). Una sola corrida de lecturas
// puntuales por llamada -- nunca dos.
export async function lotesDisponiblesParaAdministrar(lotes, { anulaciones, prefijo, hoyISO }) {
  const estadoPorLoteId = await estadoPorLoteDosisUnica(lotes, { anulaciones, prefijo, hoyISO });
  return {
    disponibles: disponiblesDesdeEstadoPorLote(lotes, estadoPorLoteId),
    sinVencimiento: lotes.filter((l) => estadoPorLoteId.get(l.id)?.estado === "sin-vencimiento"),
    noVerificables: lotes.filter((l) => estadoPorLoteId.get(l.id)?.estado === "no-verificable"),
  };
}

// ===========================================================================
// Paso 6 (9/11) -- estado por lote para el LISTADO de TabLoteDosisUnica
// (no el picker de arriba). Hermana de estadoPorLoteDosisUnica, NO la
// reemplaza ni la modifica -- el picker del paso 5 (y sus tests) siguen
// usando esa función tal cual, sin tocar.
//
// Por qué una función aparte: estadoPorLoteDosisUnica corta ANTES de leer el
// uso si el lote está vencido/sin-vencimiento (correcto para el picker: un
// lote vencido nunca se ofrece, haya sido usado o no). Acá la prioridad es
// la inversa -- un lote usado tiene que figurar "Usado" aunque esté vencido
// (decisión de Pablo, 9/11: "los lotes no se vencen en la práctica, se usan
// siempre"; un vencido SIN uso es la anomalía real a destacar). Por eso acá
// se verifica el uso de CUALQUIER lote no anulado, nunca se corta antes por
// vencimiento.
// ===========================================================================

// Resuelve el estado de UN lote para el listado. Reutiliza usoActivoDeLote
// tal cual (misma función que ya usan el picker del paso 5 y la impresión de
// Libro 4) -- ninguna lectura nueva distinta de las que ya existían.
// hoyISO llega como parámetro (nunca `hoy()` adentro), mismo criterio que ya
// usa estadoPorLoteDosisUnica -- quien la llama (useEstadoListadoLotes) es
// quien decide "ahora", esta función queda pura en el tiempo.
export async function estadoDeUnLoteListado(lote, { anulaciones, prefijo, hoyISO, onLectura }) {
  if (anulaciones.has(lote.id)) return { estado: "anulado", uso: null, error: null };
  let uso;
  try {
    uso = await usoActivoDeLote(lote.id, { prefijo, anulaciones, onLectura });
  } catch (error) {
    return { estado: "no-verificable", uso: null, error };
  }
  if (uso) return { estado: "usado", uso, error: null };
  if (!lote.fechaVencimiento) return { estado: "sin-vencimiento", uso: null, error: null };
  return { estado: lote.fechaVencimiento <= hoyISO ? "vencido-sin-uso" : "disponible", uso: null, error: null };
}

// Versión en lote de la de arriba, para la primera carga / "Ver más" (varios
// lotes nuevos a la vez). Promise.allSettled -- un error de programación en
// un lote puntual (no absorbido ya por el try/catch de arriba) no tira abajo
// la corrida completa de los demás, mismo criterio que estadoPorLoteDosisUnica.
export async function estadoListadoLoteDosisUnica(lotes, { anulaciones, prefijo, hoyISO, onLectura }) {
  const resultados = await Promise.allSettled(lotes.map((l) => estadoDeUnLoteListado(l, { anulaciones, prefijo, hoyISO, onLectura })));
  const mapa = new Map();
  lotes.forEach((l, i) => {
    const r = resultados[i];
    mapa.set(l.id, r.status === "fulfilled" ? r.value : { estado: "no-verificable", uso: null, error: r.reason });
  });
  return mapa;
}

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

      // N° de Ficha (Libro 2): por sede (CORREGIDO -- cada sede lleva su
      // propio libro, numeración independiente, ver nota larga en
      // firestore.rules), mismo esquema de intento secuencial que el lote
      // (ver firestore.rules#fichaIntentoHabilitado) -- dentro de la MISMA
      // transacción en vez de un batch (ya hay una transacción abierta
      // para el lote/intento). dataActa.pacienteFicha llega ya normalizado
      // desde TabPacientes.jsx, dataActa.sedeId ya viene en la data base.
      let fichaIntentoNro = null;
      for (let n = 1; n <= CAP_FICHA_INTENTOS; n++) {
        const fichaSnap = await tx.get(fichaUsadaRef(dataActa.sedeId, dataActa.pacienteFicha, String(n)));
        if (!fichaSnap.exists()) { fichaIntentoNro = String(n); break; }
        const fichaAnulaSnap = await tx.get(anulaFichaRef(dataActa.sedeId, dataActa.pacienteFicha, String(n)));
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
          tx.set(fichaUsadaRef(dataActa.sedeId, dataActa.pacienteFicha, fichaIntentoNro), datosFichaUsada({ ...dataActa, fichaIntentoNro }, tipo, usoRef.id));
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
