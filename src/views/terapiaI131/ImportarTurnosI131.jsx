import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { parsearArchivoTurnosI131, clavesDuplicadasEnArchivo, claveDuplicado } from "../../helpers/importarTurnosI131.js";
import { unidadDe, TIPOS_TURNO } from "../../helpers/turnosI131.js";
import { addTurnosBatch, existeTurno } from "../../services/firestore/turnos.js";

const ESTADO_FILA = {
  ok: { label: "OK", color: "green" },
  advertencia: { label: "Advertencia", color: "orange" },
  error: { label: "Error", color: "red" },
};

// Importación de turnos desde Excel (Parte C, uso regular) -- SIEMPRE pasa
// por esta vista previa antes de tocar Firestore: nunca se crea nada fila
// por fila directo desde el archivo. Ver helpers/importarTurnosI131.js para
// el parseo/validación (por qué es texto tab-delimited y no un .xlsx real).
export function ImportarTurnosI131({ open, onClose, sedeId, sedeNombre, usuario, onToast }) {
  const [filas, setFilas] = useState(null); // null = todavía no se subió nada
  const [incluidas, setIncluidas] = useState({}); // { numeroFila: bool }
  const [errorArchivo, setErrorArchivo] = useState(null);
  const [fase, setFase] = useState(null); // null | "leyendo" | "verificando"
  const [importando, setImportando] = useState(false);
  const procesando = !!fase;

  function reset() {
    setFilas(null);
    setIncluidas({});
    setErrorArchivo(null);
  }

  function cerrar() {
    reset();
    onClose();
  }

  // Posible duplicado (dos fuentes, mismo aviso): otra fila de este mismo
  // archivo con igual DNI+fecha (gratis, en memoria), o un turno que ya
  // existía guardado de antes con ese DNI+fecha en la sede activa (una
  // consulta chica por par único, en paralelo -- ver existeTurno). Nunca
  // bloquea la fila ni cambia el default del checkbox: es sólo un aviso para
  // que el humano decida, mismo espíritu que "advertencia" pero una señal
  // distinta (una fila "OK" en todo lo demás puede igual ser un duplicado).
  async function marcarPosiblesDuplicados(parseadas) {
    const clavesEnArchivo = clavesDuplicadasEnArchivo(parseadas);
    const candidatas = parseadas.filter((f) => f.estado !== "error");
    const paresUnicos = [...new Map(candidatas.map((f) => [claveDuplicado(f.datos), f.datos])).values()];
    const encontrados = await Promise.all(
      paresUnicos.map((d) => existeTurno({ sedeId, fechaTurno: d.fechaTurno, pacienteDni: d.pacienteDni }))
    );
    const clavesEnFirestore = new Set(paresUnicos.filter((_, i) => encontrados[i]).map(claveDuplicado));

    return parseadas.map((f) => {
      if (f.estado === "error") return f;
      const clave = claveDuplicado(f.datos);
      return { ...f, duplicadoArchivo: clavesEnArchivo.has(clave), duplicadoExistente: clavesEnFirestore.has(clave) };
    });
  }

  async function elegirArchivo(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo si hay que corregir y resubir
    if (!file) return;
    setErrorArchivo(null);
    setFase("leyendo");
    try {
      const parseadas = await parsearArchivoTurnosI131(file);
      setFase("verificando");
      const conDuplicados = await marcarPosiblesDuplicados(parseadas);
      setFilas(conDuplicados);
      setIncluidas(Object.fromEntries(conDuplicados.map((f) => [f.numeroFila, f.incluir])));
    } catch (err) {
      setErrorArchivo(err.message || "No se pudo leer el archivo.");
    } finally {
      setFase(null);
    }
  }

  const seleccionadas = (filas || []).filter((f) => f.estado !== "error" && incluidas[f.numeroFila]);

  async function confirmarImportacion() {
    if (!seleccionadas.length) return;
    setImportando(true);
    try {
      const turnos = seleccionadas.map((f) => {
        const unidad = unidadDe(f.datos.tipoDosis);
        return {
          sedeId, sedeNombre,
          fechaTurno: f.datos.fechaTurno, pacienteNombre: f.datos.pacienteNombre, pacienteDni: f.datos.pacienteDni,
          telefono: f.datos.telefono, tipoDosis: f.datos.tipoDosis,
          ...(unidad ? { actividadPrevista: f.datos.actividadPrevista, unidadActividad: unidad } : {}),
          obraSocial: f.datos.obraSocial, fechaBarrido: f.datos.fechaBarrido || null,
          estado: "confirmado", notas: f.datos.notas,
          usuarioNombre: usuario.nombre, usuarioEmail: usuario.email,
        };
      });
      await addTurnosBatch(turnos);
      onToast(`${turnos.length} turno${turnos.length !== 1 ? "s" : ""} importado${turnos.length !== 1 ? "s" : ""}`);
      cerrar();
    } catch (err) {
      onToast(err.message || "No se pudo importar -- no se creó ningún turno.", "error");
    } finally {
      setImportando(false);
    }
  }

  const conteo = (filas || []).reduce((acc, f) => { acc[f.estado] = (acc[f.estado] || 0) + 1; return acc; }, {});
  const conteoDuplicados = (filas || []).filter((f) => f.duplicadoArchivo || f.duplicadoExistente).length;

  return (
    <Modal open={open} title="Importar turnos desde Excel" onClose={cerrar} size="xl">
      <div className="flex flex-col gap-4">
        {!filas && (
          <>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 flex flex-col gap-1">
              <p>1. Descargá la plantilla (.xlsx) y completá un turno por fila en la hoja "Plantilla" (mirá la hoja "Instrucciones" para el detalle de cada columna).</p>
              <p>2. Antes de subirla: en Excel de escritorio, "Guardar como" → <strong>Texto Unicode (*.txt)</strong>; desde el celular, exportá como <strong>TSV (*.tsv)</strong> -- no subas el .xlsx directamente, el importador lo rechaza a propósito.</p>
              <p>3. Subí ese archivo de texto acá: vas a ver una vista previa antes de que se cree ningún turno.</p>
            </div>
            <div className="text-xs text-gray-500">
              Tipos de dosis válidos: {TIPOS_TURNO.map((t) => t.label).join(", ")}.
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <a href="/plantilla-turnos-i131.xlsx" download className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition min-h-11 md:min-h-0">
                ↓ Descargar plantilla (.xlsx)
              </a>
              <label className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer transition min-h-11 md:min-h-0">
                {fase === "leyendo" ? "Leyendo..." : fase === "verificando" ? "Verificando duplicados..." : "Subir archivo completado (.txt o .tsv)"}
                <input type="file" accept=".txt,.tsv" className="hidden" onChange={elegirArchivo} disabled={procesando} />
              </label>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-700">
              La plantilla es un .xlsx pensado para completarse cómodo en Excel, pero el importador de RadioFarm <strong>no lee archivos .xlsx</strong> directamente. Guardala como "Texto Unicode (*.txt)" en la compu, o exportala como TSV (*.tsv) desde el celular, antes de subirla -- si subís el .xlsx tal cual, la vas a ver rechazada con un error.
            </div>
            {errorArchivo && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{errorArchivo}</div>
            )}
          </>
        )}

        {filas && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="green">{conteo.ok || 0} OK</Badge>
                {conteo.advertencia > 0 && <Badge color="orange">{conteo.advertencia} advertencia{conteo.advertencia !== 1 ? "s" : ""}</Badge>}
                {conteo.error > 0 && <Badge color="red">{conteo.error} error{conteo.error !== 1 ? "es" : ""}</Badge>}
                {conteoDuplicados > 0 && <Badge color="purple">⚠️ {conteoDuplicados} posible{conteoDuplicados !== 1 ? "s" : ""} duplicado{conteoDuplicados !== 1 ? "s" : ""}</Badge>}
              </div>
              <Btn size="sm" variant="outline" onClick={reset}>Elegir otro archivo</Btn>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="max-h-[45vh] overflow-y-auto divide-y divide-gray-50">
                {filas.map((f) => {
                  const estado = ESTADO_FILA[f.estado];
                  return (
                    <div key={f.numeroFila} className={`p-3 flex items-start gap-3 text-xs ${f.estado === "error" ? "bg-red-50/40" : ""}`}>
                      <input
                        type="checkbox"
                        className="w-4 h-4 mt-0.5 accent-blue-600 shrink-0"
                        checked={!!incluidas[f.numeroFila]}
                        disabled={f.estado === "error"}
                        onChange={(e) => setIncluidas((prev) => ({ ...prev, [f.numeroFila]: e.target.checked }))}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-gray-400 font-mono">Fila {f.numeroFila}</span>
                          <Badge color={estado.color}>{estado.label}</Badge>
                          <span className="font-semibold text-gray-700">{f.resumen}</span>
                        </div>
                        {f.errores.map((m, i) => <div key={i} className="text-red-600">{m}</div>)}
                        {f.advertencias.map((m, i) => <div key={i} className="text-orange-600">{m}</div>)}
                        {f.duplicadoExistente && <div className="text-purple-600">⚠️ Posible duplicado -- ya existe un turno con este DNI y esta fecha</div>}
                        {f.duplicadoArchivo && <div className="text-purple-600">⚠️ Posible duplicado -- otra fila de este mismo archivo tiene el mismo DNI y fecha</div>}
                      </div>
                    </div>
                  );
                })}
                {filas.length === 0 && (
                  <div className="text-center py-10 text-gray-400 text-sm">El archivo no tiene filas de datos.</div>
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={cerrar} disabled={importando}>Cancelar</Btn>
              <Btn onClick={confirmarImportacion} disabled={importando || seleccionadas.length === 0}>
                {importando ? "Importando..." : `Confirmar importación (${seleccionadas.length})`}
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
