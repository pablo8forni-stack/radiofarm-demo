// Cartel de fichas faltantes (Libro 2) -- función pura, sin Firestore, para
// poder testearla sin levantar ningún listener. Los N° de Ficha de VM RIS
// son correlativos POR SEDE y exclusivos de cámara gamma: un hueco casi
// siempre es un paciente sin cargar, muy rara vez VM RIS saltea un número.
//
// Definición (confirmada con Pablo, 4/10): un hueco se reclama SÓLO mientras
// la ficha activa inmediatamente SUPERIOR a él tenga menos de 48hs de
// antigüedad -- no hay ventana de "hoy/ayer" por calendario, evita los casos
// de borde de medianoche. Un número por encima de la ficha más alta activa
// NUNCA es un hueco (no se detectan "faltantes al final del día").
function aFecha(valor) {
  return valor?.toDate ? valor.toDate() : new Date(valor);
}

const VENTANA_HORAS_DEFAULT = 48;

// Fichas sospechosas (mal tipeadas, Pablo 4-5/10): calibrado con datos
// reales de producción (central, únicа sede activa) -- 60 días, 521 saltos
// entre fichas activas vecinas, p99 = 3, máximo real = 29 (un único caso,
// 2026-09-02, sin resolver). 40 queda con margen (~38%) sobre ese máximo
// real y por debajo de un error de decenas típico (ej. distancia 45).
// LÍMITE CONOCIDO: un error en el dígito de las UNIDADES (ej. 177105
// tipeado 177106) da distancia 1 -- indistinguible de un paciente
// legítimo consecutivo. Este umbral nunca lo va a atrapar, por diseño: no
// hay forma de distinguir "offset de 1" de "el paciente siguiente real"
// sin otra fuente de verdad (no la hay). Sólo errores de magnitud (dígitos
// de más/de menos) o de decenas/centenas son detectables así.
export const UMBRAL_SOSPECHA = 40;

// Tramos de fichas faltantes de más de esto (Pablo, calibrado: el mayor
// hueco real medido en 4 semanas fue de 12 faltantes/salto de 13; con 25
// un error de decenas de distancia 16-25 listaría hasta 24 faltantes
// falsos) colapsan a un aviso agregado ("Hay un salto grande entre las
// fichas X e Y: revisar") en vez de listarse uno por uno.
export const UMBRAL_SALTO_GRANDE = 15;

// Tope de sanidad ABSOLUTO (no el mecanismo operativo -- ese es
// UMBRAL_SALTO_GRANDE, que siempre dispara primero): ningún hueco real
// debería medir más que esto. Bug real encontrado con Playwright contra
// staging: sin este tope, dos números activos con una diferencia
// astronómica (en la práctica, sólo visto con datos de prueba) hacía que
// el for de abajo intentara empujar miles de millones de elementos a un
// array y tirara RangeError: Invalid array length, rompiendo el cartel
// entero. Queda como red de seguridad computacional, nunca debería
// alcanzarse en un escenario real.
const MAX_HUECO_RAZONABLE = 500;

// anulaciones: TODAS las anulaciones de la sede (reusa el listener que
// TabPacientes.jsx ya tiene para los badges "ANULADO", sin costo marginal) --
// se filtran acá adentro por prefijo de anulaId, nunca se le pide al
// llamador que las separe de antemano.
function idsFichaAnulados(anulaciones) {
  return new Set(
    anulaciones
      .map((a) => a.anulaId)
      .filter((id) => typeof id === "string" && id.startsWith("ficha_"))
  );
}

function idsDescarteAnulados(anulaciones) {
  return new Set(
    anulaciones
      .map((a) => a.anulaId)
      .filter((id) => typeof id === "string" && id.startsWith("descarte_"))
  );
}

// fichasUsadas: [{ sedeId, pacienteFicha, pacienteFichaNum, fichaIntentoNro, fecha }]
// -- tal cual vienen de la colección fichasUsadas (ver services/firestore/actas.js).
// Un número está "activo" si tiene AL MENOS un intento sin su anula_ficha_
// correspondiente -- mismo criterio que ya usa fichaIntentoHabilitado en
// firestore.rules, no uno nuevo inventado acá.
function numerosActivos(fichasUsadas, sedeId, idsAnulados) {
  const map = new Map(); // numero -> fecha más reciente entre los intentos activos
  for (const f of fichasUsadas) {
    if (f.sedeId !== sedeId) continue;
    const anulaId = `ficha_${sedeId}_${f.pacienteFicha}_${f.fichaIntentoNro}`;
    if (idsAnulados.has(anulaId)) continue;
    const fecha = aFecha(f.fecha);
    const actual = map.get(f.pacienteFichaNum);
    if (!actual || fecha.getTime() > actual.getTime()) map.set(f.pacienteFichaNum, fecha);
  }
  return map;
}

// fichasDescartadas: [{ sedeId, numero, intentoNro }] -- ver
// services/firestore/fichasDescartadas.js. Un descarte está "vigente" si
// tiene al menos un intento sin su anula_descarte_ correspondiente.
// d.numero llega como string (mismo criterio que pacienteFicha en
// fichasUsadas -- ver fichasDescartadas.js) -- se parsea acá para comparar
// contra los números enteros que arma numerosActivos.
function numerosDescartadosVigentes(fichasDescartadas, sedeId, idsDescarteAnuladosSet) {
  const set = new Set();
  for (const d of fichasDescartadas) {
    if (d.sedeId !== sedeId) continue;
    const anulaId = `descarte_${sedeId}_${d.numero}_${d.intentoNro}`;
    if (idsDescarteAnuladosSet.has(anulaId)) continue;
    set.add(parseInt(d.numero, 10));
  }
  return set;
}

// Núcleo compartido entre el cartel (sospecha "en vivo", ventana de 48hs,
// datos del listener fichasUsadas) y el control previo a la impresión
// mensual (sin ventana de tiempo, sobre las actas YA cargadas en memoria
// para armar el PDF, ver GenerarActasImpresion.jsx) -- "aislada" es la
// misma noción en los dos casos: un número cuya distancia al vecino más
// cercano (en cualquier dirección) supera el umbral. numerosOrdenados: ya
// ordenado ascendente, sin duplicados.
function detectarNumerosAislados(numerosOrdenados, umbral) {
  const aislados = new Set();
  for (let i = 0; i < numerosOrdenados.length; i++) {
    const n = numerosOrdenados[i];
    const distInferior = i > 0 ? n - numerosOrdenados[i - 1] : Infinity;
    const distSuperior = i < numerosOrdenados.length - 1 ? numerosOrdenados[i + 1] - n : Infinity;
    const distMinima = Math.min(distInferior, distSuperior);
    // Sin ningún vecino en absoluto (lista de 1 elemento) -- sin
    // referencia, no se evalúa (Pablo, punto 4e).
    if (distMinima !== Infinity && distMinima > umbral) aislados.add(n);
  }
  return aislados;
}

// Devuelve { huecos, saltosGrandes } -- huecos: N° de ficha individuales
// en falta, ascendente (sólo números, nunca nombres ni DNI). saltosGrandes:
// tramos de más de UMBRAL_SALTO_GRANDE faltantes de una sola vez, como
// { inferior, superior, faltantes } -- el cartel los muestra agregados
// ("Hay un salto grande entre las fichas X e Y: revisar"), nunca
// enumerados uno por uno. Las fichas aisladas (sospechosas de estar mal
// tipeadas) se excluyen ANTES de formar los pares -- ni definen techo ni
// piso de ningún hueco, sin importar su antigüedad (a diferencia del
// aviso de "sospechosa" del cartel, que sí vence a las 48hs -- ver
// calcularFichasSospechosas).
export function calcularHuecos(fichasUsadas, anulaciones, fichasDescartadas, sedeId, ahora = new Date(), ventanaHoras = VENTANA_HORAS_DEFAULT) {
  const idsAnulados = idsFichaAnulados(anulaciones);
  const idsDescarteAnuladosSet = idsDescarteAnulados(anulaciones);
  const activos = numerosActivos(fichasUsadas, sedeId, idsAnulados);
  const descartados = numerosDescartadosVigentes(fichasDescartadas, sedeId, idsDescarteAnuladosSet);

  const numerosOrdenadosTodos = [...activos.keys()].sort((a, b) => a - b);
  const aislados = detectarNumerosAislados(numerosOrdenadosTodos, UMBRAL_SOSPECHA);
  const numerosOrdenados = numerosOrdenadosTodos.filter((n) => !aislados.has(n));
  if (numerosOrdenados.length < 2) return { huecos: [], saltosGrandes: [] };

  const limiteMs = ventanaHoras * 60 * 60 * 1000;
  const huecos = [];
  const saltosGrandes = [];
  for (let i = 1; i < numerosOrdenados.length; i++) {
    const inferior = numerosOrdenados[i - 1];
    const superior = numerosOrdenados[i];
    const faltantes = superior - inferior - 1;
    if (faltantes <= 0) continue; // sin hueco entre estos dos
    if (faltantes > MAX_HUECO_RAZONABLE) continue; // tope de seguridad absoluto, no un tramo real

    const fechaSuperior = activos.get(superior);
    const antiguedadMs = ahora.getTime() - fechaSuperior.getTime();
    if (antiguedadMs >= limiteMs) continue; // la ficha superior ya es vieja -- el hueco deja de reclamarse

    if (faltantes > UMBRAL_SALTO_GRANDE) {
      saltosGrandes.push({ inferior, superior, faltantes });
      continue;
    }
    for (let n = inferior + 1; n < superior; n++) {
      if (!descartados.has(n)) huecos.push(n);
    }
  }
  return { huecos, saltosGrandes };
}

// Fichas sospechosas de estar mal tipeadas -- vive todo el día (no gateado
// a las 13:00 como el cartel de huecos, ver CartelFichasFaltantes.jsx),
// pero el aviso VENCE a las 48hs (mismo criterio y mismo plazo que un
// hueco): un falso positivo no debe quedar visible para siempre, y la
// única otra forma de resolverlo sería anular un registro que en
// realidad era válido -- confirmado con Pablo que eso no es aceptable.
// Se resuelve también, antes de las 48hs, anulando el registro real si de
// verdad estaba mal (mismo flujo de anulación que ya existe) -- en ese
// caso deja de estar "activo" (numerosActivos ya lo excluye) y el aviso
// desaparece solo, sin ningún mecanismo nuevo.
export function calcularFichasSospechosas(fichasUsadas, anulaciones, sedeId, ahora = new Date(), ventanaHoras = VENTANA_HORAS_DEFAULT, umbral = UMBRAL_SOSPECHA) {
  const idsAnulados = idsFichaAnulados(anulaciones);
  const activos = numerosActivos(fichasUsadas, sedeId, idsAnulados);
  const numerosOrdenados = [...activos.keys()].sort((a, b) => a - b);
  const aislados = detectarNumerosAislados(numerosOrdenados, umbral);

  const limiteMs = ventanaHoras * 60 * 60 * 1000;
  return [...aislados]
    .filter((n) => ahora.getTime() - activos.get(n).getTime() < limiteMs)
    .sort((a, b) => a - b);
}

// Control previo a la impresión mensual (Pablo 6/10, GenerarActasImpresion.jsx):
// mismo núcleo (detectarNumerosAislados), pero SIN ventana de tiempo -- acá
// se evalúa el mes completo ya cargado en memoria para armar el PDF, no
// "las últimas 48hs" de un listener en vivo. Sirve para atrapar justo lo
// que el cartel en vivo no ve (ej. dígitos de menos, que caen fuera de la
// ventana limit(120) por número del listener -- ver diagnóstico 6/10).
// actasDelMes: actas YA fetcheadas por GenerarActasImpresion (actasPorRango),
// sin ninguna lectura nueva -- sólo las que tienen pacienteFicha (Tc-99m,
// Lutecio-177, los 8 de I-131; Barrido/MIBG incluidos, todos pasan por acá).
export function calcularFichasSospechosasDelMes(actasDelMes, anulacionesMap, umbral = UMBRAL_SOSPECHA) {
  const numeros = new Set();
  for (const a of actasDelMes) {
    if (!a.pacienteFicha || anulacionesMap.has(a.id)) continue;
    const n = parseInt(a.pacienteFicha, 10);
    if (Number.isFinite(n)) numeros.add(n);
  }
  const numerosOrdenados = [...numeros].sort((a, b) => a - b);
  return [...detectarNumerosAislados(numerosOrdenados, umbral)].sort((a, b) => a - b);
}

// Texto neutro del cartel -- "Faltan cargar las fichas 104 y 107", sin
// nombres de personas. Mismo criterio "y" antes del último que el resto de
// la app usa para listas cortas (ver components/actas/CartelFichasFaltantes.jsx).
export function formatearListaFichas(huecos) {
  if (huecos.length === 0) return "";
  if (huecos.length === 1) return String(huecos[0]);
  if (huecos.length === 2) return `${huecos[0]} y ${huecos[1]}`;
  return `${huecos.slice(0, -1).join(", ")} y ${huecos[huecos.length - 1]}`;
}
