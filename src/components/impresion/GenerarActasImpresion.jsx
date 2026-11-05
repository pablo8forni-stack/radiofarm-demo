import { useState } from "react";
import { Sel } from "../ui/Sel.jsx";
import { Btn } from "../ui/Btn.jsx";
import { actasPorRango, anulacionesPorSede } from "../../services/firestore/actas.js";
import { lotesPorSede, usoActivoDeLote } from "../../services/firestore/mibgLotes.js";
import { lotesDelMes, lotesSinFecha, avisoLotesSinFecha } from "../../helpers/mibgLote.js";
import { primerYUltimoDiaMes, nombreMes } from "../../helpers/rangoMensual.js";
import { compararPorSedeYFicha } from "../../helpers/fichaPaciente.js";
import { calcularFichasSospechosasDelMes, formatearListaFichas } from "../../helpers/huecosFicha.js";
import { nombreArchivoLibro, periodoMes } from "../../helpers/nombreArchivoLibro.js";
import { PortalImpresion } from "./PortalImpresion.jsx";
import { ImprimibleLibro1Marcacion } from "./ImprimibleLibro1Marcacion.jsx";
import { ImprimibleLibro2Pacientes } from "./ImprimibleLibro2Pacientes.jsx";
import { ImprimibleLibro3Elucion } from "./ImprimibleLibro3Elucion.jsx";
import { ImprimibleLibro4Lutecio } from "./ImprimibleLibro4Lutecio.jsx";

const TIPOS_LIBRO2 = ["paciente", "i131_ablativa", "i131_dosis", "i131_barrido", "i131_dosis_barrido", "i131_mibg", "i131_captacion", "i131_centellograma", "i131_captacion_centellograma"];

const hoyISO = () => new Date().toISOString().slice(0, 7);

// Ordena ascendente por fecha (orden de lectura de un libro en papel) --
// actasPorRango ya trae desc (mismo criterio que "Ver todos" en pantalla),
// así que sólo hace falta invertir, no volver a ordenar.
const porFechaAsc = (lista) => [...lista].reverse();

// Exportación mensual imprimible de los 4 libros de Actas ARN -- impresión
// nativa (window.print() + @media print, ver PortalImpresion/index.css),
// no una librería de PDF (mismo criterio de siempre: no sumar dependencia
// si hay una alternativa nativa razonable). Siempre UNA sede a la vez --
// usa sedeAuditando, coherente con el resto de Configuración. Vive acá
// (junto al selector de sede) porque "mes + sede" son los únicos dos
// parámetros que necesita, mismo motivo que sedeAuditando centraliza ahí.
export function GenerarActasImpresion({ catalogo, usuario, onToast }) {
  const [mes, setMes] = useState(hoyISO());
  const [generando, setGenerando] = useState(false);
  const [datos, setDatos] = useState(null); // { libro1, libro2, libro3, libro4 } | null
  // Control previo a la impresión (Pablo, 6/10): fichas sospechosas DEL MES
  // ya cargado para armar el PDF -- ningún fetch nuevo, mismo
  // calcularFichasSospechosasDelMes que ya usa el cálculo puro de
  // helpers/huecosFicha.js, sin ventana de tiempo (acá no importa "hace
  // cuánto" se cargó, es un control de una sola vez antes de imprimir).
  // Cubre justo lo que el cartel en vivo no ve (ej. dígitos de menos, fuera
  // del limit(120) por número del listener). No bloquea -- sólo avisa.
  const [sospechosasMes, setSospechosasMes] = useState([]);
  // Lotes de Lutecio-177 de la sede, SIN fecha de llegada -- no dependen
  // del mes elegido (lotesSinFecha no filtra por fecha, ver mibgLote.js),
  // pero se recalculan junto con el resto en cada "Generar" para no quedar
  // con un aviso viejo de otra sede/corrida.
  const [lutecioSinFecha, setLutecioSinFecha] = useState([]);
  const [imprimiendo, setImprimiendo] = useState(null); // "libro1" | "libro2" | "libro3" | "libro4" | null

  const sedeId = usuario.sedeAuditando;
  const sedeNombre = catalogo.sedes[sedeId]?.nombre || "—";
  const mesTexto = nombreMes(mes);

  async function generar() {
    if (!sedeId) { onToast("Elegí primero una sede para auditar, arriba.", "error"); return; }
    setGenerando(true);
    setDatos(null);
    try {
      const { desde, hasta } = primerYUltimoDiaMes(mes);
      const [marcacion, elucion, porTipoLibro2, anulacionesRaw, lotesRaw] = await Promise.all([
        actasPorRango("marcacion", { desde, hasta, sedeId }),
        actasPorRango("elucion", { desde, hasta, sedeId }),
        Promise.all(TIPOS_LIBRO2.map((t) => actasPorRango(t, { desde, hasta, sedeId }))),
        anulacionesPorSede(sedeId),
        lotesPorSede(sedeId),
      ]);

      const anulaciones = new Map(anulacionesRaw.map((a) => [a.anulaId, a]));
      // Por N° de Ficha ASCENDENTE (el orden real de VM RIS, el que lleva el
      // libro de papel), NO por fecha de guardado -- bug real reportado por
      // Pablo (imprimió septiembre y salió por hora de carga): una carga
      // tardía (ver fechaRealAtencion/detección de atraso en
      // TabPacientes.jsx) tiene fecha de HOY pero una ficha de un día
      // anterior, así que ordenar por fecha la imprimía fuera de lugar. El
      // defecto es anterior a esa función (este archivo nunca ordenó por
      // ficha, ver commit de creación) pero recién se volvió visible cuando
      // empezó a haber cargas tardías reales. compararPorSedeYFicha es
      // ASCENDENTE a propósito -- pedido explícito de Pablo, headers de
      // página en vez del descendente que ya usa la pantalla día a día
      // (compararPorSedeYFichaDescendente, ver fichaPaciente.js).
      const actasLibro2 = porTipoLibro2.flat().sort(compararPorSedeYFicha);
      const lotesPorId = new Map(lotesRaw.map((l) => [l.id, l]));
      setSospechosasMes(calcularFichasSospechosasDelMes(actasLibro2, anulaciones));

      // Libro 4: lotes de Lutecio-177 llegados dentro del mes elegido
      // (filtro CLIENT-SIDE con lotesDelMes -- lotesPorSede no acota por
      // fecha, ver su propio comentario). Los SIN fecha quedan afuera de
      // CUALQUIER mes (lotesSinFecha) -- se muestran aparte como aviso más
      // abajo, nunca mezclados en un libro (ver mibgLote.js). El uso de
      // cada lote del mes se busca SIN acotar por fecha (usoActivoDeLote,
      // por id determinístico del lote) -- no con actasLibro2, que está
      // recortada al mes: así Estado/Paciente administrado reflejan la
      // realidad completa del lote (llegado este mes, usado en cualquier
      // otro) en vez de mostrar "disponible" cuando en realidad ya fue
      // usado fuera de este mes. anulaciones ya viene sin acotar por fecha
      // (anulacionesPorSede), así que un uso anulado en otro mes también
      // queda bien excluido.
      const lotesLutecioRaw = lotesRaw.filter((l) => (l.isotopoId || "mibg") === "lutecio177");
      const lotesLutecio = porFechaAsc(lotesDelMes(lotesLutecioRaw, { desde, hasta }));
      setLutecioSinFecha(lotesSinFecha(lotesLutecioRaw));
      const usosLutecioActivos = await Promise.all(
        lotesLutecio.map((l) => usoActivoDeLote(l.id, { prefijo: "lote_", anulaciones }))
      );
      const usoPorLoteId = new Map(
        lotesLutecio.map((l, i) => [l.id, usosLutecioActivos[i]]).filter(([, uso]) => uso != null)
      );

      setDatos({
        libro1: { actas: porFechaAsc(marcacion), anulaciones },
        libro2: { actas: actasLibro2, anulaciones, lotesPorId },
        libro3: { actas: porFechaAsc(elucion), anulaciones },
        libro4: { lotes: lotesLutecio, anulaciones, usoPorLoteId },
      });
    } catch (e) {
      onToast(e.message || "No se pudieron generar los libros de este mes", "error");
    } finally {
      setGenerando(false);
    }
  }

  // Se monta el libro elegido en el portal, se espera al próximo frame para
  // que React ya haya pintado el DOM (si se llama print() en el mismo tick
  // del setState, el navegador puede imprimir el frame anterior, vacío), y
  // recién ahí se dispara el diálogo de impresión nativo.
  //
  // document.title mientras dura la impresión = nombre sugerido por el
  // diálogo "Guardar como PDF" del navegador (Chrome/Edge lo usan así) --
  // sin la extensión, que el propio navegador agrega sola. Es el único
  // gancho que existe para esto: no hay ninguna librería de PDF de por
  // medio (ver comentario de más arriba) que permita nombrar el archivo
  // directamente. NO pudimos verificar el comportamiento real en todos los
  // navegadores/sistemas -- queda pendiente de que se pruebe a mano.
  // "afterprint" restaura el título siempre (se cerró el diálogo con
  // Guardar o con Cancelar) -- más confiable que un setTimeout a ciegas
  // después de window.print(), que en desktop bloquea hasta cerrar el
  // diálogo pero en algunos navegadores/móviles no.
  function imprimir(libro) {
    setImprimiendo(libro);
    const tituloOriginal = document.title;
    const nombreSugerido = nombreArchivoLibro({
      libro, extension: "pdf", periodo: periodoMes(mes), sedeShort: catalogo.sedes[sedeId]?.short,
    });
    document.title = nombreSugerido.replace(/\.pdf$/, "");
    const restaurarTitulo = () => {
      document.title = tituloOriginal;
      window.removeEventListener("afterprint", restaurarTitulo);
    };
    window.addEventListener("afterprint", restaurarTitulo);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  const LIBROS = datos && [
    { id: "libro1", titulo: "Libro 1 — Marcación", cantidad: datos.libro1.actas.length,
      render: () => <ImprimibleLibro1Marcacion {...datos.libro1} sedeNombre={sedeNombre} mesTexto={mesTexto} nombreResponsable={usuario.nombre} /> },
    { id: "libro2", titulo: "Libro 2 — Pacientes", cantidad: datos.libro2.actas.length,
      render: () => <ImprimibleLibro2Pacientes {...datos.libro2} catalogo={catalogo} sedeNombre={sedeNombre} mesTexto={mesTexto} nombreResponsable={usuario.nombre} /> },
    { id: "libro3", titulo: "Libro 3 — Elución", cantidad: datos.libro3.actas.length,
      render: () => <ImprimibleLibro3Elucion {...datos.libro3} sedeNombre={sedeNombre} mesTexto={mesTexto} nombreResponsable={usuario.nombre} /> },
    { id: "libro4", titulo: "Libro 4 — Lutecio-177", cantidad: datos.libro4.lotes.length,
      render: () => <ImprimibleLibro4Lutecio {...datos.libro4} sedeNombre={sedeNombre} mesTexto={mesTexto} nombreResponsable={usuario.nombre} /> },
  ];
  const libroActivo = LIBROS?.find((l) => l.id === imprimiendo);

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex flex-col gap-3">
      <div>
        <p className="text-xs font-bold text-blue-800">Impresión mensual de Actas ARN</p>
        <p className="text-xs text-blue-700/80 mt-0.5">
          Genera los 4 libros del mes elegido, listos para imprimir/guardar como PDF y archivar en papel -- siempre de la sede que estás auditando.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <input type="month" value={mes} max={hoyISO()} onChange={(e) => { setMes(e.target.value); setDatos(null); setSospechosasMes([]); setLutecioSinFecha([]); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-11 md:min-h-0" />
        <Btn size="sm" onClick={generar} disabled={generando || !sedeId}>{generando ? "Generando..." : "Generar"}</Btn>
      </div>
      {/* No bloquea la generación ni la impresión -- sólo avisa antes de
          imprimir. Mismo umbral/criterio que el cartel en vivo de Libro 2
          (helpers/huecosFicha.js), pero sin ventana de 48hs: acá se evalúa
          el mes entero de una sola vez, no "vence" con el tiempo. */}
      {sospechosasMes.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
          {sospechosasMes.length > 1 ? "Hay fichas que parecen mal tipeadas" : "Hay una ficha que parece mal tipeada"} en este mes: {formatearListaFichas(sospechosasMes)}. Revisá antes de archivar el PDF.
        </div>
      )}
      {/* No depende del mes elegido (lotesSinFecha no filtra por fecha) --
          por eso vive afuera del bloque {datos && ...} de abajo, igual que
          sospechosasMes, visible en cuanto termina "Generar". */}
      {lutecioSinFecha.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
          {avisoLotesSinFecha(lutecioSinFecha)}
        </div>
      )}
      {datos && (
        <div className="flex flex-col gap-1.5 mt-1">
          {LIBROS.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-blue-100">
              <span className="text-xs text-gray-700">{l.titulo} <span className="text-gray-400">· {l.cantidad} registro{l.cantidad !== 1 ? "s" : ""}</span></span>
              {l.cantidad > 0
                ? <Btn size="sm" variant="ghost" onClick={() => imprimir(l.id)}>Imprimir</Btn>
                : <span className="text-xs text-gray-400">Sin movimientos</span>}
            </div>
          ))}
        </div>
      )}
      {libroActivo && <PortalImpresion>{libroActivo.render()}</PortalImpresion>}
    </div>
  );
}
