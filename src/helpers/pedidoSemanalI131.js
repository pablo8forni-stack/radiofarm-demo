import { diasTranscurridos, actividadTeorica } from "./decaimientoI131.js";
import { esTipoMci } from "./turnosI131.js";
import { diaDeSemana } from "./semanaI131.js";

// Simulación "Pedido semanal" (Agenda, Parte C) -- PROYECCIÓN de material que
// todavía no llegó, nunca material real (eso es Stock de viales, Parte A).
// Reusa sin cambios la misma fórmula pura de decaimiento (actividadTeorica +
// diasTranscurridos, decaimientoI131.js) con actividadEsperada/
// fechaHoraLlegada en vez de actividadCalibrada/fechaCalibracion de un vial.

// A qué balde (martes/jueves) consume un turno según su fechaTurno -- corte
// de fecha, no asignación manual: lunes a miércoles consumen del balde del
// martes (ya disponible en ese momento); jueves a domingo consumen del
// balde del jueves (recién llega ese día). Confirmado explícitamente.
export function baldeDeTurno(fechaTurnoISO, semanaISO) {
  const jueves = diaDeSemana(semanaISO, 3);
  return fechaTurnoISO < jueves ? "martes" : "jueves";
}

// Remanente proyectado de UN balde -- null si todavía no se cargó actividad
// esperada o fecha/hora de llegada (nada que proyectar todavía, el pedido se
// va completando de a poco durante la semana). `turnosDelBalde` ya viene
// filtrado por baldeDeTurno del lado del caller; acá sólo se filtra por tipo
// mCi (mismo criterio que el tope semanal -- diagnósticos/barrido no restan).
export function remanenteBalde(actividadEsperada, fechaHoraLlegada, turnosDelBalde) {
  if (!actividadEsperada || !fechaHoraLlegada) return null;
  const dias = diasTranscurridos(fechaHoraLlegada);
  const teorica = actividadTeorica(actividadEsperada, dias);
  const consumido = turnosDelBalde.filter((t) => esTipoMci(t.tipoDosis)).reduce((s, t) => s + (t.actividadPrevista || 0), 0);
  return { dias, teorica, consumido, remanente: Math.max(0, teorica - consumido) };
}

// Promedio real de actividadPrevista (ablativa/dosis, mCi) ya agendado ESTA
// semana -- mismo dato/mismo filtro que sumaMci usa para el tope de 500
// (turnosSemana completo, no por balde), reusado acá para traducir el
// remanente a "cuántos pacientes más" sin inventar una dosis típica fija.
// null si todavía no hay ningún turno mCi cargado esta semana -- nada real
// de dónde sacar un promedio, así que el llamador no debe mostrar la frase.
export function promedioActividadSemana(turnosSemana) {
  const valores = turnosSemana.filter((t) => esTipoMci(t.tipoDosis) && t.actividadPrevista > 0).map((t) => t.actividadPrevista);
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}
