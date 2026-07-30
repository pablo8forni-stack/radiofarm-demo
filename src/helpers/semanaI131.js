// Límites de semana (lunes a domingo, convención Argentina/ISO) para la
// Agenda de turnos I-131 -- funciones puras, sin Firestore. Mismo cuidado de
// fecha local que hoy()/diasV() en helpers/formato.js: se construye con
// componentes locales (getFullYear/getMonth/getDate), nunca toISOString()
// (corre a UTC y puede desfasar el día en Argentina, UTC-3).
function aFechaLocal(iso) {
  return new Date(`${iso}T00:00:00`);
}

function aISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Lunes de la semana que contiene fechaISO. getDay(): 0=domingo..6=sábado --
// un domingo pertenece a la semana que empezó el lunes anterior (offset -6),
// cualquier otro día retrocede hasta su propio lunes (offset 1-diaSemana).
export function inicioSemana(fechaISO) {
  const d = aFechaLocal(fechaISO);
  const diaSemana = d.getDay();
  d.setDate(d.getDate() + (diaSemana === 0 ? -6 : 1 - diaSemana));
  return aISO(d);
}

export function finSemana(fechaISO) {
  const d = aFechaLocal(inicioSemana(fechaISO));
  d.setDate(d.getDate() + 6);
  return aISO(d);
}

export function semanaSiguiente(fechaISO) {
  const d = aFechaLocal(fechaISO);
  d.setDate(d.getDate() + 7);
  return aISO(d);
}

export function semanaAnterior(fechaISO) {
  const d = aFechaLocal(fechaISO);
  d.setDate(d.getDate() - 7);
  return aISO(d);
}

// Un día puntual de la semana que empieza en inicioISO (que ya tiene que ser
// un lunes, ver inicioSemana) -- offset 0=lunes, 1=martes, 3=jueves, etc.
// Usado por el Pedido semanal (Agenda) para saber la fecha de "el jueves de
// esta semana" sin reimplementar la aritmética de fechas.
export function diaDeSemana(inicioISO, offset) {
  const d = aFechaLocal(inicioISO);
  d.setDate(d.getDate() + offset);
  return aISO(d);
}
