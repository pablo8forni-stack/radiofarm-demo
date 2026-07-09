import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Html5QrcodeFallback } from "./Html5QrcodeFallback.jsx";

// Nativo (BarcodeDetector, Chrome/Android) cuando está disponible; si no,
// cae a html5-qrcode (Safari/iOS) -- requisito 5.
export function QRScanner({ onResult, onClose }) {
  const soportaNativo = typeof window !== "undefined" && "BarcodeDetector" in window;
  if (!soportaNativo) return <Html5QrcodeFallback onResult={onResult} onClose={onClose} />;
  return <QRScannerNativo onResult={onResult} onClose={onClose} />;
}

function QRScannerNativo({ onResult, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setScanning(true);
        }
      } catch {
        setError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
      }
    }
    startCamera();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    let active = true;
    async function scan() {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      async function tick() {
        if (!active || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
            onResult(codes[0].rawValue);
            return;
          }
        } catch {}
        if (active) requestAnimationFrame(tick);
      }
      tick();
    }
    scan();
    return () => { active = false; };
  }, [scanning]);

  function cerrar() {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    onClose();
  }

  return (
    <Modal open title="Escanear pulsera QR" onClose={cerrar} size="md">
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-blue-400 rounded-xl opacity-80">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br" />
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 text-center">Apuntá la cámara al QR de la pulsera del paciente</p>
          </>
        )}
        <Btn variant="outline" onClick={cerrar}>Cancelar</Btn>
      </div>
    </Modal>
  );
}
