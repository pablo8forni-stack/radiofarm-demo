import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, fmtHora, fmtFechaISO, hoy, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { nombreArchivoLibro } from "../../helpers/nombreArchivoLibro.js";
import { normalizarLoteSeisDigitos } from "../../helpers/lote.js";
import { listenActas, addActaElucion, actasPorRango, anularActaTransaction, listenAnulacionesActas, loteGeneradorYaRegistrado } from "../../services/firestore/actas.js";
import { calcularPedirDatos, textoSubfilaGenerador } from "../../helpers/elucionGenerador.js";

const TIMEOUT_BUSQUEDA_MS = 20000;
const MSJ_TIMEOUT_BUSQUEDA = "La consulta tardó demasiado, puede haber un problema de conexión -- intentá cerrar las otras pestañas de RadioFarm que tengas abiertas y reintentá.";
// Fallback por timeout de los listeners del formulario (24/11) -- ver el
// useEffect que usa esto, más abajo.
const TIMEOUT_LISTENERS_MS = 15000;
const MSJ_TIMEOUT_LISTENERS = "No se pudo verificar el historial de este lote: se piden los 4 datos por las dudas.";

// Sin esto, una consulta que nunca resuelve (ver nota en exportarRango) deja
// el botón trabado en "Buscando..." para siempre, sin ningún error visible.
function conTimeout(promesa, ms, mensaje) {
  let idTimeout;
  const timeout = new Promise((_, reject) => { idTimeout = setTimeout(() => reject(new Error(mensaje)), ms); });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));
}

export function TabElucion({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  // Fase elución (24/11): mientras estos dos listeners no trajeron su
  // primer snapshot, pedirDatos no se puede calcular de verdad (actasTodas/
  // anulacionesRaw todavía están en su valor inicial vacío, que diría
  // "no hay ninguna vigente con datos" aunque sí la haya) -- se bloquea
  // Guardar y se muestra "Cargando..." en vez de decidir con datos a medias.
  const [actasCargadas, setActasCargadas] = useState(false);
  const [anulacionesCargadas, setAnulacionesCargadas] = useState(false);
  // Fallback por timeout (24/11): si a los TIMEOUT_LISTENERS_MS de abierto
  // el formulario los 2 listeners de arriba TODAVÍA no entregaron (corte de
  // red, permisos, etc. -- onSnapshot no tiene hoy ningún timeout ni
  // callback de error propio), se deja de esperar y se pide los 4 datos
  // igual, por las dudas. Ver el useEffect que lo arma/retira más abajo.
  const [timeoutVencido, setTimeoutVencido] = useState(false);
  const [mAnular, setMAnular] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  // Ver comentario largo equivalente en TabPacientes.jsx.
  const sedeEfectiva = esAdmin ? usuario.sedeAuditando : usuario.sede;
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [buscandoRango, setBuscandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState(null);
  // null = todavía no se buscó; array (incluso vacío) = resultado en memoria
  // de la última búsqueda, listo para descargar sin volver a consultar.
  const [resultadoRango, setResultadoRango] = useState(null);

  function cambiarRango(setter) {
    return (e) => { setter(e.target.value); setResultadoRango(null); setErrorRango(null); };
  }

  // Sede de trabajo (2026-11): constante, no estado -- ver nota equivalente
  // en TabPacientes.jsx. Ya no hay selector "Sede" para elegir otra.
  const sedeId = usuario.sede;
  const [loteGenerador, setLoteGenerador] = useState("");
  const [loteVerificado, setLoteVerificado] = useState("");
  // Renombrado (24/11): esto SOLO dice si generadoresVistos ya existe para
  // este lote/sede -- antes se llamaba esPrimeraVez y se usaba directo para
  // decidir si pedir los 4 datos, lo que mezclaba dos preguntas distintas
  // (¿existe el marcador? vs. ¿hay que pedir los datos?). Ver pedirDatos
  // más abajo para la segunda.
  const [marcadorExiste, setMarcadorExiste] = useState(false);
  const [verificandoLote, setVerificandoLote] = useState(false);
  const [actividadCalibrada, setActividadCalibrada] = useState("");
  // Sólo se piden cuando pedirDatos es true (ver helpers/elucionGenerador.js
  // y el useMemo más abajo). Strings
  // "YYYY-MM-DD" tal cual (sin Date()) -- no entran en ningún cálculo de
  // decaimiento acá, mismo criterio que mibg_lote.fechaVencimiento.
  // numeroGenerador: dato IMPRESO en la etiqueta física del generador,
  // distinto de loteGenerador (que ya existía) -- puramente informativo.
  const [fechaCalibracionGen, setFechaCalibracionGen] = useState("");
  const [fechaVencimientoGen, setFechaVencimientoGen] = useState("");
  const [numeroGenerador, setNumeroGenerador] = useState("");
  const [actividadEluida, setActividadEluida] = useState("");
  const [volumen, setVolumen] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!sedeEfectiva) return undefined;
    setActasCargadas(false);
    return listenActas("elucion", (actas) => { setActasTodas(actas); setActasCargadas(true); }, { sedeId: sedeEfectiva });
  }, [sedeEfectiva]);
  useEffect(() => {
    if (!sedeEfectiva) return undefined;
    setAnulacionesCargadas(false);
    return listenAnulacionesActas((anulaciones) => { setAnulacionesRaw(anulaciones); setAnulacionesCargadas(true); }, { sedeId: sedeEfectiva });
  }, [sedeEfectiva]);

  // Arma/retira el timeout de arriba. Depende de actasCargadas/
  // anulacionesCargadas (la carga REAL), nunca del combinado
  // listosParaDecidir (= cargaReal || timeoutVencido, ver más abajo): si
  // dependiera del combinado, poner timeoutVencido en true reengancharía
  // este mismo efecto, y la rama "ya cargó, bajar la bandera" lo bajaría de
  // vuelta a false en el mismo tick -- un parpadeo que nunca llega a
  // mostrarse. Si los listeners responden DESPUÉS del timeout, este efecto
  // vuelve a correr (actasCargadas/anulacionesCargadas cambiaron), retira el
  // aviso, y pedirDatos/listosParaDecidir recalculan con los datos reales.
  useEffect(() => {
    if (!mostrarForm || (actasCargadas && anulacionesCargadas)) { setTimeoutVencido(false); return undefined; }
    const id = setTimeout(() => setTimeoutVencido(true), TIMEOUT_LISTENERS_MS);
    return () => clearTimeout(id);
  }, [mostrarForm, actasCargadas, anulacionesCargadas]);

  // Se dispara al perder foco del campo lote (no en cada tecla) y también si
  // cambia la sede con un lote ya tipeado. Dos pasos:
  //  1) chequeo local instantáneo contra actasTodas (el listener en tiempo
  //     real) -- Firestore ya refleja ahí una escritura recién disparada
  //     aunque el servidor todavía no la confirmó, así que dos eluciones del
  //     mismo lote cargadas rápido una atrás de la otra no compiten en una
  //     carrera contra el paso 2.
  //  2) si no aparece localmente, getDoc directo por id determinístico
  //     (services/firestore/actas.js#loteGeneradorYaRegistrado), no una
  //     query -- cubre lotes con historial más viejo que los últimos 150
  //     registros cargados en pantalla. Si falla (ej. offline), se pide el
  //     dato igual: mejor pedir de más que perder un dato regulatorio que no
  //     se puede recuperar después.
  useEffect(() => {
    const lote = loteVerificado.trim();
    if (!lote) { setMarcadorExiste(false); return; }
    // Misma normalización compartida (helpers/lote.js) que arma el id
    // determinístico del marcador en actas.js -- si compara el texto tal
    // cual lo tipeó cada quien, "1-11111" y "111111" nunca matchean entre sí.
    const loteNormalizado = normalizarLoteSeisDigitos(lote);
    if (actasTodas.some((a) => a.loteGenerador && normalizarLoteSeisDigitos(a.loteGenerador) === loteNormalizado)) {
      setMarcadorExiste(true);
      return;
    }
    let cancelado = false;
    setVerificandoLote(true);
    loteGeneradorYaRegistrado(sedeId, lote)
      .then((yaRegistrado) => { if (!cancelado) setMarcadorExiste(yaRegistrado); })
      .catch(() => { if (!cancelado) setMarcadorExiste(false); })
      .finally(() => { if (!cancelado) setVerificandoLote(false); });
    return () => { cancelado = true; };
  }, [sedeId, loteVerificado, actasTodas]);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // pedirDatos (24/11): reemplaza al viejo esPrimeraVez para decidir si
  // mostrar/exigir los 4 campos -- ver calcularPedirDatos
  // (helpers/elucionGenerador.js). cargaReal: mientras los 2 listeners de
  // arriba no trajeron su primer snapshot, no se puede calcular de verdad
  // (actasTodas/anulacionesRaw todavía vacíos de arranque darían un falso
  // "no hay vigente con datos"). listosParaDecidir suma el fallback por
  // timeout (ver useEffect de arriba): a los 15s sin cargaReal, se deja de
  // esperar y se decide igual, con los 4 datos obligatorios.
  const cargaReal = actasCargadas && anulacionesCargadas;
  const listosParaDecidir = cargaReal || timeoutVencido;
  const pedirDatos = useMemo(() => {
    if (!cargaReal) return timeoutVencido; // sin cargaReal: timeoutVencido decide (false = todavía esperando, no se usa; true = pedir por las dudas)
    return calcularPedirDatos({ marcadorExiste, actas: actasTodas, anulaciones, sedeId, loteGenerador: loteVerificado });
  }, [cargaReal, timeoutVencido, marcadorExiste, actasTodas, anulaciones, sedeId, loteVerificado]);

  function limpiarForm() {
    setLoteGenerador(""); setLoteVerificado(""); setMarcadorExiste(false);
    setActividadCalibrada(""); setFechaCalibracionGen(""); setFechaVencimientoGen(""); setNumeroGenerador("");
    setActividadEluida(""); setVolumen(""); setObs("");
  }

  async function confirmarAnulacion(acta, motivo) {
    try {
      await anularActaTransaction(acta, motivo, usuario);
      setMAnular(null);
      // Sede de trabajo (2026-11): hallazgo real de Pablo -- loteGenerador
      // está atado a generadoresVistos, un marcador POR SEDE (id
      // sedeId_lote). Precargarlo en una elución nueva de la sede de
      // trabajo haría que la detección de "primera vez" (useEffect de
      // abajo, vía loteGeneradorYaRegistrado(sedeId,...)) mire el marcador
      // de la sede de trabajo, no el de la sede real del generador --
      // resultado incorrecto, no sólo una mezcla de datos. Sólo se puede
      // ver una elución de otra sede auditándola, nunca trabajando ahí --
      // si eso pasó, NO se precarga nada: la corrección se carga desde los
      // libros de esa otra sede, no desde acá.
      if (acta.sedeId !== sedeId) {
        onToast(
          `Elución anulada. Era de ${catalogo.sedes[acta.sedeId]?.nombre || "otra sede"} -- la corrección se carga desde los libros de esa sede, no desde acá.`,
          "info", 10000
        );
        return;
      }
      onToast("Elución anulada", "info", 6000);
      // Precarga para corregir sólo lo que estaba mal -- ver mismo patrón en
      // TabMarcacion/TabPacientes. La detección de "primera vez" se vuelve a
      // correr sola (useEffect de arriba) apenas se precarga el lote.
      setLoteGenerador(acta.loteGenerador); setLoteVerificado(acta.loteGenerador);
      setActividadCalibrada(acta.actividadCalibrada != null ? String(acta.actividadCalibrada) : "");
      setFechaCalibracionGen(acta.fechaCalibracion || ""); setFechaVencimientoGen(acta.fechaVencimiento || ""); setNumeroGenerador(acta.numeroGenerador || "");
      setActividadEluida(String(acta.actividadEluida ?? "")); setVolumen(String(acta.volumen ?? "")); setObs(acta.observacion || "");
      setMostrarForm(true);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  // A diferencia de ingreso/marcación/paciente (fire-and-forget, offline-safe
  // porque un rechazo real ahí es prácticamente imposible), la validez de una
  // elución depende de una condición server-side (loteGeneradorVisto) que el
  // cliente sólo puede aproximar -- un desfasaje cliente/regla (como el que
  // pasó con el fix de mayúsculas: cliente ya actualizado, regla de prod
  // todavía no) puede hacer que el guardado se rechace de verdad. Por eso acá
  // sí se espera la confirmación real del batch antes de avisar éxito, y si
  // falla, el error se muestra en el toast y el formulario se queda abierto
  // (no se limpia ni se cierra) para reintentar -- mismo criterio que ya
  // usamos en egreso/transferencia/anulación.
  async function guardar() {
    if (!listosParaDecidir) return; // no decidir con los listeners a medio cargar
    if (!loteGenerador.trim() || !actividadEluida || !volumen || (pedirDatos && (!actividadCalibrada || !fechaCalibracionGen || !fechaVencimientoGen || !numeroGenerador.trim()))) return;
    if (!catalogo.sedes[sedeId]?.eluye) return;
    const datos = {
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      // normalizarLoteSeisDigitos (no sólo .trim()) -- defensivo, por si se
      // guarda sin haber pasado por el onBlur del campo (poco probable,
      // pero así el valor GUARDADO queda siempre en el formato correcto,
      // no sólo lo que se ve en pantalla).
      loteGenerador: normalizarLoteSeisDigitos(loteGenerador),
      actividadEluida: parseFloat(actividadEluida) || 0,
      volumen: parseFloat(volumen) || 0,
      usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
    };
    // pedirDatos (si hay que pedir los 4 campos) y !marcadorExiste (si hay
    // que CREAR el marcador) son preguntas DISTINTAS -- con marcador ya
    // existente y pedirDatos true (recarga/nueva elución sin vigente con
    // datos), el acta lleva los 4 campos igual pero el marcador NO se toca
    // (addActaElucion sólo escribe el marcador si el 2do argumento es
    // true -- ver firestore.rules:731-751, acepta los 4 campos aunque el
    // marcador ya exista, y actas.js#addActaElucion, el create de
    // generadoresVistos sobre un id existente rechazaría TODO el batch).
    if (pedirDatos) {
      datos.actividadCalibrada = parseFloat(actividadCalibrada) || 0;
      datos.fechaCalibracion = fechaCalibracionGen; datos.fechaVencimiento = fechaVencimientoGen; datos.numeroGenerador = numeroGenerador.trim();
    }
    setGuardando(true);
    try {
      await addActaElucion(datos, !marcadorExiste);
      onToast("Elución registrada");
      limpiarForm();
      setMostrarForm(false);
    } catch (e) {
      onToast(e.message || "No se pudo guardar la elución", "error");
    } finally {
      setGuardando(false);
    }
  }

  const actas = useMemo(
    () => actasTodas.filter((a) => (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) && (!sedeEfectiva || a.sedeId === sedeEfectiva)),
    [actasTodas, filtroFecha, sedeEfectiva]
  );

  const grupos = useMemo(
    () => (filtroFecha ? null : agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))),
    [actas, filtroFecha]
  );

  function filaElucion(a) {
    const anulacion = anulaciones.get(a.id);
    const subfila = textoSubfilaGenerador(a);
    return (
      <Fragment key={a.id}>
        <tr className={`border-b ${subfila ? "" : "border-gray-50"} last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
          <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
          <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[a.sedeId]?.short || "—"}</td>
          <td className="px-3 py-2.5 text-xs font-mono text-gray-700">{a.loteGenerador}</td>
          <td className="px-3 py-2.5 text-xs text-gray-600">{a.actividadCalibrada != null ? `${a.actividadCalibrada} mCi` : "—"}</td>
          <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{a.actividadEluida}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
          <td className="px-3 py-2.5 text-xs text-gray-600">{a.volumen} ml</td>
          <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
          <td className="px-3 py-2.5 text-xs text-gray-400 italic">
            {a.observacion || "—"}
            {anulacion && <div className="text-orange-500 font-semibold not-italic mt-0.5">ANULADA: {anulacion.motivo}</div>}
          </td>
          <td className="px-3 py-2.5 text-right">
            {esAdmin && !anulacion && (
              <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                Anular
              </button>
            )}
          </td>
        </tr>
        {/* Subfila (24/11): hereda la opacidad de la fila -- no hace falta
            repetirla, es un <tr> hijo del mismo <tbody>, el opacity-50 de
            arriba no se aplica acá (CSS no hereda opacity entre hermanos) --
            SÍ hace falta repetirlo. */}
        {subfila && (
          <tr className={`border-b border-gray-50 last:border-0 ${anulacion ? "opacity-50" : ""}`}>
            <td colSpan={9} className="px-3 pb-2 -mt-1 text-[11px] text-gray-400">{subfila}</td>
          </tr>
        )}
      </Fragment>
    );
  }

  function tarjetaElucion(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm font-mono">{a.loteGenerador}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        <div className="text-xs text-gray-500">
          {catalogo.sedes[a.sedeId]?.short || "—"} · Eluido: <span className="font-bold text-blue-700">{a.actividadEluida} mCi</span> · Vol: {a.volumen} ml
        </div>
        {a.actividadCalibrada != null && <div className="text-xs text-gray-500">Calibrada: {a.actividadCalibrada} mCi</div>}
        {textoSubfilaGenerador(a) && <div className="text-[11px] text-gray-400">{textoSubfilaGenerador(a)}</div>}
        <div className="text-xs text-gray-500">Técnico: {a.usuarioNombre}</div>
        {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADA: {anulacion.motivo}</div>}
        {esAdmin && !anulacion && (
          <div className="flex justify-end mt-0.5">
            <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular
            </button>
          </div>
        )}
      </div>
    );
  }

  function filaCSV(a) {
    const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
    return [d.toLocaleDateString("es-AR"), fmtHora(a.fecha),
      a.sedeNombre, a.loteGenerador, a.actividadCalibrada ?? "—", a.actividadEluida, a.volumen, a.usuarioNombre, a.observacion || "—",
      // 3 columnas nuevas al final (24/11) -- vacías (no "—") si no hay,
      // fechas SIN pasar por new Date (fmtF corta el string, ver arriba).
      a.fechaCalibracion ? fmtF(a.fechaCalibracion) : "", a.fechaVencimiento ? fmtF(a.fechaVencimiento) : "", a.numeroGenerador || ""];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Lote/Serie generador", "Actividad calibrada (mCi)", "Actividad eluida (mCi)", "Volumen (ml)", "Técnico", "Observación", "Fecha calibración", "Fecha vencimiento", "N° generador"],
      ...lista.map(filaCSV),
    ];
    const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
    descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
  }

  // Nombre centralizado (nombreArchivoLibro, helpers/nombreArchivoLibro.js)
  // -- PENDIENTE de confirmación de Pablo, ver diagnóstico del 4/11. Antes
  // era `libro3_elucion_${filtroFecha || hoy()}.csv`: sin sede, y el
  // `|| hoy()` nunca se usaba en la práctica porque este botón sólo existe
  // con filtroFecha ya puesto (ver el `{filtroFecha ? (...` más abajo).
  function exportarCSV() {
    descargarCSV(actas, nombreArchivoLibro({ libro: "libro3", extension: "csv", periodo: filtroFecha, sedeShort: catalogo.sedes[sedeEfectiva]?.short }));
    onToast("Libro 3 exportado");
  }

  // Buscar y descargar son dos pasos separados a propósito: ver nota completa
  // en TabMarcacion.jsx#buscarRango.
  async function buscarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setBuscandoRango(true);
    setErrorRango(null);
    setResultadoRango(null);
    try {
      const registros = await conTimeout(
        actasPorRango("elucion", { desde: rangoDesde, hasta: rangoHasta, sedeId: sedeEfectiva }),
        TIMEOUT_BUSQUEDA_MS, MSJ_TIMEOUT_BUSQUEDA
      );
      setResultadoRango(registros);
    } catch (e) {
      setErrorRango(e.message || "No se pudo buscar el rango.");
    } finally {
      setBuscandoRango(false);
    }
  }

  function descargarResultadoRango() {
    if (!resultadoRango?.length) return;
    descargarCSV(resultadoRango, nombreArchivoLibro({ libro: "libro3", extension: "csv", periodo: `${rangoDesde}_a_${rangoHasta}`, sedeShort: catalogo.sedes[sedeEfectiva]?.short }));
    onToast(`Libro 3 exportado: ${resultadoRango.length} registro${resultadoRango.length !== 1 ? "s" : ""}`);
  }

  if (esAdmin && !sedeEfectiva) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
        Elegí qué sede vas a auditar en Configuración antes de ver este libro.
      </div>
    );
  }

  const sedeEluye = !!catalogo.sedes[sedeId]?.eluye;
  // Para un técnico (sede fija, sin selector) alcanza con mirar su propia
  // sede para decidir si tiene sentido abrir el formulario. Un admin puede
  // elegir cualquier sede adentro del form, así que su botón queda siempre
  // habilitado -- el aviso aparece adentro si la sede elegida no eluye.
  const puedeAbrirForm = esAdmin || !!catalogo.sedes[usuario.sede]?.eluye;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex gap-2 items-center">
            {filtroFecha && <Input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />}
            <Btn size="sm" variant="outline" onClick={() => setFiltroFecha(filtroFecha ? "" : hoy())}>
              {filtroFecha ? "Ver todos" : "Ver por fecha"}
            </Btn>
          </div>
          {esAdmin && (
            <div className="w-full md:w-auto text-xs text-gray-400">
              Auditando <span className="font-semibold text-gray-600">{catalogo.sedes[sedeEfectiva]?.short || "—"}</span> · cambiar en Configuración
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {filtroFecha ? (
            actas.length > 0 && (
              <Btn size="sm" variant="outline" onClick={exportarCSV} className="order-2 md:order-none">↓ CSV</Btn>
            )
          ) : (
            <>
              <div className="flex gap-2 items-center order-2 md:order-none">
                <div className="flex-1 md:flex-none"><Input label="Desde" type="date" value={rangoDesde} onChange={cambiarRango(setRangoDesde)} /></div>
                <span className="text-xs text-gray-400 mt-5">a</span>
                <div className="flex-1 md:flex-none"><Input label="Hasta" type="date" value={rangoHasta} onChange={cambiarRango(setRangoHasta)} /></div>
              </div>
              <Btn size="sm" variant="outline" onClick={buscarRango} disabled={!rangoDesde || !rangoHasta || buscandoRango} className="order-3 md:order-none">
                {buscandoRango ? "Buscando..." : "Buscar"}
              </Btn>
            </>
          )}
          <Btn
            size="sm" variant="primary" className="w-full md:w-auto order-1 md:order-none"
            onClick={() => setMostrarForm(true)} disabled={!puedeAbrirForm}
            title={puedeAbrirForm ? undefined : "Esta sede no tiene elución habilitada — activala en Configuración → Sedes activas"}
          >
            + Registrar elución
          </Btn>
        </div>
      </div>

      {errorRango && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{errorRango}</div>
      )}

      {resultadoRango !== null && (
        resultadoRango.length > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-xs rounded-xl px-3 py-2">
            <span>Se encontraron {resultadoRango.length} registro{resultadoRango.length !== 1 ? "s" : ""} entre {fmtF(rangoDesde)} y {fmtF(rangoHasta)}.</span>
            <Btn size="sm" variant="outline" onClick={descargarResultadoRango} className="sm:ml-auto">↓ Descargar CSV</Btn>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 text-gray-500 text-xs rounded-xl px-3 py-2">
            No se encontraron registros en ese rango.
          </div>
        )
      )}

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nueva elución</h3>
            <button onClick={() => { setMostrarForm(false); limpiarForm(); }} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!sedeEluye && (
              <div className="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm text-amber-700">
                Esta sede no tiene elución habilitada — activala en Configuración → Sedes activas.
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Input
                label="Lote/serie del generador" value={loteGenerador}
                onChange={(e) => setLoteGenerador(e.target.value)}
                onBlur={() => {
                  // Reescribe el campo visible con el resultado normalizado
                  // (no sólo lo usa para comparar internamente) -- así el
                  // técnico ve al toque que "111111"/"1 11111" quedó en
                  // "1-11111", el mismo formato que efectivamente se guarda.
                  const normalizado = normalizarLoteSeisDigitos(loteGenerador);
                  setLoteGenerador(normalizado);
                  setLoteVerificado(normalizado);
                }}
                placeholder="Ej: 1-11111"
              />
              <p className="text-xs text-gray-400">No hace falta poner el guion, se completa solo al salir del campo.</p>
            </div>
            {!cargaReal && !timeoutVencido && <div className="sm:col-span-2 text-xs text-gray-400">Cargando datos del lote...</div>}
            {!cargaReal && timeoutVencido && <div className="sm:col-span-2 text-xs text-amber-600">{MSJ_TIMEOUT_LISTENERS}</div>}
            {listosParaDecidir && verificandoLote && <div className="sm:col-span-2 text-xs text-gray-400">Verificando lote...</div>}
            {listosParaDecidir && !verificandoLote && pedirDatos && (
              <>
                <div className="sm:col-span-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
                  Este lote/serie no tiene una elución vigente con estos datos en esta sede — hacen falta los 4 (no se vuelven a pedir mientras siga vigente una elución que ya los tenga).
                </div>
                <Input label="Actividad de Mo-99 calibrada (mCi)" type="number" min={0} step={0.1} value={actividadCalibrada} onChange={(e) => setActividadCalibrada(e.target.value)} placeholder="1850" />
                <Input label="Fecha de calibración" type="date" value={fechaCalibracionGen} onChange={(e) => setFechaCalibracionGen(e.target.value)} />
                <Input label="Fecha de vencimiento" type="date" value={fechaVencimientoGen} onChange={(e) => setFechaVencimientoGen(e.target.value)} />
                {/* Dato DISTINTO de "Lote/serie del generador" de arriba --
                    la etiqueta física trae los dos números por separado
                    (confirmado con Pablo). Nunca se usa como clave de
                    detección de primera vez, sólo informativo. */}
                <Input label="Número de generador" value={numeroGenerador} onChange={(e) => setNumeroGenerador(e.target.value)} placeholder="Ej: 240017992" />
              </>
            )}
            <Input label="Actividad de Tc-99m eluida (mCi)" type="number" min={0} step={0.1} value={actividadEluida} onChange={(e) => setActividadEluida(e.target.value)} placeholder="740" />
            <Input label="Volumen (ml)" type="number" min={0} step={0.1} value={volumen} onChange={(e) => setVolumen(e.target.value)} placeholder="10" />
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: rendimiento, incidencias..." />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!listosParaDecidir || !sedeEluye || !loteGenerador.trim() || !actividadEluida || !volumen || (pedirDatos && (!actividadCalibrada || !fechaCalibracionGen || !fechaVencimientoGen || !numeroGenerador.trim())) || verificandoLote || guardando}>
              {guardando ? "Guardando..." : "Guardar elución"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Eluciones del ${fmtF(filtroFecha)}` : "Todas las eluciones"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "Sede", "Lote/Serie", "Act. calibrada", "Act. eluida", "Volumen", "Técnico", "Observación", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos
                ? grupos.flatMap((g) => [
                    <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                      <td colSpan={9} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
                        {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                      </td>
                    </tr>,
                    ...g.items.map(filaElucion),
                  ])
                : actas.map(filaElucion)}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-gray-50">
          {grupos
            ? grupos.flatMap((g) => [
                <div key={`sep-${g.fecha}`} className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                </div>,
                ...g.items.map(tarjetaElucion),
              ])
            : actas.map(tarjetaElucion)}
        </div>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay eluciones para la fecha seleccionada." : "No hay eluciones registradas."}
          </div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`Elución ${mAnular.loteGenerador} — ${mAnular.actividadEluida} mCi (${mAnular.sedeNombre || catalogo.sedes[mAnular.sedeId]?.nombre})`}
          notaExtra={
            mAnular.sedeId === sedeId
              ? "Después de confirmar se abre el formulario precargado con estos mismos datos para que corrijas sólo lo que estaba mal."
              : `Es un registro de ${catalogo.sedes[mAnular.sedeId]?.nombre || "otra sede"} -- no se precarga ningún dato: la corrección se carga desde los libros de esa sede, no desde acá.`
          }
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
