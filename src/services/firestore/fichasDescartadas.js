import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { anularActaTransaction } from "./actas.js";

const fichasUsadasCol = collection(db, "fichasUsadas");
const fichasDescartadasCol = collection(db, "fichasDescartadas");

// Cartel de fichas faltantes (Libro 2) -- el cálculo (src/helpers/huecosFicha.js)
// sólo reclama un hueco mientras la ficha activa inmediatamente superior
// tenga menos de 48hs, así que no hace falta más que eso de margen acá:
// ~25 fichas/día medido en producción real (central, única sede activa) ×
// 2 días (48hs) ≈ 50, con margen ~2.4x para intentos múltiples (reintentos
// tras una anulación) -- mismo orden de magnitud que el limit(150) que ya
// usa cada uno de los 9 listeners de tipo de acta en TabPacientes.jsx.
// Exportado: scripts/testing/reglas.test.mjs lo reusa para probar contra
// staging real que una ficha con dígitos de menos (número bajo) cae fuera
// de esta ventana -- brecha aceptada y documentada (ver diagnóstico
// 6/10), cubierta en origen por el aviso al tipear (TabPacientes.jsx).
export const LIMITE_FICHAS_USADAS = 120;
const LIMITE_DESCARTES = 100;

export function listenFichasUsadasRecientes(sedeId, callback) {
  const q = query(fichasUsadasCol, where("sedeId", "==", sedeId), orderBy("pacienteFichaNum", "desc"), limit(LIMITE_FICHAS_USADAS));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Colección nueva y rara (excepcional, creada a mano por un admin) -- sin
// orderBy/límite ajustado, un límite grande alcanza de sobra.
export function listenFichasDescartadas(sedeId, callback) {
  const q = query(fichasDescartadasCol, where("sedeId", "==", sedeId), limit(LIMITE_DESCARTES));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

const descarteRef = (sedeId, numero, intentoNro) => doc(fichasDescartadasCol, `${sedeId}_${numero}_${intentoNro}`);

// Mismo esquema de intento secuencial (1..5) que ya usan fichasUsadas/MIBG/
// Lutecio-177 -- necesario para que un descarte deshecho por error se pueda
// volver a descartar después (si no, el id determinístico del primer
// intento, create-only, quedaría bloqueado para siempre). getDoc suelto
// (sin transacción): el peor caso es una colisión rarísima entre dos
// admins descartando la MISMA ficha en el mismo instante, que
// firestore.rules rechaza solo (create-only sobre un id ya existente).
async function resolverIntentoDescarte(sedeId, numero) {
  for (let n = 1; n <= 5; n++) {
    const snap = await getDoc(descarteRef(sedeId, numero, String(n)));
    if (!snap.exists()) return String(n);
  }
  throw new Error("Esta ficha ya tuvo demasiados descartes/deshechos -- contactá a soporte.");
}

// numero SIEMPRE string (igual que pacienteFicha en fichasUsadas, nunca el
// number crudo) -- así el id determinístico y fichaValida() del lado
// servidor reusan la misma validación ya probada, sin concatenar string+number
// en las reglas (Firestore Rules no coacciona tipos en +).
export async function descartarFicha({ sedeId, numero, motivo, usuario }) {
  const numeroStr = String(numero);
  const intentoNro = await resolverIntentoDescarte(sedeId, numeroStr);
  await setDoc(descarteRef(sedeId, numeroStr, intentoNro), {
    sedeId, numero: numeroStr, intentoNro, motivo,
    usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, fecha: serverTimestamp(),
  });
}

// Reutiliza 100% anularActaTransaction (actas.js) -- mismo mecanismo
// probado que ya usa el resto del sistema (anula_${id}), sin código nuevo
// para el undo. El pseudo-objeto NO lleva pacienteFicha/fichaIntentoNro a
// propósito: así anularActaTransaction no intenta además liberar un
// intento de FICHA real (acá no hay ninguno -- fichasDescartadas nunca
// tocó fichasUsadas). Confirmado en firestore.rules: la rama 'anulacion'
// no exige que anulaId corresponda a una acta existente, así que un
// anulaId "descarte_..." (que nunca es el id de ninguna acta real) se
// acepta sin problema.
export function deshacerDescarte(descarte, motivo, usuario) {
  const pseudoActa = { id: `descarte_${descarte.sedeId}_${descarte.numero}_${descarte.intentoNro}`, sedeId: descarte.sedeId };
  return anularActaTransaction(pseudoActa, motivo, usuario);
}
