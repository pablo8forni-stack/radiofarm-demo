import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { QRScanner } from "../../components/scanner/QRScanner.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, fmtFechaISO, hoy, capitalizarPalabras, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { parseQR } from "../../helpers/qr.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { TIPO_LABEL_I131 } from "../../constants/tipoI131.js";
import {
  listenActas, addActaPaciente, actasPorRango, anularActaTransaction, listenAnulacionesActas,
  addActaI131Ablativa, addActaI131Dosis, addActaI131Barrido,
  addActaI131Captacion, addActaI131Centellograma, addActaI131CaptacionCentellograma,
} from "../../services/firestore/actas.js";
import { listenMibgLotes, administrarMibgTransaction, administrarLutecioTransaction, anularActaConLote } from "../../services/firestore/mibgLotes.js";
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

export function TabPacientes({ catalogo, usuario, esAdmin, onToast }) {
  const [pacientesTodas, setPacientesTodas] = useState([]);
  const [ablativaI131, setAblativaI131] = useState([]);
  const [barridosI131, setBarridosI131] = useState([]);
  const [captacionI131, setCaptacionI131] = useState([]);
  const [centellogramaI131, setCentellogramaI131] = useState([]);
  const [captCentellogramaI131, setCaptCentellogramaI131] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarQR, setMostrarQR] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
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

  useEffect(() => listenActas("paciente", setPacientesTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);
  // Un listener por tipo de I-131 (mismo criterio que dosis/barrido ya
  // tenían) -- dosisI131/ablativaI131 alimentan además el picker "Dosis
  // relacionada" de los 3 diagnósticos (ver dosisParaVincular). Todos se
  // mezclan en el listado principal -- el N° de Ficha es un correlativo
  // diario único compartido por todos los pacientes del servicio, así que
  // "Registros del día" tiene que mostrar los 7 tipos intercalados por hora
  // para no dejar saltos de ficha sin explicación visible. La pestaña
  // "Gestión I-131" (consulta) sigue siendo el filtro específico de estos
  // mismos 7 tipos, sin cambios.
  useEffect(() => listenActas("i131_ablativa", setAblativaI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_dosis", setDosisI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_barrido", setBarridosI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_mibg", setMibgI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion", setCaptacionI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_centellograma", setCentellogramaI131, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion_centellograma", setCaptCentellogramaI131, { esAdmin, sedeId: usuario.sede }), []);
  // mibgLotes/mibgUsos no se mezclan en actasTodas (mibg_lote no es una
  // acta) -- alimentan sólo el picker "Lote disponible" de abajo, filtrado
  // en tiempo real: un lote usado por otra técnica desaparece para todos al
  // instante, sin importar el día (ver lotesMibgDisponibles).
  useEffect(() => listenMibgLotes(setMibgLotes, { esAdmin, sedeId: usuario.sede }), []);

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
  // que TabMibg.jsx (estadoMibgLote, ver helpers/mibgLote.js: antes cada
  // pantalla tenía su propia lógica y divergieron, auditoría #12). Filtra
  // por la sede elegida en el FORMULARIO (sedeId), no por usuario.sede --
  // admin puede cambiarla.
  const usoPorLoteId = useMemo(() => new Map(mibgI131.map((u) => [u.mibgLoteId, u])), [mibgI131]);
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
    () => new Map(pacientesTodas.filter((p) => p.isotopoId === "lu177" && p.loteDosisUnicaId).map((p) => [p.loteDosisUnicaId, p])),
    [pacientesTodas]
  );
  const lotesLutecioDisponibles = useMemo(
    () => mibgLotes.filter((l) => l.isotopoId === "lutecio177" && l.sedeId === sedeId && estadoMibgLote(l.id, { anulaciones, usoPorLoteId: usoLutecioPorLoteId }) === "disponible")
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [mibgLotes, sedeId, anulaciones, usoLutecioPorLoteId]
  );

  async function confirmarAnulacion(acta, motivo) {
    try {
      // Lutecio-177 vinculado a un lote (Libro 4): anular la acta tiene que
      // anular TAMBIÉN el lote, mismo motivo/mecanismo que MIBG (auditoría,
      // #2) -- si no, el lote queda "usado" para siempre (id determinístico
      // lote_${loteId} ya ocupado) sin aparecer nunca más como disponible.
      if (acta.tipo === "paciente" && acta.isotopoId === "lu177" && acta.loteDosisUnicaId) {
        await anularActaConLote(acta, acta.loteDosisUnicaId, motivo, usuario);
        onToast("Lutecio-177 anulado (el lote también quedó anulado, no se reutiliza). Para corregir: registrá el lote de nuevo en Libro 4 y cargá el acta correcta acá.", "info", 10000);
      } else {
        await anularActaTransaction(acta, motivo, usuario);
        onToast("Registro anulado", "info", 6000);
      }
      setMAnular(null);
      // Precarga el formulario con los mismos datos para corregir sólo lo
      // que estaba mal, en vez de tipear todo de nuevo -- salvo el lote de
      // Lutecio-177 (quedó anulado, no se puede reelegir: hay que registrar
      // uno nuevo en Libro 4 primero).
      setSedeId(acta.sedeId); setFichaNro(acta.pacienteFicha || ""); setNombre(acta.pacienteNombre); setDni(acta.pacienteDni);
      setPeso(String(acta.peso ?? "")); setTalla(String(acta.talla ?? "")); setEstudio(acta.estudio || "");
      const iso = acta.isotopoId || "tc99m";
      setMostrarIsotopo(iso !== "tc99m"); setIsotopoId(iso); setMedicoResponsable(acta.medicoResponsable || "");
      setFarmId(acta.farmId || ""); setLote(acta.lote); setMci(String(acta.mciAdministrados ?? ""));
      setObs(acta.observacion || "");
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
      setMostrarForm(true);
      onToast("Pulsera leída correctamente", "success");
    } else {
      onToast("QR no reconocido. Ingresá los datos manualmente.", "error");
      setMostrarForm(true);
    }
  }

  function limpiarForm() {
    setFichaNro(""); setNombre(""); setDni(""); setPeso(""); setTalla(""); setEstudio(""); setEstudioOtro(""); setMci(""); setFarmId(""); setLote(""); setObs("");
    setMostrarIsotopo(false); setIsotopoId("tc99m"); setMedicoResponsable("");
    setTipoI131("barrido"); setActividadAdministrada(""); setIndicacion(""); setDosisVinculada(""); setMibgLoteSeleccionado(""); setLutecioLoteSeleccionado("");
    setSedeId(usuario.sede);
  }

  const esLutecio = isotopoId === "lu177";
  const esI131 = isotopoId === "i131";
  const puedeCargarDosisI131 = esAdmin || !!usuario.accesoTerapiaI131;

  // Lutecio-177 e I-131 son los únicos "casos distintos" de hoy -- lista
  // blanca explícita por id, no "todo lo que no sea tc99m": agregar una fila
  // a radioisotopos no debe hacer aparecer nada acá por sí sola (ver nota en
  // services/firestore/radioisotopos.js). I-131 ya no tiene pestaña propia de
  // carga -- toda la carga de pacientes (sea cual sea el isótopo) vive acá,
  // porque el N° de Ficha es un correlativo diario único compartido por
  // todos; Gestión I-131 pasó a ser sólo una vista de consulta de estos
  // mismos registros (6 tipos, sin cambios de modelo).
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
    if (!fichaNro.trim() || !nombre.trim() || !dni.trim()) return;
    if (esI131) {
      const base = {
        sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
        pacienteFicha: fichaNro.trim(), pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
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
        if (!mibgLoteSeleccionado) return;
        const loteElegido = mibgLotes.find((l) => l.id === mibgLoteSeleccionado);
        if (!loteElegido) return;
        administrarMibgTransaction(mibgLoteSeleccionado, {
          ...base, numeroLote: loteElegido.numeroLote, actividadCalibrada: loteElegido.actividadCalibrada, volumen: loteElegido.volumen,
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
      // vinculado (ya no texto libre) y la dosis administrada es la
      // actividadCalibrada COMPLETA del lote (dosis única, no se retipea).
      // Transacción real por el mismo motivo que MIBG: puede fallar de
      // verdad si otra técnica usó el mismo lote un instante antes.
      if (!lutecioLoteSeleccionado || !medicoResponsable.trim()) return;
      const loteElegido = mibgLotes.find((l) => l.id === lutecioLoteSeleccionado);
      if (!loteElegido) return;
      administrarLutecioTransaction(lutecioLoteSeleccionado, {
        sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
        pacienteFicha: fichaNro.trim(), pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
        peso: parseFloat(peso) || 0, talla: parseFloat(talla) || 0,
        mciAdministrados: loteElegido.actividadCalibrada, isotopoId, lote: loteElegido.numeroLote,
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
      pacienteFicha: fichaNro.trim(),
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
  // igual que ya pasa con el filtro de fecha/sede.
  const busqNorm = busq.trim().toLowerCase();
  const actas = useMemo(
    () => actasTodas.filter((a) =>
      (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) &&
      (!filtroSede || a.sedeId === filtroSede) &&
      (!busqNorm || a.pacienteNombre?.toLowerCase().includes(busqNorm) || a.pacienteDni?.toLowerCase().includes(busqNorm))
    ),
    [actasTodas, filtroFecha, filtroSede, busqNorm]
  );

  // Sólo se agrupa por fecha en "Ver todos" -- con un día ya filtrado, todos
  // los registros mostrados comparten fecha y un separador no aportaría nada.
  const grupos = useMemo(
    () => (filtroFecha ? null : agruparPorFecha(actas, (a) => fmtFechaISO(a.fecha))),
    [actas, filtroFecha]
  );

  const lotesDisp = (catalogo.stock[sedeId]?.[farmId] || []).filter((l) => l.cantidad > 0);

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
  // (mciAdministrados, siempre mCi), los 5 tipos de I-131 con actividad
  // (actividadAdministrada, mCi para dosis/ablativa, µCi para los 3
  // diagnósticos) y MIBG (actividadCalibrada, mCi -- denormalizada del lote
  // al administrar, no se retipea) -- se unifica en una sola columna con su
  // unidad real, no un sufijo "mCi" fijo. unidadActividad ausente (actas
  // i131_dosis anteriores a este cambio) se interpreta como mCi, mismo
  // criterio que isotopoId ausente = tc99m. Barrido corporal no administra
  // nada nuevo.
  function dosisRegistro(a) {
    if (a.mciAdministrados != null) return { valor: a.mciAdministrados, unidad: "mCi" };
    if (a.actividadAdministrada != null) return { valor: a.actividadAdministrada, unidad: a.unidadActividad || "mCi" };
    if (a.tipo === "i131_mibg" && a.actividadCalibrada != null) return { valor: a.actividadCalibrada, unidad: "mCi" };
    return null;
  }

  function filaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = tipoInfo(a);
    const { principal, sub } = detalleRegistro(a);
    const dosis = dosisRegistro(a);
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5">{tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-600">{a.pacienteFicha || "—"}</td>
        <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
          {a.pacienteNombre}
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
          {esAdmin && a.tipo === "paciente" && !anulacion && (
            <button onClick={() => setMAnular(a)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular
            </button>
          )}
        </td>
      </tr>
    );
  }

  function tarjetaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    const tipo = tipoInfo(a);
    const { principal, sub } = detalleRegistro(a);
    const dosis = dosisRegistro(a);
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm">{a.pacienteNombre}</span>
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
        {esAdmin && a.tipo === "paciente" && !anulacion && (
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
    return [d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      a.sedeNombre, tipoTextoCSV(a), a.pacienteFicha || "—", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
      a.peso ?? "—", a.talla ?? "—", a.estudio || "—", a.farmNombre || "—", a.lote || a.numeroLote || "—",
      dosis?.valor ?? "—", dosis?.unidad ?? "—", a.indicacion || "—", a.dosisActaId || "—", a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Tipo de registro", "N° Ficha", "Paciente", "DNI", "Médico responsable", "Peso (kg)", "Talla (cm)", "Estudio", "Radiofármaco", "Lote", "Dosis/Actividad", "Unidad", "Indicación", "Dosis vinculada (id)", "Técnico", "Observación"],
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
      const opts = { desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede };
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
            <div className="w-full md:w-auto">
              <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
                <option value="">Todas las sedes</option>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
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
            <Btn size="sm" variant="ghost" onClick={() => { limpiarForm(); setMostrarForm(true); }} className="md:order-3">+ Manual</Btn>
          </div>
          <Btn size="sm" variant="primary" onClick={() => setMostrarQR(true)} className="order-1 md:order-2 w-full md:w-auto">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="N° de Ficha" value={fichaNro} onChange={(e) => setFichaNro(e.target.value)} placeholder="4521" />
            <Input label="Apellido y nombre" value={nombre} onChange={(e) => setNombre(capitalizarPalabras(e.target.value))} placeholder="García Juan" />
            <Input label="DNI" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="28456789" />
            {esAdmin && (
              <Sel label="Sede" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setFarmId(""); setLote(""); }}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            )}
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
                carga: el N° de Ficha es un correlativo diario único
                compartido por todos los pacientes del servicio, así que toda
                la carga vive acá sin importar el isótopo -- Gestión I-131 es
                sólo una vista de consulta de estos mismos registros. */}
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
              <div className="sm:col-span-2">
                <Sel label="Lote de MIBG disponible" value={mibgLoteSeleccionado} onChange={(e) => setMibgLoteSeleccionado(e.target.value)}>
                  <option value="">Seleccionar lote...</option>
                  {lotesMibgDisponibles.map((l) => (
                    <option key={l.id} value={l.id}>{l.numeroLote} · {l.actividadCalibrada} mCi en {l.volumen} mL · Calibrado {fmtTs(l.fechaHoraCalibracion)}</option>
                  ))}
                </Sel>
                {lotesMibgDisponibles.length === 0 && (
                  <p className="text-xs text-orange-500 mt-1">No hay lotes de MIBG disponibles en esta sede -- registrá uno nuevo en la pestaña "MIBG" de Gestión I-131.</p>
                )}
              </div>
            )}
            {esLutecio && (
              // Libro 4: mismo patrón que MIBG -- lote vinculado (ya no texto
              // libre), dosis única, no pasa por el catálogo de
              // radiofármacos/stock (ver guardar()).
              <div className="sm:col-span-2">
                <Sel label="Lote de Lutecio-177 disponible" value={lutecioLoteSeleccionado} onChange={(e) => setLutecioLoteSeleccionado(e.target.value)}>
                  <option value="">Seleccionar lote...</option>
                  {lotesLutecioDisponibles.map((l) => (
                    <option key={l.id} value={l.id}>{l.numeroLote} · {l.actividadCalibrada} mCi en {l.volumen} mL · Calibrado {fmtTs(l.fechaHoraCalibracion)}</option>
                  ))}
                </Sel>
                {lotesLutecioDisponibles.length === 0 && (
                  <p className="text-xs text-orange-500 mt-1">No hay lotes de Lutecio-177 disponibles en esta sede -- registrá uno nuevo en "Libro 4 — Lutecio-177" (Actas ARN).</p>
                )}
              </div>
            )}
            {!esI131 && !esLutecio && (
              <>
                <Sel label="Radiofármaco utilizado" value={farmId} onChange={(e) => { setFarmId(e.target.value); setLote(""); }}>
                  <option value="">Seleccionar...</option>
                  {farmsDeSede(catalogo, sedeId).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </Sel>
                <Sel label="Lote" value={lote} onChange={(e) => setLote(e.target.value)} disabled={!farmId}>
                  <option value="">Seleccionar lote...</option>
                  {lotesDisp.map((l) => <option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
                </Sel>
                <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={mci} onChange={(e) => setMci(e.target.value)} placeholder="10.5" />
              </>
            )}
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder={esI131 && tipoI131 === "barrido" ? "Ej: hallazgos del barrido" : "Ej: paciente con marcapasos"} />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={
              !fichaNro.trim() || !nombre.trim() || !dni.trim() ||
              (esI131
                ? ((tipoI131Actual.requierePermiso && !puedeCargarDosisI131) ||
                   (tipoI131Actual.categoria !== "barrido" && tipoI131Actual.categoria !== "mibg" && !actividadAdministrada) ||
                   (tipoI131Actual.categoria === "dosis" && !lote.trim()) ||
                   (tipoI131Actual.categoria === "mibg" && !mibgLoteSeleccionado))
                : esLutecio
                  ? (!medicoResponsable.trim() || !lutecioLoteSeleccionado)
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
                : actas.map(filaPaciente)}
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
            : actas.map(tarjetaPaciente)}
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
