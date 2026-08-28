import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { listenActas, addActaI131CaptacionResultado, addActaI131SeguimientoFin, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import { calcularPorcentajeCaptacion } from "../../helpers/porcentajeCaptacion.js";
import { TIPO_LABEL_I131, categoriaVial, MOMENTOS_CAPTACION as MOMENTOS, MOMENTO_LABEL } from "../../constants/tipoI131.js";
import { AvisoGuiaNoOficial } from "./DesgloseCalculo.jsx";

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

const VACIO = { dosisActaId: "", momento: "", extraccionId: "", cuentasPaciente: "", fondo: "", cuentasEstandar: "", volumenAdministrado: "", obs: "" };

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
// (Gestión I-131 > Registros) vía dosisActaId. Mismo gate estricto que Stock
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
  const [seguimientosFin, setSeguimientosFin] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  const [mConfirmarFin, setMConfirmarFin] = useState(null);
  const [finalizando, setFinalizando] = useState(false);
  // Ver comentario largo equivalente en TabPacientes.jsx.
  const sedeEfectiva = esAdmin ? usuario.sedeAuditando : usuario.sede;
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (sedeEfectiva) return listenActas("i131_captacion", setCaptacion, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_centellograma", setCentellograma, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_captacion_centellograma", setCaptCentellograma, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_vial", setViales, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_extraccion", setExtracciones, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_captacion_resultado", setResultados, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_seguimiento_fin", setSeguimientosFin, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenAnulacionesActas(setAnulacionesRaw, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);
  const finalizadoPorDosis = useMemo(() => new Map(seguimientosFin.map((s) => [s.dosisActaId, s])), [seguimientosFin]);

  // Momentos ya cargados por dosisActaId -- el id determinístico
  // captacion_${dosisActaId}_${momento} bloquea para siempre un segundo
  // intento del mismo momento (allow update: false), incluso si ese
  // resultado terminó anulado, así que no hace falta excluir anulados acá.
  const momentosUsadosPorDosis = useMemo(() => {
    const map = new Map();
    for (const r of resultados) {
      if (!map.has(r.dosisActaId)) map.set(r.dosisActaId, new Set());
      map.get(r.dosisActaId).add(r.momento);
    }
    return map;
  }, [resultados]);

  // Registros diagnósticos disponibles para vincular -- los 3 tipos
  // mezclados, más recientes primero, filtrados por sede igual que el resto.
  const registrosDiagnosticos = useMemo(
    () => [...captacion, ...centellograma, ...captCentellograma]
      .filter((a) => !sedeEfectiva || a.sedeId === sedeEfectiva)
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [captacion, centellograma, captCentellograma, sedeEfectiva]
  );
  const registroPorId = useMemo(() => new Map(registrosDiagnosticos.map((r) => [r.id, r])), [registrosDiagnosticos]);

  // Para el picker de "nuevo resultado": no ofrecer casos con seguimiento ya
  // finalizado (la regla del servidor los rechazaría igual, esto es sólo
  // para no dejar elegir algo que va a fallar).
  const registrosParaNuevo = useMemo(
    () => registrosDiagnosticos.filter((r) => !finalizadoPorDosis.has(r.id)),
    [registrosDiagnosticos, finalizadoPorDosis]
  );

  // Sólo extracciones cuyos viales son TODOS de categoría diagnóstico --
  // mismo espíritu que el guardrail de VialDetalle.jsx: no ofrecer mezclar
  // conceptos que no corresponden.
  const vialPorId = useMemo(() => new Map(viales.map((v) => [v.id, v])), [viales]);
  const extraccionesDiagnosticas = useMemo(
    () => extracciones
      .filter((e) => (e.viales || []).every((p) => categoriaVial(vialPorId.get(p.vialId) || {}) === "diagnostico"))
      .filter((e) => !sedeEfectiva || e.sedeId === sedeEfectiva)
      .sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [extracciones, vialPorId, sedeEfectiva]
  );

  const resultadosFiltrados = useMemo(
    () => resultados.filter((r) => !sedeEfectiva || r.sedeId === sedeEfectiva).sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)),
    [resultados, sedeEfectiva]
  );

  // Vista agrupada por caso (dosisActaId) -- cada grupo muestra el estado de
  // los 3 momentos (cargado/pendiente) y si el seguimiento ya se finalizó,
  // en vez de una lista plana donde hora/24h/48h del mismo paciente
  // aparecen mezcladas con las de otros.
  const gruposPorDosis = useMemo(() => {
    const map = new Map();
    for (const r of resultadosFiltrados) {
      if (!map.has(r.dosisActaId)) map.set(r.dosisActaId, []);
      map.get(r.dosisActaId).push(r);
    }
    return [...map.entries()]
      .map(([dosisActaId, items]) => ({
        dosisActaId,
        items: [...items].sort((a, b) => MOMENTOS.indexOf(a.momento) - MOMENTOS.indexOf(b.momento)),
        masReciente: Math.max(...items.map((i) => tsMillis(i.fecha))),
      }))
      .sort((a, b) => b.masReciente - a.masReciente);
  }, [resultadosFiltrados]);

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

  // Al elegir el caso, el momento se resetea a la primera opción todavía
  // disponible para esa dosis puntual (o "" si ya están los 3 cargados sin
  // haber finalizado seguimiento).
  function elegirDosis(dosisActaId) {
    const usados = momentosUsadosPorDosis.get(dosisActaId) || new Set();
    const disponibles = MOMENTOS.filter((m) => !usados.has(m));
    setForm((f) => ({ ...f, dosisActaId, momento: disponibles[0] || "" }));
  }

  const momentosDisponibles = useMemo(() => {
    if (!form.dosisActaId) return MOMENTOS;
    const usados = momentosUsadosPorDosis.get(form.dosisActaId) || new Set();
    return MOMENTOS.filter((m) => !usados.has(m));
  }, [form.dosisActaId, momentosUsadosPorDosis]);

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
    if (!form.dosisActaId || !form.momento || !form.cuentasEstandar || !form.volumenAdministrado || resultadoCalculado == null) return;
    const registro = registroPorId.get(form.dosisActaId);
    if (!registro) return;
    setGuardando(true);
    try {
      await addActaI131CaptacionResultado({
        sedeId: registro.sedeId, sedeNombre: registro.sedeNombre,
        dosisActaId: form.dosisActaId, momento: form.momento,
        pacienteDni: registro.pacienteDni, pacienteNombre: registro.pacienteNombre,
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
      // "48h" es el último momento posible -- recién ahí tiene sentido
      // ofrecer cerrar el seguimiento de esta dosis puntual.
      if (form.momento === "48h") setMConfirmarFin(registro);
      setForm(VACIO);
    } catch (e) {
      onToast(e.message || "No se pudo registrar el resultado", "error");
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarFinalizarSeguimiento() {
    if (!mConfirmarFin) return;
    setFinalizando(true);
    try {
      await addActaI131SeguimientoFin({
        sedeId: mConfirmarFin.sedeId, sedeNombre: mConfirmarFin.sedeNombre,
        dosisActaId: mConfirmarFin.id,
        pacienteDni: mConfirmarFin.pacienteDni, pacienteNombre: mConfirmarFin.pacienteNombre,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
      });
      onToast("Seguimiento finalizado");
      setMConfirmarFin(null);
    } catch (e) {
      onToast(e.message || "No se pudo finalizar el seguimiento", "error");
    } finally {
      setFinalizando(false);
    }
  }

  if (esAdmin && !sedeEfectiva) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
        Elegí qué sede vas a auditar en Configuración antes de ver esta sección.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AvisoGuiaNoOficial />

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {esAdmin ? (
          <div className="w-full md:w-auto text-xs text-gray-400">
            Auditando <span className="font-semibold text-gray-600">{catalogo.sedes[sedeEfectiva]?.short || "—"}</span> · cambiar en Configuración
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

          <Sel label="Registro diagnóstico" value={form.dosisActaId} onChange={(e) => elegirDosis(e.target.value)}>
            <option value="">Seleccionar...</option>
            {registrosParaNuevo.map((r) => (
              <option key={r.id} value={r.id}>
                Ficha {r.pacienteFicha || "—"} · {r.pacienteNombre} · {TIPO_LABEL_I131[r.tipo]?.label || r.tipo} · {fmtTs(r.fecha)}
              </option>
            ))}
          </Sel>

          {form.dosisActaId && (
            momentosDisponibles.length > 0 ? (
              <Sel label="Momento" value={form.momento} onChange={(e) => setForm((f) => ({ ...f, momento: e.target.value }))}>
                <option value="">Seleccionar...</option>
                {momentosDisponibles.map((m) => <option key={m} value={m}>{MOMENTO_LABEL[m]}</option>)}
              </Sel>
            ) : (
              <div className="text-xs text-orange-500 font-semibold bg-orange-50 border border-orange-100 rounded-xl p-3">
                Ya se cargaron los 3 momentos (hora, 24h, 48h) para este caso.
              </div>
            )
          )}

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
            <Btn onClick={guardar} disabled={guardando || !form.dosisActaId || !form.momento || !form.cuentasEstandar || !form.volumenAdministrado || resultadoCalculado == null}>
              {guardando ? "Guardando..." : "Guardar resultado"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Resultados</span>
          <Badge color="blue">{gruposPorDosis.length}</Badge>
        </div>
        <div className="divide-y divide-gray-100">
          {gruposPorDosis.map((grupo) => {
            const registro = registroPorId.get(grupo.dosisActaId);
            const finalizado = finalizadoPorDosis.get(grupo.dosisActaId);
            const usados = new Set(grupo.items.map((i) => i.momento));
            return (
              <div key={grupo.dosisActaId} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm">
                    <span className="font-semibold text-gray-800">{registro?.pacienteNombre || "Registro no encontrado"}</span>
                    {registro && <span className="text-gray-400"> · Ficha {registro.pacienteFicha || "—"} · {TIPO_LABEL_I131[registro.tipo]?.label}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {MOMENTOS.map((m) => (
                      <span
                        key={m}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${usados.has(m) ? "bg-blue-50 text-blue-600 line-through decoration-blue-300" : "bg-gray-100 text-gray-400"}`}
                      >
                        {MOMENTO_LABEL[m]}
                      </span>
                    ))}
                    {finalizado && <Badge color="green">Finalizado</Badge>}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {grupo.items.map((r) => {
                    const anulacion = anulaciones.get(r.id);
                    return (
                      <div key={r.id} className={`bg-gray-50 rounded-xl p-3 flex flex-col gap-2 ${anulacion ? "opacity-50" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge color="blue">{MOMENTO_LABEL[r.momento] || r.momento}</Badge>
                            <span className="text-xs text-gray-500">{fmtTs(r.fecha)} · {r.usuarioNombre}</span>
                          </div>
                          {esAdmin && !anulacion && (
                            <button onClick={() => setMAnular(r)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                              Anular
                            </button>
                          )}
                        </div>
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
                </div>
              </div>
            );
          })}
          {gruposPorDosis.length === 0 && (
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

      <Modal open={!!mConfirmarFin} title="¿Finalizar seguimiento?" onClose={() => setMConfirmarFin(null)} size="sm">
        {mConfirmarFin && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              Se cargó el resultado de <strong>48 h</strong> para <strong>{mConfirmarFin.pacienteNombre}</strong> (Ficha {mConfirmarFin.pacienteFicha || "—"}).
              Finalizar el seguimiento bloquea la carga de más controles de %Captación para esta dosis puntual. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={() => setMConfirmarFin(null)} disabled={finalizando}>No finalizar</Btn>
              <Btn onClick={confirmarFinalizarSeguimiento} disabled={finalizando}>
                {finalizando ? "Finalizando..." : "Finalizar seguimiento"}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
