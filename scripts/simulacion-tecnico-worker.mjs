// Worker de UN técnico para scripts/simulacion-dia-uso.mjs -- corre en su
// PROPIO proceso de Node a propósito: cada proceso tiene su propio module
// cache, así que importar fixtures.mjs (que a su vez importa
// src/firebase.js) acá crea una instancia de Firestore/Auth genuinamente
// independiente por técnico -- la única forma de tener 10 sesiones
// concurrentes reales sin tocar services/firestore/*.js (que están
// cableados al singleton db por diseño, correcto para una sesión por
// browser real, pero eso mismo impide compartir un solo proceso entre
// 10 identidades distintas en simultáneo). Usa exclusivamente las
// funciones reales de services/firestore/*.js, igual que la app -- nunca
// addDoc/setDoc crudo.
import {
  SEDE_A, FARM_ID, PERSONAS, loguearComo, cerrarConexiones, fichaDePrueba,
} from "./testing/fixtures.mjs";
import {
  addActaPaciente, addActaElucion, loteGeneradorYaRegistrado, resolverFichaIntento,
  listenActas, listenAnulacionesActas, listenUltimaFicha,
} from "../src/services/firestore/actas.js";
import {
  addMibgLote, administrarMibgTransaction, administrarLutecioTransaction, listenMibgLotes,
} from "../src/services/firestore/mibgLotes.js";

const tarea = JSON.parse(process.argv[2]);
const { index, email, nombre, nPacientes, hacerElucion, hacerMibg, hacerLutecio } = tarea;
const persona = { email, nombre, rol: "tecnico", sede: SEDE_A };
const SEDE_NOMBRE = "FUESMEN Central";

const contador = { escrituras: 0, erroresEscritura: 0 };

async function main() {
  await loguearComo(persona);

  // Mismo set de 11 onSnapshot que abre TabPacientes.jsx (Libro 2) al
  // montar -- 7 tipos de acta I-131 + anulaciones + lotes MIBG/Lutecio +
  // última ficha (sugerencia). Quedan abiertos toda la corrida para
  // capturar el costo real de lecturas incrementales de CADA escritura
  // de CUALQUIER técnico (no sólo el snapshot inicial ni las propias).
  const tiposActa = [
    "paciente", "i131_ablativa", "i131_dosis", "i131_barrido",
    "i131_mibg", "i131_captacion", "i131_centellograma", "i131_captacion_centellograma",
  ];
  const unsubs = [
    ...tiposActa.map((t) => listenActas(t, () => {}, { esAdmin: false, sedeId: SEDE_A })),
    listenAnulacionesActas(() => {}, { esAdmin: false, sedeId: SEDE_A }),
    listenMibgLotes(() => {}, { esAdmin: false, sedeId: SEDE_A }),
    listenUltimaFicha(SEDE_A, () => {}),
  ];

  if (hacerElucion) {
    // Mismas 4 eluciones del mismo lote/serie -- sólo la primera crea el
    // marcador generadoresVistos, mismo flujo real de TabElucion.jsx
    // (loteGeneradorYaRegistrado antes de decidir esPrimeraVez).
    const loteGenerador = `SIM-GEN-${Date.now()}`;
    for (let i = 0; i < 4; i++) {
      const yaRegistrado = await loteGeneradorYaRegistrado(SEDE_A, loteGenerador);
      const datos = {
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE, loteGenerador,
        actividadEluida: 900 + i * 10, volumen: 5,
        usuarioNombre: nombre, usuarioEmail: email, observacion: "Simulación de día de uso",
      };
      if (!yaRegistrado) datos.actividadCalibrada = 20000;
      try {
        await addActaElucion(datos, !yaRegistrado);
        contador.escrituras += yaRegistrado ? 1 : 2;
      } catch (e) { contador.erroresEscritura++; console.error(`[${nombre}] elución ${i + 1} falló:`, e.message); }
    }
  }

  if (hacerMibg) {
    const numeroLote = `SIM-MIBG-${Date.now()}`;
    try {
      const loteRef = await addMibgLote({
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE, isotopoId: "mibg",
        numeroLote, proveedor: "Proveedor Simulado",
        actividadCalibrada: 20, volumen: 2, fechaHoraCalibracion: new Date(),
        fechaVencimiento: "2027-06-01", conformidad: true,
        usuarioNombre: nombre, usuarioEmail: email, observacion: "Simulación de día de uso",
      });
      contador.escrituras += 1;
      // Bug real encontrado hoy (no de este script): administrarLoteDosisUnicaTransaction
      // lee actas/anula_{loteId} ANTES de que exista (primera administración
      // de un lote nuevo) -- resource==null ahí + regla de actas sin
      // isAdmin() de por medio = permission-denied para cualquier técnico
      // no-admin. Hoy sólo funciona logueado como admin ("Responsable").
      // Se deja documentado -- no se corrige acá, es un cambio de reglas
      // aparte. Se vuelve a loguear como el técnico apenas termina, para
      // que sus pacientes de abajo sigan quedando a SU nombre real.
      await loguearComo(PERSONAS.admin);
      await administrarMibgTransaction(loteRef.id, {
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE,
        pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Simulado MIBG", pacienteDni: `SIMDNI${index}M`,
        numeroLote, actividadCalibrada: 20, volumen: 2, actividadAdministrada: 18,
        usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "Simulación de día de uso",
      });
      await loguearComo(persona);
      contador.escrituras += 2;
    } catch (e) { contador.erroresEscritura++; console.error(`[${nombre}] MIBG falló:`, e.message); }
  }

  if (hacerLutecio) {
    const numeroLote = `SIM-LU-${Date.now()}`;
    try {
      const loteRef = await addMibgLote({
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE, isotopoId: "lutecio177",
        numeroLote, proveedor: "Proveedor Simulado",
        actividadCalibrada: 150, volumen: 10, fechaHoraCalibracion: new Date(),
        fechaVencimiento: "2027-06-01", conformidad: true,
        usuarioNombre: nombre, usuarioEmail: email, observacion: "Simulación de día de uso",
      });
      contador.escrituras += 1;
      // Mismo bug que MIBG (ver comentario arriba) -- administrarLutecioTransaction
      // comparte administrarLoteDosisUnicaTransaction, mismo tx.get roto
      // para no-admin. Se deja documentado, no se corrige acá.
      await loguearComo(PERSONAS.admin);
      await administrarLutecioTransaction(loteRef.id, {
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE,
        pacienteFicha: fichaDePrueba(), pacienteNombre: "Paciente Simulado Lutecio", pacienteDni: `SIMDNI${index}L`,
        peso: 70, talla: 170, mciAdministrados: 140, actividadCalibrada: 150,
        isotopoId: "lu177", lote: numeroLote, medicoResponsable: "Dr. Simulado",
        usuarioNombre: PERSONAS.admin.nombre, usuarioEmail: PERSONAS.admin.email, observacion: "Simulación de día de uso",
      });
      await loguearComo(persona);
      contador.escrituras += 2;
    } catch (e) { contador.erroresEscritura++; console.error(`[${nombre}] Lutecio falló:`, e.message); }
  }

  for (let i = 0; i < nPacientes; i++) {
    const ficha = fichaDePrueba();
    try {
      const r = await resolverFichaIntento(SEDE_A, ficha);
      if (!r.intento) throw new Error("ficha recién generada sin intento libre (inesperado)");
      await addActaPaciente({
        sedeId: SEDE_A, sedeNombre: SEDE_NOMBRE,
        pacienteFicha: ficha, fichaIntentoNro: r.intento,
        pacienteNombre: `Paciente Simulado ${index}-${i + 1}`, pacienteDni: `SIMDNI${index}${i}`,
        peso: 70, talla: 170, estudio: "Centellograma óseo", mciAdministrados: 20,
        isotopoId: "tc99m", lote: `SIM-LOTE-${index}`, farmId: FARM_ID, farmNombre: "MIBI (Sestamibi)",
        usuarioNombre: nombre, usuarioEmail: email, observacion: "Simulación de día de uso",
      });
      contador.escrituras += 2;
    } catch (e) { contador.erroresEscritura++; console.error(`[${nombre}] paciente ${i + 1} falló:`, e.message); }
  }

  // Deja los listeners abiertos un rato más -- si cerráramos apenas
  // terminamos de escribir, nos perderíamos justo el efecto multiplicativo
  // que se quiere medir (las actualizaciones incrementales que le llegan a
  // ESTE técnico por las escrituras de los OTROS 9, que siguen en curso).
  await new Promise((r) => setTimeout(r, 30000));
  unsubs.forEach((u) => u());
  await cerrarConexiones();

  process.send?.({ index, nombre, ...contador });
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`[worker ${index}] error fatal:`, e);
  process.send?.({ index, nombre, escrituras: contador.escrituras, erroresEscritura: contador.erroresEscritura + 1, fatal: e.message });
  process.exit(1);
});
