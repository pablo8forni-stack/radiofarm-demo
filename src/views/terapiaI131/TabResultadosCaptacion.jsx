import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { listenActas, addActaI131CaptacionResultado, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { calcularPorcentajeCaptacion } from "../../helpers/porcentajeCaptacion.js";
import { TIPO_LABEL_I131, categoriaVial } from "../../constants/tipoI131.js";
import { AvisoGuiaNoOficial } from "./DesgloseCalculo.jsx";

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

const VACIO = { dosisActaId: "", extraccionId: "", cuentasPaciente: "", fondo: "", cuentasEstandar: "", volumenAdministrado: "", obs: "" };

// Desglose de %Captación -- a diferencia de DesgloseCalculo (pensado para
// decaimiento con fecha/λ), esta fórmula no depende del tiempo: son 4
// números y una razón. Mismo principio de transparencia igual: nunca sólo
// el resultado.
function DesglosePorcentaje({ cuentasPaciente, fondo, cuentasEstandar, volumenAdministrado, resultado }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 flex flex-col gap-1">
      <div className="font-semibold text-gray-700 mb-0.5">Cálculo de %Captación</div>
      <div className="flex justify-between"><span>Cuentas paciente</span><span className="font-mono">{cuentasPaciente}</span></div>
      <div className="flex justify-between"><span>Fondo</span><span className="font-mono">{fondo}</span></div>
      <div className="flex justify-between"><span>Cuentas estándar</span><span className="font-mono">{cuentasEstandar}</span></div>
      <div className="flex justify-between"><span>Volumen administrado</span><span className="font-mono">{volumenAdministrado} mL</span></div>
      <div className="text-gray-400 italic mt-1">Fórmula: %Captación = (paciente − fondo) × 100 ÷ ((estándar − fondo) × volumen)</div>
      <div className="mt-1 pt-1.5 border-t border-gray-200 flex items-baseline justify-between">
        <span className="font-semibold text-gray-700">Resultado</span>
        <span className="font-bold text-blue-700 text-sm">{resultado == null ? "—" : `${resultado.toFixed(2)}%`}</span>
      </div>
    </div>
  );
}

// Resultado de %Captación -- Parte B del espacio de cálculo I-131, vinculado
// al registro original de Captación/Centellograma/Captación y Centellograma
// (Terapia I-131 > Registros) vía dosisActaId. Mismo gate estricto que Stock
// de viales: lectura y escritura sólo con accesoTerapiaI131 (o admin) --
// quien puede crear un estudio diagnóstico es quien puede cargar su
// resultado, no hay técnico que necesite ver uno sin poder ver el otro.
export function TabResultadosCaptacion({ catalogo, usuario, esAdmin, onToast }) {
  const [captacion, setCaptacion] = useState([]);
  const [centellograma, setCentellograma] = useState([]);
  const [captCentellograma, setCaptCentellograma] = useState([]);
  const [viales, setViales] = useState([]);
  const [extracciones, setExtracciones] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => listenActas("i131_captacion", setCaptacion, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_centellograma", setCentellograma, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion_centellograma", setCaptCentellograma, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_vial", setViales, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_extraccion", setExtracciones, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenActas("i131_captacion_resultado", setResultados, { esAdmin, sedeId: usuario.sede }), []);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { esAdmin, sedeId: usuario.sede }), []);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // Registros diagnósticos disponibles para vincular -- los 3 tipos
  // mezclados, más recientes primero, filtrados por sede igual que el resto.
  const registrosDiagnosticos = useMemo(
    () => [...captacion, ...centellograma, ...captCentellograma]
      .filter((a) => !filtroSede || a.sedeId === filtroSede)
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [captacion, centellograma, captCentellograma, filtroSede]
  );
  const registroPorId = useMemo(() => new Map(registrosDiagnosticos.map((r) => [r.id, r])), [registrosDiagnosticos]);

  // Sólo extracciones cuyos viales son TODOS de categoría diagnóstico --
  // mismo espíritu que el guardrail de VialDetalle.jsx: no ofrecer mezclar
  // conceptos que no corresponden.
  const vialPorId = useMemo(() => new Map(viales.map((v) => [v.id, v])), [viales]);
  const extraccionesDiagnosticas = useMemo(
    () => extracciones
      .filter((e) => (e.viales || []).every((p) => categoriaVial(vialPorId.get(p.vialId) || {}) === "diagnostico"))
      .filter((e) => !filtroSede || e.sedeId === filtroSede)
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [extracciones, vialPorId, filtroSede]
  );

  const resultadosFiltrados = useMemo(
    () => resultados.filter((r) => !filtroSede || r.sedeId === filtroSede).sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [resultados, filtroSede]
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

  function abrirNuevo() {
    setForm(VACIO);
    setMostrarForm(true);
  }

  function elegirExtraccion(extraccionId) {
    const ext = extracciones.find((e) => e.id === extraccionId);
    const volumen = ext ? (ext.viales || []).reduce((s, p) => s + (p.mlExtraidos || 0), 0) : "";
    setForm((f) => ({ ...f, extraccionId, volumenAdministrado: volumen ? String(volumen) : f.volumenAdministrado }));
  }

  const resultadoCalculado = useMemo(() => {
    const { cuentasPaciente, fondo, cuentasEstandar, volumenAdministrado } = form;
    if (!cuentasPaciente || !cuentasEstandar || !volumenAdministrado) return null;
    return calcularPorcentajeCaptacion({
      cuentasPaciente: parseFloat(cuentasPaciente) || 0,
      fondo: parseFloat(fondo) || 0,
      cuentasEstandar: parseFloat(cuentasEstandar) || 0,
      volumenAdministrado: parseFloat(volumenAdministrado) || 0,
    });
  }, [form]);

  async function guardar() {
    if (!form.dosisActaId || !form.cuentasEstandar || !form.volumenAdministrado || resultadoCalculado == null) return;
    const registro = registroPorId.get(form.dosisActaId);
    if (!registro) return;
    setGuardando(true);
    try {
      await addActaI131CaptacionResultado({
        sedeId: registro.sedeId, sedeNombre: registro.sedeNombre,
        dosisActaId: form.dosisActaId,
        ...(form.extraccionId ? { extraccionId: form.extraccionId } : {}),
        cuentasPaciente: parseFloat(form.cuentasPaciente) || 0,
        fondo: parseFloat(form.fondo) || 0,
        cuentasEstandar: parseFloat(form.cuentasEstandar) || 0,
        volumenAdministrado: parseFloat(form.volumenAdministrado) || 0,
        porcentajeCaptacion: resultadoCalculado,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: form.obs.trim(),
      });
      onToast("Resultado de %Captación registrado");
      setMostrarForm(false);
      setForm(VACIO);
    } catch (e) {
      onToast(e.message || "No se pudo registrar el resultado", "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AvisoGuiaNoOficial />

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {esAdmin ? (
          <div className="w-full md:w-auto">
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          </div>
        ) : <div />}
        <Btn size="sm" onClick={abrirNuevo} className="w-full md:w-auto">+ Registrar %Captación</Btn>
      </div>

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">Nuevo resultado de %Captación</h3>
            <button onClick={() => setMostrarForm(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <Sel label="Registro diagnóstico" value={form.dosisActaId} onChange={(e) => setForm((f) => ({ ...f, dosisActaId: e.target.value }))}>
            <option value="">Seleccionar...</option>
            {registrosDiagnosticos.map((r) => (
              <option key={r.id} value={r.id}>
                Ficha {r.pacienteFicha || "—"} · {r.pacienteNombre} · {TIPO_LABEL_I131[r.tipo]?.label || r.tipo} · {fmtTs(r.fecha)}
              </option>
            ))}
          </Sel>

          <Sel label="Vincular a extracción de stock diagnóstico (opcional)" value={form.extraccionId} onChange={(e) => elegirExtraccion(e.target.value)}>
            <option value="">Sin vincular -- carga manual</option>
            {extraccionesDiagnosticas.map((e) => (
              <option key={e.id} value={e.id}>
                Ficha {e.pacienteFicha || "—"} · {fmtTs(e.fecha)} · {(e.viales || []).reduce((s, p) => s + (p.mlExtraidos || 0), 0)} mL
              </option>
            ))}
          </Sel>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Cuentas paciente" type="number" min={0} value={form.cuentasPaciente} onChange={(e) => setForm((f) => ({ ...f, cuentasPaciente: e.target.value }))} placeholder="12500" />
            <Input label="Fondo" type="number" min={0} value={form.fondo} onChange={(e) => setForm((f) => ({ ...f, fondo: e.target.value }))} placeholder="150" />
            <Input label="Cuentas estándar (1 mL)" type="number" min={0} value={form.cuentasEstandar} onChange={(e) => setForm((f) => ({ ...f, cuentasEstandar: e.target.value }))} placeholder="98000" />
            <Input label="Volumen administrado (mL)" type="number" min={0} step={0.01} value={form.volumenAdministrado} onChange={(e) => setForm((f) => ({ ...f, volumenAdministrado: e.target.value }))} placeholder="1.2" />
          </div>

          <DesglosePorcentaje
            cuentasPaciente={form.cuentasPaciente || 0} fondo={form.fondo || 0}
            cuentasEstandar={form.cuentasEstandar || 0} volumenAdministrado={form.volumenAdministrado || 0}
            resultado={resultadoCalculado}
          />

          <Input label="Observación (opcional)" value={form.obs} onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))} />

          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMostrarForm(false)} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={guardando || !form.dosisActaId || !form.cuentasEstandar || !form.volumenAdministrado || resultadoCalculado == null}>
              {guardando ? "Guardando..." : "Guardar resultado"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Resultados</span>
          <Badge color="blue">{resultadosFiltrados.length}</Badge>
        </div>
        <div className="divide-y divide-gray-50">
          {resultadosFiltrados.map((r) => {
            const anulacion = anulaciones.get(r.id);
            const registro = registroPorId.get(r.dosisActaId);
            return (
              <div key={r.id} className={`p-4 flex flex-col gap-2 ${anulacion ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-gray-800">{registro?.pacienteNombre || "Registro no encontrado"}</span>
                    {registro && <span className="text-gray-400"> · Ficha {registro.pacienteFicha || "—"} · {TIPO_LABEL_I131[registro.tipo]?.label}</span>}
                  </div>
                  {esAdmin && !anulacion && (
                    <button onClick={() => setMAnular(r)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                      Anular
                    </button>
                  )}
                </div>
                <div className="text-xs text-gray-500">{fmtTs(r.fecha)} · {r.usuarioNombre}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">%Captación:</span>
                  <span className="font-bold text-blue-700 text-lg">{r.porcentajeCaptacion.toFixed(2)}%</span>
                </div>
                <DesglosePorcentaje
                  cuentasPaciente={r.cuentasPaciente} fondo={r.fondo} cuentasEstandar={r.cuentasEstandar}
                  volumenAdministrado={r.volumenAdministrado} resultado={r.porcentajeCaptacion}
                />
                {r.observacion && <div className="text-xs text-gray-400 italic">{r.observacion}</div>}
                {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
              </div>
            );
          })}
          {resultadosFiltrados.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">Sin resultados de %Captación registrados todavía.</div>
          )}
        </div>
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={`%Captación — ${mAnular.porcentajeCaptacion.toFixed(2)}%`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
