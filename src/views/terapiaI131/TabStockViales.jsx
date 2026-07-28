import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, diasV } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, addActaI131Vial, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { diasTranscurridos, actividadRestante, volumenExtraidoDe } from "../../helpers/decaimientoI131.js";
import { AvisoGuiaNoOficial } from "./DesgloseCalculo.jsx";
import { VialDetalle } from "./VialDetalle.jsx";
import { CATEGORIA_VIAL_LABEL, categoriaVial } from "../../constants/tipoI131.js";

const VACIO_VIAL = { lote: "", categoria: "terapeutico", fechaCalibracion: "", actividadCalibrada: "", volumenInicial: "", fechaVencimiento: "", obs: "" };

// Stock de viales I-131 -- Parte A del "espacio de cálculo": digitaliza la
// planilla "Yodo-131 Recibido" en papel. Toda la pestaña (lectura y
// escritura) queda gateada por accesoTerapiaI131 desde el wrapper
// (VistaTerapiaI131.jsx) y respaldado server-side (ver esTipoStockI131 en
// firestore.rules) -- es inventario de material controlado, no un registro
// de atención puntual como el resto de Terapia I-131.
export function TabStockViales({ catalogo, usuario, esAdmin, onToast }) {
  const [viales, setViales] = useState([]);
  const [extracciones, setExtracciones] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [vialSeleccionadoId, setVialSeleccionadoId] = useState(null);
  const [mostrarFormVial, setMostrarFormVial] = useState(false);
  const [formVial, setFormVial] = useState(VACIO_VIAL);
  const [guardandoVial, setGuardandoVial] = useState(false);

  useEffect(() => listenActas("i131_vial", setViales, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_extraccion", setExtracciones, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  const vialesFiltrados = useMemo(
    () => viales.filter((v) => (!filtroSede || v.sedeId === filtroSede) && (!filtroCategoria || categoriaVial(v) === filtroCategoria))
      .sort((a, b) => diasTranscurridos(a.fechaCalibracion) - diasTranscurridos(b.fechaCalibracion)),
    [viales, filtroSede, filtroCategoria]
  );

  async function confirmarAnulacion(acta, motivo) {
    try {
      await anularActaTransaction(acta, motivo, usuario);
      onToast("Registro anulado", "info", 6000);
      setMAnular(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function abrirNuevoVial() {
    setFormVial({ ...VACIO_VIAL, });
    setMostrarFormVial(true);
  }

  async function guardarVial() {
    if (!formVial.lote.trim() || !formVial.fechaCalibracion || !formVial.actividadCalibrada || !formVial.volumenInicial) return;
    setGuardandoVial(true);
    try {
      await addActaI131Vial({
        sedeId: usuario.sede, sedeNombre: catalogo.sedes[usuario.sede]?.nombre,
        lote: formVial.lote.trim(), categoria: formVial.categoria,
        fechaCalibracion: new Date(formVial.fechaCalibracion),
        actividadCalibrada: parseFloat(formVial.actividadCalibrada) || 0,
        volumenInicial: parseFloat(formVial.volumenInicial) || 0,
        fechaVencimiento: formVial.fechaVencimiento || null,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: formVial.obs.trim(),
      });
      onToast("Vial registrado");
      setMostrarFormVial(false);
      setFormVial(VACIO_VIAL);
    } catch (e) {
      onToast(e.message || "No se pudo registrar el vial", "error");
    } finally {
      setGuardandoVial(false);
    }
  }

  const vialSeleccionado = vialSeleccionadoId ? viales.find((v) => v.id === vialSeleccionadoId) : null;

  // Antes esto era un `if (vialSeleccionado) return <VialDetalle .../>` --
  // un return temprano separado del resto del JSX. Eso dejaba
  // ModalAnularActa (más abajo) en una rama que el detalle de vial nunca
  // alcanzaba: tocar "Anular" ahí actualizaba el estado sin ningún error,
  // pero el modal nunca llegaba a renderizarse. Ahora todo vive en un único
  // return, con el modal siempre disponible sin importar qué vista esté
  // activa.
  if (vialSeleccionado) {
    return (
      <div className="flex flex-col gap-4">
        <VialDetalle
          vial={vialSeleccionado}
          anulacionVial={anulaciones.get(vialSeleccionado.id)}
          todosLosViales={viales.filter((v) => v.sedeId === vialSeleccionado.sedeId && !anulaciones.get(v.id))}
          extracciones={extracciones}
          anulaciones={anulaciones}
          catalogo={catalogo}
          usuario={usuario}
          esAdmin={esAdmin}
          onToast={onToast}
          onVolver={() => setVialSeleccionadoId(null)}
          onAnular={(acta) => setMAnular(acta)}
        />
        {mAnular && (
          <ModalAnularActa
            acta={mAnular}
            resumen={mAnular.tipo === "i131_vial" ? `Vial ${mAnular.lote}` : `Extracción — ${mAnular.actividadCalculada?.toFixed(1)} mCi calc.`}
            onConfirm={confirmarAnulacion}
            onClose={() => setMAnular(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AvisoGuiaNoOficial />

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="w-full md:w-auto">
            <Sel value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
              <option value="">Todas las categorías</option>
              <option value="terapeutico">Sólo terapéutico</option>
              <option value="diagnostico">Sólo diagnóstico</option>
            </Sel>
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
        <Btn size="sm" onClick={abrirNuevoVial} className="w-full md:w-auto">+ Nuevo vial</Btn>
      </div>

      {mostrarFormVial && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-800">Nuevo vial de I-131</h3>
            <button onClick={() => setMostrarFormVial(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Lote (como viene del proveedor)" value={formVial.lote} onChange={(e) => setFormVial((f) => ({ ...f, lote: e.target.value }))} placeholder="Ej: 22/24 (4-17992)" />
            <Sel label="Categoría" value={formVial.categoria} onChange={(e) => setFormVial((f) => ({ ...f, categoria: e.target.value }))}>
              <option value="terapeutico">Terapéutico</option>
              <option value="diagnostico">Diagnóstico (solución de captación)</option>
            </Sel>
            <Input label="Fecha y hora de calibración" type="datetime-local" value={formVial.fechaCalibracion} onChange={(e) => setFormVial((f) => ({ ...f, fechaCalibracion: e.target.value }))} />
            <Input label="Actividad calibrada (mCi)" type="number" min={0} step={0.1} value={formVial.actividadCalibrada} onChange={(e) => setFormVial((f) => ({ ...f, actividadCalibrada: e.target.value }))} placeholder="1000" />
            <Input label="Volumen inicial (mL)" type="number" min={0} step={0.1} value={formVial.volumenInicial} onChange={(e) => setFormVial((f) => ({ ...f, volumenInicial: e.target.value }))} placeholder="10" />
            <Input label="Fecha de vencimiento (opcional)" type="date" value={formVial.fechaVencimiento} onChange={(e) => setFormVial((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
            <Input label="Observación (opcional)" value={formVial.obs} onChange={(e) => setFormVial((f) => ({ ...f, obs: e.target.value }))} placeholder="Ej: remito N°..." />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => setMostrarFormVial(false)} disabled={guardandoVial}>Cancelar</Btn>
            <Btn onClick={guardarVial} disabled={guardandoVial || !formVial.lote.trim() || !formVial.fechaCalibracion || !formVial.actividadCalibrada || !formVial.volumenInicial}>
              {guardandoVial ? "Guardando..." : "Guardar vial"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Viales</span>
          <Badge color="blue">{vialesFiltrados.length}</Badge>
        </div>
        {/* Desktop: tabla. */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Lote", "Categoría", "Sede", "Calibración", "Act. calibrada", "Vol. inicial", "Vol. restante", "Act. restante (calc.)", "Vencimiento", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vialesFiltrados.map((v) => {
                const anulacion = anulaciones.get(v.id);
                const volExtraido = volumenExtraidoDe(v.id, extracciones);
                const volRestante = Math.max(0, v.volumenInicial - volExtraido);
                const actRestante = actividadRestante(v, volRestante);
                const diasVenc = v.fechaVencimiento ? diasV(v.fechaVencimiento) : null;
                return (
                  <tr key={v.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 cursor-pointer ${anulacion ? "opacity-50" : ""}`} onClick={() => setVialSeleccionadoId(v.id)}>
                    <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs font-mono">
                      {v.lote}
                      {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
                    </td>
                    <td className="px-3 py-2.5"><Badge color={CATEGORIA_VIAL_LABEL[categoriaVial(v)].color}>{CATEGORIA_VIAL_LABEL[categoriaVial(v)].label}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[v.sedeId]?.short || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{fmtTs(v.fechaCalibracion)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{v.actividadCalibrada} mCi</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{v.volumenInicial} mL</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{volRestante.toFixed(1)} mL</td>
                    <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{actRestante.toFixed(1)}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
                    <td className="px-3 py-2.5 text-xs">
                      {diasVenc == null ? <span className="text-gray-300">—</span>
                        : diasVenc < 0 ? <Badge color="red">Vencido</Badge>
                        : diasVenc <= 5 ? <Badge color="orange">Vence {diasVenc}d</Badge>
                        : <span className="text-gray-500">{fmtF(v.fechaVencimiento)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-blue-600 font-semibold">Ver →</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Mobile: tarjeta por vial. */}
        <div className="md:hidden divide-y divide-gray-50">
          {vialesFiltrados.map((v) => {
            const anulacion = anulaciones.get(v.id);
            const volExtraido = volumenExtraidoDe(v.id, extracciones);
            const volRestante = Math.max(0, v.volumenInicial - volExtraido);
            const actRestante = actividadRestante(v, volRestante);
            return (
              <button key={v.id} onClick={() => setVialSeleccionadoId(v.id)} className={`w-full text-left p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800 text-sm font-mono">{v.lote}</span>
                  <span className="text-xs text-blue-600 font-semibold">Ver →</span>
                </div>
                <div><Badge color={CATEGORIA_VIAL_LABEL[categoriaVial(v)].color}>{CATEGORIA_VIAL_LABEL[categoriaVial(v)].label}</Badge></div>
                <div className="text-xs text-gray-500">{catalogo.sedes[v.sedeId]?.short || "—"} · Calibrado {fmtTs(v.fechaCalibracion)}</div>
                <div className="text-xs text-gray-700">
                  Restante: <span className="font-bold text-blue-700">{actRestante.toFixed(1)} mCi</span> en {volRestante.toFixed(1)} mL
                </div>
                {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
              </button>
            );
          })}
        </div>
        {vialesFiltrados.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Sin viales registrados todavía.</div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={mAnular.tipo === "i131_vial" ? `Vial ${mAnular.lote}` : `Extracción — ${mAnular.actividadCalculada?.toFixed(1)} mCi calc.`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
