import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { fmtF, fmtTs } from "../../helpers/formato.js";
import { addActaI131Extraccion } from "../../services/firestore/actas.js";
import { diasTranscurridos, actividadRestante, volumenExtraidoDe, calcularDesglosePorVial } from "../../helpers/decaimientoI131.js";
import { DesgloseCalculo, AvisoGuiaNoOficial } from "./DesgloseCalculo.jsx";
import { CurvaDecaimiento } from "./CurvaDecaimiento.jsx";
import { CATEGORIA_VIAL_LABEL, categoriaVial } from "../../constants/tipoI131.js";

const LINEA_VACIA = () => ({ vialId: "", ml: "" });

// Detalle de un vial: desglose transparente del cálculo, curva de
// decaimiento sin tope fijo, y el formulario de extracción -- que soporta
// combinar mL de varios viales en una sola extracción (caso real relevado:
// "completan 150 mCi con lote 241"). El aviso de "guía, no reemplaza al
// activímetro" va siempre visible acá, no en un modal que se cierra y se
// olvida.
export function VialDetalle({ vial, anulacionVial, todosLosViales, extracciones, anulaciones, catalogo, usuario, esAdmin, onToast, onVolver, onAnular }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [lineas, setLineas] = useState([{ vialId: vial.id, ml: "" }]);
  const [actividadMedida, setActividadMedida] = useState("");
  const [pacienteFicha, setPacienteFicha] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  const extraccionesDelVial = useMemo(
    () => extracciones.filter((e) => (e.viales || []).some((p) => p.vialId === vial.id)),
    [extracciones, vial.id]
  );

  // Guardrail sólo client-side (confirmado, sin validación server-side): al
  // combinar viales en una misma extracción, sólo se ofrecen otros de la
  // MISMA categoría que el actual -- mezclar mL de un vial terapéutico con
  // uno diagnóstico en una sola extracción no tiene sentido clínico.
  const vialesParaCombinar = useMemo(
    () => todosLosViales.filter((v) => categoriaVial(v) === categoriaVial(vial)),
    [todosLosViales, vial]
  );

  const volumenExtraido = volumenExtraidoDe(vial.id, extracciones);
  const volumenRestante = Math.max(0, vial.volumenInicial - volumenExtraido);
  const dias = diasTranscurridos(vial.fechaCalibracion);
  const actRestante = actividadRestante(vial, volumenRestante);

  function limpiarForm() {
    setLineas([{ vialId: vial.id, ml: "" }]);
    setActividadMedida(""); setPacienteFicha(""); setObs("");
  }

  function agregarLinea() {
    setLineas((ls) => [...ls, LINEA_VACIA()]);
  }
  function quitarLinea(i) {
    setLineas((ls) => ls.filter((_, idx) => idx !== i));
  }
  function cambiarLinea(i, campo, valor) {
    setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  }

  // Vista previa en vivo, un desglose por línea -- transparencia obligatoria
  // (nunca mostrar sólo el resultado). volumenDisponible de cada vial ya
  // descuenta lo extraído hasta ahora, para poder avisar si se está pidiendo
  // de más -- aviso nada más, sin bloqueo duro (ver nota en TabStockViales
  // sobre por qué no hay transacción acá).
  const previaLineas = lineas.map((l) => {
    const v = todosLosViales.find((x) => x.id === l.vialId);
    const ml = parseFloat(l.ml);
    if (!v || !ml || ml <= 0) return { ...l, valido: false };
    const volDisponible = Math.max(0, v.volumenInicial - volumenExtraidoDe(v.id, extracciones));
    const desglose = calcularDesglosePorVial(v, ml);
    return { ...l, valido: true, vial: v, desglose, excedeVolumen: ml > volDisponible, volDisponible };
  });
  const actividadCalculadaTotal = previaLineas.filter((l) => l.valido).reduce((s, l) => s + l.desglose.mCiCalculado, 0);
  const hayLineaValida = previaLineas.some((l) => l.valido);
  const hayLineaIncompleta = lineas.some((l) => !l.vialId || !l.ml);

  async function guardarExtraccion() {
    const validas = previaLineas.filter((l) => l.valido);
    if (!validas.length || !actividadMedida) return;
    setGuardando(true);
    try {
      await addActaI131Extraccion({
        sedeId: vial.sedeId, sedeNombre: vial.sedeNombre,
        viales: validas.map((l) => ({ vialId: l.vialId, mlExtraidos: parseFloat(l.ml) })),
        vialIds: validas.map((l) => l.vialId),
        desglosePorVial: validas.map((l) => l.desglose),
        actividadCalculada: actividadCalculadaTotal,
        actividadMedida: parseFloat(actividadMedida) || 0,
        ...(pacienteFicha.trim() ? { pacienteFicha: pacienteFicha.trim() } : {}),
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, observacion: obs.trim(),
      });
      onToast("Extracción registrada");
      limpiarForm();
      setMostrarForm(false);
    } catch (e) {
      onToast(e.message || "No se pudo registrar la extracción", "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onVolver} className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 min-h-11 md:min-h-0">
          ← Volver a viales
        </button>
      </div>

      <AvisoGuiaNoOficial />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-gray-800 text-lg">{vial.lote}</span>
              <Badge color={CATEGORIA_VIAL_LABEL[categoriaVial(vial)].color}>{CATEGORIA_VIAL_LABEL[categoriaVial(vial)].label}</Badge>
            </div>
            <div className="text-xs text-gray-400">{catalogo.sedes[vial.sedeId]?.short || "—"}</div>
          </div>
          {esAdmin && !anulacionVial && (
            <button onClick={() => onAnular(vial)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
              Anular vial
            </button>
          )}
        </div>
        {anulacionVial && (
          <div className="text-xs text-orange-500 font-semibold mb-3">ANULADO: {anulacionVial.motivo}</div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><div className="text-gray-400">Calibración</div><div className="font-semibold text-gray-700">{fmtTs(vial.fechaCalibracion)}</div></div>
          <div><div className="text-gray-400">Actividad calibrada</div><div className="font-semibold text-gray-700">{vial.actividadCalibrada} mCi</div></div>
          <div><div className="text-gray-400">Volumen inicial</div><div className="font-semibold text-gray-700">{vial.volumenInicial} mL</div></div>
          <div><div className="text-gray-400">Volumen restante</div><div className="font-semibold text-gray-700">{volumenRestante.toFixed(1)} mL</div></div>
          {vial.fechaVencimiento && (
            <div><div className="text-gray-400">Vencimiento</div><div className="font-semibold text-gray-700">{fmtF(vial.fechaVencimiento)}</div></div>
          )}
        </div>

        <DesgloseCalculo
          titulo="Actividad restante ahora mismo"
          actividadCalibrada={vial.actividadCalibrada}
          volumenInicial={vial.volumenInicial}
          fechaCalibracion={vial.fechaCalibracion}
          dias={dias}
          filasExtra={[{ label: "Volumen restante", valor: `${volumenRestante.toFixed(1)} mL` }]}
          resultado={actRestante}
          unidadResultado="mCi"
        />

        <div className="mt-4">
          <CurvaDecaimiento vial={vial} volumenRestanteMl={volumenRestante} />
        </div>
      </div>

      {anulacionVial ? (
        <div className="text-xs text-orange-700 font-medium bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          Este vial fue anulado ({anulacionVial.motivo}) — no se pueden registrar nuevas extracciones sobre él.
        </div>
      ) : (
        <div className="flex justify-end">
          <Btn onClick={() => setMostrarForm(true)} disabled={mostrarForm || volumenRestante <= 0}>+ Nueva extracción</Btn>
        </div>
      )}

      {mostrarForm && (
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">Nueva extracción</h3>
            <button onClick={() => { setMostrarForm(false); limpiarForm(); }} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <AvisoGuiaNoOficial />

          {lineas.map((l, i) => {
            const previa = previaLineas[i];
            return (
              <div key={i} className="border border-gray-100 rounded-xl p-3 flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                  <Sel label={`Vial ${i + 1}`} value={l.vialId} onChange={(e) => cambiarLinea(i, "vialId", e.target.value)} disabled={i === 0}>
                    <option value="">Seleccionar vial...</option>
                    {vialesParaCombinar.map((v) => <option key={v.id} value={v.id}>{v.lote}</option>)}
                  </Sel>
                  <Input label="mL extraídos" type="number" min={0} step={0.1} value={l.ml} onChange={(e) => cambiarLinea(i, "ml", e.target.value)} placeholder="1.5" />
                  {lineas.length > 1 && (
                    <Btn variant="outline" size="sm" onClick={() => quitarLinea(i)}>Quitar</Btn>
                  )}
                </div>
                {previa?.valido && (
                  <>
                    {previa.excedeVolumen && (
                      <div className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        Pediste {l.ml} mL pero el cálculo indica sólo {previa.volDisponible.toFixed(1)} mL disponibles en este vial. Revisá antes de guardar.
                      </div>
                    )}
                    <DesgloseCalculo
                      titulo={`Cálculo para ${previa.vial.lote}`}
                      actividadCalibrada={previa.vial.actividadCalibrada}
                      volumenInicial={previa.vial.volumenInicial}
                      fechaCalibracion={previa.vial.fechaCalibracion}
                      dias={previa.desglose.diasTranscurridos}
                      filasExtra={[{ label: "mL extraídos (esta línea)", valor: l.ml }]}
                      resultado={previa.desglose.mCiCalculado}
                      unidadResultado="mCi"
                    />
                  </>
                )}
              </div>
            );
          })}

          <div>
            <Btn variant="outline" size="sm" onClick={agregarLinea}>+ Agregar otro vial</Btn>
          </div>

          {hayLineaValida && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700">Total calculado</span>
              <span className="font-bold text-blue-700 text-lg">{actividadCalculadaTotal.toFixed(2)} mCi</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Actividad medida (activímetro)" type="number" min={0} step={0.01} value={actividadMedida} onChange={(e) => setActividadMedida(e.target.value)} placeholder="Confirmá con el activímetro" />
            <Input label="N° de Ficha (opcional)" value={pacienteFicha} onChange={(e) => setPacienteFicha(e.target.value)} placeholder="4521" />
          </div>
          {hayLineaValida && actividadMedida && Math.abs(parseFloat(actividadMedida) - actividadCalculadaTotal) > actividadCalculadaTotal * 0.15 && (
            <div className="text-xs text-amber-700 font-semibold bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              La actividad medida difiere del cálculo en más de un 15% ({actividadMedida} mCi medido vs. {actividadCalculadaTotal.toFixed(2)} mCi calculado). Se guarda igual, sin ocultar la diferencia.
            </div>
          )}
          <Input label="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: paciente, indicación..." />

          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => { setMostrarForm(false); limpiarForm(); }} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardarExtraccion} disabled={guardando || !hayLineaValida || hayLineaIncompleta || !actividadMedida}>
              {guardando ? "Guardando..." : "Guardar extracción"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Extracciones de este vial</span>
          <Badge color="blue">{extraccionesDelVial.length}</Badge>
        </div>
        <div className="divide-y divide-gray-50">
          {extraccionesDelVial.map((e) => {
            const anulacion = anulaciones.get(e.id);
            const desglose = e.desglosePorVial?.find((d) => d.vialId === vial.id);
            const diferenciaGrande = Math.abs(e.actividadMedida - e.actividadCalculada) > e.actividadCalculada * 0.15;
            return (
              <div key={e.id} className={`p-4 flex flex-col gap-2 ${anulacion ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">{fmtTs(e.fecha)} · {e.usuarioNombre}</span>
                  {esAdmin && !anulacion && (
                    <button onClick={() => onAnular(e)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition min-h-11 md:min-h-0">
                      Anular
                    </button>
                  )}
                </div>
                {e.pacienteFicha && <div className="text-xs text-gray-600">Ficha: <span className="font-mono">{e.pacienteFicha}</span></div>}
                {e.viales.length > 1 && (
                  <div className="text-xs text-gray-500">Combinada con {e.viales.length - 1} vial{e.viales.length - 1 !== 1 ? "es" : ""} más: {e.viales.filter((v) => v.vialId !== vial.id).map((v) => todosLosViales.find((tv) => tv.id === v.vialId)?.lote || v.vialId).join(", ")}</div>
                )}
                <div className="flex flex-wrap gap-4 text-xs">
                  <div>Calculado: <span className="font-bold text-blue-700">{e.actividadCalculada.toFixed(2)} mCi</span></div>
                  <div>Medido (activímetro): <span className={`font-bold ${diferenciaGrande ? "text-amber-600" : "text-gray-700"}`}>{e.actividadMedida.toFixed(2)} mCi</span></div>
                  {desglose && <div>De este vial: <span className="font-semibold text-gray-700">{desglose.mlExtraidos} mL → {desglose.mCiCalculado.toFixed(2)} mCi</span></div>}
                </div>
                {diferenciaGrande && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 w-fit">
                    Diferencia &gt;15% entre lo calculado y lo medido.
                  </div>
                )}
                {desglose && (
                  <DesgloseCalculo
                    titulo="Desglose congelado al momento de la extracción"
                    actividadCalibrada={desglose.actividadCalibrada}
                    volumenInicial={desglose.volumenInicial}
                    fechaCalibracion={desglose.fechaCalibracion}
                    dias={desglose.diasTranscurridos}
                    filasExtra={[{ label: "mL extraídos", valor: desglose.mlExtraidos }, { label: "Concentración", valor: `${desglose.concentracionMCiPorMl.toFixed(3)} mCi/mL` }]}
                    resultado={desglose.mCiCalculado}
                    unidadResultado="mCi"
                  />
                )}
                {e.observacion && <div className="text-xs text-gray-400 italic">{e.observacion}</div>}
                {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
              </div>
            );
          })}
          {extraccionesDelVial.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">Sin extracciones registradas de este vial todavía.</div>
          )}
        </div>
      </div>
    </div>
  );
}
