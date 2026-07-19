import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase.js";
import { conMensajeDeContingencia } from "../../helpers/erroresRed.js";

const lotesRef = (sedeId, loteId) => doc(db, "sedes", sedeId, "lotes", loteId);
const movimientosCol = collection(db, "movimientos");

// Un solo listener de app entera sobre todos los lotes de todas las sedes,
// reagrupado a la forma {sedeId:{farmId:[lotes]}} — igual que el `estado.stock`
// de la demo, para no tener que reescribir las tablas que ya leen esa forma.
export function listenLotes(callback) {
  return onSnapshot(collectionGroup(db, "lotes"), (snap) => {
    const stock = {};
    snap.docs.forEach((d) => {
      const sedeId = d.ref.parent.parent.id;
      const { farmId, ...lote } = d.data();
      stock[sedeId] ??= {};
      stock[sedeId][farmId] ??= [];
      stock[sedeId][farmId].push({ id: d.id, ...lote });
    });
    callback(stock);
  });
}

// Ingreso: siempre crea un lote nuevo (no mergea), no depende de leer nada
// antes -> writeBatch, offline-safe (se encola y sincroniza solo).
export function ingresoBatch({ sedeId, sedeNombre, farm, lote, vencimiento, cantidad, kits, proveedorNombre, observacion, usuario }) {
  const batch = writeBatch(db);
  const nuevoLoteRef = doc(collection(db, "sedes", sedeId, "lotes"));
  batch.set(nuevoLoteRef, { farmId: farm.id, lote, vencimiento, cantidad, proveedorNombre, creadoEn: serverTimestamp() });
  const motivo = kits ? `Recepción (${kits} kit${kits > 1 ? "s" : ""} × ${farm.viales_x_kit} = ${cantidad} viales)` : "Recepción de pedido";
  batch.set(doc(movimientosCol), {
    fecha: serverTimestamp(), tipo: "ingreso", sedeId, sedeNombre,
    farmId: farm.id, farmNombre: farm.nombre, cantidad, lote, loteId: nuevoLoteRef.id,
    motivo, observacion, proveedorNombre, usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
  });
  return batch.commit();
}

// Egreso: requiere leer el stock real del lote antes de descontar -> runTransaction.
//
// operacionId lo genera el llamador (ver ModalEgreso.jsx) una sola vez por
// apertura del modal, no en cada click de "Confirmar" -- así un reintento
// tras un error dudoso (¿se aplicó o no?) reusa el mismo id. Se usa como el
// id determinístico del movimiento: si ya existe, esta llamada es un no-op
// (el efecto ya se aplicó en un intento anterior), en vez de descontar el
// stock una segunda vez. No hace falta un campo nuevo -- el id del propio
// documento ya es la clave de idempotencia.
// La regla de lotes (ver firestore.rules) exige que la `cantidad` nueva que
// escribe un técnico sea ESTRICTAMENTE MENOR que la cantidad ACTUAL del
// documento en el momento del commit -- no la que esta transacción leyó. Con
// dos egresos concurrentes sobre el mismo lote, el que pierde la carrera
// puede terminar calculando el mismo valor (o uno mayor) que el que ya
// escribió el ganador, y la regla lo rechaza con permission-denied en vez de
// dejar que Firestore reintente la transacción con datos frescos (Firestore
// no reintenta solo ante un rechazo de reglas, sólo ante conflictos de
// versión). Reintentar acá mismo (con el mismo operacionId, así sigue siendo
// el mismo intento lógico) resuelve solo: la relectura fresca de tx.get() o
// bien alcanza a descontar, o bien tira "Stock insuficiente" -- el mensaje
// correcto que la regla le impidió llegar a evaluar.
const REINTENTOS_EGRESO = 3;

export function egresoTransaction({ sedeId, sedeNombre, farm, loteId, cantidad, motivo, observacion, usuario, operacionId }) {
  const movimientoRef = doc(movimientosCol, operacionId);
  const intentar = () =>
    runTransaction(db, async (tx) => {
      const yaAplicadoSnap = await tx.get(movimientoRef);
      const loteSnapshot = await tx.get(lotesRef(sedeId, loteId));
      if (yaAplicadoSnap.exists()) return;
      if (!loteSnapshot.exists()) throw new Error("El lote ya no existe.");
      const loteData = loteSnapshot.data();
      if (loteData.cantidad < cantidad) throw new Error("Stock insuficiente para este egreso.");
      tx.update(lotesRef(sedeId, loteId), { cantidad: loteData.cantidad - cantidad });
      tx.set(movimientoRef, {
        fecha: serverTimestamp(), tipo: "egreso", sedeId, sedeNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: loteData.lote, loteId,
        motivo, observacion, usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    });

  return conMensajeDeContingencia(async () => {
    for (let intento = 1; intento <= REINTENTOS_EGRESO; intento++) {
      try {
        return await intentar();
      } catch (e) {
        if (e.code !== "permission-denied" || intento === REINTENTOS_EGRESO) throw e;
      }
    }
  });
}

// Transferencia: lee y escribe lotes de dos sedes distintas en una sola
// transacción (Firestore no limita las transacciones a un solo documento),
// y crea los dos movimientos vinculados por grupoId.
//
// tx.get() sobre una Query (no un DocumentReference) rompe con un error
// interno del SDK cliente de Firebase ("Cannot read properties of undefined
// (reading 'path')"), tanto en Node como en el browser real -- confirmado
// contra staging y en uso real de la app. Por eso la búsqueda del lote
// existente en destino se resuelve ANTES de abrir la transacción (con
// getDocs normal) y adentro sólo se hace tx.get(docRef) sobre el id ya
// conocido. Esto no debilita la protección contra condiciones de carrera:
// si ese documento cambia entre la búsqueda y el commit, Firestore reintenta
// toda la transacción sola porque el doc fue leído con tx.get() adentro.
//
// operacionId (generado en ModalTransferencia.jsx, una vez por apertura del
// modal, reusado entre reintentos) pasa a ser directamente el grupoId que
// vincula las dos puntas, y de ahí se derivan los ids determinísticos de
// ambos movimientos -- mismo mecanismo de idempotencia que egresoTransaction:
// si la punta de salida ya existe, el reintento es un no-op.
export function transferenciaTransaction({ sedeOrigenId, sedeOrigenNombre, sedeDestinoId, sedeDestinoNombre, farm, loteId, cantidad, observacion, usuario, operacionId }) {
  const origenRef = lotesRef(sedeOrigenId, loteId);
  const salidaRef = doc(movimientosCol, `${operacionId}_salida`);
  const entradaRef = doc(movimientosCol, `${operacionId}_entrada`);
  return conMensajeDeContingencia(async () => {
    const origenPrevio = await getDoc(origenRef);
    if (!origenPrevio.exists()) throw new Error("El lote ya no existe.");
    const { lote, vencimiento } = origenPrevio.data();

    const candidatosSnap = await getDocs(
      query(collection(db, "sedes", sedeDestinoId, "lotes"), where("farmId", "==", farm.id), where("lote", "==", lote), where("vencimiento", "==", vencimiento))
    );
    const destinoExistenteRef = candidatosSnap.empty ? null : candidatosSnap.docs[0].ref;

    return runTransaction(db, async (tx) => {
      const yaAplicadoSnap = await tx.get(salidaRef);
      const origenSnapshot = await tx.get(origenRef);
      const existenteSnap = destinoExistenteRef ? await tx.get(destinoExistenteRef) : null;

      if (yaAplicadoSnap.exists()) return;
      if (!origenSnapshot.exists()) throw new Error("El lote ya no existe.");
      const origenData = origenSnapshot.data();
      if (origenData.cantidad < cantidad) throw new Error("Stock insuficiente para transferir.");

      tx.update(origenRef, { cantidad: origenData.cantidad - cantidad });
      if (existenteSnap?.exists()) {
        tx.update(destinoExistenteRef, { cantidad: existenteSnap.data().cantidad + cantidad });
      } else {
        tx.set(doc(collection(db, "sedes", sedeDestinoId, "lotes")), {
          farmId: farm.id, lote: origenData.lote, vencimiento: origenData.vencimiento,
          cantidad, proveedorNombre: origenData.proveedorNombre || "", creadoEn: serverTimestamp(),
        });
      }

      tx.set(salidaRef, {
        fecha: serverTimestamp(), tipo: "transferencia_salida", grupoId: operacionId,
        sedeId: sedeOrigenId, sedeNombre: sedeOrigenNombre, sedeRelacionada: sedeDestinoNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: origenData.lote,
        motivo: `Transferencia a ${sedeDestinoNombre}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      tx.set(entradaRef, {
        fecha: serverTimestamp(), tipo: "transferencia_entrada", grupoId: operacionId,
        sedeId: sedeDestinoId, sedeNombre: sedeDestinoNombre, sedeRelacionada: sedeOrigenNombre,
        farmId: farm.id, farmNombre: farm.nombre, cantidad, lote: origenData.lote,
        motivo: `Transferencia desde ${sedeOrigenNombre}`, observacion,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
    });
  });
}
