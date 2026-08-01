import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { fmtF, hoy, capitalizarPalabras } from "../../helpers/formato.js";
import { sedesActivas } from "../../helpers/stock.js";
import { inicioSemana, finSemana, semanaSiguiente, semanaAnterior } from "../../helpers/semanaI131.js";
import { listenTurnosSemana, turnosDeSemana, addTurno, updateTurno, deleteTurno } from "../../services/firestore/turnos.js";
import { TIPO_LABEL_I131 } from "../../constants/tipoI131.js";
import { TOPE_SEMANAL_MCI, unidadDe, TIPOS_TURNO, sumaMci } from "../../helpers/turnosI131.js";
import { ImportarTurnosI131 } from "./ImportarTurnosI131.jsx";
import { PedidoSemanalI131 } from "./PedidoSemanalI131.jsx";

const ESTADO_LABEL = {
  confirmado: { label: "Confirmado", color: "green" },
  no_vino: { label: "No vino", color: "gray" },
  cancelado: { label: "Cancelado", color: "red" },
  reprogramado: { label: "Reprogramado", color: "orange" },
};

const VACIO = {
  fechaTurno: hoy(), pacienteNombre: "", pacienteDni: "", telefono: "",
  tipoDosis: "i131_dosis", actividadPrevista: "", obraSocial: "", fechaBarrido: "",
  estado: "confirmado", notas: "",
};

// Agenda de turnos I-131 (espacio de cálculo, Parte C) -- a diferencia de
// TODO lo demás en Gestión I-131 (y del sistema en general), turnos es una
// colección mutable de verdad: se reprograma/cancela/corrige libremente, sin
// el patrón de inmutabilidad+anulación del resto. Gate por
// accesoAgendaI131, permiso separado de accesoTerapiaI131 (ver
// VistaTerapiaI131.jsx) -- pensado para poder dárselo a personal
// administrativo sin exponer los cálculos clínicos de Stock de viales /
// Resultados %Captación.
export function TabAgendaI131({ catalogo, usuario, esAdmin, onToast }) {
  const [filtroSede, setFiltroSede] = useState(usuario.sede);
  const [semanaBase, setSemanaBase] = useState(hoy());
  const [turnosSemana, setTurnosSemana] = useState([]);
  const [mForm, setMForm] = useState(null); // null | "nuevo" | "editar"
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [mEliminar, setMEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [previaSemana, setPreviaSemana] = useState({ total: 0, cargando: false });
  const [mImportar, setMImportar] = useState(false);

  const sedeEfectiva = esAdmin ? filtroSede : usuario.sede;
  const inicio = inicioSemana(semanaBase);
  const fin = finSemana(semanaBase);

  useEffect(() => {
    if (!sedeEfectiva) { setTurnosSemana([]); return; }
    return listenTurnosSemana(sedeEfectiva, inicio, fin, setTurnosSemana);
  }, [sedeEfectiva, inicio, fin]);

  const turnosOrdenados = useMemo(
    () => [...turnosSemana].sort((a, b) => a.fechaTurno.localeCompare(b.fechaTurno)),
    [turnosSemana]
  );

  const totalSemanaVisible = useMemo(() => sumaMci(turnosSemana), [turnosSemana]);
  const superaTope = totalSemanaVisible > TOPE_SEMANAL_MCI;

  // Vista previa del tope al elegir fecha en el formulario -- si cae en la
  // semana que ya está en pantalla, reusa turnosSemana (sin fetch nuevo); si
  // es otra semana (agendar para dentro de 3 semanas mientras se mira la
  // actual), hace una consulta puntual acotada a esos 7 días. Nunca trae el
  // histórico completo.
  useEffect(() => {
    if (!mForm || !form.fechaTurno || !sedeEfectiva) return;
    const inicioF = inicioSemana(form.fechaTurno), finF = finSemana(form.fechaTurno);
    const excluyeId = mForm === "editar" ? form.id : null;
    if (inicioF === inicio && finF === fin) {
      setPreviaSemana({ total: sumaMci(turnosSemana, excluyeId), cargando: false });
      return;
    }
    let cancelado = false;
    setPreviaSemana((p) => ({ ...p, cargando: true }));
    turnosDeSemana(sedeEfectiva, inicioF, finF).then((turnos) => {
      if (!cancelado) setPreviaSemana({ total: sumaMci(turnos, excluyeId), cargando: false });
    });
    return () => { cancelado = true; };
  }, [mForm, form.fechaTurno, form.id, sedeEfectiva, inicio, fin, turnosSemana]);

  function abrirNuevo() {
    setForm({ ...VACIO, fechaTurno: semanaBase });
    setMForm("nuevo");
  }

  function abrirEditar(t) {
    setForm({
      id: t.id, fechaTurno: t.fechaTurno, pacienteNombre: t.pacienteNombre, pacienteDni: t.pacienteDni,
      telefono: t.telefono || "", tipoDosis: t.tipoDosis, actividadPrevista: t.actividadPrevista != null ? String(t.actividadPrevista) : "",
      obraSocial: t.obraSocial || "", fechaBarrido: t.fechaBarrido || "", estado: t.estado, notas: t.notas || "",
    });
    setMForm("editar");
  }

  async function guardar() {
    if (!form.fechaTurno || !form.pacienteNombre.trim() || !form.pacienteDni.trim()) return;
    setGuardando(true);
    const unidad = unidadDe(form.tipoDosis);
    const data = {
      sedeId: sedeEfectiva, sedeNombre: catalogo.sedes[sedeEfectiva]?.nombre,
      fechaTurno: form.fechaTurno, pacienteNombre: form.pacienteNombre.trim(), pacienteDni: form.pacienteDni.trim(),
      telefono: form.telefono.trim(), tipoDosis: form.tipoDosis,
      ...(unidad ? { actividadPrevista: parseFloat(form.actividadPrevista) || 0, unidadActividad: unidad } : {}),
      obraSocial: form.obraSocial.trim(), fechaBarrido: form.fechaBarrido || null,
      estado: form.estado, notas: form.notas.trim(),
      usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
    };
    try {
      if (mForm === "editar") {
        await updateTurno(form.id, { ...data, actualizadoPor: usuario.nombre });
        onToast("Turno actualizado");
      } else {
        await addTurno(data);
        onToast("Turno agendado");
      }
      setMForm(null);
      setForm(VACIO);
    } catch (e) {
      onToast(e.message || "No se pudo guardar el turno", "error");
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarEliminar() {
    if (!mEliminar) return;
    setEliminando(true);
    try {
      await deleteTurno(mEliminar.id);
      onToast("Turno eliminado", "info");
      setMEliminar(null);
    } catch (e) {
      onToast(e.message || "No se pudo eliminar el turno", "error");
    } finally {
      setEliminando(false);
    }
  }

  const unidadForm = unidadDe(form.tipoDosis);
  const previaConEsteTurno = previaSemana.total + (unidadForm === "mCi" ? (parseFloat(form.actividadPrevista) || 0) : 0);
  const previaSuperaTope = unidadForm === "mCi" && previaConEsteTurno > TOPE_SEMANAL_MCI;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="outline" onClick={() => setSemanaBase(semanaAnterior(semanaBase))}>← Semana anterior</Btn>
          <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">Semana del {fmtF(inicio)} al {fmtF(fin)}</span>
          <Btn size="sm" variant="outline" onClick={() => setSemanaBase(semanaSiguiente(semanaBase))}>Semana siguiente →</Btn>
        </div>
        {esAdmin && (
          <div className="w-full md:w-auto">
            <Sel value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              {sedesActivas(catalogo).map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </Sel>
          </div>
        )}
      </div>

      <div className={`rounded-xl px-4 py-3 text-xs font-semibold border ${superaTope ? "bg-red-50 border-red-200 text-red-700" : "bg-blue-50 border-blue-100 text-blue-700"}`}>
        Comprometido esta semana: {totalSemanaVisible.toFixed(1)} / {TOPE_SEMANAL_MCI} mCi
        {superaTope && " — supera el tope semanal del proveedor"}
      </div>

      <div className="flex justify-end gap-2">
        <Btn size="sm" variant="outline" onClick={() => setMImportar(true)} disabled={!sedeEfectiva}>Importar desde Excel</Btn>
        <Btn size="sm" onClick={abrirNuevo} disabled={!sedeEfectiva}>+ Nuevo turno</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Turnos</span>
          <Badge color="blue">{turnosOrdenados.length}</Badge>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {["Fecha", "Paciente", "Teléfono", "Tipo", "Actividad prevista", "Obra social", "BCT", "Estado", "Notas", ""].map((h, i) => (
                  <th key={i} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {turnosOrdenados.map((t) => {
                const tipo = TIPO_LABEL_I131[t.tipoDosis];
                const estado = ESTADO_LABEL[t.estado] || { label: t.estado, color: "gray" };
                return (
                  <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtF(t.fechaTurno)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="font-semibold text-gray-800">{t.pacienteNombre}</div>
                      <div className="text-gray-400 font-mono">{t.pacienteDni}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{t.telefono || "—"}</td>
                    <td className="px-3 py-2.5">{tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{t.actividadPrevista != null ? `${t.actividadPrevista} ${t.unidadActividad === "mCi" ? "mCi" : "µCi"}` : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{t.obraSocial || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{t.fechaBarrido ? fmtF(t.fechaBarrido) : "—"}</td>
                    <td className="px-3 py-2.5"><Badge color={estado.color}>{estado.label}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 italic">{t.notas || "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex gap-1.5 justify-end">
                        <Btn size="sm" variant="ghost" onClick={() => abrirEditar(t)}>Editar</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setMEliminar(t)}>Eliminar</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-gray-50">
          {turnosOrdenados.map((t) => {
            const tipo = TIPO_LABEL_I131[t.tipoDosis];
            const estado = ESTADO_LABEL[t.estado] || { label: t.estado, color: "gray" };
            return (
              <div key={t.id} className="p-4 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800 text-sm">{t.pacienteNombre}</span>
                  <span className="text-xs text-gray-500">{fmtF(t.fechaTurno)}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}
                  <Badge color={estado.color}>{estado.label}</Badge>
                </div>
                <div className="text-xs text-gray-500">DNI {t.pacienteDni} {t.telefono && `· ${t.telefono}`}</div>
                {t.actividadPrevista != null && <div className="text-xs text-gray-700">{t.actividadPrevista} {t.unidadActividad === "mCi" ? "mCi" : "µCi"}</div>}
                {t.obraSocial && <div className="text-xs text-gray-600">{t.obraSocial}</div>}
                {t.fechaBarrido && <div className="text-xs text-gray-600">BCT: {fmtF(t.fechaBarrido)}</div>}
                {t.notas && <div className="text-xs text-gray-400 italic">{t.notas}</div>}
                <div className="flex gap-1.5 justify-end mt-1">
                  <Btn size="sm" variant="ghost" onClick={() => abrirEditar(t)}>Editar</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setMEliminar(t)}>Eliminar</Btn>
                </div>
              </div>
            );
          })}
        </div>
        {turnosOrdenados.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Sin turnos agendados esta semana.</div>
        )}
      </div>

      {sedeEfectiva && (
        <PedidoSemanalI131 sedeId={sedeEfectiva} semana={inicio} turnosSemana={turnosSemana} onToast={onToast} />
      )}

      <Modal open={!!mForm} title={mForm === "editar" ? "Editar turno" : "Nuevo turno"} onClose={() => setMForm(null)} size="lg">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Fecha del turno" type="date" value={form.fechaTurno} onChange={(e) => setForm((f) => ({ ...f, fechaTurno: e.target.value }))} />
            <Sel label="Tipo de dosis" value={form.tipoDosis} onChange={(e) => setForm((f) => ({ ...f, tipoDosis: e.target.value }))}>
              {TIPOS_TURNO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Sel>
            <Input label="Paciente" value={form.pacienteNombre} onChange={(e) => setForm((f) => ({ ...f, pacienteNombre: capitalizarPalabras(e.target.value) }))} placeholder="García Juan" />
            <Input label="DNI" value={form.pacienteDni} onChange={(e) => setForm((f) => ({ ...f, pacienteDni: e.target.value }))} placeholder="28456789" />
            <Input label="Teléfono" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="261..." />
            {unidadForm && (
              <Input label={`Actividad prevista (${unidadForm === "mCi" ? "mCi" : "µCi"})`} type="number" min={0} step={unidadForm === "mCi" ? 0.1 : 1}
                value={form.actividadPrevista} onChange={(e) => setForm((f) => ({ ...f, actividadPrevista: e.target.value }))} />
            )}
            <Input label="Obra social" value={form.obraSocial} onChange={(e) => setForm((f) => ({ ...f, obraSocial: e.target.value }))} />
            <Input label="Fecha de barrido (BCT, opcional)" type="date" value={form.fechaBarrido} onChange={(e) => setForm((f) => ({ ...f, fechaBarrido: e.target.value }))} />
            <Sel label="Estado" value={form.estado} onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADO_LABEL).map(([id, e]) => <option key={id} value={id}>{e.label}</option>)}
            </Sel>
          </div>
          <Input label="Notas (opcional)" value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder='Ej: "dado por celu", "cort antes"' />

          {unidadForm === "mCi" && (
            <div className={`text-xs font-semibold rounded-xl px-4 py-3 border ${previaSuperaTope ? "bg-red-50 border-red-200 text-red-700" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
              {previaSemana.cargando
                ? "Calculando comprometido de esa semana..."
                : `Comprometido esa semana (sin este turno): ${previaSemana.total.toFixed(1)} mCi. Con este turno: ${previaConEsteTurno.toFixed(1)} / ${TOPE_SEMANAL_MCI} mCi${previaSuperaTope ? " — supera el tope semanal del proveedor" : ""}.`}
            </div>
          )}

          <div className="flex gap-2 justify-end mt-2">
            <Btn variant="outline" onClick={() => setMForm(null)} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={guardando || !form.fechaTurno || !form.pacienteNombre.trim() || !form.pacienteDni.trim()}>
              {guardando ? "Guardando..." : "Guardar turno"}
            </Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!mEliminar} title="Eliminar turno" onClose={() => setMEliminar(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            ¿Eliminar el turno de <span className="font-bold">{mEliminar?.pacienteNombre}</span> del {mEliminar && fmtF(mEliminar.fechaTurno)}?
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMEliminar(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={confirmarEliminar} disabled={eliminando}>{eliminando ? "Eliminando..." : "Eliminar"}</Btn>
          </div>
        </div>
      </Modal>

      <ImportarTurnosI131
        open={mImportar}
        onClose={() => setMImportar(false)}
        sedeId={sedeEfectiva}
        sedeNombre={catalogo.sedes[sedeEfectiva]?.nombre}
        usuario={usuario}
        onToast={onToast}
      />
    </div>
  );
}
