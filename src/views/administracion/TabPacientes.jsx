import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { QRScanner } from "../../components/scanner/QRScanner.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { ESTUDIOS } from "../../constants/estudios.js";
import { fmtF, fmtTs, fmtFechaISO, hoy, capitalizarPalabras, agruparPorFecha } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { parseQR } from "../../helpers/qr.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { listenActas, addActaPaciente, addActaI131Dosis, addActaI131Barrido, actasPorRango, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";

const TIMEOUT_BUSQUEDA_MS = 20000;
const MSJ_TIMEOUT_BUSQUEDA = "La consulta tardó demasiado, puede haber un problema de conexión -- intentá cerrar las otras pestañas de RadioFarm que tengas abiertas y reintentá.";

// Sin esto, una consulta que nunca resuelve (ver nota en exportarRango) deja
// el botón trabado en "Buscando..." para siempre, sin ningún error visible.
function conTimeout(promesa, ms, mensaje) {
  let idTimeout;
  const timeout = new Promise((_, reject) => { idTimeout = setTimeout(() => reject(new Error(mensaje)), ms); });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));
}

export function TabPacientes({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
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

  useEffect(() => listenActas("paciente", setActasTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);
  // Sólo para el picker "Dosis relacionada" del sub-formulario de Barrido --
  // misma sede/límite que el resto de los listeners de esta pantalla.
  useEffect(() => listenActas("i131_dosis", setDosisI131, { esAdmin, sedeId: usuario.sede }), []);

  // anulaId -> acta de anulación (motivo, fecha, quién) -- Map en vez de Set
  // porque el listado necesita mostrar el motivo, no sólo saber que existe.
  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  async function confirmarAnulacion(acta, motivo) {
    try {
      await anularActaTransaction(acta, motivo, usuario);
      onToast("Registro anulado", "info", 6000);
      setMAnular(null);
      // Precarga el formulario con los mismos datos para corregir sólo lo
      // que estaba mal, en vez de tipear todo de nuevo.
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
    setFichaNro(""); setNombre(""); setDni(""); setPeso(""); setTalla(""); setEstudio(""); setMci(""); setFarmId(""); setLote(""); setObs("");
    setMostrarIsotopo(false); setIsotopoId("tc99m"); setMedicoResponsable("");
    setTipoI131("barrido"); setActividadAdministrada(""); setIndicacion(""); setDosisVinculada("");
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
  // todos; Terapia I-131 pasó a ser sólo una vista de consulta de estos
  // mismos registros (tipo i131_dosis/i131_barrido, sin cambios de modelo).
  const isotoposCasoDistinto = (catalogo.radioisotopos || []).filter((i) => i.id === "lu177" || i.id === "i131");

  // Dosis recientes ya cargadas en memoria (mismo límite/sede que el resto
  // de esta pantalla) para vincular un Barrido sin disparar una consulta
  // nueva -- si hay DNI tipeado, prioriza coincidencias de ese paciente.
  const dosisParaVincular = useMemo(() => {
    const propias = dni.trim() ? dosisI131.filter((d) => d.pacienteDni === dni.trim()) : [];
    return propias.length ? propias : dosisI131;
  }, [dosisI131, dni]);

  function guardar() {
    if (!fichaNro.trim() || !nombre.trim() || !dni.trim()) return;
    if (esI131) {
      if (!medicoResponsable.trim()) return;
      const base = {
        sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
        pacienteFicha: fichaNro.trim(), pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
        medicoResponsable: medicoResponsable.trim(),
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
      };
      if (tipoI131 === "dosis") {
        if (!puedeCargarDosisI131 || !actividadAdministrada || !lote.trim()) return;
        addActaI131Dosis({ ...base, actividadAdministrada: parseFloat(actividadAdministrada) || 0, lote: lote.trim(), indicacion: indicacion.trim() })
          .catch((e) => onToast(e.message || "No se pudo guardar la dosis", "error"));
        onToast("Dosis terapéutica registrada — consultala en la pestaña Terapia I-131");
      } else {
        addActaI131Barrido({ ...base, dosisActaId: dosisVinculada || null })
          .catch((e) => onToast(e.message || "No se pudo guardar el barrido", "error"));
        onToast("Barrido corporal registrado — consultalo en la pestaña Terapia I-131");
      }
      limpiarForm(); setMostrarForm(false);
      return;
    }
    if (!mci || !estudio || !lote.trim()) return;
    if (esLutecio ? !medicoResponsable.trim() : !farmId) return;
    const farm = catalogo.farms.find((f) => f.id === farmId);
    addActaPaciente({
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      pacienteFicha: fichaNro.trim(),
      pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
      peso: parseFloat(peso) || 0, talla: parseFloat(talla) || 0,
      estudio, mciAdministrados: parseFloat(mci) || 0,
      isotopoId, lote: lote.trim(),
      // Lutecio-177 no pasa por el catálogo de radiofármacos/stock (dosis
      // puntual por paciente, no stock rotativo) -- mismo criterio que
      // loteGenerador en Elución. tc99m sigue igual que siempre.
      ...(esLutecio ? { medicoResponsable: medicoResponsable.trim() } : { farmId, farmNombre: farm?.nombre || "" }),
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

  function filaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    const iso = nombreIsotopo(a);
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-600">{a.pacienteFicha || "—"}</td>
        <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
          {a.pacienteNombre}
          {(a.peso || a.talla) && <div className="text-xs font-normal text-gray-400">{a.peso && `${a.peso}kg`}{a.talla && ` · ${a.talla}cm`}</div>}
          {a.medicoResponsable && <div className="text-xs font-normal text-gray-400">Médico: {a.medicoResponsable}</div>}
          {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.pacienteDni}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">{a.estudio}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">
          {iso ? <Badge color="purple">{iso}</Badge> : (a.farmNombre || "—")}
          {a.lote && <div className="text-xs text-gray-400 font-mono">{a.lote}</div>}
        </td>
        <td className="px-3 py-2.5">
          <span className="font-bold text-blue-700 text-sm">{a.mciAdministrados}</span>
          <span className="text-xs text-gray-400 ml-1">mCi</span>
        </td>
        <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
        <td className="px-3 py-2.5 text-right">
          {esAdmin && !anulacion && (
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
    const iso = nombreIsotopo(a);
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm">{a.pacienteNombre}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        {iso && <div><Badge color="purple">{iso}</Badge></div>}
        <div className="text-xs text-gray-500">
          Ficha {a.pacienteFicha || "—"} · DNI {a.pacienteDni}
          {(a.peso || a.talla) && <> · {a.peso ? `${a.peso}kg` : ""}{a.talla ? ` ${a.talla}cm` : ""}</>}
        </div>
        <div className="text-xs text-gray-700">{a.estudio}</div>
        <div className="text-xs text-gray-700">
          {iso ? "" : (a.farmNombre || "—")}{a.lote && ` · Lote ${a.lote}`} · <span className="font-bold text-blue-700">{a.mciAdministrados} mCi</span>
        </div>
        {a.medicoResponsable && <div className="text-xs text-gray-500">Médico: {a.medicoResponsable}</div>}
        <div className="text-xs text-gray-500">Técnico: {a.usuarioNombre}</div>
        {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
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
    return [d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      a.sedeNombre, a.pacienteFicha || "—", nombreIsotopo(a) || "Tc-99m", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
      a.peso, a.talla, a.estudio, a.farmNombre || "—", a.lote || "—",
      a.mciAdministrados, a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "N° Ficha", "Isótopo", "Paciente", "DNI", "Médico responsable", "Peso (kg)", "Talla (cm)", "Estudio", "Radiofármaco", "Lote", "mCi administrados", "Técnico", "Observación"],
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
  async function buscarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setBuscandoRango(true);
    setErrorRango(null);
    setResultadoRango(null);
    try {
      const registros = await conTimeout(
        actasPorRango("paciente", { desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede }),
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
            {!esI131 && (
              <>
                <Input label="Peso (kg)" type="number" min={0} value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="78" />
                <Input label="Talla (cm)" type="number" min={0} value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="172" />
                <div className="sm:col-span-2">
                  <Sel label="Estudio" value={estudio} onChange={(e) => setEstudio(e.target.value)}>
                    <option value="">Seleccionar estudio...</option>
                    {ESTUDIOS.map((e) => <option key={e}>{e}</option>)}
                  </Sel>
                </div>
              </>
            )}
            {esAdmin && (
              <Sel label="Sede" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setFarmId(""); setLote(""); }}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            )}
            {/* Tc-99m es el 99% de los casos -- sin selector visible por
                defecto, cero fricción. Este link revela el selector de
                isótopo sólo cuando hace falta (Lutecio-177 o I-131, lista
                blanca explícita más arriba). I-131 no tiene pestaña propia de
                carga: el N° de Ficha es un correlativo diario único
                compartido por todos los pacientes del servicio, así que toda
                la carga vive acá sin importar el isótopo -- Terapia I-131 es
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
            {esI131 && (
              <div className="sm:col-span-2 flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
                <button type="button" onClick={() => setTipoI131("barrido")} className={`px-4 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition ${tipoI131 === "barrido" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  Barrido corporal
                </button>
                <button type="button" onClick={() => puedeCargarDosisI131 && setTipoI131("dosis")} disabled={!puedeCargarDosisI131}
                  title={puedeCargarDosisI131 ? undefined : "No tenés acceso a Dosis terapéutica de I-131"}
                  className={`px-4 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${tipoI131 === "dosis" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  Dosis terapéutica
                </button>
              </div>
            )}
            {(esLutecio || esI131) && (
              <Input label="Médico responsable" value={medicoResponsable} onChange={(e) => setMedicoResponsable(e.target.value)} placeholder="Dr./Dra. ..." />
            )}
            {esI131 ? (
              tipoI131 === "dosis" ? (
                <>
                  <Input label="Actividad administrada (mCi)" type="number" min={0} step={0.1} value={actividadAdministrada} onChange={(e) => setActividadAdministrada(e.target.value)} placeholder="150" />
                  <Input label="Lote / cápsula" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej: I131-2026-014" />
                  <Input label="Indicación / diagnóstico (opcional)" value={indicacion} onChange={(e) => setIndicacion(e.target.value)} placeholder="Ej: Ca. diferenciado de tiroides" />
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Sel label="Dosis relacionada (opcional)" value={dosisVinculada} onChange={(e) => setDosisVinculada(e.target.value)}>
                    <option value="">Sin vincular</option>
                    {dosisParaVincular.map((d) => (
                      <option key={d.id} value={d.id}>Ficha {d.pacienteFicha} · {d.pacienteNombre} · {fmtTs(d.fecha)}</option>
                    ))}
                  </Sel>
                </div>
              )
            ) : esLutecio ? (
              // Lutecio-177 no pasa por el catálogo de radiofármacos/stock --
              // dosis puntual por paciente, no stock rotativo (ver guardar()).
              <Input label="Lote / vial" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej: LU177-2026-014" />
            ) : (
              <>
                <Sel label="Radiofármaco utilizado" value={farmId} onChange={(e) => { setFarmId(e.target.value); setLote(""); }}>
                  <option value="">Seleccionar...</option>
                  {farmsDeSede(catalogo, sedeId).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </Sel>
                <Sel label="Lote" value={lote} onChange={(e) => setLote(e.target.value)} disabled={!farmId}>
                  <option value="">Seleccionar lote...</option>
                  {lotesDisp.map((l) => <option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
                </Sel>
              </>
            )}
            {!esI131 && (
              <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={mci} onChange={(e) => setMci(e.target.value)} placeholder="10.5" />
            )}
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder={esI131 && tipoI131 === "barrido" ? "Ej: hallazgos del barrido" : "Ej: paciente con marcapasos"} />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={
              !fichaNro.trim() || !nombre.trim() || !dni.trim() ||
              (esI131
                ? (!medicoResponsable.trim() || (tipoI131 === "dosis" && (!puedeCargarDosisI131 || !actividadAdministrada || !lote.trim())))
                : (!mci || !estudio || !lote.trim() || (esLutecio ? !medicoResponsable.trim() : !farmId)))
            }>Guardar registro</Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Registros del ${fmtF(filtroFecha)}` : "Todos los registros"}
          </span>
          <Badge color="blue">{actas.length} paciente{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        {/* Desktop: tabla de siempre. */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Hora", "N° Ficha", "Paciente", "DNI", "Estudio", "Radiofármaco / Lote", "Dosis (mCi)", "Técnico", ""].map((h, i) => (
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
