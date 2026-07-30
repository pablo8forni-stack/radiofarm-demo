import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { addMibgLote, listenMibgLotes } from "../../services/firestore/mibgLotes.js";

const VACIO = { numeroLote: "", proveedor: "", actividadCalibrada: "", volumen: "", fechaHoraCalibracion: "", fechaVencimiento: "", obs: "" };

const ESTADO_LOTE = {
  disponible: { label: "Disponible", color: "green" },
  usado: { label: "Usado", color: "gray" },
  anulado: { label: "Anulado", color: "red" },
};

// MIBG (131I-MIBG) -- neuroblastoma/feocromocitoma/paraganglioma, sobre todo
// en niños. A diferencia de Stock de viales (Parte A), SIN curva de
// decaimiento ni balance HAY/SACADO/QUEDAN: cada vial es una dosis completa
// para un único paciente, se administra apenas llega. Abierta a CUALQUIER
// técnico (sin accesoTerapiaI131/accesoAgendaI131) -- ver VistaTerapiaI131.jsx.
// "Disponible" se deriva acá mismo (nunca se guarda un contador): un lote
// deja de estarlo apenas existe una i131_mibg no anulada que lo usa, o si el
// lote mismo se anula -- ambos vía listeners en vivo, nunca queda "vencido"
// por refrescar la pantalla.
export function TabMibg({ catalogo, usuario, esAdmin, onToast }) {
  const [lotes, setLotes] = useState([]);
  const [usos, setUsos] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => listenMibgLotes(setLotes, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_mibg", setUsos, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);
  const usoPorLoteId = useMemo(() => new Map(usos.map((u) => [u.mibgLoteId, u])), [usos]);

  function estadoDe(lote) {
    if (anulaciones.has(lote.id)) return "anulado";
    if (usoPorLoteId.has(lote.id)) return "usado";
    return "disponible";
  }

  const lotesFiltrados = useMemo(
    () => lotes.filter((l) => !filtroSede || l.sedeId === filtroSede)
      .sort((a, b) => (b.fecha?.toDate?.() ?? new Date(b.fecha)) - (a.fecha?.toDate?.() ?? new Date(a.fecha))),
    [lotes, filtroSede]
  );

  async function confirmarAnulacion(lote, motivo) {
    try {
      await anularActaTransaction(lote, motivo, usuario);
      onToast("Lote anulado", "info", 6000);
      setMAnular(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardar() {
    if (!form.numeroLote.trim() || !form.proveedor.trim() || !form.actividadCalibrada || !form.volumen || !form.fechaHoraCalibracion || !form.fechaVencimiento) return;
    setGuardando(true);
    try {
      await addMibgLote({
        sedeId: usuario.sede, sedeNombre: catalogo.sedes[usuario.sede]?.nombre,
        numeroLote: form.numeroLote.trim(), proveedor: form.proveedor.trim(),
        actividadCalibrada: parseFloat(form.actividadCalibrada) || 0,
        volumen: parseFloat(form.volumen) || 0,
        fechaHoraCalibracion: new Date(form.fechaHoraCalibracion),
        fechaVencimiento: form.fechaVencimiento,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: form.obs.trim(),
      });
      onToast("Lote de MIBG registrado");
      setMostrarForm(false);
      setForm(VACIO);
    } catch (e) {
      onToast(e.message || "No se pudo registrar el lote", "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        131I-MIBG (neuroblastoma/feocromocitoma/paraganglioma) -- cada lote es una dosis completa para un único paciente, se administra al llegar. Sin curva de decaimiento ni balance de volumen: para eso está "Stock de viales", que es otro material. La administración a un paciente se carga en Libro 2, eligiendo "MIBG" como tipo de registro.
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {esAdmin ? (
          <div className="w-full md:w-auto">
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          </div>
        ) : <div />}
        <Btn size="sm" onClick={() => setMostrarForm(true)} className="w-full md:w-auto">+ Registrar lote nuevo</Btn>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">Nuevo lote de MIBG</h3>
            <button onClick={() => setMostrarForm(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="N° de lote" value={form.numeroLote} onChange={(e) => setForm((f) => ({ ...f, numeroLote: e.target.value }))} placeholder="Ej: MIBG-2026-014" />
            <Input label="Proveedor" value={form.proveedor} onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value }))} placeholder="Ej: IPEN" />
            <Input label="Actividad calibrada (mCi)" type="number" min={0} step={0.1} value={form.actividadCalibrada} onChange={(e) => setForm((f) => ({ ...f, actividadCalibrada: e.target.value }))} placeholder="150" />
            <Input label="Volumen (mL)" type="number" min={0} step={0.1} value={form.volumen} onChange={(e) => setForm((f) => ({ ...f, volumen: e.target.value }))} placeholder="10" />
            <Input label="Fecha/hora de calibración" type="datetime-local" value={form.fechaHoraCalibracion} onChange={(e) => setForm((f) => ({ ...f, fechaHoraCalibracion: e.target.value }))} />
            <Input label="Fecha de vencimiento" type="date" value={form.fechaVencimiento} onChange={(e) => setForm((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
          </div>
          <Input label="Observación (opcional)" value={form.obs} onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))} />
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMostrarForm(false)} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={guardando || !form.numeroLote.trim() || !form.proveedor.trim() || !form.actividadCalibrada || !form.volumen || !form.fechaHoraCalibracion || !form.fechaVencimiento}>
              {guardando ? "Guardando..." : "Guardar lote"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Lotes de MIBG</span>
          <Badge color="blue">{lotesFiltrados.length}</Badge>
        </div>
        <div className="divide-y divide-gray-50">
          {lotesFiltrados.map((l) => {
            const estado = ESTADO_LOTE[estadoDe(l)];
            const anulacion = anulaciones.get(l.id);
            const uso = usoPorLoteId.get(l.id);
            return (
              <div key={l.id} className={`p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-semibold text-gray-800">{l.numeroLote}</div>
                  <Badge color={estado.color}>{estado.label}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {fmtTs(l.fecha)} · {l.sedeNombre} · Proveedor: {l.proveedor}
                </div>
                <div className="text-xs text-gray-700">
                  {l.actividadCalibrada} mCi en {l.volumen} mL · Calibrado {fmtTs(l.fechaHoraCalibracion)} · Vence {fmtF(l.fechaVencimiento)}
                </div>
                {uso && <div className="text-xs text-gray-500">Usado en: Ficha {uso.pacienteFicha || "—"} · {uso.pacienteNombre} · {fmtTs(uso.fecha)}</div>}
                {l.observacion && <div className="text-xs text-gray-400 italic">{l.observacion}</div>}
                {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
                <div className="text-xs text-gray-400">{l.usuarioNombre}</div>
                {esAdmin && estadoDe(l) === "disponible" && (
                  <div className="flex justify-end mt-0.5">
                    <button onClick={() => setMAnular(l)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                      Anular
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {lotesFiltrados.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">Sin lotes de MIBG registrados todavía.</div>
          )}
        </div>
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`Lote MIBG ${mAnular.numeroLote} — ${mAnular.actividadCalibrada} mCi`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
