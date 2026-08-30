import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { QRScanner } from "../../components/scanner/QRScanner.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, capitalizarPalabras, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { parseQR } from "../../helpers/qr.js";
import { prepararSonidoEscaneo } from "../../helpers/feedbackEscaneo.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { normalizarFicha, compararPorSedeYFicha } from "../../helpers/fichaPaciente.js";
import { TIPO_LABEL_I131 } from "../../constants/tipoI131.js";
import {
  listenActas, addActaPaciente, actasPorRango, anularActaTransaction, listenAnulacionesActas,
  addActaI131Ablativa, addActaI131Dosis, addActaI131Barrido,
  addActaI131Captacion, addActaI131Centellograma, addActaI131CaptacionCentellograma,
  resolverFichaIntento, obtenerUltimaFicha, listenActasMarcacionHoy,
} from "../../services/firestore/actas.js";
import { listenMibgLotes, administrarMibgTransaction, administrarLutecioTransaction } from "../../services/firestore/mibgLotes.js";
import { estadoMibgLote } from "../../helpers/mibgLote.js";

const TIMEOUT_BUSQUEDA_MS = 20000;
const MSJ_TIMEOUT_BUSQUEDA = "La consulta tardó demasiado, puede haber un problema de conexión -- intentá cerrar las otras pestañas de RadioFarm que tengas abiertas y reintentá.";

// Sin esto, una consulta que nunca resuelve (ver nota en exportarRango) deja
// el botón trabado en "Buscando..." para siempre, sin ningún error visible.
function conTimeout(promesa, ms, mensaje) {
  let idTimeout;
  const timeout = new Promise((_, reject) => { idTimeout = setTimeout(() => reject(new Error(mensaje)), ms); });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));
}

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Conformidad de un lote (MIBG/Lutecio-177) -- 3 estados, no 2: además de
// Sí/No, los lotes de MIBG cargados antes de que este campo existiera no
// tienen el dato (null/undefined), y eso no es lo mismo que "No conforme"
// -- mostrarlo en rojo alarmaría por algo que nunca se cargó, no por un
// problema real. "Sin dato" queda neutro a propósito.
function textoConformidad(lote) {
  if (lote.conformidad === true) return { texto: "Sí", clase: "text-green-700 font-semibold" };
  if (lote.conformidad === false) return { texto: "No conforme", clase: "text-red-600 font-semibold" };
  return { texto: "Sin dato", clase: "text-gray-400" };
}

// Tabla que maneja los 6 tipos de registro de I-131 -- categoria decide qué
// campos pide el formulario y cómo se guarda (ver guardar()); requierePermiso
// decide el gate de accesoTerapiaI131, tanto acá (deshabilita la opción)
// como en la regla de Firestore (tieneAccesoI131(), respaldo server-side).
// Barrido corporal es el único sin permiso especial.
// MIBG (131I-MIBG) es su propia categoria -- sin fn genérica: no es un alta
// simple, es administrarMibgTransaction(loteId, data) (ver guardar()), la
// única de las 7 que necesita leer el lote elegido antes de escribir.
const TIPOS_I131 = [
  { id: "ablativa", label: "Dosis ablativa", categoria: "dosis", requierePermiso: true, fn: addActaI131Ablativa },
  { id: "dosis", label: "Dosis terapéutica", categoria: "dosis", requierePermiso: true, fn: addActaI131Dosis },
  { id: "barrido", label: "Barrido corporal", categoria: "barrido", requierePermiso: false, fn: addActaI131Barrido },
  { id: "mibg", label: "MIBG", categoria: "mibg", requierePermiso: false, fn: null },
  { id: "captacion", label: "Captación", categoria: "diagnostico", requierePermiso: true, fn: addActaI131Captacion },
  { id: "centellograma", label: "Centellograma", categoria: "diagnostico", requierePermiso: true, fn: addActaI131Centellograma },
  { id: "capt_centellograma", label: "Captación y Centellograma", categoria: "diagnostico", requierePermiso: true, fn: addActaI131CaptacionCentellograma },
];

export function TabPacientes({ catalogo, usuario, esAdmin, onToast, nav }) {
  const [pacientesTodas, setPacientesTodas] = useState([]);
  const [ablativaI131, setAblativaI131] = useState([]);
  const [barridosI131, setBarridosI131] = useState([]);
  const [captacionI131, setCaptacionI131] = useState([]);
  const [centellogramaI131, setCentellogramaI131] = useState([]);
  const [captCentellogramaI131, setCaptCentellogramaI131] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [loteExpandidoId, setLoteExpandidoId] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarQR, setMostrarQR] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  // Sede efectiva de ESTA pantalla: fija (usuario.sede) para un técnico;
  // para admin, la que esté auditando ahora (sedeAuditando, elegida en
  // Configuración) -- ya no hay selector propio acá ni opción "todas las
  // sedes" (ver firestore.rules, roles/{email}: un libro es de una sede a
  // la vez, siempre). Puede venir undefined si el admin nunca eligió
  // ninguna -- ver el early return más abajo, antes de armar cualquier
  // query (where(sedeId,"==",undefined) tira excepción del lado cliente).
  const sedeEfectiva = esAdmin ? usuario.sedeAuditando : usuario.sede;
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [buscandoRango, setBuscandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState(null);
  // null = todavía no se buscó; array (incluso vacío) = resultado en memoria
  // de la última búsqueda, listo para descargar sin volver a consultar.
  const [resultadoRango, setResultadoRango] = useState(null);
  const [busq, setBusq] = useState("");

  function cambiarRango(setter) {
    return (e) => { setter(e.target.value); setResultadoRango(null); setErrorRango(null); };
  }

  const [fichaNro, setFichaNro] = useState("");
  // null | { tipo: "formato" } | { tipo: "usada", data } -- se limpia solo
  // apenas fichaNro cambia (ver onChange más abajo), así nunca queda un
  // error viejo pegado a un valor ya distinto.
  const [fichaEstado, setFichaEstado] = useState(null);
  // Último "sugerida - 1" ya resuelto por precargarSugerenciaFicha (one-shot,
  // ver obtenerUltimaFicha) -- alimenta SÓLO el placeholder de abajo, para
  // el instante en que fichaNro está vacío. Ya no es un listener en tiempo
  // real (listenUltimaFicha se sacó): el camino real de la sugerencia hace
  // rato dejó de depender de él (precargarSugerenciaFicha ya resuelve
  // fresco con un getDocs one-shot cada vez que hace falta), así que
  // mantenerlo como onSnapshot sólo pagaba una lectura incremental por cada
  // ficha nueva de la sede, en cada sesión con Libro 2 abierto, por un
  // placeholder que casi nunca llega a verse (el campo siempre se precarga
  // con un valor real al abrir el form).
  const [ultimaFicha, setUltimaFicha] = useState(null);
  // true apenas el campo de Ficha recibe un input REAL del usuario (ver
  // onChange del Input más abajo) -- false cada vez que la propia app lo
  // rellena (precarga, refresco al cambiar de sede, dato del QR, reintento
  // post-anulación, o limpiarForm). Un <input> controlado sólo dispara su
  // onChange ante una interacción real -- un setFichaNro(x) desde código
  // nunca lo hace, así que el flag es tan simple como marcar true ahí y
  // false en cada lugar que precarga el valor. Sirve para decidir, al
  // cambiar de sede (banner "Guardar en sede"), si hay que REFRESCAR la
  // sugerencia (valor todavía intacto) o sólo REVALIDAR lo ya tipeado.
  const [fichaTocada, setFichaTocada] = useState(false);
  // isotopoId siempre presente al guardar (nunca ausente) -- "tc99m" es el
  // comportamiento por defecto sin selector visible (99% de los casos, cero
  // fricción). mostrarIsotopo sólo controla si el link "¿Es un caso
  // distinto...?" ya se tocó, para revelar el selector -- no se persiste.
  const [mostrarIsotopo, setMostrarIsotopo] = useState(false);
  const [isotopoId, setIsotopoId] = useState("tc99m");
  const [medicoResponsable, setMedicoResponsable] = useState("");
  const [nombre, setNombre] = useState(""); const [dni, setDni] = useState("");
  const [peso, setPeso] = useState(""); const [talla, setTalla] = useState("");
  const [estudio, setEstudio] = useState(""); const [mci, setMci] = useState("");
  // "Otro" no sale de la colección estudios -- es una opción fija de UI que
  // revela este campo. Lo que se guarda en el acta es el texto tipeado acá,
  // nunca el literal "Otro".
  const [estudioOtro, setEstudioOtro] = useState("");
  const [farmId, setFarmId] = useState(""); const [lote, setLote] = useState("");
  const [obs, setObs] = useState("");
  const [sedeId, setSedeId] = useState(usuario.sede);
  // Lista de lotes seleccionables (Tc-99m) -- por defecto SÓLO los
  // marcados hoy en Libro 1 (regla de negocio confirmada: el evento que
  // manda es la Marcación, no el Egreso/stock). "Ver todos los lotes en
  // stock" es la vía de escape para un caso excepcional (corrección de un
  // error, lote marcado ayer, etc.) -- apagada por defecto a propósito,
  // para no competir con el flujo normal.
  const [verTodoElStock, setVerTodoElStock] = useState(false);
  const [marcadosHoyRaw, setMarcadosHoyRaw] = useState([]);
  useEffect(() => { if (sedeId) return listenActasMarcacionHoy(sedeId, setMarcadosHoyRaw); }, [sedeId]);
  // Sólo para isotopoId === "i131" -- ver esI131/guardar() más abajo. El N°
  // de Ficha, nombre, DNI, médico responsable y lote ya están arriba
  // (compartidos con Tc-99m/Lutecio, mismo campo/misma numeración diaria
  // correlativa de VM RIS -- ese es justamente el motivo de este cambio).
  const [tipoI131, setTipoI131] = useState("barrido");
  const [actividadAdministrada, setActividadAdministrada] = useState("");
  const [indicacion, setIndicacion] = useState("");
  const [dosisVinculada, setDosisVinculada] = useState("");
  const [dosisI131, setDosisI131] = useState([]);
  const [mibgI131, setMibgI131] = useState([]);
  const [mibgLotes, setMibgLotes] = useState([]);
  const [mibgLoteSeleccionado, setMibgLoteSeleccionado] = useState("");
  const [lutecioLoteSeleccionado, setLutecioLoteSeleccionado] = useState("");

  useEffect(() => { if (sedeEfectiva) return listenActas("paciente", setPacientesTodas, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenAnulacionesActas(setAnulacionesRaw, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  // Un listener por tipo de I-131 (mismo criterio que dosis/barrido ya
  // tenían) -- dosisI131/ablativaI131 alimentan además el picker "Dosis
  // relacionada" de los 3 diagnósticos (ver dosisParaVincular). Todos se
  // mezclan en el listado principal -- el N° de Ficha es una secuencia
  // correlativa propia de CADA SEDE (asignada por VM RIS -- ver
  // helpers/fichaPaciente.js), así que "Registros del día" tiene que
  // mostrar los 7 tipos intercalados por hora para no dejar saltos de
  // ficha sin explicación visible dentro de la misma sede. La pestaña
  // "Gestión I-131" (consulta) sigue siendo el filtro específico de estos
  // mismos 7 tipos, sin cambios.
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_ablativa", setAblativaI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_dosis", setDosisI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_barrido", setBarridosI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_mibg", setMibgI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_captacion", setCaptacionI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_centellograma", setCentellogramaI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_captacion_centellograma", setCaptCentellogramaI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  // mibgLotes/mibgUsos no se mezclan en actasTodas (mibg_lote no es una
  // acta) -- alimentan sólo el picker "Lote disponible" de abajo, filtrado
  // en tiempo real: un lote usado por otra técnica desaparece para todos al
  // instante, sin importar el día (ver lotesMibgDisponibles).
  useEffect(() => { if (sedeEfectiva) return listenMibgLotes(setMibgLotes, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);

  // Pre-chequeo amigable (aviso inmediato antes de intentar guardar) -- la
  // garantía real es el choque server-side contra el marcador create-only
  // de ese intento puntual (fichaUsadaRef/fichaIntentoHabilitado en
  // firestore.rules), esto es sólo para no hacerle esperar al técnico
  // hasta el intento de guardado. Se dispara al perder el foco del campo,
  // no en cada tecla (evita una consulta por cada dígito tipeado).
  // fichaEstado.intento (cuando tipo=="ok") es el intento 1..5 YA resuelto
  // que guardar() manda tal cual -- Guardar queda deshabilitado hasta que
  // esto resuelva, ver disabled del botón más abajo.
  //
  // Recibe sede y valor a chequear como parámetros explícitos (no los lee
  // del estado) porque confirmarAnulacion/precargarSugerenciaFicha precargan
  // el campo (y a veces la sede) y necesitan disparar el chequeo en el
  // mismo instante -- si leyeran de React state ahí, todavía tendrían el
  // valor viejo (closure stale, un setState no se refleja hasta el próximo
  // render). La unicidad es por (sede, número) -- ver nota larga en
  // firestore.rules -- así que sedeId es tan parte de la consulta como el
  // número mismo.
  async function resolverYSetFichaEstado(sedeIdChequeo, valorFicha) {
    const normalizada = normalizarFicha(valorFicha);
    if (!valorFicha?.trim()) { setFichaEstado(null); return; }
    if (!normalizada) { setFichaEstado({ tipo: "formato" }); return; }
    setFichaEstado("verificando");
    const r = await resolverFichaIntento(sedeIdChequeo, normalizada);
    if (r.intento) setFichaEstado({ tipo: "ok", intento: r.intento });
    else if (r.agotado) setFichaEstado({ tipo: "agotado" });
    else setFichaEstado({ tipo: "usada", data: r.bloqueadaPor });
  }
  function chequearFicha() {
    return resolverYSetFichaEstado(sedeId, fichaNro);
  }

  // Precarga el campo N° de Ficha con la sugerencia (último real cargado +
  // 1, de la sede recibida como parámetro) como valor REAL y editable, no
  // sólo placeholder -- así un Tab/clic afuera sin tipear nada la acepta
  // tal cual (ver onFocus del Input más abajo, que selecciona todo para
  // que escribir encima reemplace al instante). Resuelve fichaEstado de
  // una, mismo motivo que confirmarAnulacion ya hace con su propio
  // precargado: si el técnico nunca visita el campo, Guardar no debe
  // quedar esperando un blur que no va a llegar.
  //
  // sedeIdDestino es OBLIGATORIO, nunca lee sedeId del estado -- mismo
  // motivo de siempre (closure stale si se llama justo después de un
  // setSedeId en el mismo handler síncrono, ver resolverYSetFichaEstado).
  // Usa obtenerUltimaFicha (one-shot) en vez del ultimaFicha reactivo:
  // tras un cambio de sede recién disparado, el listener de listenUltimaFicha
  // (atado a [sedeId]) todavía no trajo el primer snapshot de la sede
  // nueva -- ultimaFicha seguiría reflejando la sede VIEJA por un
  // instante. Limpia el campo de una (sin dejar ver, ni un instante, el
  // número de la sede vieja) mientras resuelve.
  async function precargarSugerenciaFicha(sedeIdDestino) {
    setFichaNro(""); setFichaTocada(false); setFichaEstado(null);
    const ultima = await obtenerUltimaFicha(sedeIdDestino);
    setUltimaFicha(ultima);
    const sugerida = ultima != null ? String(ultima + 1) : "";
    setFichaNro(sugerida);
    setFichaTocada(false);
    resolverYSetFichaEstado(sedeIdDestino, sugerida);
  }

  // nav ({busqueda, token}) llega desde "Ir a Libro 2" (bloqueo de anulación
  // de un lote de MIBG/Lutecio-177 con administración activa,
  // TabLoteDosisUnica.jsx) -- limpia el filtro de fecha (la administración
  // puede ser de cualquier día) y precarga el buscador con el DNI del
  // paciente, para no obligar a buscarlo a mano. Ya NO limpia el filtro de
  // sede -- ahora sólo existe sedeEfectiva (fija, o la sede auditada por
  // admin), así que esto sólo encuentra la acta si está en esa misma sede.
  useEffect(() => {
    if (!nav?.token) return;
    setFiltroFecha("");
    setBusq(nav.busqueda || "");
  }, [nav?.token]);

  // Cada colección ya viene ordenada desc por fecha desde el listener, así
  // que sólo hace falta mezclar y volver a ordenar, no reordenar cada una.
  const actasTodas = useMemo(
    () => [...pacientesTodas, ...ablativaI131, ...dosisI131, ...barridosI131, ...mibgI131, ...captacionI131, ...centellogramaI131, ...captCentellogramaI131]
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [pacientesTodas, ablativaI131, dosisI131, barridosI131, mibgI131, captacionI131, centellogramaI131, captCentellogramaI131]
  );

  // anulaId -> acta de anulación (motivo, fecha, quién) -- Map en vez de Set
  // porque el listado necesita mostrar el motivo, no sólo saber que existe.
  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // "Disponible" para el picker de abajo, en tiempo real -- misma derivación
  // que TabLoteDosisUnica.jsx (estadoMibgLote, ver helpers/mibgLote.js: antes
  // cada pantalla tenía su propia lógica y divergieron, auditoría #12).
  // !anulaciones.has(u.id): anular la administración es independiente de
  // anular el lote (corrección de diseño posterior) -- el lote vuelve a
  // "disponible" apenas se anula la acta que lo usaba, sin tocar el lote.
  // Filtra por la sede elegida en el FORMULARIO (sedeId), no por
  // usuario.sede -- admin puede cambiarla.
  const usoPorLoteId = useMemo(() => new Map(mibgI131.filter((u) => !anulaciones.has(u.id)).map((u) => [u.mibgLoteId, u])), [mibgI131, anulaciones]);
  const lotesMibgDisponibles = useMemo(
    () => mibgLotes.filter((l) => (l.isotopoId || "mibg") === "mibg" && l.sedeId === sedeId && estadoMibgLote(l.id, { anulaciones, usoPorLoteId }) === "disponible")
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [mibgLotes, sedeId, anulaciones, usoPorLoteId]
  );

  // Mismo criterio para Lutecio-177 (Libro 4) -- el "uso" acá es un acta
  // 'paciente' (isotopoId 'lu177') con loteDosisUnicaId, no i131_mibg, así
  // que el mapa se arma distinto, pero estadoMibgLote es el mismo (ya es
  // agnóstico de isótopo). Reusa pacientesTodas/mibgLotes, ya escuchados
  // arriba -- ningún listener nuevo.
  const usoLutecioPorLoteId = useMemo(
    () => new Map(pacientesTodas.filter((p) => p.isotopoId === "lu177" && p.loteDosisUnicaId && !anulaciones.has(p.id)).map((p) => [p.loteDosisUnicaId, p])),
    [pacientesTodas, anulaciones]
  );
  const lotesLutecioDisponibles = useMemo(
    () => mibgLotes.filter((l) => l.isotopoId === "lutecio177" && l.sedeId === sedeId && estadoMibgLote(l.id, { anulaciones, usoPorLoteId: usoLutecioPorLoteId }) === "disponible")
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [mibgLotes, sedeId, anulaciones, usoLutecioPorLoteId]
  );

  // Ver el lote vinculado (MIBG o Lutecio-177) al consultar el registro --
  // mibgLotes YA está completo en memoria (sin límite, sin filtro de fecha:
  // listenMibgLotes trae TODOS los lotes de la sede, siempre, porque el
  // picker de arriba lo necesita) así que un lookup por id alcanza, sin
  // get() nuevo ni denormalizar nada en el acta. El lote es inmutable, no
  // hay riesgo de mostrar un dato desactualizado.
  const mibgLotesPorId = useMemo(() => new Map(mibgLotes.map((l) => [l.id, l])), [mibgLotes]);
  const loteVinculadoDe = (a) => mibgLotesPorId.get(a.mibgLoteId || a.loteDosisUnicaId) || null;

  async function confirmarAnulacion(acta, motivo) {
    try {
      // Anular la administración a un paciente (MIBG/Lutecio-177 incluidos)
      // es independiente de anular el lote -- son dos hechos distintos (el
      // lote es la llegada del vial, la acta es la dosis realmente
      // inyectada). El lote NO se toca acá: sigue válido y, apenas se anula
      // esta acta, vuelve a aparecer "disponible" en el picker (ver
      // usoPorLoteId/usoLutecioPorLoteId más arriba), listo para
      // reasignarlo con el dato de dosis corregido.
      await anularActaTransaction(acta, motivo, usuario);
      const tieneLote = acta.mibgLoteId || acta.loteDosisUnicaId;
      onToast(
        tieneLote
          ? "Registro anulado. El lote sigue siendo válido y quedó disponible para reasignar (a este paciente u otro) con el dato de dosis corregido."
          : "Registro anulado",
        "info", tieneLote ? 10000 : 6000
      );
      setMAnular(null);
      // Precarga el formulario con los mismos datos para corregir sólo lo
      // que estaba mal, en vez de tipear todo de nuevo. i131_mibg es el
      // primer subtipo de I-131 con botón Anular en Libro 2 (antes limitado
      // a tipo:"paciente") -- necesita su propia rama, no la reconoce el
      // criterio isotopoId de abajo (los 6 subtipos de I-131 no tienen ese
      // campo, distinguen por tipo).
      setSedeId(acta.sedeId); setFichaNro(acta.pacienteFicha || ""); setFichaTocada(false); setNombre(acta.pacienteNombre); setDni(acta.pacienteDni);
      // Dispara el chequeo/resolución del intento siguiente de una (no
      // espera a que el técnico toque el campo) -- recién anulamos el
      // intento anterior arriba, así que este chequeo YA lo ve anulado y
      // resuelve el próximo libre. Sin esto, Guardar quedaría deshabilitado
      // hasta que el técnico clickeara el campo de Ficha y saliera de él.
      // acta.sedeId directo (no el sedeId de estado): el setSedeId de arriba
      // recién se aplica en el próximo render, closure stale si se leyera acá.
      resolverYSetFichaEstado(acta.sedeId, acta.pacienteFicha || "");
      setPeso(String(acta.peso ?? "")); setTalla(String(acta.talla ?? "")); setEstudio(acta.estudio || "");
      setObs(acta.observacion || "");
      if (acta.tipo === "i131_mibg") {
        setMostrarIsotopo(true); setIsotopoId("i131"); setTipoI131("mibg");
        setMibgLoteSeleccionado(acta.mibgLoteId || "");
        setActividadAdministrada(String(acta.actividadAdministrada ?? ""));
      } else {
        const iso = acta.isotopoId || "tc99m";
        setMostrarIsotopo(iso !== "tc99m"); setIsotopoId(iso); setMedicoResponsable(acta.medicoResponsable || "");
        setFarmId(acta.farmId || ""); setLote(acta.lote); setMci(String(acta.mciAdministrados ?? ""));
        if (iso === "lu177") {
          setLutecioLoteSeleccionado(acta.loteDosisUnicaId || "");
          setActividadAdministrada(String(acta.mciAdministrados ?? ""));
        }
      }
      setMostrarForm(true);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function handleQRResult(raw) {
    setMostrarQR(false);
    const data = parseQR(raw);
    if (data) {
      setNombre(data.pacienteNombre); setDni(data.pacienteDni);
      setPeso(data.peso); setTalla(data.talla); setEstudio(data.estudio || "");
      // Pulseras nuevas traen el N° de Ficha como 6to campo del QR (ver
      // parseQR) -- si viene y es un formato válido, se precarga ESE
      // número en vez de la sugerencia genérica de "último + 1". Un QR
      // viejo de 5 campos (o el campo vacío/no numérico) cae al mismo
      // fallback de siempre. Se valida contra `sedeId` (la sede ACTIVA del
      // formulario, no una global) -- este flujo no cambia de sede, así que
      // el valor de estado es válido acá (sin el riesgo de closure stale
      // que sí aplica en confirmarAnulacion).
      const fichaDelQR = normalizarFicha(data.pacienteFicha);
      if (fichaDelQR) { setFichaNro(fichaDelQR); setFichaTocada(false); resolverYSetFichaEstado(sedeId, fichaDelQR); }
      else precargarSugerenciaFicha(sedeId);
      setMostrarForm(true);
      onToast("Pulsera leída correctamente", "success");
    } else {
      onToast("QR no reconocido. Ingresá los datos manualmente.", "error");
      precargarSugerenciaFicha(sedeId);
      setMostrarForm(true);
    }
  }

  function limpiarForm() {
    setFichaNro(""); setFichaTocada(false); setFichaEstado(null); setNombre(""); setDni(""); setPeso(""); setTalla(""); setEstudio(""); setEstudioOtro(""); setMci(""); setFarmId(""); setLote(""); setObs("");
    setMostrarIsotopo(false); setIsotopoId("tc99m"); setMedicoResponsable("");
    setTipoI131("barrido"); setActividadAdministrada(""); setIndicacion(""); setDosisVinculada(""); setMibgLoteSeleccionado(""); setLutecioLoteSeleccionado("");
    setSedeId(usuario.sede); setVerTodoElStock(false);
  }

  const esLutecio = isotopoId === "lu177";
  const esI131 = isotopoId === "i131";
  const puedeCargarDosisI131 = esAdmin || !!usuario.accesoTerapiaI131;

  // Lutecio-177 e I-131 son los únicos "casos distintos" de hoy -- lista
  // blanca explícita por id, no "todo lo que no sea tc99m": agregar una fila
  // a radioisotopos no debe hacer aparecer nada acá por sí sola (ver nota en
  // services/firestore/radioisotopos.js). I-131 ya no tiene pestaña propia de
  // carga -- toda la carga de pacientes (sea cual sea el isótopo) vive acá,
  // porque el N° de Ficha es una secuencia única DENTRO DE CADA SEDE,
  // compartida por todos los isótopos de esa sede (no por isótopo); Gestión
  // I-131 pasó a ser sólo una vista de consulta de estos mismos registros
  // (6 tipos, sin cambios de modelo).
  const isotoposCasoDistinto = (catalogo.radioisotopos || []).filter((i) => i.id === "lu177" || i.id === "i131");

  const tipoI131Actual = TIPOS_I131.find((t) => t.id === tipoI131);

  // Dosis/Ablativas recientes ya cargadas en memoria (mismo límite/sede que
  // el resto de esta pantalla) para vincular un diagnóstico (Captación/
  // Centellograma/Captación y Centellograma) al registro de dosis que lo
  // motivó, sin disparar una consulta nueva -- si hay DNI tipeado, prioriza
  // coincidencias de ese paciente.
  const dosisParaVincular = useMemo(() => {
    const todas = [...dosisI131, ...ablativaI131];
    const propias = dni.trim() ? todas.filter((d) => d.pacienteDni === dni.trim()) : [];
    return (propias.length ? propias : todas).sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha));
  }, [dosisI131, ablativaI131, dni]);

  function guardar() {
    const fichaNormalizada = normalizarFicha(fichaNro);
    if (!fichaNormalizada || !nombre.trim() || !dni.trim() || fichaEstado?.tipo !== "ok") return;
    if (esI131) {
      const base = {
        sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
        // fichaIntentoNro: sólo hace falta para las 4 categorías que son
        // alta simple (dosis/diagnostico/barrido -- ver crearActaConFicha
        // en actas.js); para "mibg" administrarMibgTransaction lo vuelve a
        // resolver DENTRO de su transacción y pisa este valor, así que
        // mandarlo acá también no hace daño.
        pacienteFicha: fichaNormalizada, fichaIntentoNro: fichaEstado?.intento, pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
        // Opcionales para I-131 -- se omiten del todo si quedaron vacíos, en
        // vez de mandar 0 (que se leería como "pesa 0kg", no "sin dato").
        ...(peso.trim() ? { peso: parseFloat(peso) || 0 } : {}),
        ...(talla.trim() ? { talla: parseFloat(talla) || 0 } : {}),
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
      };
      if (tipoI131Actual.requierePermiso && !puedeCargarDosisI131) return;
      if (tipoI131Actual.categoria === "dosis") {
        if (!actividadAdministrada || !lote.trim()) return;
        tipoI131Actual.fn({ ...base, actividadAdministrada: parseFloat(actividadAdministrada) || 0, unidadActividad: "mCi", lote: lote.trim(), indicacion: indicacion.trim() })
          .catch((e) => onToast(e.message || "No se pudo guardar el registro", "error"));
        onToast(`${tipoI131Actual.label} registrada — consultala en la pestaña Gestión I-131`);
      } else if (tipoI131Actual.categoria === "diagnostico") {
        if (!actividadAdministrada) return;
        tipoI131Actual.fn({ ...base, actividadAdministrada: parseFloat(actividadAdministrada) || 0, unidadActividad: "uCi", dosisActaId: dosisVinculada || null })
          .catch((e) => onToast(e.message || "No se pudo guardar el registro", "error"));
        onToast(`${tipoI131Actual.label} registrado — consultalo en la pestaña Gestión I-131`);
      } else if (tipoI131Actual.categoria === "mibg") {
        // A diferencia del resto (fire-and-forget, offline-safe), esto es
        // una transacción real -- puede fallar de verdad si otra técnica
        // usó el mismo lote un instante antes. El toast de éxito espera a
        // que la transacción confirme, en vez de mostrarse optimista.
        // actividadCalibrada/volumen se denormalizan del lote como dato de
        // REFERENCIA (lo que llegó); actividadAdministrada es lo que el
        // técnico tipeó como realmente inyectado -- casi nunca coinciden
        // por decaimiento entre la llegada y la administración. Ya no se
        // copia uno como si fuera el otro.
        if (!mibgLoteSeleccionado || !actividadAdministrada) return;
        const loteElegido = mibgLotes.find((l) => l.id === mibgLoteSeleccionado);
        if (!loteElegido) return;
        administrarMibgTransaction(mibgLoteSeleccionado, {
          ...base, numeroLote: loteElegido.numeroLote, actividadCalibrada: loteElegido.actividadCalibrada, volumen: loteElegido.volumen,
          actividadAdministrada: parseFloat(actividadAdministrada) || 0,
        })
          .then(() => onToast("MIBG registrado — consultalo en la pestaña Gestión I-131"))
          .catch((e) => onToast(e.message || "No se pudo registrar la administración de MIBG", "error"));
      } else {
        tipoI131Actual.fn(base)
          .catch((e) => onToast(e.message || "No se pudo guardar el barrido", "error"));
        onToast("Barrido corporal registrado — consultalo en la pestaña Gestión I-131");
      }
      limpiarForm(); setMostrarForm(false);
      return;
    }
    if (esLutecio) {
      // Libro 4: mismo rigor que MIBG -- el lote se elige de un picker
      // vinculado (ya no texto libre). mciAdministrados es lo que el
      // técnico tipeó como realmente inyectado; actividadCalibrada se
      // denormaliza del lote sólo como dato de REFERENCIA (lo que llegó) --
      // casi nunca coinciden por decaimiento, ya no se copia uno como si
      // fuera el otro. Transacción real por el mismo motivo que MIBG: puede
      // fallar de verdad si otra técnica usó el mismo lote un instante antes.
      if (!lutecioLoteSeleccionado || !medicoResponsable.trim() || !actividadAdministrada) return;
      const loteElegido = mibgLotes.find((l) => l.id === lutecioLoteSeleccionado);
      if (!loteElegido) return;
      administrarLutecioTransaction(lutecioLoteSeleccionado, {
        sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
        pacienteFicha: fichaNormalizada, pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
        peso: parseFloat(peso) || 0, talla: parseFloat(talla) || 0,
        mciAdministrados: parseFloat(actividadAdministrada) || 0, actividadCalibrada: loteElegido.actividadCalibrada,
        isotopoId, lote: loteElegido.numeroLote,
        medicoResponsable: medicoResponsable.trim(),
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
      })
        .then(() => onToast("Lutecio-177 registrado — consultalo en Libro 4"))
        .catch((e) => onToast(e.message || "No se pudo registrar la administración de Lutecio-177", "error"));
      limpiarForm(); setMostrarForm(false);
      return;
    }
    if (!mci || !estudio || !lote.trim()) return;
    if (estudio === "Otro" && !estudioOtro.trim()) return;
    if (!farmId) return;
    const farm = catalogo.farms.find((f) => f.id === farmId);
    addActaPaciente({
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      pacienteFicha: fichaNormalizada, fichaIntentoNro: fichaEstado?.intento,
      pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
      peso: parseFloat(peso) || 0, talla: parseFloat(talla) || 0,
      estudio: estudio === "Otro" ? estudioOtro.trim() : estudio, mciAdministrados: parseFloat(mci) || 0,
      isotopoId, lote: lote.trim(), farmId, farmNombre: farm?.nombre || "",
      usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
    }).catch((e) => onToast(e.message || "No se pudo guardar el registro", "error"));
    onToast("Registro guardado"); limpiarForm(); setMostrarForm(false);
  }

  // Filtro client-side sobre lo que ya está en memoria (dentro de la fecha o
  // rango elegido) -- no dispara ninguna consulta nueva a Firestore. Como
  // "actas" también alimenta el CSV, buscar acá filtra lo que se exporta,
  // igual que ya pasa con el filtro de fecha. El filtro de sede acá es sólo
  // defensivo (la query ya viene acotada a sedeEfectiva server-side).
  const busqNorm = busq.trim().toLowerCase();
  const actas = useMemo(
    () => actasTodas.filter((a) =>
      (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) &&
      (!sedeEfectiva || a.sedeId === sedeEfectiva) &&
      (!busqNorm || a.pacienteNombre?.toLowerCase().includes(busqNorm) || a.pacienteDni?.toLowerCase().includes(busqNorm))
    ),
    [actasTodas, filtroFecha, sedeEfectiva, busqNorm]
  );

  // Orden de LISTADO (no de datos): por N° de Ficha dentro de cada sede, no
  // por cuándo terminó de guardarse cada acta -- ver compararPorSedeYFicha.
  // Deriva de "actas" (que sigue ordenado por fecha desc, tal cual viene de
  // Firestore) SIN tocarla -- "actas" sigue alimentando el CSV tal cual
  // (descargarCSV más abajo), que tiene que reflejar la fecha real de
  // guardado, no este orden visual.
  const actasOrdenadas = useMemo(() => [...actas].sort(compararPorSedeYFicha), [actas]);

  // Sólo se agrupa por fecha en "Ver todos" -- con un día ya filtrado, todos
  // los registros mostrados comparten fecha y un separador no aportaría nada.
  // agruparPorFecha necesita el array en orden de fecha (detecta grupos por
  // adyacencia) -- por eso agrupa sobre "actas", NUNCA sobre
  // actasOrdenadas -- y el orden por ficha se aplica DESPUÉS, sólo dentro de
  // cada grupo ya armado, sin tocar qué fechas quedan agrupadas juntas.
  const grupos = useMemo(() => {
    if (filtroFecha) return null;
    return agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))
      .map((g) => ({ ...g, items: [...g.items].sort(compararPorSedeYFicha) }));
  }, [actas, filtroFecha]);

  const lotesEnStock = (catalogo.stock[sedeId]?.[farmId] || []).filter((l) => l.cantidad > 0);
  // Marcados HOY para el radiofármaco elegido -- deduplicados por lote (si
  // el mismo lote se marcó varias veces hoy, aparece una sola vez; si se
  // marcaron lotes DISTINTOS, todos aparecen -- se acumulan, no se
  // reemplazan). El vencimiento es sólo un dato de Inventario, no de
  // Marcación -- se cruza acá contra el stock SOLO para mostrarlo si
  // todavía existe ahí; si ya no está (se consumió desde que se marcó), el
  // lote igual queda en la lista, sin ese dato extra.
  const lotesMarcadosHoy = useMemo(() => {
    const stockPorLote = new Map(lotesEnStock.map((l) => [l.lote, l]));
    const lotesUnicos = [...new Set(marcadosHoyRaw.filter((a) => a.farmId === farmId).map((a) => a.lote))];
    return lotesUnicos.map((loteTxt) => ({ id: loteTxt, lote: loteTxt, vencimiento: stockPorLote.get(loteTxt)?.vencimiento }));
  }, [marcadosHoyRaw, farmId, lotesEnStock]);
  const lotesDisp = verTodoElStock ? lotesEnStock : lotesMarcadosHoy;

  // "tc99m" (o ausente, actas viejas anteriores a este cambio) no se marca
  // con nada -- es el caso de siempre. Sólo Lutecio-177 se distingue en el
  // listado/CSV.
  function nombreIsotopo(a) {
    if (!a.isotopoId || a.isotopoId === "tc99m") return null;
    return catalogo.radioisotopos?.find((i) => i.id === a.isotopoId)?.nombre || a.isotopoId;
  }

  // Badge de tipo de registro -- mismo criterio que TIPO_INFO en Historial
  // (helpers/formato no lo exporta, es chico y sólo se usa acá). null = sin
  // badge (Tc-99m, caso habitual, no aporta nada verlo marcado en cada fila).
  function tipoInfo(a) {
    if (TIPO_LABEL_I131[a.tipo]) return TIPO_LABEL_I131[a.tipo];
    const iso = nombreIsotopo(a);
    return iso ? { label: iso, color: "purple" } : null;
  }

  // Detalle: cada tipo usa esta columna/línea para algo distinto (radiofármaco
  // real para Tc-99m, sólo lote para Lutecio/Dosis-Ablativa I-131, vínculo a
  // la dosis para los 3 diagnósticos) -- se centraliza acá para no repetir la
  // misma cadena de condiciones en la fila y en la tarjeta. Barrido no lleva
  // vínculo (se sacó de ahí, ver TIPOS_I131) así que siempre queda en "—".
  function detalleRegistro(a) {
    if (a.tipo === "i131_ablativa" || a.tipo === "i131_dosis") return { principal: `Lote: ${a.lote || "—"}`, sub: a.indicacion || null };
    if (a.tipo === "i131_captacion" || a.tipo === "i131_centellograma" || a.tipo === "i131_captacion_centellograma") {
      return { principal: a.dosisActaId ? "Vinculado a dosis" : "—", sub: null };
    }
    if (a.tipo === "i131_barrido") return { principal: "—", sub: null };
    if (a.tipo === "i131_mibg") return { principal: `Lote MIBG: ${a.numeroLote || "—"}`, sub: null };
    return { principal: a.isotopoId === "lu177" ? null : (a.farmNombre || "—"), sub: a.lote || null };
  }

  // Misma magnitud física (actividad administrada) para Tc-99m/Lutecio
  // (mciAdministrados, siempre mCi, tipeado a mano) y los 6 tipos de I-131
  // con actividad (actividadAdministrada, mCi para dosis/ablativa/MIBG, µCi
  // para los 3 diagnósticos, todos tipeados a mano) -- se unifica en una
  // sola columna con su unidad real, no un sufijo "mCi" fijo. unidadActividad
  // ausente (actas i131_dosis anteriores a este cambio) se interpreta como
  // mCi, mismo criterio que isotopoId ausente = tc99m. El tercer fallback
  // (actividadCalibrada del lote) es sólo para actas de MIBG previas a que
  // existiera actividadAdministrada como campo separado -- ver corrección de
  // diseño: antes se copiaba la actividad de llegada del lote como si fuera
  // lo administrado, ahora son dos campos distintos. Barrido corporal no
  // administra nada nuevo.
  function dosisRegistro(a) {
    if (a.mciAdministrados != null) return { valor: a.mciAdministrados, unidad: "mCi" };
    if (a.actividadAdministrada != null) return { valor: a.actividadAdministrada, unidad: a.unidadActividad || "mCi" };
    if (a.tipo === "i131_mibg" && a.actividadCalibrada != null) return { valor: a.actividadCalibrada, unidad: "mCi" };
    return null;
  }

  // Panel de detalle del lote vinculado (MIBG/Lutecio-177) -- mismo contenido
  // para desktop (fila extra) y mobile (bloque dentro de la tarjeta). Sólo
  // datos del lote en sí (ver loteVinculadoDe); "Usado en" no aplica acá,
  // ya se sabe -- es justo esta acta.
  function DetalleLote({ lote }) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
        <div><span className="text-gray-400">Ingreso: </span><span className="text-gray-700">{fmtTs(lote.fecha)}</span></div>
        <div><span className="text-gray-400">N° de lote: </span><span className="text-gray-700 font-mono">{lote.numeroLote}</span></div>
        <div><span className="text-gray-400">Proveedor: </span><span className="text-gray-700">{lote.proveedor}</span></div>
        <div><span className="text-gray-400">Actividad calibrada: </span><span className="text-gray-700">{lote.actividadCalibrada} mCi</span></div>
        <div><span className="text-gray-400">Volumen: </span><span className="text-gray-700">{lote.volumen} mL</span></div>
        <div><span className="text-gray-400">Calibración: </span><span className="text-gray-700">{fmtTs(lote.fechaHoraCalibracion)}</span></div>
        <div><span className="text-gray-400">Vencimiento: </span><span className="text-gray-700">{fmtF(lote.fechaVencimiento)}</span></div>
        <div><span className="text-gray-400">Conformidad: </span><span className={textoConformidad(lote).clase}>{textoConformidad(lote).texto}</span></div>
        <div><span className="text-gray-400">Registrado por: </span><span className="text-gray-700">{lote.usuarioNombre}</span></div>
        {lote.observacion && (
          <div className="col-span-2 sm:col-span-3"><span className="text-gray-400">Observación: </span><span className="text-gray-700 italic">{lote.observacion}</span></div>
        )}
      </div>
    );
  }

  function filaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = tipoInfo(a);
    const { principal, sub } = detalleRegistro(a);
    const dosis = dosisRegistro(a);
    const lote = loteVinculadoDe(a);
    const expandido = loteExpandidoId === a.id;
    return (
      <Fragment key={a.id}>
        <tr className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
          <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
          <td className="px-3 py-2.5">{tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}</td>
          <td className="px-3 py-2.5 text-xs font-mono text-gray-600">{a.pacienteFicha || "—"}</td>
          <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
            {lote ? (
              <button onClick={() => setLoteExpandidoId(expandido ? null : a.id)} className="hover:underline hover:text-blue-700 text-left">
                {a.pacienteNombre} {expandido ? "▲" : "▼"}
              </button>
            ) : a.pacienteNombre}
            {(a.peso || a.talla) && <div className="text-xs font-normal text-gray-400">{a.peso && `${a.peso}kg`}{a.talla && ` · ${a.talla}cm`}</div>}
            {a.medicoResponsable && <div className="text-xs font-normal text-gray-400">Médico: {a.medicoResponsable}</div>}
            {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
          </td>
          <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.pacienteDni}</td>
          <td className="px-3 py-2.5 text-xs text-gray-700">{a.estudio || "—"}</td>
          <td className="px-3 py-2.5 text-xs text-gray-700">
            {principal}
            {sub && <div className="text-xs text-gray-400 font-mono mt-0.5">{sub}</div>}
          </td>
          <td className="px-3 py-2.5">
            {dosis ? (
              <>
                <span className="font-bold text-blue-700 text-sm">{dosis.valor}</span>
                <span className="text-xs text-gray-400 ml-1">{dosis.unidad}</span>
              </>
            ) : <span className="text-xs text-gray-300">—</span>}
          </td>
          <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
          <td className="px-3 py-2.5 text-right">
            {esAdmin && (a.tipo === "paciente" || a.tipo === "i131_mibg") && !anulacion && (
              <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                Anular
              </button>
            )}
          </td>
        </tr>
        {expandido && lote && (
          <tr className="bg-gray-50/60 border-b border-gray-50">
            <td colSpan={10} className="px-3 py-3"><DetalleLote lote={lote} /></td>
          </tr>
        )}
      </Fragment>
    );
  }

  function tarjetaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = tipoInfo(a);
    const { principal, sub } = detalleRegistro(a);
    const dosis = dosisRegistro(a);
    const lote = loteVinculadoDe(a);
    const expandido = loteExpandidoId === a.id;
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          {lote ? (
            <button onClick={() => setLoteExpandidoId(expandido ? null : a.id)} className="font-semibold text-gray-800 text-sm hover:underline hover:text-blue-700 text-left">
              {a.pacienteNombre} {expandido ? "▲" : "▼"}
            </button>
          ) : <span className="font-semibold text-gray-800 text-sm">{a.pacienteNombre}</span>}
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        {tipo && <div><Badge color={tipo.color}>{tipo.label}</Badge></div>}
        <div className="text-xs text-gray-500">
          Ficha {a.pacienteFicha || "—"} · DNI {a.pacienteDni}
          {(a.peso || a.talla) && <> · {a.peso ? `${a.peso}kg` : ""}{a.talla ? ` ${a.talla}cm` : ""}</>}
        </div>
        {a.estudio && <div className="text-xs text-gray-700">{a.estudio}</div>}
        <div className="text-xs text-gray-700">
          {principal}{sub && ` · ${sub}`}{dosis && <> · <span className="font-bold text-blue-700">{dosis.valor} {dosis.unidad}</span></>}
        </div>
        {a.medicoResponsable && <div className="text-xs text-gray-500">Médico: {a.medicoResponsable}</div>}
        <div className="text-xs text-gray-500">Técnico: {a.usuarioNombre}</div>
        {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
        {expandido && lote && (
          <div className="bg-gray-50 rounded-xl p-3 mt-1"><DetalleLote lote={lote} /></div>
        )}
        {esAdmin && (a.tipo === "paciente" || a.tipo === "i131_mibg") && !anulacion && (
          <div className="flex justify-end mt-0.5">
            <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular
            </button>
          </div>
        )}
      </div>
    );
  }

  function tipoTextoCSV(a) {
    return TIPO_LABEL_I131[a.tipo]?.label || nombreIsotopo(a) || "Tc-99m";
  }

  function filaCSV(a) {
    const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
    const dosis = dosisRegistro(a);
    const lote = loteVinculadoDe(a);
    return [d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      a.sedeNombre, tipoTextoCSV(a), a.pacienteFicha || "—", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
      a.peso ?? "—", a.talla ?? "—", a.estudio || "—", a.farmNombre || "—", a.lote || a.numeroLote || "—",
      dosis?.valor ?? "—", dosis?.unidad ?? "—", a.indicacion || "—", a.dosisActaId || "—", a.usuarioNombre, a.observacion || "—",
      // Lote vinculado (MIBG/Lutecio-177) -- "—" en las filas sin lote (Tc-99m
      // y cualquier otro registro sin este dato), ver loteVinculadoDe.
      lote?.numeroLote ?? "—", lote?.actividadCalibrada ?? "—", lote?.volumen ?? "—",
      lote ? fmtTs(lote.fechaHoraCalibracion) : "—", lote ? fmtF(lote.fechaVencimiento) : "—",
      lote?.proveedor ?? "—", lote ? textoConformidad(lote).texto : "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Tipo de registro", "N° Ficha", "Paciente", "DNI", "Médico responsable", "Peso (kg)", "Talla (cm)", "Estudio", "Radiofármaco", "Lote", "Dosis/Actividad", "Unidad", "Indicación", "Dosis vinculada (id)", "Técnico", "Observación",
       "N° Lote vinculado", "Actividad calibrada (mCi)", "Volumen (mL)", "Fecha/hora calibración", "Vencimiento", "Proveedor", "Conformidad"],
      ...lista.map(filaCSV),
    ];
    const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
    descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
  }

  function exportarCSV() {
    descargarCSV(actas, `libro2_pacientes_${filtroFecha || hoy()}.csv`);
    onToast("Libro 2 exportado");
  }

  // Ver nota equivalente en TabMarcacion.jsx: el listener de pantalla está
  // limitado a PAGINA (150), insuficiente para una auditoría de un período
  // largo -- este es un getDocs aparte, sin ese límite, por rango de fechas.
  // Buscar y descargar son dos pasos separados a propósito: ver nota completa
  // en TabMarcacion.jsx#buscarRango.
  // Trae los 8 tipos por separado (misma sede/rango, ocho consultas en
  // paralelo) y los mezcla, igual que el listado en vivo -- una exportación
  // de rango tiene que reflejar la misma secuencia de fichas sin huecos.
  async function buscarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setBuscandoRango(true);
    setErrorRango(null);
    setResultadoRango(null);
    try {
      const opts = { desde: rangoDesde, hasta: rangoHasta, sedeId: sedeEfectiva };
      const tipos = ["paciente", "i131_ablativa", "i131_dosis", "i131_barrido", "i131_mibg", "i131_captacion", "i131_centellograma", "i131_captacion_centellograma"];
      const resultados = await conTimeout(
        Promise.all(tipos.map((t) => actasPorRango(t, opts))),
        TIMEOUT_BUSQUEDA_MS, MSJ_TIMEOUT_BUSQUEDA
      );
      const registros = resultados.flat().sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha));
      setResultadoRango(registros);
    } catch (e) {
      setErrorRango(e.message || "No se pudo buscar el rango.");
    } finally {
      setBuscandoRango(false);
    }
  }

  function descargarResultadoRango() {
    if (!resultadoRango?.length) return;
    descargarCSV(resultadoRango, `libro2_pacientes_${rangoDesde}_a_${rangoHasta}.csv`);
    onToast(`Libro 2 exportado: ${resultadoRango.length} registro${resultadoRango.length !== 1 ? "s" : ""}`);
  }

  // Admin sin sede auditada elegida todavía (nunca entró a Configuración a
  // elegir una) -- sin esto, los useEffect de arriba se saltean armar
  // cualquier query (sedeEfectiva falsy), así que sin este aviso la
  // pantalla quedaría con las listas vacías sin ninguna explicación.
  if (esAdmin && !sedeEfectiva) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
        Elegí qué sede vas a auditar en Configuración antes de ver este libro.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {/* Mobile: fecha+"Ver todos" en una fila, selector de sede en la suya a
            ancho completo -- en vez de los 3 comprimidos como en desktop. */}
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
        {/* Mobile: la acción principal (Escanear pulsera) va arriba a ancho
            completo; CSV/rango + Manual quedan debajo, compartiendo fila --
            en desktop el wrapper "desaparece" (md:contents) y los 3 botones
            vuelven al mismo orden plano de siempre (CSV/rango, Escanear, Manual). */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="order-2 md:contents flex flex-wrap gap-2">
            {filtroFecha ? (
              actas.length > 0 && <Btn size="sm" variant="outline" onClick={exportarCSV} className="md:order-1">↓ CSV</Btn>
            ) : (
              <>
                <div className="flex gap-2 items-center md:order-1">
                  <div className="flex-1 md:flex-none"><Input label="Desde" type="date" value={rangoDesde} onChange={cambiarRango(setRangoDesde)} /></div>
                  <span className="text-xs text-gray-400 mt-5">a</span>
                  <div className="flex-1 md:flex-none"><Input label="Hasta" type="date" value={rangoHasta} onChange={cambiarRango(setRangoHasta)} /></div>
                </div>
                <Btn size="sm" variant="outline" onClick={buscarRango} disabled={!rangoDesde || !rangoHasta || buscandoRango} className="md:order-1">
                  {buscandoRango ? "Buscando..." : "Buscar"}
                </Btn>
              </>
            )}
            <Btn size="sm" variant="ghost" onClick={() => { limpiarForm(); precargarSugerenciaFicha(usuario.sede); setMostrarForm(true); }} className="md:order-3">+ Manual</Btn>
          </div>
          <Btn size="sm" variant="primary" onClick={() => { prepararSonidoEscaneo(); setMostrarQR(true); }} className="order-1 md:order-2 w-full md:w-auto">
            <span className="flex items-center gap-1.5 justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              Escanear pulsera
            </span>
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

      <div className="relative w-full sm:w-72">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Buscar por nombre o DNI..." value={busq} onChange={(e) => setBusq(e.target.value)} />
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nuevo registro de paciente</h3>
            <button onClick={() => { setMostrarForm(false); limpiarForm(); }} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {esAdmin && (
            // Bug real en producción: un admin cambió "Ver registros de"
            // (el filtro de arriba de la lista, sin relación con esto) y
            // asumió que eso redirigía dónde se guarda un registro NUEVO.
            // El N° de Ficha es único POR SEDE, así que guardar en la sede
            // equivocada no tira ningún error -- queda una acta real
            // atribuida a la sede que no era. Por eso este control vive acá
            // arriba, ANTES de cualquier otro campo (no perdido en la
            // grilla, no hay que scrollear para verlo) y con un tratamiento
            // visual que no se confunde con un campo más del formulario.
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-1.5">
              <Sel label="Guardar en sede" value={sedeId} onChange={(e) => {
                const nuevaSede = e.target.value;
                setSedeId(nuevaSede); setFarmId(""); setLote("");
                // El N° de Ficha es único POR SEDE. Si el valor en el campo
                // es todavía la sugerencia intacta (fichaTocada false, el
                // admin nunca la tocó), no tiene sentido revalidarla contra
                // la sede nueva -- se REFRESCA con el "último + 1" real de
                // esa sede (ver precargarSugerenciaFicha). Si el admin ya
                // tipeó algo a mano, se deja intacto y sólo se revalida
                // (mismo principio de nunca autocompletar en silencio que
                // rige el resto de este campo).
                if (!fichaTocada) precargarSugerenciaFicha(nuevaSede);
                else if (fichaNro.trim()) resolverYSetFichaEstado(nuevaSede, fichaNro);
              }}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
              <p className="text-xs text-amber-700">Este registro se guarda acá, sin importar el filtro "Ver registros de" de arriba.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="N° de Ficha" value={fichaNro}
              onChange={(e) => { setFichaNro(e.target.value); setFichaTocada(true); setFichaEstado(null); }}
              onBlur={chequearFicha}
              // Selecciona todo al enfocar: el valor ya viene precargado
              // (sugerencia, dato del QR, o reintento post-anulación, ver
              // precargarSugerenciaFicha/confirmarAnulacion/handleQRResult)
              // como valor real editable, no sólo placeholder -- así un
              // Tab/clic afuera sin tipear nada lo acepta tal cual, y
              // escribir encima lo reemplaza al instante sin borrar primero.
              onFocus={(e) => e.target.select()}
              placeholder={ultimaFicha != null ? String(ultimaFicha + 1) : "4521"}
            />
            {fichaEstado === "verificando" && (
              <div className="sm:col-span-2 -mt-2 text-xs text-gray-400">Verificando N° de Ficha...</div>
            )}
            {fichaEstado && fichaEstado !== "verificando" && fichaEstado.tipo !== "ok" && (
              <div className="sm:col-span-2 -mt-2 text-xs text-red-600">
                {fichaEstado.tipo === "formato"
                  ? "El N° de Ficha debe ser sólo números."
                  : fichaEstado.tipo === "agotado"
                    ? "Este N° de Ficha ya tuvo demasiadas correcciones (5) -- contactá a soporte."
                    : `Este N° de Ficha ya fue usado el ${fmtTs(fichaEstado.data.fecha)} para el paciente ${fichaEstado.data.pacienteNombre}.`}
              </div>
            )}
            <Input label="Apellido y nombre" value={nombre} onChange={(e) => setNombre(capitalizarPalabras(e.target.value))} placeholder="García Juan" />
            <Input label="DNI" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="28456789" />
            {/* Peso/Talla se piden siempre, para los 3 casos (Tc-99m/Lutecio/
                I-131) -- para I-131 son opcionales (no bloquean Guardar, ver
                el disabled del botón), para Tc-99m/Lutecio quedan igual que
                siempre (ya eran opcionales ahí también). */}
            <Input label="Peso (kg)" type="number" min={0} value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="78" />
            <Input label="Talla (cm)" type="number" min={0} value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="172" />
            {/* Tc-99m es el 99% de los casos -- sin selector visible por
                defecto, cero fricción. Este link revela el selector de
                isótopo sólo cuando hace falta (Lutecio-177 o I-131, lista
                blanca explícita más arriba). I-131 no tiene pestaña propia de
                carga: el N° de Ficha es una secuencia única dentro de cada
                sede, compartida por todos los isótopos de esa sede, así que
                toda la carga vive acá sin importar el isótopo -- Gestión
                I-131 es sólo una vista de consulta de estos mismos
                registros. */}
            {!mostrarIsotopo && isotoposCasoDistinto.length > 0 && (
              <div className="sm:col-span-2">
                <button type="button" onClick={() => setMostrarIsotopo(true)} className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2">
                  ¿Es un caso distinto a Tc-99m?
                </button>
              </div>
            )}
            {mostrarIsotopo && (
              <Sel label="Isótopo" value={isotopoId} onChange={(e) => { setIsotopoId(e.target.value); setLote(""); }}>
                <option value="tc99m">Tc-99m (caso habitual)</option>
                {isotoposCasoDistinto.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </Sel>
            )}
            {/* Estudio genérico: sólo aplica a Tc-99m -- ni I-131 ni
                Lutecio-177 lo usan (I-131 tiene su propio "Tipo de registro",
                Lutecio-177 no tiene un equivalente). */}
            {!esI131 && !esLutecio && (
              <>
                <div className="sm:col-span-2">
                  <Sel label="Estudio" value={estudio} onChange={(e) => { setEstudio(e.target.value); setEstudioOtro(""); }}>
                    <option value="">Seleccionar estudio...</option>
                    {(catalogo.estudios || []).map((es) => <option key={es.id} value={es.nombre}>{es.nombre}</option>)}
                    {/* "Otro" no sale de la colección -- opción fija, siempre
                        última, revela el campo de texto libre de abajo. */}
                    <option value="Otro">Otro</option>
                  </Sel>
                </div>
                {estudio === "Otro" && (
                  <div className="sm:col-span-2">
                    <Input label="¿Cuál?" value={estudioOtro} onChange={(e) => setEstudioOtro(e.target.value)} placeholder="Ej: Gammagrafía de paratiroides" />
                  </div>
                )}
              </>
            )}
            {/* 7 opciones ya no entran cómodas en pills -- Sel, mismo criterio
                que usamos en otros lados cuando una lista de opciones crece
                (tabs de Configuración/Actas ARN). Las que requieren
                accesoTerapiaI131 quedan disabled con una nota en el texto si
                el técnico no lo tiene -- admin siempre puede elegir cualquiera.
                MIBG, como Barrido, no tiene ese gate (ver TIPOS_I131). */}
            {esI131 && (
              <div className="sm:col-span-2">
                <Sel label="Tipo de registro" value={tipoI131} onChange={(e) => setTipoI131(e.target.value)}>
                  {TIPOS_I131.map((t) => (
                    <option key={t.id} value={t.id} disabled={t.requierePermiso && !puedeCargarDosisI131}>
                      {t.label}{t.requierePermiso && !puedeCargarDosisI131 ? " (requiere acceso)" : ""}
                    </option>
                  ))}
                </Sel>
              </div>
            )}
            {esLutecio && (
              <Input label="Médico responsable" value={medicoResponsable} onChange={(e) => setMedicoResponsable(e.target.value)} placeholder="Dr./Dra. ..." />
            )}
            {esI131 && tipoI131Actual.categoria === "dosis" && (
              <>
                <Input label="Actividad administrada (mCi)" type="number" min={0} step={0.1} value={actividadAdministrada} onChange={(e) => setActividadAdministrada(e.target.value)} placeholder={tipoI131 === "ablativa" ? "100" : "10"} />
                <Input label="Lote / cápsula" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej: I131-2026-014" />
                <Input label="Indicación / diagnóstico (opcional)" value={indicacion} onChange={(e) => setIndicacion(e.target.value)} placeholder="Ej: Ca. diferenciado de tiroides" />
              </>
            )}
            {esI131 && tipoI131Actual.categoria === "diagnostico" && (
              <>
                <Input label="Actividad administrada (µCi)" type="number" min={0} step={1} value={actividadAdministrada} onChange={(e) => setActividadAdministrada(e.target.value)} placeholder="90" />
                <div className="sm:col-span-2">
                  <Sel label="Dosis relacionada (opcional)" value={dosisVinculada} onChange={(e) => setDosisVinculada(e.target.value)}>
                    <option value="">Sin vincular</option>
                    {dosisParaVincular.map((d) => (
                      <option key={d.id} value={d.id}>Ficha {d.pacienteFicha} · {d.pacienteNombre} · {fmtTs(d.fecha)}</option>
                    ))}
                  </Sel>
                </div>
              </>
            )}
            {esI131 && tipoI131Actual.categoria === "mibg" && (
              <div className="sm:col-span-2 flex flex-col gap-3">
                <Sel label="Lote de MIBG disponible" value={mibgLoteSeleccionado} onChange={(e) => setMibgLoteSeleccionado(e.target.value)}>
                  <option value="">Seleccionar lote...</option>
                  {lotesMibgDisponibles.map((l) => (
                    <option key={l.id} value={l.id}>{l.numeroLote} · {l.actividadCalibrada} mCi en {l.volumen} mL (llegada) · Calibrado {fmtTs(l.fechaHoraCalibracion)}</option>
                  ))}
                </Sel>
                {lotesMibgDisponibles.length === 0 && (
                  <p className="text-xs text-orange-500 -mt-2">No hay lotes de MIBG disponibles en esta sede -- registrá uno nuevo en la pestaña "MIBG" de Gestión I-131.</p>
                )}
                {/* Distinto de la actividad de llegada del lote (arriba) --
                    casi siempre difiere por decaimiento entre la llegada y el
                    momento real de la administración. Se tipea a mano, nunca
                    se copia sola (ver guardar()). */}
                <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={actividadAdministrada} onChange={(e) => setActividadAdministrada(e.target.value)} placeholder="Ej: 1.5 (suele ser menor a la actividad de llegada)" />
              </div>
            )}
            {esLutecio && (
              // Libro 4: mismo patrón que MIBG -- lote vinculado (ya no texto
              // libre), no pasa por el catálogo de radiofármacos/stock (ver
              // guardar()). Dosis administrada se tipea a mano, distinta de
              // la actividad de llegada del lote.
              <div className="sm:col-span-2 flex flex-col gap-3">
                <Sel label="Lote de Lutecio-177 disponible" value={lutecioLoteSeleccionado} onChange={(e) => setLutecioLoteSeleccionado(e.target.value)}>
                  <option value="">Seleccionar lote...</option>
                  {lotesLutecioDisponibles.map((l) => (
                    <option key={l.id} value={l.id}>{l.numeroLote} · {l.actividadCalibrada} mCi en {l.volumen} mL (llegada) · Calibrado {fmtTs(l.fechaHoraCalibracion)}</option>
                  ))}
                </Sel>
                {lotesLutecioDisponibles.length === 0 && (
                  <p className="text-xs text-orange-500 -mt-2">No hay lotes de Lutecio-177 disponibles en esta sede -- registrá uno nuevo en "Libro 4 — Lutecio-177" (Actas ARN).</p>
                )}
                <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={actividadAdministrada} onChange={(e) => setActividadAdministrada(e.target.value)} placeholder="Ej: 1.5 (suele ser menor a la actividad de llegada)" />
              </div>
            )}
            {!esI131 && !esLutecio && (
              <>
                <Sel label="Radiofármaco utilizado" value={farmId} onChange={(e) => { setFarmId(e.target.value); setLote(""); }}>
                  <option value="">Seleccionar...</option>
                  {farmsDeSede(catalogo, sedeId).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </Sel>
                <div className="flex flex-col gap-1">
                  <Sel label="Lote" value={lote} onChange={(e) => setLote(e.target.value)} disabled={!farmId}>
                    <option value="">Seleccionar lote...</option>
                    {lotesDisp.map((l) => <option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
                  </Sel>
                  {/* Por defecto sólo lo marcado hoy en Libro 1 (regla de
                      negocio confirmada) -- este checkbox es la vía de
                      escape para un caso excepcional (corrección, lote
                      marcado otro día), apagada por defecto a propósito. */}
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600" checked={verTodoElStock}
                      onChange={(e) => { setVerTodoElStock(e.target.checked); setLote(""); }} />
                    Ver todos los lotes en stock (excepcional)
                  </label>
                  {!verTodoElStock && farmId && lotesMarcadosHoy.length === 0 && (
                    <p className="text-xs text-amber-600">Ningún lote de este radiofármaco fue marcado hoy en esta sede.</p>
                  )}
                </div>
                <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={mci} onChange={(e) => setMci(e.target.value)} placeholder="10.5" />
              </>
            )}
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder={esI131 && tipoI131 === "barrido" ? "Ej: hallazgos del barrido" : "Ej: paciente con marcapasos"} />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={
              !normalizarFicha(fichaNro) || !nombre.trim() || !dni.trim() || fichaEstado?.tipo !== "ok" ||
              (esI131
                ? ((tipoI131Actual.requierePermiso && !puedeCargarDosisI131) ||
                   (tipoI131Actual.categoria !== "barrido" && !actividadAdministrada) ||
                   (tipoI131Actual.categoria === "dosis" && !lote.trim()) ||
                   (tipoI131Actual.categoria === "mibg" && !mibgLoteSeleccionado))
                : esLutecio
                  ? (!medicoResponsable.trim() || !lutecioLoteSeleccionado || !actividadAdministrada)
                  : (!mci || !estudio || (estudio === "Otro" && !estudioOtro.trim()) || !lote.trim() || !farmId))
            }>Guardar registro</Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Registros del ${fmtF(filtroFecha)}` : "Todos los registros"}
          </span>
          <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        {/* Desktop: tabla de siempre. */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[840px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "Tipo", "N° Ficha", "Paciente", "DNI", "Estudio", "Detalle", "Dosis (mCi)", "Técnico", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos
                ? grupos.flatMap((g) => [
                    <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                      <td colSpan={10} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
                        {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                      </td>
                    </tr>,
                    ...g.items.map(filaPaciente),
                  ])
                : actasOrdenadas.map(filaPaciente)}
            </tbody>
          </table>
        </div>
        {/* Mobile: tarjeta por paciente en vez de columnas comprimidas. */}
        <div className="md:hidden divide-y divide-gray-50">
          {grupos
            ? grupos.flatMap((g) => [
                <div key={`sep-${g.fecha}`} className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {fmtF(g.fecha)} <span className="font-normal text-gray-400 normal-case">· {g.items.length} registro{g.items.length !== 1 ? "s" : ""}</span>
                </div>,
                ...g.items.map(tarjetaPaciente),
              ])
            : actasOrdenadas.map(tarjetaPaciente)}
        </div>
        {actas.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {filtroFecha ? "No hay registros para la fecha seleccionada." : "No hay registros."}
          </div>
        )}
      </div>

      {mostrarQR && <QRScanner onResult={handleQRResult} onClose={() => setMostrarQR(false)} />}

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`${mAnular.pacienteNombre} (DNI ${mAnular.pacienteDni})`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
