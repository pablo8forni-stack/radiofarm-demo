import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";

const ELEMENT_ID = "radiofarm-html5-qrcode-region";

// Fallback para navegadores sin BarcodeDetector nativo (Safari/iOS). Usa la
// librería html5-qrcode, que dibuja su propio <video> dentro del div que le
// pasamos. El contrato hacia afuera (onResult(rawValue)) es idéntico al del
// escáner nativo, así que TabPacientes no necesita saber cuál se usó.
export function Html5QrcodeFallback({ onResult, onClose }) {
  const [error, setError] = useState("");
  const scannerRef = useRef(null);
  const yaResolvioRef = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelado) return;
      const instancia = new Html5Qrcode(ELEMENT_ID);
      scannerRef.current = instancia;
      try {
        await instancia.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (decodedText) => {
            if (yaResolvioRef.current) return;
            yaResolvioRef.current = true;
            onResult(decodedText);
          },
          () => {} // errores de frame-a-frame sin QR detectado, se ignoran
        );
      } catch {
        if (!cancelado) setError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
      }
    }
    iniciar();

    return () => {
      cancelado = true;
      const instancia = scannerRef.current;
      if (instancia) {
        instancia.stop().then(() => instancia.clear()).catch(() => {});
      }
    };
  }, []);

  function cerrar() {
    const instancia = scannerRef.current;
    if (instancia) instancia.stop().then(() => instancia.clear()).catch(() => {});
    onClose();
  }

  return (
    <Modal open title="Escanear pulsera QR" onClose={cerrar} size="md">
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div id={ELEMENT_ID} className="rounded-xl overflow-hidden bg-black" />
            <p className="text-xs text-gray-400 text-center">Apuntá la cámara al QR de la pulsera del paciente</p>
          </>
        )}
        <Btn variant="outline" onClick={cerrar}>Cancelar</Btn>
      </div>
    </Modal>
  );
}
