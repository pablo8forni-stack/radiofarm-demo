import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, limit, query, runTransaction, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const actasCol = collection(db, "actas");
const generadoresCol = collection(db, "generadoresVistos");
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

// Alta simple, sin lectura previa -> offline-safe (se encola sola).
export function addActaPaciente(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "paciente", fecha: serverTimestamp() });
  return batch.commit();
}

export function addActaMarcacion(data) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "marcacion", fecha: serverTimestamp() });
  return batch.commit();
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
// crearlo en el mismo batch que la propia acta, no después.
export function addActaElucion(data, esPrimeraVez) {
  const batch = writeBatch(db);
  batch.set(doc(actasCol), { ...data, tipo: "elucion", fecha: serverTimestamp() });
  if (esPrimeraVez) {
    batch.set(generadorRef(data.sedeId, data.loteGenerador), {
      sedeId: data.sedeId, loteGenerador: data.loteGenerador, primeraFecha: serverTimestamp(), usuarioEmail: data.usuarioEmail,
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
export function anularActaTransaction(acta, motivo, usuario) {
  const anulacionRef = doc(actasCol, `anula_${acta.id}`);
  return conMensajeDeContingencia(() =>
    runTransaction(db, async (tx) => {
      const yaAnuladaSnap = await tx.get(anulacionRef);
      if (yaAnuladaSnap.exists()) throw new Error("Esta acta ya fue anulada.");
      tx.set(anulacionRef, {
        tipo: "anulacion", anulaId: acta.id, sedeId: acta.sedeId,
        fecha: serverTimestamp(), motivo,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
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
