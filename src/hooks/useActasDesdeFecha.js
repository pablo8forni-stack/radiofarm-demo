import { useEffect, useState } from "react";
import { listenActasDesdeFecha } from "../services/firestore/actas.js";

// Paso "decaído" de I-131 (9/11) -- orquesta listenActasDesdeFecha cuando la
// cota `desde` no es fija, sino que se recalcula sola a medida que cambian
// los datos (ver decaidoPorTeorica/fechaMenosMargenDias, decaimientoI131.js).
// `desde === null` significa "no hay ningún candidato que necesite esta
// lectura todavía" (ver TabStockViales.jsx/TabPacientes.jsx) -- en ese caso
// NO se suscribe ningún listener, se devuelve [] directo, sin ninguna
// lectura. Se re-suscribe SOLO cuando `desde` cambia de verdad (comparado
// por .getTime(), no por referencia de objeto Date -- un Date nuevo con el
// mismo instante no tiene que disparar una resuscripción).
export function useActasDesdeFecha(tipo, { sedeId, desde }) {
  const [actas, setActas] = useState([]);
  const desdeMs = desde ? desde.getTime() : null;

  useEffect(() => {
    if (!sedeId || desdeMs == null) { setActas([]); return; }
    return listenActasDesdeFecha(tipo, setActas, { sedeId, desde: new Date(desdeMs) });
  }, [tipo, sedeId, desdeMs]);

  return actas;
}
