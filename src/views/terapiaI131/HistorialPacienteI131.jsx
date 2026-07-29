import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { actasPorPacienteDni } from "../../services/firestore/actas.js";
import { TIPO_LABEL_I131, MOMENTO_LABEL } from "../../constants/tipoI131.js";

// Historial completo de I-131 por paciente (Parte C, para auditorías ARN) --
// agrupado por pacienteDni (identificador estable, a diferencia del N° de
// Ficha que cambia por visita). Consulta acotada directamente por
// pacienteDni + tipo, en paralelo por cada uno de los 8 tipos posibles --
// nunca trae el histórico de otros pacientes. Ver actasPorPacienteDni en
// services/firestore/actas.js.
const TIPOS_HISTORIAL_I131 = [
  "i131_ablativa", "i131_dosis", "i131_barrido",
  "i131_captacion", "i131_centellograma", "i131_captacion_centellograma",
  "i131_captacion_resultado", "i131_seguimiento_fin",
];

const TIMEOUT_MS = 20000;
const MSJ_TIMEOUT = "La consulta tardó demasiado, puede haber un problema de conexión -- intentá cerrar las otras pestañas de RadioFarm que tengas abiertas y reintentá.";

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

function detalleFila(a) {
  if (a.tipo === "i131_ablativa" || a.tipo === "i131_dosis") return `${a.actividadAdministrada} mCi · Lote ${a.lote}`;
  if (a.tipo === "i131_captacion" || a.tipo === "i131_centellograma" || a.tipo === "i131_captacion_centellograma") {
    const base = a.actividadAdministrada != null ? `${a.actividadAdministrada} ${a.unidadActividad === "mCi" ? "mCi" : "µCi"}` : "—";
    return a.dosisActaId ? `${base} · Vinculado a dosis` : base;
  }
  if (a.tipo === "i131_captacion_resultado") return `${MOMENTO_LABEL[a.momento] || a.momento} · ${a.porcentajeCaptacion.toFixed(2)}%`;
  if (a.tipo === "i131_seguimiento_fin") return "Seguimiento finalizado";
  return "—";
}

function filaCSV(a) {
  const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
  return [
    d.toLocaleDateString("es-AR"), d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
    a.sedeNombre, TIPO_LABEL_I131[a.tipo]?.label || a.tipo,
    a.pacienteFicha || "—", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
    a.actividadAdministrada ?? "—", a.unidadActividad || "—", a.lote || "—", a.indicacion || "—",
    a.dosisActaId || "—", a.momento ? (MOMENTO_LABEL[a.momento] || a.momento) : "—",
    a.porcentajeCaptacion != null ? `${a.porcentajeCaptacion.toFixed(2)}%` : "—",
    a.usuarioNombre, a.observacion || "—",
  ];
}

function descargarCSV(lista, nombreArchivo) {
  const filas = [
    ["Fecha", "Hora", "Sede", "Tipo", "N° Ficha", "Paciente", "DNI", "Médico responsable", "Actividad administrada", "Unidad", "Lote", "Indicación", "Dosis vinculada (id)", "Momento", "%Captación", "Técnico", "Observación"],
    ...lista.map(filaCSV),
  ];
  const csv = filas.map((r) => r.map((x) => String(x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n");
  descargarArchivo(csv, nombreArchivo, "text/csv;charset=utf-8");
}

// sedeId: null/"" para admin sin sede elegida (ve todas las sedes de este
// paciente); la sede propia siempre para un técnico -- mismo criterio de
// scoping que el resto de las consultas de rango.
export function HistorialPacienteI131({ open, dni, sedeId, esAdmin, onClose, onToast }) {
  const [actas, setActas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !dni) return;
    setCargando(true);
    setError(null);
    setActas([]);
    conTimeout(
      Promise.all(TIPOS_HISTORIAL_I131.map((t) => actasPorPacienteDni(t, { dni, sedeId, esAdmin }))),
      TIMEOUT_MS, MSJ_TIMEOUT
    )
      .then((resultados) => setActas(resultados.flat().sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha))))
      .catch((e) => setError(e.message || "No se pudo cargar el historial."))
      .finally(() => setCargando(false));
  }, [open, dni, sedeId, esAdmin]);

  function descargar() {
    if (!actas.length) return;
    descargarCSV(actas, `historial_i131_dni_${dni}.csv`);
    onToast?.(`Historial exportado: ${actas.length} registro${actas.length !== 1 ? "s" : ""}`);
  }

  const paciente = actas[0];

  return (
    <Modal open={open} title="Historial completo de I-131" onClose={onClose} size="xl">
      <div className="flex flex-col gap-4">
        {paciente && (
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-gray-800">{paciente.pacienteNombre}</span>
            <span className="text-gray-400"> · DNI {dni}</span>
          </div>
        )}
        {!paciente && !cargando && <div className="text-sm text-gray-600">DNI {dni}</div>}

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{error}</div>}

        {cargando ? (
          <div className="text-center py-12 text-gray-400 text-sm">Buscando...</div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Badge color="blue">{actas.length} registro{actas.length !== 1 ? "s" : ""}</Badge>
              {actas.length > 0 && <Btn size="sm" variant="outline" onClick={descargar}>↓ Descargar historial de este paciente</Btn>}
            </div>

            <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-xl">
              {actas.map((a) => {
                const tipo = TIPO_LABEL_I131[a.tipo];
                return (
                  <div key={a.id} className="p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {tipo && <Badge color={tipo.color}>{tipo.label}</Badge>}
                        <span className="text-xs text-gray-500">{fmtTs(a.fecha)}</span>
                      </div>
                      <span className="text-xs text-gray-400">{a.sedeNombre}</span>
                    </div>
                    <div className="text-xs text-gray-700">{detalleFila(a)}</div>
                    {a.medicoResponsable && <div className="text-xs text-gray-500">Médico: {a.medicoResponsable}</div>}
                    <div className="text-xs text-gray-400">{a.usuarioNombre}</div>
                    {a.observacion && <div className="text-xs text-gray-400 italic">{a.observacion}</div>}
                  </div>
                );
              })}
              {actas.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">Sin registros de I-131 para este DNI.</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
