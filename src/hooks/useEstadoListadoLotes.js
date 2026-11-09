import { useCallback, useEffect, useRef, useState } from "react";
import { estadoListadoLoteDosisUnica } from "../services/firestore/mibgLotes.js";
import { hoy } from "../helpers/formato.js";

// Hook del paso 6 (9/11) -- estado por lote para el LISTADO de
// TabLoteDosisUnica (paginado, 30 por página + "Ver más"). Hermano de
// useLotesDisponibles (paso 5), NO lo modifica ni lo reemplaza -- ese hook y
// sus tests siguen tal cual.
//
// Por qué un hook aparte en vez de generalizar useLotesDisponibles: ese hook
// guarda UN resultado global por "clave" (todo el conjunto se recalcula
// junto, siempre). Acá hace falta memoria POR LOTE -- "Ver más" no puede
// releer los ya resueltos, una anulación puntual sólo invalida al lote que
// afecta, y "Reintentar" sólo a uno. Mezclar los dos modelos en un solo hook
// hubiera arriesgado el comportamiento ya cubierto por los tests del picker.
//
// SIN_USO: los únicos 3 estados para los que "aparece un uso nuevo" (ver
// idsConUsoSegunListener más abajo) tiene sentido como señal de invalidar --
// "usado"/"anulado"/"no-verificable"/"verificando" nunca se re-disparan por
// esto (ver ajuste A de Pablo).
const SIN_USO = new Set(["disponible", "vencido-sin-uso", "sin-vencimiento"]);

function claveIds(lotes) {
  return lotes.map((l) => l.id).join(",");
}

// lotesVisibles: los N lotes de la página actual (30, 60, 90...), YA
// ordenados/filtrados por el llamador -- este hook no decide paginación, sólo
// recibe la ventana vigente.
// anulaciones: Map<anulaId, doc> en vivo (listenAnulacionesActas), mismo que
// ya usa el resto de la pantalla.
// idsConUsoSegunListener: Set<loteId> derivado del listener listenActas que
// la pantalla SIGUE teniendo montado (ajuste A de Pablo) -- se usa SOLO como
// aviso de "revisá este lote de nuevo", nunca como fuente del estado final
// (eso sale siempre de una lectura puntual, usoActivoDeLote).
// scopeKey: cambia cuando cambia sede o isótopo -- reinicia TODO el cache
// (ajuste D). El cache vive en useState de este hook, así que también se
// reinicia solo al desmontar el componente que lo usa -- nunca a nivel
// módulo.
export function useEstadoListadoLotes(lotesVisibles, { anulaciones, prefijo, idsConUsoSegunListener, scopeKey }) {
  const [estadoPorLote, setEstadoPorLote] = useState(new Map());
  const estadoPorLoteRef = useRef(estadoPorLote);
  useEffect(() => { estadoPorLoteRef.current = estadoPorLote; }, [estadoPorLote]);

  // generacionRef: token que protege contra respuestas tardías de ANTES de
  // un reset de scope (ajuste E) -- una corrida que arrancó con la sede/
  // isótopo viejo nunca pisa el estado del nuevo, aunque resuelva después.
  const generacionRef = useRef(0);
  // versionPorLoteRef: mismo mecanismo, pero por lote individual -- dos
  // verificaciones del MISMO lote pueden quedar en vuelo a la vez (ej.
  // "Reintentar" mientras ya había una por una anulación); sólo la más nueva
  // (la última en *arrancar*) puede escribir el resultado.
  const versionPorLoteRef = useRef(new Map());
  const idsVistosRef = useRef(new Set());
  const idsConUsoVistosRef = useRef(new Set());
  const anulacionesVistasRef = useRef(new Set());

  const verificarLotes = useCallback(async (lotesAVerificar) => {
    if (lotesAVerificar.length === 0) return;
    const miGeneracion = generacionRef.current;
    const versiones = lotesAVerificar.map((l) => {
      const v = (versionPorLoteRef.current.get(l.id) || 0) + 1;
      versionPorLoteRef.current.set(l.id, v);
      return v;
    });
    setEstadoPorLote((prev) => {
      const copia = new Map(prev);
      lotesAVerificar.forEach((l) => copia.set(l.id, { estado: "verificando", uso: null, error: null }));
      return copia;
    });

    const resultados = await estadoListadoLoteDosisUnica(lotesAVerificar, { anulaciones, prefijo, hoyISO: hoy() });

    if (miGeneracion !== generacionRef.current) return; // todo el scope cambió mientras esto estaba en vuelo -- se descarta entero
    setEstadoPorLote((prev) => {
      const copia = new Map(prev);
      lotesAVerificar.forEach((l, i) => {
        // Una verificación MÁS NUEVA de este mismo lote puntual ya arrancó
        // (o ya resolvió) después de ésta -- esta respuesta vieja no pisa
        // nada, aunque haya llegado después en el tiempo real.
        if (versionPorLoteRef.current.get(l.id) !== versiones[i]) return;
        copia.set(l.id, resultados.get(l.id));
      });
      return copia;
    });
  }, [anulaciones, prefijo]);

  // Reset completo al cambiar de sede/isótopo (ajuste D) -- nunca a nivel
  // módulo, vive en refs/state de ESTA instancia del hook, se destruye solo
  // si el componente se desmonta.
  useEffect(() => {
    generacionRef.current += 1;
    versionPorLoteRef.current = new Map();
    idsVistosRef.current = new Set();
    idsConUsoVistosRef.current = new Set();
    anulacionesVistasRef.current = new Set();
    setEstadoPorLote(new Map());
  }, [scopeKey]);

  // Primera carga y "Ver más" -- sólo verifica los ids de lotesVisibles que
  // todavía no se vieron nunca. Los ya resueltos (de páginas anteriores) NO
  // se vuelven a leer -- es lo que pide el ajuste de paginación.
  const clave = claveIds(lotesVisibles);
  useEffect(() => {
    const vistos = idsVistosRef.current;
    const nuevos = lotesVisibles.filter((l) => !vistos.has(l.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((l) => vistos.add(l.id));
    verificarLotes(nuevos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clave (ids) es la dependencia real, no la referencia del array
  }, [clave, scopeKey, verificarLotes]);

  // Invalidación puntual por anulación nueva (en vivo, listenAnulacionesActas
  // sigue siendo el listener de siempre). Nunca recalcula TODA la página --
  // sólo el/los lotes que esa anulación puntual puede afectar:
  //   - anulaId == el id de un lote visible -> lote anulado directo.
  //   - anulaId == el id del uso que ese lote tenía cacheado -> esa
  //     administración se corrigió, hay que re-verificar ese lote puntual
  //     (puede volver a "disponible", o aparecer un intento siguiente).
  // Cualquier otra anulación (de otro tipo de acta, o de un lote fuera de la
  // página visible) no dispara ninguna lectura -- se descarta sin tocar nada.
  useEffect(() => {
    const vistas = anulacionesVistasRef.current;
    const nuevas = [...anulaciones.values()].filter((a) => !vistas.has(a.anulaId));
    if (nuevas.length === 0) return;
    nuevas.forEach((a) => vistas.add(a.anulaId));

    const idsVisibles = new Set(lotesVisibles.map((l) => l.id));
    const porInvalidar = new Set();
    nuevas.forEach((a) => {
      if (idsVisibles.has(a.anulaId)) { porInvalidar.add(a.anulaId); return; }
      for (const [loteId, estado] of estadoPorLoteRef.current.entries()) {
        if (idsVisibles.has(loteId) && estado?.uso?.id === a.anulaId) { porInvalidar.add(loteId); break; }
      }
    });
    if (porInvalidar.size === 0) return;
    verificarLotes(lotesVisibles.filter((l) => porInvalidar.has(l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clave (ids) es la dependencia real, no la referencia del array
  }, [anulaciones, clave, verificarLotes]);

  // Ajuste A de Pablo: listenActas(TIPO_USO...) sigue en vivo en la pantalla,
  // pero SOLO como aviso -- nunca fuente del estado. Un uso nuevo cuyo lote
  // ya está cacheado en un estado SIN uso (ver SIN_USO arriba) dispara una
  // re-verificación puntual de ESE lote. Un uso de un lote que ya figuraba
  // "usado" (o "anulado"/"no-verificable"/"verificando") no dispara nada.
  useEffect(() => {
    const vistos = idsConUsoVistosRef.current;
    const nuevosIds = [...idsConUsoSegunListener].filter((id) => !vistos.has(id));
    if (nuevosIds.length === 0) return;
    nuevosIds.forEach((id) => vistos.add(id));

    const aInvalidar = nuevosIds.filter((id) => SIN_USO.has(estadoPorLoteRef.current.get(id)?.estado));
    if (aInvalidar.length === 0) return;
    verificarLotes(lotesVisibles.filter((l) => aInvalidar.includes(l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clave (ids) es la dependencia real, no la referencia del array
  }, [idsConUsoSegunListener, clave, verificarLotes]);

  const reintentar = useCallback((loteId) => {
    const lote = lotesVisibles.find((l) => l.id === loteId);
    if (lote) verificarLotes([lote]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clave (ids) es la dependencia real, no la referencia del array
  }, [clave, verificarLotes]);

  return { estadoPorLote, reintentar };
}
