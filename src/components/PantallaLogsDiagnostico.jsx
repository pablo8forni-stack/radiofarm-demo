import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal.jsx";
import { Btn } from "./ui/Btn.jsx";
import { obtenerLogsTexto, registrarLog, limpiarLogs, obtenerImagenes, limpiarImagenes } from "../helpers/debugLog.js";

// Herramienta de diagnóstico interno -- se abre con un gesto discreto
// (7 taps rápidos en el logo del header, ver App.jsx), no un botón
// permanente. Pensada para poder copiar y pasar logs desde un celular sin
// cable ni inspector remoto (el caso de iPhone sin Mac a mano).
export function PantallaLogsDiagnostico({ open, onClose }) {
  const [copiado, setCopiado] = useState(false);
  const [version, setVersion] = useState(0); // fuerza refrescar texto/imágenes al reabrir

  // Bug real ya visto una vez: el buffer de imágenes puede aparecer vacío
  // al abrir (ver nota larga en debugLog.js) -- este log confirma con
  // certeza, la próxima vez, si el buffer estaba realmente vacío al leerlo
  // (en vez de tener que inferirlo de la ausencia de imágenes en pantalla).
  useEffect(() => {
    if (open) {
      registrarLog(`[Logs] visor abierto -- ${obtenerImagenes().length} imágenes encontradas en el buffer`);
      setVersion((v) => v + 1);
    }
    // eslint-disable-next-line
  }, [open]);

  const texto = obtenerLogsTexto();
  const imagenes = obtenerImagenes();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto || "(sin logs todavía)");
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  function limpiar() {
    limpiarLogs();
    limpiarImagenes();
    setVersion((v) => v + 1);
  }

  return (
    <Modal open={open} title="Logs de diagnóstico" onClose={onClose} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-400">Herramienta interna -- copiá el texto y pasalo para ayudar a diagnosticar un problema.</p>

        {imagenes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-600">
              Frames capturados durante el escaneo -- mantené el dedo apretado sobre la imagen para guardarla o compartirla directo desde el teléfono.
            </div>
            {imagenes.map((img, i) => (
              <div key={i} className="flex flex-col gap-1">
                <img src={img.dataUrl} alt={`frame capturado ${img.hora}`} className="w-full rounded-xl border border-gray-200" />
                <span className="text-[10px] text-gray-400">{img.hora} -- {img.etiqueta}</span>
              </div>
            ))}
          </div>
        )}

        <pre key={version} className="bg-gray-900 text-green-400 text-[10px] leading-relaxed rounded-xl p-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {texto || "(sin logs todavía)"}
        </pre>
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={limpiar}>Limpiar</Btn>
          <Btn onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
