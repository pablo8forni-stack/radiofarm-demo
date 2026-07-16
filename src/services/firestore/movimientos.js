import {
  collection,
  doc,
  getDoc,
  getDocs,
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

// Anula un movimiento revirtiendo su efecto sobre el stock.
//
// tx.get() sobre una Query rompe con un error interno del SDK cliente de
// Firebase ("Cannot read properties of undefined (reading 'path')"), tanto
// en Node como en el browser real (ver misma nota en transferenciaTransaction
// de stock.js). Por eso:
//   - la comprobación de "no anulado todavía" usa un docId determinístico
//     (`anula_${mov.id}`) en vez de una query por el campo anulaId -- así el
//     chequeo es un tx.get(docRef) simple y sigue protegiendo contra dos
//     anulaciones simultáneas: si ambas transacciones leen ese doc como
//     inexistente y una gana la carrera, Firestore reintenta la otra sola al
//     detectar que el doc leído cambió, y en el reintento sí lo va a ver.
//   - la búsqueda del lote por número (cuando no hay loteId o no se encuentra)
//     se resuelve ANTES de abrir la transacción, y adentro se relee ese docId
//     conocido con tx.get(docRef).
export function anularMovimientoTransaction(mov, observacion, usuario, motivoLabel) {
  if (mov.tipo === "transferencia_salida" || mov.tipo === "transferencia_entrada") {
    throw new Error("Esta es una transferencia: usá 'Anular transferencia' para anular ambas puntas juntas.");
  }
  const sid = mov.sedeId, fid = mov.farmId;
  const anulacionRef = doc(movimientosCol, `anula_${mov.id}`);

  return conMensajeDeContingencia(async () => {
    let loteRef = mov.loteId ? doc(db, "sedes", sid, "lotes", mov.loteId) : null;
    if (loteRef) {
      const snap = await getDoc(loteRef);
      if (!snap.exists()) loteRef = null;
    }
    if (!loteRef) {
      // Lote no encontrado por id (p. ej. se creó en otra sede en una transferencia
      // vieja) -> buscar por número de lote, igual que la demo original.
      const porLote = await getDocs(query(collection(db, "sedes", sid, "lotes"), where("lote", "==", mov.lote), where("farmId", "==", fid)));
      loteRef = porLote.empty ? null : porLote.docs[0].ref;
    }

    return runTransaction(db, async (tx) => {
      const yaAnuladoSnap = await tx.get(anulacionRef);
      if (yaAnuladoSnap.exists()) throw new Error("Este movimiento ya fue anulado.");

      const esEntrada = mov.tipo === "ingreso" || mov.tipo === "transferencia_entrada";
      const loteSnap = loteRef ? await tx.get(loteRef) : null;
      const loteData = loteSnap?.exists() ? loteSnap.data() : null;

      if (loteData) {
        const delta = esEntrada ? -mov.cantidad : mov.cantidad;
        tx.update(loteRef, { cantidad: Math.max(0, loteData.cantidad + delta) });
      } else if (!esEntrada) {
        // Egreso a anular cuyo lote ya no existe: recrearlo con la cantidad devuelta.
        tx.set(doc(collection(db, "sedes", sid, "lotes")), {
          farmId: fid, lote: mov.lote, vencimiento: "", cantidad: mov.cantidad, proveedorNombre: "", creadoEn: serverTimestamp(),
        });
      }

      tx.set(anulacionRef, {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: mov.id,
        sedeId: sid, sedeNombre: mov.sedeNombre, farmId: fid, farmNombre: mov.farmNombre,
        cantidad: mov.cantidad, lote: mov.lote,
        motivo: motivoLabel || `Anula movimiento ${mov.id}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    });
  });
}

// Anula una transferencia completa (ambas puntas) en una sola transacción.
// Recibe cualquiera de los dos movimientos vinculados (salida o entrada) y
// busca el par por grupoId -- así no depende de qué sede esté filtrada en el
// Historial ni de cuál de las dos filas se haya clickeado. Revierte el stock
// de origen y destino juntos, y crea los dos movimientos de anulación (uno
// por cada punta) o ninguno.
//
// Mismo problema que anularMovimientoTransaction con tx.get(query): acá hay
// tres búsquedas por campo (el par por grupoId, y el lote de cada punta por
// número) que se resuelven ANTES de abrir la transacción, y el chequeo de
// "ya anulada" usa los mismos docId determinísticos `anula_${id}` que usa
// anularMovimientoTransaction, así que también queda como tx.get(docRef)
// simple. La transacción relee todo por docId conocido adentro, así que
// sigue reintentando sola si algo cambió entre la búsqueda y el commit.
export function anularTransferenciaTransaction(mov, observacion, usuario, motivoLabel) {
  return conMensajeDeContingencia(async () => {
    const parSnap = await getDocs(query(movimientosCol, where("grupoId", "==", mov.grupoId)));
    const par = parSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const movSalida = par.find((m) => m.tipo === "transferencia_salida");
    const movEntrada = par.find((m) => m.tipo === "transferencia_entrada");
    if (!movSalida || !movEntrada) throw new Error("No se encontró el par completo de esta transferencia.");

    const anulaSalidaRef = doc(movimientosCol, `anula_${movSalida.id}`);
    const anulaEntradaRef = doc(movimientosCol, `anula_${movEntrada.id}`);

    async function buscarLoteRef(m) {
      const porLote = await getDocs(query(collection(db, "sedes", m.sedeId, "lotes"), where("lote", "==", m.lote), where("farmId", "==", m.farmId)));
      return porLote.empty ? null : porLote.docs[0].ref;
    }
    const origenLoteRef = await buscarLoteRef(movSalida);
    const destinoLoteRef = await buscarLoteRef(movEntrada);

    return runTransaction(db, async (tx) => {
      const [yaSalida, yaEntrada] = await Promise.all([tx.get(anulaSalidaRef), tx.get(anulaEntradaRef)]);
      if (yaSalida.exists() || yaEntrada.exists()) throw new Error("Esta transferencia ya fue anulada.");

      const destinoSnap = destinoLoteRef ? await tx.get(destinoLoteRef) : null;
      // El destino sí tiene que existir y tener stock suficiente: si no,
      // revertir a ciegas dejaría cantidades negativas o crearía stock de la
      // nada -- se corta la anulación entera en vez de hacerla a medias.
      if (!destinoSnap?.exists()) throw new Error("El lote de destino ya no existe; no se puede revertir automáticamente.");
      const cantidadDestino = destinoSnap.data().cantidad - movEntrada.cantidad;
      if (cantidadDestino < 0) throw new Error("El lote de destino ya no tiene suficiente stock para revertir la transferencia.");

      // Firestore exige que todas las lecturas de la transacción pasen ANTES
      // que cualquier escritura -- por eso este get() va acá, antes del primer
      // tx.update(), y no más abajo junto al resto de la lógica de origen.
      const origenSnap = origenLoteRef ? await tx.get(origenLoteRef) : null;

      tx.update(destinoLoteRef, { cantidad: cantidadDestino });
      if (origenSnap?.exists()) {
        tx.update(origenLoteRef, { cantidad: origenSnap.data().cantidad + movSalida.cantidad });
      } else {
        tx.set(doc(collection(db, "sedes", movSalida.sedeId, "lotes")), {
          farmId: movSalida.farmId, lote: movSalida.lote, vencimiento: "", cantidad: movSalida.cantidad, proveedorNombre: "", creadoEn: serverTimestamp(),
        });
      }

      tx.set(anulaSalidaRef, {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: movSalida.id,
        sedeId: movSalida.sedeId, sedeNombre: movSalida.sedeNombre, farmId: movSalida.farmId, farmNombre: movSalida.farmNombre,
        cantidad: movSalida.cantidad, lote: movSalida.lote,
        motivo: motivoLabel || `Anula transferencia ${mov.grupoId}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      tx.set(anulaEntradaRef, {
        fecha: serverTimestamp(), tipo: "anulacion", anulaId: movEntrada.id,
        sedeId: movEntrada.sedeId, sedeNombre: movEntrada.sedeNombre, farmId: movEntrada.farmId, farmNombre: movEntrada.farmNombre,
        cantidad: movEntrada.cantidad, lote: movEntrada.lote,
        motivo: motivoLabel || `Anula transferencia ${mov.grupoId}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    });
  });
}
