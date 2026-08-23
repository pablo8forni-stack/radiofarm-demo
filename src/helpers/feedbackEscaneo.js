// Feedback al escanear un QR con éxito -- el SONIDO es el canal
// garantizado (funciona en Android y en iPhone). La vibración es un
// plus opcional: Safari/iOS NUNCA implementó la Vibration API (hueco
// permanente de la plataforma, no un tema de configuración) -- por eso
// nunca puede ser el único aviso, sólo se dispara si el navegador
// realmente la soporta.
let audioCtx = null;

// Safari/iOS exige que el AudioContext se cree (o reanude) dentro de un
// gesto real de usuario -- si se creara recién en el momento del
// escaneo exitoso (un callback asíncrono, no un gesto), iOS lo bloquea
// en silencio, sin avisar nada. Por eso esto se llama en el click que
// abre el escáner, no en el resultado.
export function prepararSonidoEscaneo() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  } catch {
    // Sin sonido no debe romper la apertura del escáner -- sólo se
    // pierde el aviso.
  }
}

export function avisarEscaneoExitoso() {
  try {
    if (audioCtx) {
      const ahora = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ahora);
      gain.gain.exponentialRampToValueAtTime(0.3, ahora + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(ahora);
      osc.stop(ahora + 0.2);
    }
  } catch {
    // Sin sonido no debe romper el flujo de escaneo -- sólo se pierde
    // el aviso.
  }
  try {
    if ("vibrate" in navigator) navigator.vibrate(80);
  } catch {
    // idem
  }
}
