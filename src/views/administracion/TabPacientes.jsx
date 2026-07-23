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
import { listenActas, addActaPaciente, actasPorRango, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";

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
  const [exportandoRango, setExportandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState(null);
  const [busq, setBusq] = useState("");

  const [nombre, setNombre] = useState(""); const [dni, setDni] = useState("");
  const [peso, setPeso] = useState(""); const [talla, setTalla] = useState("");
  const [estudio, setEstudio] = useState(""); const [mci, setMci] = useState("");
  const [farmId, setFarmId] = useState(""); const [lote, setLote] = useState("");
  const [obs, setObs] = useState("");
  const [sedeId, setSedeId] = useState(usuario.sede);

  useEffect(() => listenActas("paciente", setActasTodas, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

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
      setSedeId(acta.sedeId); setNombre(acta.pacienteNombre); setDni(acta.pacienteDni);
      setPeso(String(acta.peso ?? "")); setTalla(String(acta.talla ?? "")); setEstudio(acta.estudio || "");
      setFarmId(acta.farmId); setLote(acta.lote); setMci(String(acta.mciAdministrados ?? ""));
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
    setNombre(""); setDni(""); setPeso(""); setTalla(""); setEstudio(""); setMci(""); setFarmId(""); setLote(""); setObs("");
    setSedeId(usuario.sede);
  }

  function guardar() {
    if (!nombre.trim() || !dni.trim() || !mci || !estudio || !farmId || !lote) return;
    const farm = catalogo.farms.find((f) => f.id === farmId);
    addActaPaciente({
      sedeId, sedeNombre: catalogo.sedes[sedeId]?.nombre,
      pacienteNombre: nombre.trim(), pacienteDni: dni.trim(),
      peso: parseFloat(peso) || 0, talla: parseFloat(talla) || 0,
      estudio, mciAdministrados: parseFloat(mci) || 0,
      farmId, farmNombre: farm?.nombre || "", lote,
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

  function filaPaciente(a) {
    const anulacion = anulaciones.get(a.id);
    return (
      <tr key={a.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${anulacion ? "opacity-50" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
        <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
          {a.pacienteNombre}
          {(a.peso || a.talla) && <div className="text-xs font-normal text-gray-400">{a.peso && `${a.peso}kg`}{a.talla && ` · ${a.talla}cm`}</div>}
          {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.pacienteDni}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">{a.estudio}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">
          {a.farmNombre || "—"}
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
    return (
      <div key={a.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-800 text-sm">{a.pacienteNombre}</span>
          <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</span>
        </div>
        <div className="text-xs text-gray-500">
          DNI {a.pacienteDni}
          {(a.peso || a.talla) && <> · {a.peso ? `${a.peso}kg` : ""}{a.talla ? ` ${a.talla}cm` : ""}</>}
        </div>
        <div className="text-xs text-gray-700">{a.estudio}</div>
        <div className="text-xs text-gray-700">
          {a.farmNombre || "—"}{a.lote && ` · Lote ${a.lote}`} · <span className="font-bold text-blue-700">{a.mciAdministrados} mCi</span>
        </div>
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
      a.sedeNombre, a.pacienteNombre, a.pacienteDni, a.peso, a.talla, a.estudio, a.farmNombre || "—", a.lote || "—",
      a.mciAdministrados, a.usuarioNombre, a.observacion || "—"];
  }

  function descargarCSV(lista, nombreArchivo) {
    const filas = [
      ["Fecha", "Hora", "Sede", "Paciente", "DNI", "Peso (kg)", "Talla (cm)", "Estudio", "Radiofármaco", "Lote", "mCi administrados", "Técnico", "Observación"],
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
  async function exportarRango() {
    if (!rangoDesde || !rangoHasta) return;
    setExportandoRango(true);
    setErrorRango(null);
    try {
      const registros = await conTimeout(
        actasPorRango("paciente", { desde: rangoDesde, hasta: rangoHasta, esAdmin, sedeId: esAdmin ? (filtroSede || null) : usuario.sede }),
        TIMEOUT_BUSQUEDA_MS, MSJ_TIMEOUT_BUSQUEDA
      );
      if (!registros.length) { onToast("No hay registros en ese rango", "error"); return; }
      descargarCSV(registros, `libro2_pacientes_${rangoDesde}_a_${rangoHasta}.csv`);
      onToast(`Libro 2 exportado: ${registros.length} registro${registros.length !== 1 ? "s" : ""}`);
    } catch (e) {
      setErrorRango(e.message || "No se pudo buscar el rango.");
    } finally {
      setExportandoRango(false);
    }
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
                  <div className="flex-1 md:flex-none"><Input label="Desde" type="date" value={rangoDesde} onChange={(e) => setRangoDesde(e.target.value)} /></div>
                  <span className="text-xs text-gray-400 mt-5">a</span>
                  <div className="flex-1 md:flex-none"><Input label="Hasta" type="date" value={rangoHasta} onChange={(e) => setRangoHasta(e.target.value)} /></div>
                </div>
                <Btn size="sm" variant="outline" onClick={exportarRango} disabled={!rangoDesde || !rangoHasta || exportandoRango} className="md:order-1">
                  {exportandoRango ? "Buscando..." : "Buscar"}
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
            <Input label="Apellido y nombre" value={nombre} onChange={(e) => setNombre(capitalizarPalabras(e.target.value))} placeholder="García Juan" />
            <Input label="DNI" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="28456789" />
            <Input label="Peso (kg)" type="number" min={0} value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="78" />
            <Input label="Talla (cm)" type="number" min={0} value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="172" />
            <div className="sm:col-span-2">
              <Sel label="Estudio" value={estudio} onChange={(e) => setEstudio(e.target.value)}>
                <option value="">Seleccionar estudio...</option>
                {ESTUDIOS.map((e) => <option key={e}>{e}</option>)}
              </Sel>
            </div>
            {esAdmin && (
              <Sel label="Sede" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setFarmId(""); setLote(""); }}>
                {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
              </Sel>
            )}
            <Sel label="Radiofármaco utilizado" value={farmId} onChange={(e) => { setFarmId(e.target.value); setLote(""); }}>
              <option value="">Seleccionar...</option>
              {farmsDeSede(catalogo, sedeId).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </Sel>
            <Sel label="Lote" value={lote} onChange={(e) => setLote(e.target.value)} disabled={!farmId}>
              <option value="">Seleccionar lote...</option>
              {lotesDisp.map((l) => <option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
            </Sel>
            <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={mci} onChange={(e) => setMci(e.target.value)} placeholder="10.5" />
            <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: paciente con marcapasos" />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!nombre.trim() || !dni.trim() || !mci || !estudio || !farmId || !lote}>Guardar registro</Btn>
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
                {["Hora", "Paciente", "DNI", "Estudio", "Radiofármaco / Lote", "Dosis (mCi)", "Técnico", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos
                ? grupos.flatMap((g) => [
                    <tr key={`sep-${g.fecha}`} className="bg-gray-50">
                      <td colSpan={8} className="px-3 py-2 text-xs font-bold text-gray-600 uppercase tracking-wide">
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
