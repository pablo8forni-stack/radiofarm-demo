import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { registrarLog, registrarImagen } from "../../helpers/debugLog.js";

const ELEMENT_ID = "radiofarm-html5-qrcode-region";

// Fallback para navegadores sin BarcodeDetector nativo (Safari/iOS). Usa la
// librería html5-qrcode, que dibuja su propio <video>/<canvas> dentro del
// div que le pasamos -- React NO controla esos nodos. El contrato hacia
// afuera (onResult(rawValue)) es idéntico al del escáner nativo, así que
// TabPacientes no necesita saber cuál se usó.
export function Html5QrcodeFallback({ onResult, onClose }) {
  const [error, setError] = useState("");
  const scannerRef = useRef(null);
  const yaResolvioRef = useRef(false);
  const cancelarRef = useRef(false);
  // Muestreo del qrCodeErrorCallback (dispara por cada frame sin QR
  // detectado, puede ser decenas de veces por segundo) -- log resumido
  // cada ~2s en vez de por frame, para no inundar el buffer.
  const muestreoRef = useRef({ intentos: 0, ultimoMsg: "", ultimoLog: 0 });
  // Último qrbox calculado (ver qrboxFn) -- lo guarda capturarFrame() para
  // dibujar, sobre el frame capturado, una estimación de qué región es la
  // que realmente se recorta y se analiza (no un hecho confirmado -- ver
  // comentario en capturarFrame).
  const ultimoQrboxRef = useRef(null);
  const capturaRef = useRef({ cantidad: 0, ultima: 0 });
  // Bug real CONFIRMADO con evidencia de dispositivo (ver detenerYLuego y
  // el cleanup del useEffect, más abajo, para el porqué).
  const detenidoRef = useRef(false);

  useEffect(() => {
    async function iniciar() {
      registrarLog("[QR] iniciando Html5QrcodeFallback");
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelarRef.current) return;
      const instancia = new Html5Qrcode(ELEMENT_ID);
      scannerRef.current = instancia;
      try {
        // qrbox como FUNCIÓN (no un tamaño fijo en píxeles) -- calculado
        // con las dimensiones REALES del viewfinder que reporta la
        // librería en cada plataforma. Bug real sospechado en iOS: un
        // tamaño fijo (220) puede no coincidir con el tamaño real del
        // buffer de video ahí, haciendo que la librería analice una
        // región del frame que no es la que se ve centrada en el visor
        // -- ver documentación oficial (scanapp.org/blog, tamaño de
        // qrbox dinámico) para exactamente este caso.
        const qrboxFn = (viewfinderWidth, viewfinderHeight) => {
          const lado = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.7);
          ultimoQrboxRef.current = { lado, viewfinderWidth, viewfinderHeight };
          registrarLog(`[QR] qrbox calculado -- viewfinder=${viewfinderWidth}x${viewfinderHeight}, lado=${lado}`);
          return { width: lado, height: lado };
        };
        // Captura el frame REAL en el momento de un intento fallido --
        // desde el mismo <video> que la librería usa (no genera un frame
        // nuevo aparte), llamado sincrónicamente dentro del callback de
        // error, así que es el mismo cuadro (o como mucho 1 frame
        // después, imperceptible con la cámara quieta) que el decoder
        // acaba de analizar. El rectángulo rojo es una ESTIMACIÓN de qué
        // región cae el qrbox calculado, escalada de coordenadas CSS
        // (lo que recibe qrboxFn) a resolución real del video -- no es un
        // hecho confirmado, la librería podría hacer esa traducción
        // distinto por dentro; por eso se manda también el frame
        // COMPLETO sin tocar, que es la evidencia primaria.
        // Tope de resolución para lo que efectivamente se GUARDA (no para
        // el cálculo del recuadro rojo, que se hace antes, contra la
        // resolución real) -- así el tamaño en localStorage no depende de
        // qué cámara tenga cada celular; una foto sin este tope podría
        // pesar mucho más que las ~300 líneas de texto juntas.
        const LADO_MAX_GUARDADO = 640;
        // Bug real encontrado (regresión reportada tras agregar esta
        // captura): a diferencia de TODO el resto del archivo
        // (start/stop/clear, todos con try/catch), esta función tocaba
        // <video>/canvas sin ningún manejo de excepción -- si
        // drawImage()/toDataURL() se llaman justo cuando el
        // MediaStreamTrack está siendo detenido (stop() en vuelo), pueden
        // tirar sin capturar. Ahora con try/catch, igual que el resto.
        // Tope de agrandado del recorte -- lo bastante grande para juzgar
        // nitidez/luz/encuadre a simple vista sin entrecerrar los ojos
        // sobre una foto chica, sin agrandar tanto que sólo se vea
        // borroneado (fuente típica: un cuadrado de ~300-350px).
        const ESCALA_MAX_RECORTE = 4;
        const LADO_MAX_RECORTE = 800;
        function capturarFrame() {
          try {
            const video = document.querySelector(`#${ELEMENT_ID} video`);
            if (!video || !video.videoWidth) return;
            const canvasCompleto = document.createElement("canvas");
            canvasCompleto.width = video.videoWidth;
            canvasCompleto.height = video.videoHeight;
            const ctxCompleto = canvasCompleto.getContext("2d");
            ctxCompleto.drawImage(video, 0, 0, canvasCompleto.width, canvasCompleto.height);
            const info = ultimoQrboxRef.current;
            let etiqueta = `video real ${video.videoWidth}x${video.videoHeight}`;
            let recorte = null;
            if (info) {
              const escalaX = canvasCompleto.width / info.viewfinderWidth;
              const escalaY = canvasCompleto.height / info.viewfinderHeight;
              const w = info.lado * escalaX, h = info.lado * escalaY;
              const x = (canvasCompleto.width - w) / 2, y = (canvasCompleto.height - h) / 2;
              recorte = { x, y, w, h };
            }

            // Recorte SOLO -- los mismos píxeles (x,y,w,h) de arriba,
            // cortados del frame ANTES de dibujar el rectángulo rojo (para
            // que no le queden líneas rojas adentro) y agrandados. Mismo
            // canvasCompleto que la imagen de abajo -- nunca se vuelve a
            // leer el <video>, así que es exactamente el mismo momento.
            let dataUrlRecorte = null, etiquetaRecorte = "";
            if (recorte && recorte.w > 0 && recorte.h > 0) {
              const escalaRecorte = Math.min(ESCALA_MAX_RECORTE, LADO_MAX_RECORTE / Math.max(recorte.w, recorte.h));
              const canvasRecorte = document.createElement("canvas");
              canvasRecorte.width = Math.round(recorte.w * escalaRecorte);
              canvasRecorte.height = Math.round(recorte.h * escalaRecorte);
              canvasRecorte.getContext("2d").drawImage(
                canvasCompleto, recorte.x, recorte.y, recorte.w, recorte.h,
                0, 0, canvasRecorte.width, canvasRecorte.height
              );
              dataUrlRecorte = canvasRecorte.toDataURL("image/jpeg", 0.7);
              etiquetaRecorte = `SOLO el recorte estimado, agrandado ${escalaRecorte.toFixed(1)}x (original ${Math.round(recorte.w)}x${Math.round(recorte.h)})`;

              // Recién ACÁ se dibuja el rectángulo rojo sobre
              // canvasCompleto -- después de haber cortado el recorte
              // limpio arriba, para la versión "completo" de abajo.
              ctxCompleto.strokeStyle = "red";
              ctxCompleto.lineWidth = Math.max(3, Math.floor(canvasCompleto.width * 0.008));
              ctxCompleto.strokeRect(recorte.x, recorte.y, recorte.w, recorte.h);
              etiqueta += ` -- recorte estimado (rojo) ${Math.round(recorte.w)}x${Math.round(recorte.h)}`;
            }

            // Frame completo (con el rectángulo ya dibujado si corresponde)
            // -- recién acá se achica, para guardar.
            const escalaGuardado = Math.min(1, LADO_MAX_GUARDADO / Math.max(canvasCompleto.width, canvasCompleto.height));
            const canvasGuardado = document.createElement("canvas");
            canvasGuardado.width = Math.round(canvasCompleto.width * escalaGuardado);
            canvasGuardado.height = Math.round(canvasCompleto.height * escalaGuardado);
            canvasGuardado.getContext("2d").drawImage(canvasCompleto, 0, 0, canvasGuardado.width, canvasGuardado.height);
            const dataUrl = canvasGuardado.toDataURL("image/jpeg", 0.6);

            // Se registran en este orden (completo primero, recorte
            // después) a propósito -- así en el visor aparece la vista
            // general primero y el detalle agrandado justo al lado, no al
            // revés.
            const resultado = registrarImagen(dataUrl, etiqueta);
            // Confirma el DATO en sí (no sólo que se llamó a la función)
            // -- si esto no aparece en el log, algo falló guardando, no
            // sólo mostrando.
            registrarLog(`[QR] frame completo capturado -- ${etiqueta} -- guardado en el buffer: ${resultado.ok} (${resultado.bytes} bytes, ${resultado.totalEnBuffer} imágenes en el buffer)`);
            if (dataUrlRecorte) {
              const resultadoRecorte = registrarImagen(dataUrlRecorte, etiquetaRecorte);
              registrarLog(`[QR] recorte agrandado capturado -- ${etiquetaRecorte} -- guardado en el buffer: ${resultadoRecorte.ok} (${resultadoRecorte.bytes} bytes, ${resultadoRecorte.totalEnBuffer} imágenes en el buffer)`);
            }
          } catch (e) {
            registrarLog(`[QR] capturarFrame() falló: ${e.name || "Error"} -- ${e.message || e}`);
          }
        }

        await instancia.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: qrboxFn,
            // Bug real bajo investigación (Problema 1, nunca decodifica en
            // iOS): sin esto, la librería arma el getUserMedia sólo con
            // facingMode (ver createVideoConstraints() en
            // html5-qrcode/src/html5-qrcode.ts) -- la resolución queda
            // 100% librada al default de Safari, confirmado por log real
            // en 480x640 (bajísima, un tercio de los píxeles del camino
            // nativo de Android en QRScanner.jsx, que sí pide 1280x720).
            // Con el qrbox recortando encima de esa imagen ya chica, cada
            // módulo del QR queda con muy pocos píxeles reales -- se ve
            // bien a ojo en una foto agrandada, pero no alcanza para que
            // el binarizador de ZXing sea robusto. El log de video real
            // (más abajo) confirma si iOS respeta este pedido o lo ignora.
            videoConstraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          },
          (decodedText) => {
            if (yaResolvioRef.current) return;
            yaResolvioRef.current = true;
            registrarLog(`[QR] decode exitoso: "${decodedText.slice(0, 60)}"`);
            detenerYLuego(() => onResult(decodedText));
          },
          (mensaje) => {
            // Bug real (regresión encontrada): a diferencia del callback
            // de éxito (que ya chequeaba yaResolvioRef), éste no tenía
            // NINGÚN guard contra seguir corriendo durante el cierre --
            // un intento de escaneo ya encolado por la librería podía
            // disparar igual mientras detenerYLuego() esperaba
            // stop()/clear(), incluida una llamada a capturarFrame()
            // tocando un <video> a medio desmontar. cancelarRef ahora se
            // marca al PRINCIPIO de detenerYLuego (ver más abajo), no
            // sólo en el unmount real -- este chequeo corta cualquier
            // trabajo de acá en cuanto empieza el cierre, sea por cancelar
            // o por un escaneo exitoso.
            if (cancelarRef.current) return;
            // Frame sin QR detectado -- normal, pasa todo el tiempo que
            // no hay un código en cuadro. Muestreado, no logueado 1 a 1.
            const m = muestreoRef.current;
            m.intentos += 1;
            m.ultimoMsg = mensaje;
            const ahora = Date.now();
            if (ahora - m.ultimoLog > 2000) {
              registrarLog(`[QR] ${m.intentos} intentos de decode en los últimos ~2s, último mensaje: ${m.ultimoMsg}`);
              m.intentos = 0;
              m.ultimoLog = ahora;
            }
            // Captura visual real -- ver los ojos en vez de seguir
            // infiriendo del mensaje genérico de error. Throttleada (máx
            // 3 capturas por sesión, una cada 3s) -- el callback dispara
            // decenas de veces por segundo, capturar en cada uno sería
            // carísimo y no aporta nada extra.
            const cap = capturaRef.current;
            if (cap.cantidad < 3 && ahora - cap.ultima > 3000) {
              cap.ultima = ahora;
              cap.cantidad += 1;
              capturarFrame();
            }
          }
        );
        registrarLog("[QR] instancia.start() resolvió OK");
        const video = document.querySelector(`#${ELEMENT_ID} video`);
        if (video) {
          const logDims = () => registrarLog(`[QR] video real -- videoWidth=${video.videoWidth}, videoHeight=${video.videoHeight}, clientWidth=${video.clientWidth}, clientHeight=${video.clientHeight}`);
          if (video.videoWidth) logDims();
          else video.addEventListener("loadedmetadata", logDims, { once: true });
        } else {
          registrarLog("[QR] no se encontró el <video> de la librería para loguear dimensiones");
        }
      } catch (e) {
        registrarLog(`[QR] instancia.start() falló: ${e.name || "Error"} -- ${e.message || e}`);
        if (!cancelarRef.current) setError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
      }
    }
    iniciar();

    return () => {
      cancelarRef.current = true;
      // Bug real CONFIRMADO con log de dispositivo real (Error Boundary,
      // iPhone de Fernando): este cleanup llamaba stop() SIEMPRE al
      // desmontar, incluso cuando detenerYLuego() (cerrar() o un escaneo
      // exitoso) ya había hecho stop()+clear() con éxito un instante antes
      // -- ese segundo stop(), sobre un scanner que ya está parado,
      // html5-qrcode lo tira EN FORMA SÍNCRONA ("Cannot stop, scanner is
      // not running or paused."), no como promesa rechazada. Por eso el
      // .catch() encadenado nunca lo atrapaba: un throw síncrono ocurre
      // evaluando instancia.stop() ANTES de que exista la promesa a la que
      // encadenar .catch(), así que se propagaba directo a través del
      // cleanup, en plena reconciliación de React al desmontar -- eso era
      // la pantalla en blanco inmediata al cancelar (confirmado: el log
      // mostraba "stop() OK"/"clear() OK" de detenerYLuego() milisegundos
      // antes de la excepción atrapada por el Error Boundary).
      //
      // Fix: sólo intentar stop() acá si detenerYLuego() todavía NO lo
      // hizo (ruta de emergencia real: unmount abrupto sin pasar por
      // cerrar()/onResult, ej. navegación). Y aun así, try/catch de
      // verdad (no sólo .catch()) por si el throw síncrono vuelve a pasar
      // por cualquier otro motivo.
      const instancia = scannerRef.current;
      if (instancia && !detenidoRef.current) {
        try {
          instancia.stop().then(() => instancia.clear()).catch(() => {});
        } catch {
          // stop() puede tirar de forma síncrona -- ver comentario arriba.
        }
      }
    };
  }, []);

  // Bug real (pantalla en blanco al cerrar): html5-qrcode maneja su
  // propio <video>/<canvas> DENTRO del div que le dimos -- si el padre
  // desmonta este componente (onClose/onResult) mientras stop()/clear()
  // (asíncronos) siguen en vuelo, React saca el div del árbol mientras la
  // librería todavía intenta tocar sus propios nodos ahí adentro --
  // "removeChild: the node to be removed is not a child of this node",
  // sin manejar en ningún lado, tira toda la app abajo (sin Error
  // Boundary). Por eso ACÁ se espera a que stop()+clear() terminen de
  // verdad, con el div todavía montado, antes de avisar al padre --
  // tanto para cancelar como para un escaneo exitoso (los dos caminos
  // pasan por acá, el de éxito tenía el mismo riesgo aunque nunca se vio
  // porque el Problema 1 impedía llegar ahí en la práctica).
  async function detenerYLuego(cb) {
    // Se marca ACÁ, antes de esperar nada -- no sólo en el cleanup del
    // useEffect (ruta de emergencia, demasiado tarde para esto). Corta de
    // raíz cualquier callback de escaneo que la librería tenga ya
    // encolado y dispare mientras stop()/clear() siguen en vuelo (ver
    // guard en el callback de error, arriba).
    cancelarRef.current = true;
    const instancia = scannerRef.current;
    if (instancia) {
      // Se marca ACÁ, apenas termina el intento de stop() (haya salido
      // bien o mal) -- el cleanup del useEffect (más abajo) lo usa para
      // no volver a llamar stop() sobre un scanner que ya fue tocado por
      // esta vía. Ver el comentario largo en ese cleanup para la causa
      // real confirmada de por qué esto hace falta.
      try { await instancia.stop(); registrarLog("[QR] stop() OK"); } catch (e) { registrarLog(`[QR] stop() falló: ${e.message || e}`); }
      detenidoRef.current = true;
      try { await instancia.clear(); registrarLog("[QR] clear() OK"); } catch (e) { registrarLog(`[QR] clear() falló: ${e.message || e}`); }
    }
    cb();
  }

  function cerrar() {
    registrarLog("[QR] cerrar() -- cancelado sin escanear");
    detenerYLuego(onClose);
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
