import { collection, doc, getDoc, setDoc, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "../../firebase.js";
import { fichaUsadaRef, anulaFichaRef } from "./actas.js";

const fichasUsadasCol = collection(db, "fichasUsadas");

// Fase 2.1a (23/11) -- capa de servicio de emisión de fichas. Sólo las 2
// piezas aprobadas para esta etapa: crear una emisión y liberarla desde la
// administrativa/admin (standalone, sin acta hermana en el mismo batch).
// "Marcar enterada" y "cargada con corrección" quedan para Fase 2.2.
const emisionesFichaCol = collection(db, "emisionesFicha");
const emisionesFichaResueltasCol = collection(db, "emisionesFichaResueltas");

const CAP_INTENTOS = 5;
const CAP_VERSIONES = 5;
export const TTL_EMISION_DIAS = 60;

export const emisionFichaRef = (sedeId, numero, emisionVersion) =>
  doc(emisionesFichaCol, `${sedeId}_${numero}_${emisionVersion}`);
export const emisionResueltaRef = (sedeId, numero, emisionVersion) =>
  doc(emisionesFichaResueltasCol, `${sedeId}_${numero}_${emisionVersion}`);

function expiraEnDefault() {
  return Timestamp.fromMillis(Date.now() + TTL_EMISION_DIAS * 86400000);
}

// Listeners acotados por sede -- nunca sin where(sedeId==), mismo criterio
// que el resto de la app (ver nota larga en firestore.rules sobre actas).
export function listenEmisionesFicha(sedeId, callback) {
  const q = query(emisionesFichaCol, where("sedeId", "==", sedeId));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenEmisionesResueltas(sedeId, callback) {
  const q = query(emisionesFichaResueltasCol, where("sedeId", "==", sedeId));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Listener por FILA pendiente (no por colección entera) -- query acotada a
// (sedeId, pacienteFichaNum), máximo 5 documentos (tope de intentos). En
// cada snapshot nuevo (alta de un intento), re-lee con 1 getDoc puntual la
// anulación del intento más alto -- así el estado vigente/anulado queda
// correcto en el momento de cada alta. Una anulación POSTERIOR sin ningún
// alta nueva de por medio no dispara este listener (fichasUsadas es
// inmutable, allow update/delete:false) -- por diseño, se actualiza con el
// foco de pestaña o el botón "Actualizar" de la pantalla, no al instante.
export function listenFichaUsadaEstado(sedeId, numero, callback) {
  const q = query(fichasUsadasCol, where("sedeId", "==", sedeId), where("pacienteFichaNum", "==", Number(numero)));
  return onSnapshot(q, async (snap) => {
    if (snap.empty) {
      callback({ k: "0", vigente: false });
      return;
    }
    let maxN = 0;
    let maxDoc = null;
    for (const d of snap.docs) {
      const n = Number(d.data().fichaIntentoNro);
      if (n > maxN) { maxN = n; maxDoc = d; }
    }
    const anulaSnap = await getDoc(anulaFichaRef(sedeId, numero, String(maxN)));
    callback({ k: String(maxN), vigente: !anulaSnap.exists(), dni: maxDoc.data().pacienteDni });
  });
}

// Intento más alto EXISTENTE de fichasUsadas para (sedeId, numero), y si
// está vigente (no anulado) -- mismo loop y mismos refs que
// resolverFichaIntento (actas.js) pero con otro criterio de corte: ahí se
// busca el PRÓXIMO libre para crear una acta; acá hace falta saber el MÁS
// ALTO EXISTENTE sea cual sea su estado, para el bloqueo duro de emisión/
// liberación (ver fichaSinActaVigente/fichaLiberableStandalone en
// firestore.rules). Devuelve { k, vigente, dni } -- dni sólo si vigente
// (pacienteDni del marcador, para el cruce de "mismo paciente" en
// liberarEmisionStandalone). Hasta 2*CAP_INTENTOS lecturas puntuales
// (getDoc normal de cliente, no cuenta contra el presupuesto de 10 de las
// reglas -- eso es un límite aparte, ya resuelto en Fase 2.0).
export async function calcularFichaIntentoObservado(sedeId, numero) {
  let kAnuladoMasAlto = "0";
  for (let n = 1; n <= CAP_INTENTOS; n++) {
    const usoSnap = await getDoc(fichaUsadaRef(sedeId, numero, String(n)));
    if (!usoSnap.exists()) return { k: kAnuladoMasAlto, vigente: false };
    const anulaSnap = await getDoc(anulaFichaRef(sedeId, numero, String(n)));
    if (!anulaSnap.exists()) return { k: String(n), vigente: true, dni: usoSnap.data().pacienteDni };
    kAnuladoMasAlto = String(n);
  }
  // Los 5 existen y los 5 están anulados -- el intento 5 queda "anulado",
  // nunca vigente (puede pasar: hasta la última corrección se anuló).
  return { k: "5", vigente: false };
}

// Próxima emisionVersion -- algoritmo "más alta +1" (corregido 23/11,
// Pablo): lee v=1..5 en AMBAS colecciones (10 lecturas fijas, sin cortar
// antes) y toma la v MÁS ALTA que tenga algún doc en cualquiera de las dos.
// "Primer slot limpio" (el diseño anterior) fallaba si TTL borró v1 pero v2
// sigue viva: proponía v1 y quedaban dos emisiones para el mismo N°. Con
// "más alta +1" eso no puede pasar -- nunca se reusa un hueco por debajo de
// la más alta real.
//
// Devuelve una de:
//   { ok: true, version: '1'..'5' }
//   { ok: false, motivo: 'pendiente', version: '1'..'5' }  -- la v más alta
//     tiene una emisión sin resolver y sin vencer; hay que resolverla o
//     liberarla antes de emitir una nueva.
//   { ok: false, motivo: 'tope' }  -- la siguiente sería '6'.
export async function calcularProximaEmisionVersion(sedeId, numero) {
  let vMax = null;
  let padreVMax = null;
  for (let v = 1; v <= CAP_VERSIONES; v++) {
    const vStr = String(v);
    const padreSnap = await getDoc(emisionFichaRef(sedeId, numero, vStr));
    const resueltaSnap = await getDoc(emisionResueltaRef(sedeId, numero, vStr));
    if (padreSnap.exists() || resueltaSnap.exists()) {
      vMax = vStr;
      padreVMax = padreSnap.exists() ? padreSnap.data() : null;
    }
    // Si ninguno existe en este nivel, no se toca vMax/padreVMax -- sigue
    // valiendo lo último encontrado. El loop nunca corta antes de v=5 a
    // propósito (10 lecturas fijas), para no reintroducir el bug del hueco.
  }
  if (vMax === null) return { ok: true, version: "1" };
  if (padreVMax) {
    const resueltaVMax = await getDoc(emisionResueltaRef(sedeId, numero, vMax));
    if (!resueltaVMax.exists()) {
      const expiraEn = padreVMax.expiraEn;
      const vencido = expiraEn && expiraEn.toMillis() < Date.now();
      if (!vencido) return { ok: false, motivo: "pendiente", version: vMax };
      // Vencida (desfasaje de TTL): se cuenta como resuelta, se sigue.
    }
  }
  const siguiente = Number(vMax) + 1;
  if (siguiente > CAP_VERSIONES) return { ok: false, motivo: "tope" };
  return { ok: true, version: String(siguiente) };
}

// Crea la emisión -- calcula fichaIntentoObservado y emisionVersion
// internamente (nunca confía en que el llamador los traiga ya calculados,
// para no tener dos fuentes de verdad). Tira Error con mensaje claro ANTES
// de intentar el write si el bloqueo duro o la cadena de versión lo impiden
// -- la garantía real sigue siendo la regla, esto es sólo para no mostrar
// un permission-denied crudo donde ya se puede explicar la causa.
export async function crearEmisionFicha({ sedeId, numero, dni, nombre, estudio, usuarioEmail, peso, talla }) {
  if (!/^[0-9]+$/.test(numero)) throw new Error("El N° de ficha tiene que ser numérico.");

  const intento = await calcularFichaIntentoObservado(sedeId, numero);
  if (intento.vigente) {
    throw new Error("Este N° de ficha ya tiene un acta vigente -- no se puede emitir.");
  }

  const version = await calcularProximaEmisionVersion(sedeId, numero);
  if (!version.ok) {
    if (version.motivo === "pendiente") {
      throw new Error(`Ya hay una emisión pendiente (versión ${version.version}) para este N° -- resolvela o liberala antes de emitir otra.`);
    }
    throw new Error("Esta ficha ya tuvo demasiadas reemisiones (5) -- contactá soporte.");
  }

  // peso/talla: campos opcionales, sin equivalente obligatorio en la regla
  // (emisionesFichaValida no tiene ningún .hasOnly() -- no restringe qué
  // otros campos puede tener el documento, confirmado leyendo
  // firestore.rules:1427-1450). Mismo criterio que pacienteDni opcional en
  // datosFichaUsada (actas.js): omitir la clave entera si no vino, nunca
  // escribir undefined (Firestore lo rechaza).
  await setDoc(emisionFichaRef(sedeId, numero, version.version), {
    sedeId, numero, pacienteFichaNum: Number(numero), emisionVersion: version.version,
    dni, nombre, estudio, usuarioEmail,
    fichaIntentoObservado: intento.k,
    expiraEn: expiraEnDefault(),
    ...(peso != null && peso !== "" ? { peso: Number(peso) } : {}),
    ...(talla != null && talla !== "" ? { talla: Number(talla) } : {}),
  });
}

// Liberación standalone (administrativa/admin, sin acta hermana en el
// mismo batch) -- motivo libre obligatorio, recortado antes de enviar
// (tope de 300 caracteres es SOLO de cliente/UI, la regla no tiene tope,
// ver firestore.rules:1497). fichaIntentoNroObservado -- con "Nro", nombre
// EXACTO en esta colección, distinto de fichaIntentoObservado (sin "Nro")
// que usa emisionesFicha -- no son el mismo campo aunque el valor sea el
// mismo k, ver firestore.rules:1445 vs. :1498.
export async function liberarEmisionStandalone({ sedeId, numero, emisionVersion, motivo, usuarioEmail }) {
  const motivoRecortado = (motivo || "").trim();
  if (!motivoRecortado) throw new Error("El motivo es obligatorio.");

  const padreSnap = await getDoc(emisionFichaRef(sedeId, numero, emisionVersion));
  if (!padreSnap.exists()) throw new Error("Esta emisión no existe (puede haber sido liberada o vencida ya).");
  const padre = padreSnap.data();

  // La regla sólo permite CREAR esta resolución (allow update está acotado
  // a vistoAdmin, firestore.rules:1540-1543) -- si ya existe, un setDoc de
  // vuelta chocaría con permission-denied crudo. Chequeo aparte para dar un
  // mensaje claro antes de intentarlo.
  const resueltaExistente = await getDoc(emisionResueltaRef(sedeId, numero, emisionVersion));
  if (resueltaExistente.exists()) throw new Error("Esta emisión ya fue resuelta.");

  const intento = await calcularFichaIntentoObservado(sedeId, numero);
  if (intento.vigente && intento.dni === padre.dni) {
    throw new Error("Este N° de ficha ya está cargado para este mismo paciente -- no se libera, hay que resolverlo como \"cargada\".");
  }

  await setDoc(emisionResueltaRef(sedeId, numero, emisionVersion), {
    sedeId, numero, emisionVersion, usuarioEmail,
    vistoAdmin: false,
    expiraEn: padre.expiraEn,
    estado: "liberada",
    motivo: motivoRecortado,
    fichaIntentoNroObservado: intento.k,
  });
}
