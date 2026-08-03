import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, limit, query, runTransaction, setDoc, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const actasCol = collection(db, "actas");
const generadoresCol = collection(db, "generadoresVistos");
const fichasUsadasCol = collection(db, "fichasUsadas");
// El id determinístico no puede depender de mayúsculas/espacios tal como los
// tipeó cada quien -- un teclado de celular autocapitaliza/autocorrige
// distinto entre dos cargas del "mismo" lote, y eso alcanza para que
// "Gen2026014" y "gen2026014" construyan ids distintos y el marcador nunca
// se encuentre. El campo loteGenerador de la propia acta (lo que se ve en
// listado/CSV) conserva el texto tal cual se tipeó -- esto normaliza sólo
// para el id interno, no para el dato mostrado.
export const normalizarLoteGenerador = (lote) => lote.trim().toUpperCase();
const generadorRef = (sedeId, loteGenerador) => doc(generadoresCol, `${sedeId}_${normalizarLoteGenerador(loteGenerador)}`);
const PAGINA = 150;

// tipo: "paciente" | "marcacion". El filtro de fecha se aplica client-side
// sobre la página traída (como en VistaHistorial), pero el de sede NO --
// las reglas de Firestore sólo dejan leer a un técnico las actas de su
// propia sede (tienen nombre/DNI de pacientes, Ley 25.326), y rechazan la
// consulta entera si no viene ya acotada por sedeId. `sedeId` acá es
// obligatorio para un técnico (esAdmin=false); un admin pasa sedeId=null
// para seguir viendo todas.
export function listenActas(tipo, callback, { esAdmin, sedeId } = {}) {
  const clausulas = [where("tipo", "==", tipo)];
  if (!esAdmin) clausulas.push(where("sedeId", "==", sedeId));
  const q = query(actasCol, ...clausulas, orderBy("fecha", "desc"), limit(PAGINA));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Para exportar CSV de un rango completo en modo "Ver todos" (sin el límite
// de PAGINA que tiene el listener de pantalla) -- getDocs suelto, no listener.
// Mismo motivo que arriba para el filtro de sede: si esAdmin es false, sedeId
// es obligatorio, si no la consulta completa se rechaza por las reglas.
export async function actasPorRango(tipo, { desde, hasta, sedeId, esAdmin }) {
  const clausulas = [
    where("tipo", "==", tipo),
    where("fecha", ">=", new Date(`${desde}T00:00:00`)),
    where("fecha", "<=", new Date(`${hasta}T23:59:59.999`)),
  ];
  if (!esAdmin || sedeId) clausulas.push(where("sedeId", "==", sedeId));
  const snap = await getDocs(query(actasCol, ...clausulas, orderBy("fecha", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Historial completo de I-131 por paciente (Parte C, para auditorías ARN) --
// consulta acotada directamente por pacienteDni + tipo (nunca trae el
// histórico de otros pacientes). Requiere el índice compuesto
// (tipo, pacienteDni, fecha desc) -- o (tipo, sedeId, pacienteDni, fecha
// desc) para técnico -- ver firestore.indexes.json. Mismo criterio de
// scoping por sede que actasPorRango.
export async function actasPorPacienteDni(tipo, { dni, sedeId, esAdmin }) {
  const clausulas = [where("tipo", "==", tipo), where("pacienteDni", "==", dni)];
  if (!esAdmin || sedeId) clausulas.push(where("sedeId", "==", sedeId));
  const snap = await getDocs(query(actasCol, ...clausulas, orderBy("fecha", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// N° de Ficha (Libro 2): mismo esquema de intento secuencial que
// mibg_${loteId}_${n}/lote_${loteId}_${n} (ver firestore.rules#
// fichaIntentoHabilitado) -- bug real: un marcador único y fijo por número
// (diseño original) no dejaba ningún id libre para volver a guardar la
// acta después de anularla y corregirla (ej. error de DNI). Cada intento
// es su propio marcador inmutable en su propia colección (fichasUsadas,
// lectura GLOBAL a propósito -- ver firestore.rules).
// data.pacienteFicha/fichaIntentoNro llegan YA resueltos desde el
// llamador (TabPacientes.jsx via resolverFichaIntento, o
// administrarLoteDosisUnicaTransaction en mibgLotes.js), nunca se
// recalculan acá para no tener dos fuentes de verdad sobre qué id
// corresponde.
const CAP_FICHA_INTENTOS = 5;
export const fichaUsadaRef = (pacienteFicha, fichaIntentoNro) => doc(fichasUsadasCol, `${pacienteFicha}_${fichaIntentoNro}`);
// Marcador SIN sufijo _n -- sólo existe por compatibilidad con fichas
// creadas antes de este esquema (tanda anterior). Nunca se escribe de
// nuevo, sólo se lee para el chequeo de "está usado" (ver
// resolverFichaIntento) -- no hay desbloqueo automático para éstos,
// decisión explícita (ver nota larga en firestore.rules).
export const fichaUsadaBareRef = (pacienteFicha) => doc(fichasUsadasCol, pacienteFicha);
// Anulación de un intento de ficha -- vive en `actas` (mismo namespace
// `anula_...` de siempre), NO dentro de fichasUsadas: reusa la rama
// genérica 'anulacion' de actaValida() sin necesitar ninguna regla nueva.
// Ver anularActaTransaction más abajo, que la crea en la MISMA
// transacción que la anulación de la acta cuando corresponde.
export const anulaFichaRef = (pacienteFicha, fichaIntentoNro) => doc(actasCol, `anula_ficha_${pacienteFicha}_${fichaIntentoNro}`);

export function datosFichaUsada(data, tipo, actaId) {
  return {
    pacienteFicha: data.pacienteFicha, pacienteFichaNum: parseInt(data.pacienteFicha, 10),
    fichaIntentoNro: data.fichaIntentoNro,
    pacienteNombre: data.pacienteNombre, sedeId: data.sedeId, actaId, tipo,
    fecha: serverTimestamp(),
  };
}

// Pre-chequeo amigable del lado cliente (aviso inmediato antes de intentar
// guardar, TabPacientes.jsx#chequearFicha) -- resuelve el PRIMER intento
// libre (1..5) para este número, igual que hace
// administrarLoteDosisUnicaTransaction en mibgLotes.js pero con getDoc
// suelto en vez de tx.get (no hay ninguna transacción abierta acá: los
// tipos que usan esto -- paciente/tc99m, los 6 de I-131 salvo MIBG -- son
// altas simples offline-safe, sin lectura previa real; esto es sólo para
// UX, la garantía real sigue siendo el choque server-side). La garantía
// real es la regla de Firestore, no esto -- si el estado cambió entre el
// chequeo y el guardado (carrera rara), el batch de guardado falla solo y
// se ve un error genérico, mismo riesgo residual que el resto del sistema.
//
// Devuelve { intento } si hay uno libre, o { bloqueadaPor } con los datos
// de quién lo tiene activo, o { agotado: true } si los 5 intentos están
// ocupados y activos.
export async function resolverFichaIntento(pacienteFicha) {
  const bareSnap = await getDoc(fichaUsadaBareRef(pacienteFicha));
  if (bareSnap.exists()) return { bloqueadaPor: bareSnap.data() };
  for (let n = 1; n <= CAP_FICHA_INTENTOS; n++) {
    const snap = await getDoc(fichaUsadaRef(pacienteFicha, String(n)));
    if (!snap.exists()) return { intento: String(n) };
    const anulaSnap = await getDoc(anulaFichaRef(pacienteFicha, String(n)));
    if (!anulaSnap.exists()) return { bloqueadaPor: snap.data() };
  }
  return { agotado: true };
}

// Sugerencia de placeholder (punto 1) -- NUNCA se envía sola, es sólo una
// referencia visual. Una única query indexada (orderBy de un solo campo,
// sin índice compuesto) en vez de mantener un contador mutable -- ver nota
// larga en firestore.rules sobre por qué se descartó un doc contador.
export function listenUltimaFicha(callback) {
  const q = query(fichasUsadasCol, orderBy("pacienteFichaNum", "desc"), limit(1));
  return onSnapshot(q, (snap) => callback(snap.empty ? null : snap.docs[0].data().pacienteFichaNum));
}

// Crea la acta Y el marcador de ficha usada en el MISMO batch -- si el
// marcador choca (ficha ya usada por otra acta en ese mismo intento), el
// batch entero se rechaza, así que la acta tampoco se crea. Sigue siendo
// offline-safe (un solo batch, sin lectura previa) -- data.fichaIntentoNro
// ya viene resuelto por el llamador (ver resolverFichaIntento arriba).
function crearActaConFicha(tipo, data) {
  const batch = writeBatch(db);
  const actaRef = doc(actasCol);
  batch.set(actaRef, { ...data, tipo, fecha: serverTimestamp() });
  batch.set(fichaUsadaRef(data.pacienteFicha, data.fichaIntentoNro), datosFichaUsada(data, tipo, actaRef.id));
  return batch.commit();
}

export function addActaPaciente(data) {
  return crearActaConFicha("paciente", data);
}

export function addActaMarcacion(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "marcacion", fecha: serverTimestamp() });
  return batch.commit();
}

// Gestión I-131: 6 tipos planos (mismo criterio que transferencia_salida/
// transferencia_entrada en movimientos, no un campo "subtipo") -- cada uno
// tiene su propio requisito de campos y de permiso en actaValida(). Dosis
// ablativa/terapéutica y los 3 diagnósticos (Captación/Centellograma/
// Captación y Centellograma) exigen accesoTerapiaI131 (o admin) del lado
// servidor; Barrido corporal no.
function addActaI131(tipo, data) {
  return crearActaConFicha(tipo, data);
}

// unidadActividad la fija el llamador según el tipo (nunca a elección del
// técnico) -- ver nota en TabPacientes.jsx#guardar. La regla de Firestore
// valida que coincida con lo esperado para cada tipo, no confía en el valor
// que mande el cliente.
export const addActaI131Ablativa = (data) => addActaI131("i131_ablativa", data);
export const addActaI131Dosis = (data) => addActaI131("i131_dosis", data);
export const addActaI131Barrido = (data) => addActaI131("i131_barrido", data);
export const addActaI131Captacion = (data) => addActaI131("i131_captacion", data);
export const addActaI131Centellograma = (data) => addActaI131("i131_centellograma", data);
export const addActaI131CaptacionCentellograma = (data) => addActaI131("i131_captacion_centellograma", data);

// Stock de viales I-131 (espacio de cálculo, Parte A) -- mismo writeBatch
// simple, sin lectura previa. "vial" es create-only igual que todo lo demás
// (corrección de un error de carga = anular + volver a cargar, mismo patrón
// que el resto de las actas). "extraccion" no bloquea por transacción contra
// otra extracción concurrente del mismo vial -- decisión explícita, ver nota
// en TabStockViales.jsx: es un acto manual/supervisado, no un depósito
// compartido de alta concurrencia. Su desglosePorVial queda congelado con los
// valores calculados en el momento de guardar, para que una consulta futura
// nunca recalcule (y por lo tanto nunca cambie) el número ya mostrado/usado.
//
// NO pasan por addActaI131()/crearActaConFicha (bug real, visto al probar
// "Nuevo vial de I-131"): un vial y una extracción no son registros de
// paciente, nunca tienen pacienteFicha/fichaIntentoNro -- crearActaConFicha
// intentaba igual escribir un marcador en fichasUsadas con esos campos
// undefined, y el SDK cliente de Firestore rechaza cualquier set() con un
// campo undefined antes de llegar al server. Mismo patrón simple que
// addActaMarcacion: un único set() del acta, sin marcador de ficha.
export function addActaI131Vial(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "i131_vial", fecha: serverTimestamp() });
  return batch.commit();
}

export function addActaI131Extraccion(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "i131_extraccion", fecha: serverTimestamp() });
  return batch.commit();
}

// Resultado de %Captación (espacio de cálculo, Parte B) -- vinculado por
// dosisActaId al registro original de Captación/Centellograma/Captación y
// Centellograma (mismo patrón que dosisActaId ya usa para vincular un
// Barrido/diagnóstico a la dosis que lo motivó). porcentajeCaptacion se
// calcula y congela en el cliente al guardar -- a diferencia del
// decaimiento, esta fórmula no depende de cuándo se consulta, así que no
// hay riesgo de que "cambie"; se guarda igual para no recalcular en cada
// render y para que el CSV lo tenga directo.
//
// Id determinístico `captacion_${dosisActaId}_${momento}` (Parte C, control
// de secuencia hora/24h/48h) -- mismo truco que anula_${id}/generadoresVistos:
// si alguien intenta cargar el mismo momento dos veces para el mismo caso,
// el segundo intento choca con un doc inmutable ya existente y las reglas lo
// rechazan solas (allow update: false), sin necesitar lógica de dedup aparte.
const resultadoCaptacionRef = (dosisActaId, momento) => doc(actasCol, `captacion_${dosisActaId}_${momento}`);

export function addActaI131CaptacionResultado(data) {
  return setDoc(resultadoCaptacionRef(data.dosisActaId, data.momento), { ...data, tipo: "i131_captacion_resultado", fecha: serverTimestamp() });
}

// "Finalizar seguimiento" (Parte C): evento nuevo e inmutable, nunca una
// edición del resultado 48h -- el nombre describe exactamente lo que hace,
// bloquea cargar más resultados de %Captación para ESTE dosisActaId
// puntual (no cierra nada más amplio del paciente). Id determinístico
// `fin_${dosisActaId}` -- la regla de i131_captacion_resultado usa
// exists() contra este mismo path para rechazar altas nuevas una vez
// finalizado, mismo mecanismo que loteGeneradorVisto en Elución.
const seguimientoFinRef = (dosisActaId) => doc(actasCol, `fin_${dosisActaId}`);

export function addActaI131SeguimientoFin(data) {
  return setDoc(seguimientoFinRef(data.dosisActaId), { ...data, tipo: "i131_seguimiento_fin", fecha: serverTimestamp() });
}

// Libro 3 (Elución Mo-99/Tc-99m). getDoc directo por id determinístico
// (sedeId_loteGenerador), no una query -- funciona aunque el lote tenga
// meses de historial, no depende de estar dentro de los últimos PAGINA
// registros. Lo usa el formulario para decidir si pedir actividadCalibrada;
// la regla de Firestore hace el mismo chequeo del lado servidor
// (loteGeneradorVisto en firestore.rules), así que esto es sólo para la UI.
export async function loteGeneradorYaRegistrado(sedeId, loteGenerador) {
  const snap = await getDoc(generadorRef(sedeId, loteGenerador));
  return snap.exists();
}

// Mismo writeBatch simple que marcación/paciente (sin lectura previa,
// offline-safe). Si es la primera elución de este lote/serie en la sede, el
// mismo batch crea el marcador -- la regla exige actividadCalibrada
// exactamente cuando ese marcador todavía no existe, así que hay que
// crearlo en el mismo batch que la propia acta, no después. El marcador
// también lleva su PROPIA actividadCalibrada (denormalizada de la acta) --
// mitigación de la auditoría (hallazgo #5): sin backend no se puede exigir
// "este write ocurre en el mismo batch que una elución válida", así que en
// cambio se sube el costo de pre-crear un marcador falso vía SDK directo
// (además del id exacto, ahora hace falta un número > 0 plausible).
export function addActaElucion(data, esPrimeraVez) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "elucion", fecha: serverTimestamp() });
  if (esPrimeraVez) {
    batch.set(generadorRef(data.sedeId, data.loteGenerador), {
      sedeId: data.sedeId, loteGenerador: data.loteGenerador, primeraFecha: serverTimestamp(), usuarioEmail: data.usuarioEmail,
      actividadCalibrada: data.actividadCalibrada,
    });
  }
  return batch.commit();
}

// Anulaciones de actas: mismo espíritu que movimientos (requisito 8,
// inmutabilidad) -- actas sigue create-only, nunca se edita ni se borra la
// original. Anular crea un acta nueva, tipo "anulacion", vinculada por
// anulaId con id determinístico (`anula_${actaId}`): si dos admins anulan la
// misma acta casi al mismo tiempo, la transacción rechaza al segundo intento
// en vez de pisar el motivo del primero. No hace falta el mismo mecanismo de
// operacionId que egreso/transferencia -- acá el id de la propia acta ya es
// una clave estable, no generada por el cliente en cada click.
// Si la acta que se anula tiene pacienteFicha/fichaIntentoNro (los 5 tipos
// que pasan por crearActaConFicha/administrarLoteDosisUnicaTransaction),
// en la MISMA transacción se anula también ESE intento de ficha
// (actas/anula_ficha_${numero}_${intento}, ver fichaAnulada en
// firestore.rules) -- así el siguiente intento queda libre para corregir
// (ej. error de DNI), mismo mecanismo que ya libera un lote de MIBG/
// Lutecio-177 al anular su acta de uso. Genérica: los tipos SIN ficha
// (marcación, elución, lotes, movimientos) no llevan estos campos, así
// que acá no pasa nada extra para ellos.
export function anularActaTransaction(acta, motivo, usuario) {
  const anulacionRef = doc(actasCol, `anula_${acta.id}`);
  const fichaAnulaRef = acta.pacienteFicha && acta.fichaIntentoNro
    ? anulaFichaRef(acta.pacienteFicha, acta.fichaIntentoNro)
    : null;
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const yaAnuladaSnap = await tx.get(anulacionRef);
      if (yaAnuladaSnap.exists()) throw new Error("Esta acta ya fue anulada.");
      tx.set(anulacionRef, {
        tipo: "anulacion", anulaId: acta.id, sedeId: acta.sedeId,
        fecha: serverTimestamp(), motivo,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      if (fichaAnulaRef) {
        tx.set(fichaAnulaRef, {
          tipo: "anulacion", anulaId: `ficha_${acta.pacienteFicha}_${acta.fichaIntentoNro}`, sedeId: acta.sedeId,
          fecha: serverTimestamp(), motivo,
          usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
        });
      }
    })
  );
}

// Listener chico y compartido (Libro 1 y Libro 2) sólo para saber qué actas
// están anuladas -- no se mezcla con listenActas porque ese filtra por
// tipo "paciente"/"marcacion" y las anulaciones son su propio tipo. Sin
// límite ni orderBy: son poco frecuentes (correcciones, no carga normal), y
// a diferencia del listener paginado de movimientos, una anulación vieja
// nunca deja de reflejarse por haber quedado fuera de una página.
export function listenAnulacionesActas(callback, { esAdmin, sedeId } = {}) {
  const clausulas = [where("tipo", "==", "anulacion")];
  if (!esAdmin) clausulas.push(where("sedeId", "==", sedeId));
  return onSnapshot(query(actasCol, ...clausulas), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
