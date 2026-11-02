import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Html5QrcodeFallback } from "./Html5QrcodeFallback.jsx";
import { avisarEscaneoExitoso } from "../../helpers/feedbackEscaneo.js";
import { registrarLog } from "../../helpers/debugLog.js";

// INSTRUMENTACIÓN TEMPORAL (Pablo, investigación del lector QR lento con
// wifi sin internet en Android) -- activa SÓLO con ?debugQR=1 en la URL,
// apagada por defecto. Mide, no cambia nada de la lógica de lectura: tiempo
// hasta la primera lectura exitosa, intervalo entre frames del loop de
// requestAnimationFrame y duración de cada detect() -- para confirmar o
// descartar si los listeners onSnapshot de TabPacientes.jsx (ver
// instrumentación paralela ahí) le compiten el hilo principal al loop de
// detección cuando la red está en ese estado. Sacar este bloque (y el de
// TabPacientes.jsx) una vez resuelta la investigación.
const DEBUG_QR = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugQR") === "1";

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
  // Instrumentación temporal (ver comentario de DEBUG_QR arriba). aperturaRef
  // se fija en startCamera() (abajo), apenas arranca el efecto de montaje --
  // el momento más fiel a "se abrió el escáner" desde la perspectiva de la
  // técnica. medicionRef acumula por segundo (mismo criterio de muestreo que
  // ya usa Html5QrcodeFallback.jsx para no inundar el buffer de logs
  // logueando por frame).
  const aperturaRef = useRef(null);
  const yaMidioAperturaRef = useRef(false);
  const medicionRef = useRef({ frames: 0, sumaIntervalo: 0, maxIntervalo: 0, ultimoFrame: null, detects: 0, sumaDetect: 0, maxDetect: 0, ultimoLog: null });

  useEffect(() => {
    if (DEBUG_QR) {
      aperturaRef.current = performance.now();
      medicionRef.current.ultimoLog = aperturaRef.current;
      registrarLog("[QR debug] escáner nativo: abierto, empieza a medir");
    }
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;

        // Bug real bajo investigación (autoenfoque lento/no confiable en
        // Android, confirmado con evidencia real: otra app nativa en el
        // MISMO celular enfoca bien, así que no es el hardware -- es cómo
        // esta app pide la cámara). focusMode NO es una constraint básica
        // de getUserMedia -- sólo se puede pedir vía el track ya obtenido,
        // con applyConstraints({advanced:[...]}) (ver
        // MediaStreamTrack.applyConstraints, MDN) -- exclusivo de Chrome/
        // Android, iOS Safari no lo expone de ningún modo. La documentación
        // oficial es ambigua/contradictoria sobre si un focusMode no
        // soportado dentro de "advanced" se ignora en silencio o rechaza
        // la promesa -- por eso NO confiamos en eso solo: primero se
        // chequea getCapabilities() explícitamente, y applyConstraints
        // igual queda en try/catch como red de seguridad. Logueado (no
        // asumido) para confirmar con evidencia real de dispositivo (7
        // taps en el logo) si esto mejora algo, antes de darlo por
        // resuelto.
        const track = stream.getVideoTracks()[0];
        const capacidades = track.getCapabilities?.() || {};
        registrarLog(`[QR nativo] focusMode soportado: ${JSON.stringify(capacidades.focusMode || "no expone capabilities")}`);
        if (capacidades.focusMode?.includes("continuous")) {
          try {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
            registrarLog("[QR nativo] applyConstraints(focusMode: continuous) OK");
          } catch (e) {
            registrarLog(`[QR nativo] applyConstraints(focusMode) falló: ${e.name} -- ${e.message}`);
          }
        }

        // Paso 1 de la investigación de foco (sólo medir, no aplicar nada
        // todavía): si el dispositivo sólo expone focusMode "manual" (caso
        // real confirmado, Galaxy S23), un valor fijo de focusDistance
        // podría servir de arranque mejor calibrado que el default -- pero
        // el spec oficial (W3C Media Capture and Image) NO garantiza la
        // unidad ("usualmente metros", sin exigirlo) ni da ninguna guía de
        // qué valor elegir para algo cercano tipo QR -- hay que verlo con
        // el número real de ESTE dispositivo antes de calibrar cualquier
        // cosa, no adivinar.
        if (capacidades.focusDistance) {
          registrarLog(`[QR nativo] focusDistance disponible -- min:${capacidades.focusDistance.min}, max:${capacidades.focusDistance.max}, step:${capacidades.focusDistance.step}`);
        } else {
          registrarLog("[QR nativo] focusDistance no expuesto en capabilities");
        }

        // Segunda línea de investigación en paralelo (misma filosofía --
        // sólo medir): los celulares modernos suelen tener varias cámaras
        // traseras (principal, ultra wide, macro dedicada). Hoy sólo se
        // pide facingMode:"environment", sin elegir cuál -- el navegador
        // decide sola, probablemente la principal, no una macro pensada
        // para distancias cortas como esta. enumerateDevices() sólo
        // devuelve labels reales DESPUÉS de tener permiso de cámara
        // concedido (por privacidad) -- por eso se llama acá, recién
        // después de que getUserMedia ya resolvió arriba, nunca antes.
        try {
          const dispositivos = await navigator.mediaDevices.enumerateDevices();
          const camaras = dispositivos.filter((d) => d.kind === "videoinput")
            .map((d) => ({ deviceId: d.deviceId.slice(0, 12) + "...", label: d.label || "(sin label)" }));
          registrarLog(`[QR nativo] cámaras de video disponibles: ${JSON.stringify(camaras)}`);
        } catch (e) {
          registrarLog(`[QR nativo] enumerateDevices() falló: ${e.name} -- ${e.message}`);
        }

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
        // Instrumentación temporal (ver DEBUG_QR arriba) -- intervalo entre
        // frames, medido ANTES del detect() de este frame (así el tiempo que
        // tarda detect() en sí queda aparte, en medicionRef.sumaDetect/
        // maxDetect, sin mezclarse con el intervalo entre frames).
        if (DEBUG_QR) {
          const ahora = performance.now();
          const m = medicionRef.current;
          if (m.ultimoFrame != null) {
            const intervalo = ahora - m.ultimoFrame;
            m.frames += 1;
            m.sumaIntervalo += intervalo;
            if (intervalo > m.maxIntervalo) m.maxIntervalo = intervalo;
          }
          m.ultimoFrame = ahora;
        }
        try {
          const t0 = DEBUG_QR ? performance.now() : 0;
          const codes = await detector.detect(videoRef.current);
          if (DEBUG_QR) {
            const dt = performance.now() - t0;
            const m = medicionRef.current;
            m.detects += 1;
            m.sumaDetect += dt;
            if (dt > m.maxDetect) m.maxDetect = dt;
          }
          if (codes.length > 0) {
            if (DEBUG_QR && !yaMidioAperturaRef.current && aperturaRef.current != null) {
              yaMidioAperturaRef.current = true;
              registrarLog(`[QR debug] primera lectura exitosa a los ${(performance.now() - aperturaRef.current).toFixed(0)} ms de abrir el escáner`);
            }
            avisarEscaneoExitoso();
            if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
            onResult(codes[0].rawValue);
            return;
          }
        } catch {}
        // Muestreo cada ~1s (no por frame) -- mismo criterio que ya usa
        // Html5QrcodeFallback.jsx para no inundar el buffer de registrarLog.
        if (DEBUG_QR) {
          const m = medicionRef.current;
          const ahora = performance.now();
          if (m.ultimoLog != null && ahora - m.ultimoLog >= 1000) {
            const avgIntervalo = m.frames ? m.sumaIntervalo / m.frames : 0;
            const avgDetect = m.detects ? m.sumaDetect / m.detects : 0;
            registrarLog(
              `[QR debug] último segundo -- frames: ${m.frames} (intervalo avg=${avgIntervalo.toFixed(0)}ms, max=${m.maxIntervalo.toFixed(0)}ms) -- ` +
              `detect(): ${m.detects} llamados (avg=${avgDetect.toFixed(0)}ms, max=${m.maxDetect.toFixed(0)}ms)`
            );
            m.frames = 0; m.sumaIntervalo = 0; m.maxIntervalo = 0;
            m.detects = 0; m.sumaDetect = 0; m.maxDetect = 0;
            m.ultimoLog = ahora;
          }
        }
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
