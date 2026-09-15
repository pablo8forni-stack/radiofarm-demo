// Diagnóstico de una sola corrida (no es un test, no hace assert) --
// imprime las últimas 5 actas tipo "paciente" (Libro 2, ver addActaPaciente
// en services/firestore/actas.js) de staging, para confirmar a mano si
// fechaRealAtencion quedó guardada bien, sin pelear con la Consola de
// Firebase (miles de actas de prueba acumuladas, filtro lento ahí).
//
// tipo == "paciente" (no sólo sedeId) a propósito: reusa el índice
// compuesto (tipo, sedeId, fecha desc) que YA EXISTE en
// firestore.indexes.json -- una consulta sólo por sedeId+fecha en `actas`
// no tiene índice hoy y tiraría un error de índice faltante. Como sólo
// interesa el caso Tc-99m/genérico (el que se estaba verificando), esto
// alcanza sin arriesgar nada nuevo.
//
// Mismas credenciales/conexión que scripts/testing/*.test.mjs (ver
// fixtures.mjs): inicia sesión como la admin de prueba ya dada de alta en
// staging -- nada nuevo que crear ni pedir.
//
// La regla de lectura de `actas` para admin exige sedeId == sedeAuditando
// (roles/{email}, ver firestore.rules) -- un admin sólo puede leer UNA sede
// a la vez, la que está auditando en ese momento. Como acá interesan las 4
// sedes, se recorren SECUENCIALMENTE (no en paralelo), cambiando
// sedeAuditando antes de cada consulta -- no se puede paralelizar porque
// las 4 comparten el mismo doc de rol.
//
// Uso: npm run staging:ultimas-actas
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { PERSONAS, db, loguearComo, cerrarConexiones } from "./fixtures.mjs";
import { setSedeAuditando } from "../../src/services/auth.js";
import { SEDES } from "../../src/constants/sedes.js";
import { fmtTs } from "../../src/helpers/formato.js";

async function main() {
  await loguearComo(PERSONAS.admin);

  const todas = [];
  for (const s of SEDES) {
    await setSedeAuditando(PERSONAS.admin.email, s.id);
    const snap = await getDocs(query(
      collection(db, "actas"),
      where("tipo", "==", "paciente"),
      where("sedeId", "==", s.id),
      orderBy("fecha", "desc"),
      limit(5),
    ));
    todas.push(...snap.docs.map((d) => d.data()));
  }
  todas.sort((a, b) => (b.fecha?.toMillis() || 0) - (a.fecha?.toMillis() || 0));
  const ultimas5 = todas.slice(0, 5);

  console.log(`\nÚltimas ${ultimas5.length} actas tipo "paciente" (las 4 sedes), por fecha descendente:\n`);
  for (const a of ultimas5) {
    console.log(
      `Ficha ${a.pacienteFicha ?? "?"} | sede: ${a.sedeId ?? "?"} | fecha: ${fmtTs(a.fecha)} | ` +
      `fechaRealAtencion: ${a.fechaRealAtencion ? fmtTs(a.fechaRealAtencion) : "sin fechaRealAtencion"} | lote: ${a.lote ?? "?"}`
    );
  }
  if (ultimas5.length === 0) console.log('(No se encontró ninguna acta tipo "paciente" en ninguna sede.)');
  console.log("");
}

main()
  .then(cerrarConexiones)
  .catch(async (e) => { console.error(e); await cerrarConexiones(); process.exit(1); });
