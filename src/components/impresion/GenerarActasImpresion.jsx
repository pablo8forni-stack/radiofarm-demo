import { useState } from "react";
import { Sel } from "../ui/Sel.jsx";
import { Btn } from "../ui/Btn.jsx";
import { actasPorRango, anulacionesPorSede } from "../../services/firestore/actas.js";
import { lotesPorSede } from "../../services/firestore/mibgLotes.js";
import { primerYUltimoDiaMes, nombreMes } from "../../helpers/rangoMensual.js";
import { PortalImpresion } from "./PortalImpresion.jsx";
import { ImprimibleLibro1Marcacion } from "./ImprimibleLibro1Marcacion.jsx";
import { ImprimibleLibro2Pacientes } from "./ImprimibleLibro2Pacientes.jsx";
import { ImprimibleLibro3Elucion } from "./ImprimibleLibro3Elucion.jsx";
import { ImprimibleLibro4Lutecio } from "./ImprimibleLibro4Lutecio.jsx";

const TIPOS_LIBRO2 = ["paciente", "i131_ablativa", "i131_dosis", "i131_barrido", "i131_mibg", "i131_captacion", "i131_centellograma", "i131_captacion_centellograma"];

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
      const actasLibro2 = porTipoLibro2.flat().sort((a, b) => (a.fecha?.toDate?.() ?? new Date(a.fecha)) - (b.fecha?.toDate?.() ?? new Date(b.fecha)));
      const lotesPorId = new Map(lotesRaw.map((l) => [l.id, l]));

      // Libro 4: lotes de Lutecio-177 llegados este mes + su administración
      // si también quedó dentro del mismo mes (ver comentario en
      // ImprimibleLibro4Lutecio sobre el caso borde de mes cruzado).
      const lotesLutecio = porFechaAsc(lotesRaw.filter((l) => (l.isotopoId || "mibg") === "lutecio177"));
      const usosLutecio = actasLibro2.filter((a) => a.isotopoId === "lu177" && a.loteDosisUnicaId && !anulaciones.has(a.id));
      const usoPorLoteId = new Map(usosLutecio.map((u) => [u.loteDosisUnicaId, u]));

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
  function imprimir(libro) {
    setImprimiendo(libro);
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
        <input type="month" value={mes} max={hoyISO()} onChange={(e) => { setMes(e.target.value); setDatos(null); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-11 md:min-h-0" />
        <Btn size="sm" onClick={generar} disabled={generando || !sedeId}>{generando ? "Generando..." : "Generar"}</Btn>
      </div>
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
