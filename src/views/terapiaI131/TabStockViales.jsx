import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { ModalAnularActa } from "../../components/actas/ModalAnularActa.jsx";
import { fmtF, fmtTs, diasV } from "../../helpers/formato.js";
import { listenActas, listenActasSinLimite, addActaI131Vial, anularActaTransaction, listenAnulacionesActas } from "../../services/firestore/actas.js";
import {
  aFecha, diasTranscurridos, actividadTeorica,
  decaidoPorTeorica, estadoDecaimientoVial, fechaMenosMargenDias,
} from "../../helpers/decaimientoI131.js";
import { useActasDesdeFecha } from "../../hooks/useActasDesdeFecha.js";
import { useAhoraAlVolverVisible } from "../../hooks/useAhoraAlVolverVisible.js";
import { AvisoGuiaNoOficial } from "./DesgloseCalculo.jsx";
import { VialDetalle } from "./VialDetalle.jsx";
import { CATEGORIA_VIAL_LABEL, categoriaVial } from "../../constants/tipoI131.js";
import { mCiATextoMicroCi, volumenTotalDilucion } from "../../helpers/unidadesI131.js";

// volumenAlicuota/volumenDiluyente (25/11, Pablo): reemplazan al viejo campo
// único "Volumen inicial" en el FORMULARIO -- volumenInicial sigue
// existiendo igual que siempre en el payload (ver guardarVial), calculado
// como la suma de estos dos. Preparación real: se toma una alícuota del
// vial original (p. ej. 0,61 mL con 10 mCi) y se diluye en agua (p. ej. 100
// mL) -- toda la actividad pasa a la dilución, nada se pierde.
const VACIO_VIAL = { lote: "", categoria: "terapeutico", fechaCalibracion: "", actividadCalibrada: "", volumenAlicuota: "", volumenDiluyente: "", fechaVencimiento: "", obs: "" };

// Una fila por vial, compartida entre vigentes y el grupo plegado "Ver
// anteriores" (9/11) -- sólo cambia el prop `decaido` (badge "Decaído" +
// Vol. restante "—" si no se leyó dato real, ver TabStockViales#decaidos).
function FilaVialDesktop({ v, anulacion, catalogo, onClick, decaido = false }) {
  const diasVenc = v.fechaVencimiento ? diasV(v.fechaVencimiento) : null;
  return (
    <tr className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 cursor-pointer ${anulacion ? "opacity-50" : ""}`} onClick={onClick}>
      <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs font-mono">
        {v.lote}
        {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
      </td>
      <td className="px-3 py-2.5 flex items-center gap-1">
        <Badge color={CATEGORIA_VIAL_LABEL[categoriaVial(v)].color}>{CATEGORIA_VIAL_LABEL[categoriaVial(v)].label}</Badge>
        {decaido && <Badge color="gray">Decaído</Badge>}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600">{catalogo.sedes[v.sedeId]?.short || "—"}</td>
      <td className="px-3 py-2.5 text-xs text-gray-500">{fmtTs(v.fechaCalibracion)}</td>
      <td className="px-3 py-2.5 text-xs text-gray-700">{v.actividadCalibrada} mCi</td>
      <td className="px-3 py-2.5 text-xs text-gray-700">{v.volumenInicial} mL</td>
      <td className="px-3 py-2.5 text-xs text-gray-700">{v._remanente.volumenRestante == null ? "—" : `${v._remanente.volumenRestante.toFixed(1)} mL`}</td>
      <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{v._remanente.actividadRestante.toFixed(1)}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
      <td className="px-3 py-2.5 text-xs">
        {/* Sólo informativa (decisión de Pablo, 9/11) -- nunca determina
            "Decaído", nunca oculta ni deshabilita nada. */}
        {diasVenc == null ? <span className="text-gray-300">—</span>
          : diasVenc < 0 ? <Badge color="red">Vencido</Badge>
          : diasVenc <= 5 ? <Badge color="orange">Vence {diasVenc}d</Badge>
          : <span className="text-gray-500">{fmtF(v.fechaVencimiento)}</span>}
      </td>
      <td className="px-3 py-2.5 text-right text-xs text-blue-600 font-semibold">Ver →</td>
    </tr>
  );
}

function FilaVialMobile({ v, anulacion, catalogo, onClick, decaido = false }) {
  return (
    <button onClick={onClick} className={`w-full text-left p-4 flex flex-col gap-1.5 ${anulacion ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-gray-800 text-sm font-mono">{v.lote}</span>
        <span className="text-xs text-blue-600 font-semibold">Ver →</span>
      </div>
      <div className="flex items-center gap-1">
        <Badge color={CATEGORIA_VIAL_LABEL[categoriaVial(v)].color}>{CATEGORIA_VIAL_LABEL[categoriaVial(v)].label}</Badge>
        {decaido && <Badge color="gray">Decaído</Badge>}
      </div>
      <div className="text-xs text-gray-500">{catalogo.sedes[v.sedeId]?.short || "—"} · Calibrado {fmtTs(v.fechaCalibracion)}</div>
      <div className="text-xs text-gray-700">
        Restante: <span className="font-bold text-blue-700">{v._remanente.actividadRestante.toFixed(1)} mCi</span>
        {v._remanente.volumenRestante != null && <> en {v._remanente.volumenRestante.toFixed(1)} mL</>}
      </div>
      {anulacion && <div className="text-xs text-orange-500 font-semibold">ANULADO: {anulacion.motivo}</div>}
    </button>
  );
}

// Stock de viales I-131 -- Parte A del "espacio de cálculo": digitaliza la
// planilla "Yodo-131 Recibido" en papel. Toda la pestaña (lectura y
// escritura) queda gateada por accesoTerapiaI131 desde el wrapper
// (VistaTerapiaI131.jsx) y respaldado server-side (ver esTipoStockI131 en
// firestore.rules) -- es inventario de material controlado, no un registro
// de atención puntual como el resto de Gestión I-131.
export function TabStockViales({ catalogo, usuario, esAdmin, onToast }) {
  const [viales, setViales] = useState([]);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  // Sólo para el índice inverso extraccionId -> acta de dosis (ver
  // extraccionesVinculadas más abajo) -- este vínculo se guarda en Libro 2
  // (TabPacientes.jsx), acá sólo se lee para mostrarlo del lado de Parte A.
  const [ablativaI131, setAblativaI131] = useState([]);
  const [dosisI131, setDosisI131] = useState([]);
  const [dosisBarridoI131, setDosisBarridoI131] = useState([]);
  const [mAnular, setMAnular] = useState(null);
  // Ver comentario largo equivalente en TabPacientes.jsx.
  const sedeEfectiva = esAdmin ? usuario.sedeAuditando : usuario.sede;
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [vialSeleccionadoId, setVialSeleccionadoId] = useState(null);
  const [mostrarFormVial, setMostrarFormVial] = useState(false);
  const [formVial, setFormVial] = useState(VACIO_VIAL);
  const [guardandoVial, setGuardandoVial] = useState(false);
  // "Ver anteriores" (decaídos) -- plegado por defecto, SIN persistir la
  // preferencia (decisión de Pablo, 9/11): vuelve a plegarse en cada visita.
  const [mostrarAnteriores, setMostrarAnteriores] = useState(false);
  const ahora = useAhoraAlVolverVisible();

  // Ajuste A (9/11): listenActasSinLimite, NO listenActas -- los viales de
  // I-131 entran pocos por semana (confirmado con Pablo), así que el límite
  // de 150 acá era puro bug, no una optimización real: un vial viejo (fuera
  // de las 150 actas i131_vial más recientes de la sede) desaparecía del
  // listado principal Y de "Combinar viales" sin aviso. Con "Ver anteriores"
  // (más abajo) prometiendo acceso a TODO el historial, hacía falta
  // corregir esto primero -- un listado "completo" que en realidad sigue
  // limitado a 150 sería mentira.
  useEffect(() => { if (sedeEfectiva) return listenActasSinLimite("i131_vial", setViales, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_ablativa", setAblativaI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_dosis", setDosisI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenActas("i131_dosis_barrido", setDosisBarridoI131, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);
  useEffect(() => { if (sedeEfectiva) return listenAnulacionesActas(setAnulacionesRaw, { sedeId: sedeEfectiva }); }, [sedeEfectiva]);

  const anulaciones = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);
  // Índice inverso extraccionId -> acta de dosis (Libro 2) -- el vínculo en
  // sí vive del otro lado (dosisActa.extraccionId), acá sólo se arma el
  // mapa para mostrarlo en "Extracciones de este vial". Una acta anulada no
  // cuenta como vínculo vigente (ver mismo criterio en TabPacientes.jsx#
  // extraccionesYaVinculadasIds).
  const extraccionesVinculadas = useMemo(() => {
    const todas = [...ablativaI131, ...dosisI131, ...dosisBarridoI131];
    return new Map(todas.filter((a) => a.extraccionId && !anulaciones.has(a.id)).map((a) => [a.extraccionId, a]));
  }, [ablativaI131, dosisI131, dosisBarridoI131, anulaciones]);

  const vialesPropios = useMemo(() => viales.filter((v) => !sedeEfectiva || v.sedeId === sedeEfectiva), [viales, sedeEfectiva]);

  // Paso 1, GRATIS (sin leer ninguna extracción) -- ver decaidoPorTeorica,
  // decaimientoI131.js, para la demostración de por qué esto nunca da un
  // falso "vigente". La mayoría de los viales viejos se resuelven acá,
  // cero lecturas.
  const candidatosVigentesPorTeorica = useMemo(
    () => vialesPropios.filter((v) => !decaidoPorTeorica(v, ahora)),
    [vialesPropios, ahora]
  );

  // Ventana de tiempo (ajuste C: 1 día de margen) desde la calibración MÁS
  // VIEJA entre los candidatos vigentes -- ninguna extracción de ESOS
  // viales puede tener fecha anterior a la propia calibración del vial
  // (ver demostración completa en el reporte de la Fase 1). null si no hay
  // ningún candidato -- ahí no hace falta ninguna lectura de extracciones.
  const fechaMinimaVigentes = useMemo(() => {
    if (candidatosVigentesPorTeorica.length === 0) return null;
    const minima = candidatosVigentesPorTeorica.reduce((min, v) => {
      const f = aFecha(v.fechaCalibracion);
      return !min || f < min ? f : min;
    }, null);
    return fechaMenosMargenDias(minima);
  }, [candidatosVigentesPorTeorica]);

  // Ajuste E: listener en vivo (onSnapshot vía useActasDesdeFecha), NUNCA
  // getDocs -- esta lista alimenta "Combinar viales" y el remanente en
  // pantalla; si otra sesión extrae mientras esta pantalla está abierta,
  // tiene que reflejarse sola. Acotada por TIEMPO, sin límite de cantidad --
  // inmune al bug de la ventana de 150 (ver reporte de la Fase 1).
  const extraccionesVigentes = useActasDesdeFecha("i131_extraccion", { sedeId: sedeEfectiva, desde: fechaMinimaVigentes });

  // Paso 2: de los candidatos "vigentes por teórica", cuáles son REALMENTE
  // vigentes una vez descontadas las extracciones de verdad -- acá sí puede
  // aparecer un decaído de más (teórica alta pero mucho volumen ya
  // extraído). vigentes/decaidos quedan con viales "enriquecidos"
  // (_remanente) para no recalcular de nuevo en el render.
  const { vigentes, decaidos } = useMemo(() => {
    const vig = [], dec = [];
    vialesPropios.forEach((v) => {
      if (decaidoPorTeorica(v, ahora)) {
        // Decaído gratis -- no hay lectura real de SU remanente (puede
        // estar fuera de la ventana de extraccionesVigentes a propósito,
        // ver fechaMinimaVigentes). Se muestra la cota teórica (siempre
        // < umbral en esta rama) en vez de pedir una lectura sólo para una
        // fila plegada -- volumen real queda sin dato (null), nunca inventado.
        const dias = diasTranscurridos(v.fechaCalibracion, ahora);
        dec.push({ ...v, _remanente: { volumenRestante: null, actividadRestante: actividadTeorica(v.actividadCalibrada, dias), estaDecaido: true } });
        return;
      }
      const remanente = estadoDecaimientoVial(v, extraccionesVigentes, ahora);
      (remanente.estaDecaido ? dec : vig).push({ ...v, _remanente: remanente });
    });
    return { vigentes: vig, decaidos: dec };
  }, [vialesPropios, extraccionesVigentes, ahora]);

  function porCategoriaYOrden(lista, categoria) {
    return lista.filter((v) => !categoria || categoriaVial(v) === categoria)
      .sort((a, b) => diasTranscurridos(a.fechaCalibracion) - diasTranscurridos(b.fechaCalibracion));
  }
  const vigentesFiltrados = useMemo(() => porCategoriaYOrden(vigentes, filtroCategoria), [vigentes, filtroCategoria]);
  const decaidosFiltrados = useMemo(() => porCategoriaYOrden(decaidos, filtroCategoria), [decaidos, filtroCategoria]);

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

  // Validación de la dilución (25/11, Pablo): alícuota obligatoria y > 0;
  // diluyente obligatorio, 0 ES válido -- por eso el chequeo de "falta"
  // compara contra "" (string vacío), nunca contra el valor parseado (0 es
  // falsy en JS, pero acá es un dato real, no una ausencia).
  const volumenAlicuotaOk = parseFloat(formVial.volumenAlicuota) > 0;
  const volumenDiluyenteOk = formVial.volumenDiluyente !== "" && parseFloat(formVial.volumenDiluyente) >= 0;
  const volumenTotalVial = volumenAlicuotaOk && volumenDiluyenteOk
    ? volumenTotalDilucion(parseFloat(formVial.volumenAlicuota), parseFloat(formVial.volumenDiluyente))
    : null;

  async function guardarVial() {
    if (!formVial.lote.trim() || !formVial.fechaCalibracion || !formVial.actividadCalibrada || !volumenAlicuotaOk || !volumenDiluyenteOk) return;
    setGuardandoVial(true);
    try {
      await addActaI131Vial({
        sedeId: usuario.sede, sedeNombre: catalogo.sedes[usuario.sede]?.nombre,
        lote: formVial.lote.trim(), categoria: formVial.categoria,
        fechaCalibracion: new Date(formVial.fechaCalibracion),
        actividadCalibrada: parseFloat(formVial.actividadCalibrada) || 0,
        // volumenInicial sigue siendo el TOTAL, como siempre (no se toca
        // decaimientoI131.js ni se reinterpreta nada para los 13 viales ya
        // cargados) -- volumenAlicuota/volumenDiluyente se agregan aparte,
        // sólo para poder reconstruir el detalle de la dilución en pantalla
        // (ver VialDetalle.jsx). La regla de i131_vial (firestore.rules)
        // exige los campos de siempre nada más -- no usa hasOnly(), así que
        // acepta estos 2 campos extra sin tocar nada ahí.
        volumenInicial: volumenTotalVial,
        volumenAlicuota: parseFloat(formVial.volumenAlicuota),
        volumenDiluyente: parseFloat(formVial.volumenDiluyente),
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

  // Del listado enriquecido (vigentes/decaidos), no de `viales` crudo -- así
  // el detalle ya sabe si el vial elegido está decaído (vialSeleccionado.
  // _remanente.estaDecaido) sin tener que recalcularlo de nuevo.
  const vialSeleccionado = vialSeleccionadoId ? [...vigentes, ...decaidos].find((v) => v.id === vialSeleccionadoId) : null;

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
          estaDecaido={vialSeleccionado._remanente.estaDecaido}
          anulacionVial={anulaciones.get(vialSeleccionado.id)}
          // Combinar viales (más abajo, VialDetalle.jsx) ya NO ofrece
          // decaídos -- se filtra ACÁ, pasando sólo vigentes, en vez de en
          // VialDetalle (que tendría que recalcular el estado de cada uno
          // de nuevo). Ver ajuste del plan "Combinar viales sin decaídos".
          todosLosViales={vigentes.filter((v) => v.sedeId === vialSeleccionado.sedeId && !anulaciones.get(v.id))}
          extracciones={extraccionesVigentes}
          extraccionesVinculadas={extraccionesVinculadas}
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
            resumen={mAnular.tipo === "i131_vial" ? `Vial ${mAnular.lote}` : `Extracción — ${mAnular.actividadCalculada != null ? mCiATextoMicroCi(mAnular.actividadCalculada) : "—"} calc.`}
            onConfirm={confirmarAnulacion}
            onClose={() => setMAnular(null)}
          />
        )}
      </div>
    );
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
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="w-full md:w-auto">
            <Sel value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
              <option value="">Todas las categorías</option>
              <option value="terapeutico">Sólo terapéutico</option>
              <option value="diagnostico">Sólo diagnóstico</option>
            </Sel>
          </div>
          {esAdmin && (
            <div className="w-full md:w-auto text-xs text-gray-400">
              Auditando <span className="font-semibold text-gray-600">{catalogo.sedes[sedeEfectiva]?.short || "—"}</span> · cambiar en Configuración
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
            {/* Dilución (25/11, Pablo): se toma una alícuota del vial
                original y se diluye en agua -- toda la actividad pasa a la
                dilución. volumenInicial (lo que usa el cálculo de
                decaimiento) sigue siendo la SUMA de estos dos, nunca se
                precarga ningún default. */}
            <Input label="Volumen extraído del vial original (mL)" type="number" min={0} step={0.01} value={formVial.volumenAlicuota} onChange={(e) => setFormVial((f) => ({ ...f, volumenAlicuota: e.target.value }))} placeholder="0.61" />
            <Input label="Volumen de agua a diluir (mL)" type="number" min={0} step={0.1} value={formVial.volumenDiluyente} onChange={(e) => setFormVial((f) => ({ ...f, volumenDiluyente: e.target.value }))} placeholder="100" />
            {volumenTotalVial != null && (
              <div className="sm:col-span-2 text-xs text-gray-500">Volumen total: <span className="font-semibold text-gray-700">{volumenTotalVial} mL</span></div>
            )}
            <Input label="Fecha de vencimiento (opcional)" type="date" value={formVial.fechaVencimiento} onChange={(e) => setFormVial((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
            <Input label="Observación (opcional)" value={formVial.obs} onChange={(e) => setFormVial((f) => ({ ...f, obs: e.target.value }))} placeholder="Ej: remito N°..." />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Btn variant="outline" onClick={() => setMostrarFormVial(false)} disabled={guardandoVial}>Cancelar</Btn>
            <Btn onClick={guardarVial} disabled={guardandoVial || !formVial.lote.trim() || !formVial.fechaCalibracion || !formVial.actividadCalibrada || !volumenAlicuotaOk || !volumenDiluyenteOk}>
              {guardandoVial ? "Guardando..." : "Guardar vial"}
            </Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Viales</span>
          <Badge color="blue">{vigentesFiltrados.length}</Badge>
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
              {vigentesFiltrados.map((v) => (
                <FilaVialDesktop key={v.id} v={v} anulacion={anulaciones.get(v.id)} catalogo={catalogo} onClick={() => setVialSeleccionadoId(v.id)} />
              ))}
              {mostrarAnteriores && decaidosFiltrados.map((v) => (
                <FilaVialDesktop key={v.id} v={v} anulacion={anulaciones.get(v.id)} catalogo={catalogo} onClick={() => setVialSeleccionadoId(v.id)} decaido />
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile: tarjeta por vial. */}
        <div className="md:hidden divide-y divide-gray-50">
          {vigentesFiltrados.map((v) => (
            <FilaVialMobile key={v.id} v={v} anulacion={anulaciones.get(v.id)} catalogo={catalogo} onClick={() => setVialSeleccionadoId(v.id)} />
          ))}
          {mostrarAnteriores && decaidosFiltrados.map((v) => (
            <FilaVialMobile key={v.id} v={v} anulacion={anulaciones.get(v.id)} catalogo={catalogo} onClick={() => setVialSeleccionadoId(v.id)} decaido />
          ))}
        </div>
        {vigentesFiltrados.length === 0 && decaidosFiltrados.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Sin viales registrados todavía.</div>
        )}
        {/* "Ver anteriores" (9/11) -- plegado por defecto, SIN persistir la
            preferencia. El listado nunca OCULTA un vial decaído del todo --
            siempre queda accesible (ver y anular) con un clic, sólo no
            compite visualmente con los vigentes. */}
        {decaidosFiltrados.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <button onClick={() => setMostrarAnteriores((m) => !m)} className="text-xs text-blue-600 hover:text-blue-800 font-semibold min-h-11 md:min-h-0">
              {mostrarAnteriores ? "Ocultar anteriores" : `Ver anteriores (${decaidosFiltrados.length})`}
            </button>
          </div>
        )}
      </div>

      {mAnular && (
        <ModalAnularActa
          acta={mAnular}
          resumen={mAnular.tipo === "i131_vial" ? `Vial ${mAnular.lote}` : `Extracción — ${mAnular.actividadCalculada != null ? mCiATextoMicroCi(mAnular.actividadCalculada) : "—"} calc.`}
          onConfirm={confirmarAnulacion}
          onClose={() => setMAnular(null)}
        />
      )}
    </div>
  );
}
