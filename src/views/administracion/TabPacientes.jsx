import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { QRScanner } from "../../components/scanner/QRScanner.jsx";
import { ESTUDIOS } from "../../constants/estudios.js";
import { fmtF, fmtTs, fmtFechaISO, hoy } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { parseQR } from "../../helpers/qr.js";
import { sedesActivas, farmsDeSede } from "../../helpers/stock.js";
import { listenActas, addActaPaciente } from "../../services/firestore/actas.js";

export function TabPacientes({ catalogo, usuario, esAdmin, onToast }) {
  const [actasTodas, setActasTodas] = useState([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarQR, setMostrarQR] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(hoy());
  const [filtroSede, setFiltroSede] = useState(usuario.sede);

  const [nombre, setNombre] = useState(""); const [dni, setDni] = useState("");
  const [peso, setPeso] = useState(""); const [talla, setTalla] = useState("");
  const [estudio, setEstudio] = useState(""); const [mci, setMci] = useState("");
  const [farmId, setFarmId] = useState(""); const [lote, setLote] = useState("");
  const [obs, setObs] = useState("");
  const [sedeId, setSedeId] = useState(usuario.sede);

  useEffect(() => listenActas("paciente", setActasTodas), []);

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

  const actas = useMemo(
    () => actasTodas.filter((a) => (!filtroFecha || fmtFechaISO(a.fecha) === filtroFecha) && (!filtroSede || a.sedeId === filtroSede)),
    [actasTodas, filtroFecha, filtroSede]
  );

  const lotesDisp = (catalogo.stock[sedeId]?.[farmId] || []).filter((l) => l.cantidad > 0);

  function exportarCSV() {
    const filas = [
      ["Fecha", "Hora", "Sede", "Paciente", "DNI", "Peso (kg)", "Talla (cm)", "Estudio", "Radiofármaco", "Lote", "mCi administrados", "Técnico", "Observación"],
      ...actas.map((a) => {
        const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
        return [d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
          a.sedeNombre, a.pacienteNombre, a.pacienteDni, a.peso, a.talla, a.estudio, a.farmNombre || "—", a.lote || "—",
          a.mciAdministrados, a.usuarioNombre, a.observacion || "—"];
      }),
    ];
    const csv = "sep=;\n" + filas.map((r) => r.map((x) => `"${x}"`).join(";")).join("\n");
    descargarArchivo(csv, `libro2_pacientes_${filtroFecha || hoy()}.csv`, "text/csv;charset=utf-8");
    onToast("Libro 2 exportado");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />
          {esAdmin && (
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          )}
        </div>
        <div className="flex gap-2">
          {actas.length > 0 && <Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>}
          <Btn size="sm" variant="primary" onClick={() => setMostrarQR(true)}>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              Escanear pulsera
            </span>
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => { limpiarForm(); setMostrarForm(true); }}>+ Manual</Btn>
        </div>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nuevo registro de paciente</h3>
            <button onClick={() => { setMostrarForm(false); limpiarForm(); }} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Apellido y nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="García Juan" />
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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {filtroFecha ? `Registros del ${fmtF(filtroFecha)}` : "Todos los registros"}
          </span>
          <Badge color="blue">{actas.length} paciente{actas.length !== 1 ? "s" : ""}</Badge>
        </div>
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {["Hora", "Paciente", "DNI", "Estudio", "Radiofármaco / Lote", "Dosis (mCi)", "Técnico"].map((h) => (
                <th key={h} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {actas.map((a) => {
              return (
                <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(a.fecha).split(" ")[1] || ""}</td>
                  <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
                    {a.pacienteNombre}
                    {(a.peso || a.talla) && <div className="text-xs font-normal text-gray-400">{a.peso && `${a.peso}kg`}{a.talla && ` · ${a.talla}cm`}</div>}
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
                </tr>
              );
            })}
          </tbody>
        </table>
        {actas.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">No hay registros para la fecha seleccionada.</div>}
      </div>

      {mostrarQR && <QRScanner onResult={handleQRResult} onClose={() => setMostrarQR(false)} />}
    </div>
  );
}
