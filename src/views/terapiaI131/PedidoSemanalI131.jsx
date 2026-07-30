import { useEffect, useState } from "react";
import { Input } from "../../components/ui/Input.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { CurvaTeoricaSVG } from "./CurvaDecaimiento.jsx";
import { listenPedidoSemanal, guardarPedidoSemanal } from "../../services/firestore/pedidosSemanales.js";
import { baldeDeTurno, remanenteBalde } from "../../helpers/pedidoSemanalI131.js";
import { diaDeSemana } from "../../helpers/semanaI131.js";
import { fmtF } from "../../helpers/formato.js";

// datetime-local necesita "YYYY-MM-DDTHH:mm" en hora LOCAL -- toISOString()
// convierte a UTC primero y desfasa la hora mostrada en Argentina (UTC-3),
// mismo cuidado que fmtFechaISO en helpers/formato.js.
function aInputDatetimeLocal(valor) {
  if (!valor) return "";
  const d = valor?.toDate ? valor.toDate() : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const BALDES = [
  { id: "martes", label: "Martes", offsetDia: 1, campoActividad: "actividadEsperadaMartes", campoFecha: "fechaHoraLlegadaMartes", color: "#7c3aed" },
  { id: "jueves", label: "Jueves", offsetDia: 3, campoActividad: "actividadEsperadaJueves", campoFecha: "fechaHoraLlegadaJueves", color: "#a21caf" },
];

// Simulación "Pedido semanal" -- PROYECCIÓN de material que todavía no
// llegó, completamente separada de Stock de viales (Parte A, exclusivo para
// material YA recibido y registrado). Panel deliberadamente distinto
// (morado, badge "Simulación") para que nunca se confunda a simple vista
// con un cálculo de vial real. Cualquiera con accesoAgendaI131 edita los 2
// baldes libremente durante la semana -- no hay "guardar", cada campo se
// persiste solo al perder el foco (setDoc merge, ver pedidosSemanales.js).
export function PedidoSemanalI131({ sedeId, semana, turnosSemana, onToast }) {
  const [pedido, setPedido] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (!sedeId || !semana) return;
    return listenPedidoSemanal(sedeId, semana, setPedido);
  }, [sedeId, semana]);

  useEffect(() => {
    setForm({
      actividadEsperadaMartes: pedido?.actividadEsperadaMartes != null ? String(pedido.actividadEsperadaMartes) : "",
      fechaHoraLlegadaMartes: aInputDatetimeLocal(pedido?.fechaHoraLlegadaMartes),
      actividadEsperadaJueves: pedido?.actividadEsperadaJueves != null ? String(pedido.actividadEsperadaJueves) : "",
      fechaHoraLlegadaJueves: aInputDatetimeLocal(pedido?.fechaHoraLlegadaJueves),
    });
  }, [pedido]);

  async function guardarActividad(campo, texto) {
    const valor = texto.trim() === "" ? null : parseFloat(texto);
    try {
      await guardarPedidoSemanal(sedeId, semana, { [campo]: valor != null && !Number.isNaN(valor) ? valor : null });
    } catch (e) {
      onToast?.(e.message || "No se pudo guardar", "error");
    }
  }

  async function guardarFecha(campo, texto) {
    try {
      await guardarPedidoSemanal(sedeId, semana, { [campo]: texto ? new Date(texto) : null });
    } catch (e) {
      onToast?.(e.message || "No se pudo guardar", "error");
    }
  }

  return (
    <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color="purple">⚠️ Simulación</Badge>
        <h3 className="text-sm font-bold text-purple-800">Pedido semanal (proyección, no es material real)</h3>
      </div>
      <p className="text-xs text-purple-600">
        Estimación de cuánto I-131 va a quedar disponible según lo que se espera recibir esta semana, menos lo ya agendado. No refleja stock real -- para eso está "Stock de viales", con material efectivamente recibido y registrado.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BALDES.map((b) => {
          const actividadEsperada = pedido?.[b.campoActividad];
          const fechaLlegada = pedido?.[b.campoFecha];
          const turnosDelBalde = turnosSemana.filter((t) => baldeDeTurno(t.fechaTurno, semana) === b.id);
          const calculo = remanenteBalde(actividadEsperada, fechaLlegada, turnosDelBalde);
          return (
            <div key={b.id} className="bg-white/70 border border-purple-100 rounded-xl p-3 flex flex-col gap-3">
              <div className="text-xs font-bold text-purple-700">{b.label} ({fmtF(diaDeSemana(semana, b.offsetDia))})</div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Actividad esperada (mCi)" type="number" min={0} max={500}
                  value={form[b.campoActividad] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [b.campoActividad]: e.target.value }))}
                  onBlur={(e) => guardarActividad(b.campoActividad, e.target.value)}
                  placeholder="hasta 500"
                />
                <Input
                  label="Fecha/hora de llegada" type="datetime-local"
                  value={form[b.campoFecha] ?? ""}
                  onChange={(e) => { setForm((f) => ({ ...f, [b.campoFecha]: e.target.value })); guardarFecha(b.campoFecha, e.target.value); }}
                />
              </div>
              {calculo ? (
                <>
                  <CurvaTeoricaSVG actividadInicial={actividadEsperada} diasHoy={calculo.dias} actividadHoy={calculo.remanente} colorLinea={b.color} colorHoy={b.color} labelHoy="Ahora" />
                  <div className="text-xs text-purple-700 text-center">
                    Proyección a hoy ({calculo.dias.toFixed(1)} días desde la llegada esperada): {calculo.teorica.toFixed(2)} mCi teóricos − {calculo.consumido.toFixed(2)} mCi ya agendados (ablativa/dosis) = <span className="font-bold">{calculo.remanente.toFixed(2)} mCi</span> remanente proyectado
                  </div>
                </>
              ) : (
                <div className="text-xs text-purple-400 italic text-center py-4">Completá actividad esperada y fecha/hora de llegada para ver la proyección.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
