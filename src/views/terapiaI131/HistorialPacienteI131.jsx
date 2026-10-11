import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { fmtTs, fmtHora } from "../../helpers/formato.js";
import { descargarArchivo } from "../../helpers/descargarArchivo.js";
import { actasPorPacienteDni } from "../../services/firestore/actas.js";
import { esErrorDePermiso, esErrorSinConexion } from "../../helpers/erroresRed.js";
import { TIPO_LABEL_I131, MOMENTO_LABEL } from "../../constants/tipoI131.js";

// Historial completo de I-131 por paciente (Parte C, para auditorías ARN) --
// agrupado por pacienteDni (identificador estable, a diferencia del N° de
// Ficha que cambia por visita). Consulta acotada directamente por
// pacienteDni + tipo, en paralelo por cada uno de los 10 tipos posibles --
// nunca trae el histórico de otros pacientes. Ver actasPorPacienteDni en
// services/firestore/actas.js. i131_mibg entra acá igual que el resto (es
// una acta más de Libro 2) -- mibg_lote en cambio NO tiene pacienteDni, así
// que el lote físico en sí queda fuera de este historial por paciente.
const TIPOS_HISTORIAL_I131 = [
  "i131_ablativa", "i131_dosis", "i131_barrido", "i131_dosis_barrido", "i131_mibg",
  "i131_captacion", "i131_centellograma", "i131_captacion_centellograma",
  "i131_captacion_resultado", "i131_seguimiento_fin",
];

// Por consulta individual, no por el conjunto -- ver nota larga en el
// useEffect de abajo sobre por qué (bug real: antes envolvía el Promise.all
// entero, así que UNA consulta colgada tiraba todo el historial, las otras
// 9 incluidas).
const TIMEOUT_MS = 20000;
const MSJ_TIMEOUT = "La consulta tardó demasiado, puede haber un problema de conexión.";

function conTimeout(promesa, ms, mensaje) {
  let idTimeout;
  const timeout = new Promise((_, reject) => {
    idTimeout = setTimeout(() => {
      const e = new Error(mensaje);
      e.esTimeoutPropio = true;
      reject(e);
    }, ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));
}

function tsMillis(fecha) {
  if (!fecha) return 0;
  const d = typeof fecha?.toDate === "function" ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Sólo para cuando las 10 consultas fallaron -- no hay nada que mostrar,
// así que vale la pena traducir el motivo (a diferencia del aviso de
// incompleto, que lista TIPOS que fallaron sin necesitar explicar por qué).
// Se clasifica por el primer rechazo -- si las 10 fallaron por la misma
// causa real (permiso o sin conexión), alcanza; si fuera una mezcla de
// causas distintas, el mensaje genérico de abajo sigue siendo correcto
// aunque menos específico.
function mensajeErrorTotal(error) {
  if (esErrorDePermiso(error)) return "No se pudo leer el historial: tu usuario no tiene permiso para uno o más tipos de registro.";
  if (esErrorSinConexion(error)) return "No se pudo leer el historial: sin conexión.";
  if (error?.esTimeoutPropio) return "No se pudo leer el historial: la consulta tardó demasiado.";
  return "No se pudo leer el historial.";
}

function detalleFila(a) {
  if (a.tipo === "i131_ablativa" || a.tipo === "i131_dosis") return `${a.actividadAdministrada} mCi · Lote ${a.lote}`;
  if (a.tipo === "i131_mibg") return `${a.actividadCalibrada} mCi · Lote ${a.numeroLote}`;
  if (a.tipo === "i131_captacion" || a.tipo === "i131_centellograma" || a.tipo === "i131_captacion_centellograma" || a.tipo === "i131_dosis_barrido") {
    const base = a.actividadAdministrada != null ? `${a.actividadAdministrada} ${a.unidadActividad === "mCi" ? "mCi" : "µCi"}` : "—";
    return a.dosisActaId ? `${base} · Vinculado a dosis` : base;
  }
  if (a.tipo === "i131_captacion_resultado") return `${MOMENTO_LABEL[a.momento] || a.momento} · ${a.porcentajeCaptacion.toFixed(2)}%`;
  if (a.tipo === "i131_seguimiento_fin") {
    return a.motivoFinalizacionIncompleta ? `Seguimiento finalizado incompleto -- ${a.motivoFinalizacionIncompleta}` : "Seguimiento finalizado";
  }
  return "—";
}

function filaCSV(a) {
  const d = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
  return [
    d.toLocaleDateString("es-AR"), fmtHora(a.fecha),
    a.sedeNombre, TIPO_LABEL_I131[a.tipo]?.label || a.tipo,
    a.pacienteFicha || "—", a.pacienteNombre, a.pacienteDni, a.medicoResponsable || "—",
    a.actividadAdministrada ?? a.actividadCalibrada ?? "—", a.unidadActividad || (a.tipo === "i131_mibg" ? "mCi" : "—"), a.lote || a.numeroLote || "—", a.indicacion || "—",
    a.dosisActaId || "—", a.momento ? (MOMENTO_LABEL[a.momento] || a.momento) : "—",
    a.porcentajeCaptacion != null ? `${a.porcentajeCaptacion.toFixed(2)}%` : "—",
    a.usuarioNombre, a.observacion || "—",
  ];
}

// avisos: líneas de advertencia (incompleto/caché) que van COMO FILAS reales
// arriba del encabezado -- no sólo en el toast -- porque el archivo puede
// circular (mail, pendrive) sin el toast que lo acompañó al descargarlo. Una
// sola celda por fila (no 17 columnas vacías) para que salte a la vista
// apenas se abre en Excel/Sheets, sin poder confundirse con una fila de dato.
function descargarCSV(lista, nombreArchivo, avisos) {
  const filas = [
    ...avisos.map((a) => [a]),
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
  // Tipos que no se pudieron leer (permiso, timeout propio, red, lo que
  // sea) -- cada uno con su error real, para poder traducir el caso "las
  // 10 fallaron" sin perder esa información.
  const [tiposFallidos, setTiposFallidos] = useState([]);
  // Firestore con persistencia offline no tira error sin conexión -- sirve
  // en silencio lo último guardado en este dispositivo (ver nota en
  // actasPorPacienteDni). Sin este aviso, un historial desactualizado se ve
  // idéntico a uno fresco y completo.
  const [huboCache, setHuboCache] = useState(false);

  useEffect(() => {
    if (!open || !dni) return;
    setCargando(true);
    setActas([]);
    setTiposFallidos([]);
    setHuboCache(false);
    // Bug real (encontrado y corregido en esta misma revisión): antes
    // conTimeout envolvía el Promise.all ENTERO -- una sola consulta
    // colgada (nunca resuelve, nunca rechaza) hacía que el timeout global
    // reventara TODO el historial a los 20s, perdiendo los resultados de
    // las 9 consultas que sí habían respondido. Ahora cada una tiene su
    // propio timeout: una colgada cuenta como "ese tipo falló" (ver
    // tiposFallidos) sin tocar a las demás. Promise.allSettled (no
    // Promise.all) por el mismo motivo -- un permission-denied real en
    // captacion_resultado/seguimiento_fin (el único caso hoy: ver
    // firestore.rules#esTipoStockI131, exige accesoTerapiaI131 sólo para
    // esos 2 tipos) no debe tirar los otros 8.
    Promise.allSettled(
      TIPOS_HISTORIAL_I131.map((t) => conTimeout(actasPorPacienteDni(t, { dni, sedeId, esAdmin }), TIMEOUT_MS, MSJ_TIMEOUT))
    ).then((resultados) => {
      const actasOk = [];
      const fallidos = [];
      let cache = false;
      resultados.forEach((r, i) => {
        if (r.status === "fulfilled") {
          actasOk.push(...r.value.docs);
          if (r.value.fromCache) cache = true;
        } else {
          fallidos.push({ tipo: TIPOS_HISTORIAL_I131[i], error: r.reason });
        }
      });
      setActas(actasOk.sort((a, b) => tsMillis(b.fecha) - tsMillis(a.fecha)));
      setTiposFallidos(fallidos);
      setHuboCache(cache);
    }).finally(() => setCargando(false));
  }, [open, dni, sedeId, esAdmin]);

  const todosFallaron = tiposFallidos.length > 0 && tiposFallidos.length === TIPOS_HISTORIAL_I131.length;
  const etiquetasFallidas = tiposFallidos.map(({ tipo }) => TIPO_LABEL_I131[tipo]?.label || tipo);

  function avisosParaArchivo() {
    const avisos = [];
    if (tiposFallidos.length > 0) {
      avisos.push(`AVISO: HISTORIAL INCOMPLETO -- no se pudieron leer ${tiposFallidos.length} de ${TIPOS_HISTORIAL_I131.length} tipos de registro: ${etiquetasFallidas.join(", ")}.`);
    }
    if (huboCache) {
      avisos.push("AVISO: parte de estos datos viene del caché de este dispositivo (sin conexión al servidor en el momento de la consulta) -- puede no reflejar cargas recientes.");
    }
    return avisos;
  }

  function descargar() {
    if (!actas.length) return;
    const avisos = avisosParaArchivo();
    descargarCSV(actas, `historial_i131_dni_${dni}.csv`, avisos);
    const sufijoIncompleto = avisos.length > 0 ? " -- INCOMPLETO, ver primera(s) fila(s) del archivo" : "";
    onToast?.(`Historial exportado: ${actas.length} registro${actas.length !== 1 ? "s" : ""}${sufijoIncompleto}`);
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

        {cargando ? (
          <div className="text-center py-12 text-gray-400 text-sm">Buscando...</div>
        ) : todosFallaron ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">
            {mensajeErrorTotal(tiposFallidos[0].error)}
          </div>
        ) : (
          <>
            {(tiposFallidos.length > 0 || huboCache) && (
              <div className="bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-xl px-3 py-2 flex flex-col gap-1">
                {tiposFallidos.length > 0 && (
                  <div>
                    <span className="font-semibold">Historial incompleto:</span> no se pudieron leer {tiposFallidos.length} de {TIPOS_HISTORIAL_I131.length} tipos de registro -- {etiquetasFallidas.join(", ")}.
                  </div>
                )}
                {huboCache && (
                  <div>Parte de estos datos viene del caché de este dispositivo (sin conexión al servidor) -- puede no reflejar cargas recientes de otros técnicos.</div>
                )}
              </div>
            )}

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
                <div className="text-center py-12 text-gray-400 text-sm">
                  {tiposFallidos.length > 0
                    ? "No se pudo determinar el historial completo -- ver aviso arriba."
                    : "Sin registros de I-131 para este DNI."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
