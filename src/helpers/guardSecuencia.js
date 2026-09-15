// "Última llamada gana": para una función async que puede dispararse de
// nuevo antes de que la anterior termine (ej. resolverYSetFichaEstado en
// TabPacientes.jsx, re-chequeada en cada blur del campo Ficha) -- sin esto,
// dos llamadas en vuelo pueden resolver en CUALQUIER orden (no
// necesariamente el orden en que arrancaron), y la que responde último
// pisa el estado sin importar si sigue siendo relevante. Bug real
// encontrado con evidencia de Firebase Console: precargarSugerenciaFicha
// dispara un chequeo con la ficha SUGERIDA al abrir el formulario; si la
// técnica sobreescribe de inmediato con la ficha REAL y esa segunda
// consulta resuelve PRIMERO, una respuesta tardía de la primera (ya
// irrelevante) pisaba el resultado bueno.
//
// Extraído a un módulo aparte (en vez de un useRef inline) para poder
// testear el orden de resolución de forma determinística sin depender de
// React ni de timing real de red -- ver scripts/testing/guardSecuencia.test.mjs.
export function crearGuardDeSecuencia() {
  let actual = 0;
  return {
    // Llamar al ARRANCAR cada intento -- devuelve el id de ESE intento.
    empezar() {
      return ++actual;
    },
    // Llamar antes de aplicar el resultado de un intento -- true sólo si
    // ningún intento más nuevo arrancó después de éste.
    esVigente(id) {
      return id === actual;
    },
  };
}
