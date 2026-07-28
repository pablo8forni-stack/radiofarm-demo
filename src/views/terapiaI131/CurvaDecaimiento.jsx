import { actividadTeorica, actividadRestante, diasTranscurridos } from "../../helpers/decaimientoI131.js";

const ANCHO = 600, ALTO = 220, PAD_IZQ = 46, PAD_DER = 16, PAD_ARRIBA = 20, PAD_ABAJO = 28;

// Curva de decaimiento por vial -- SVG a mano (sin librería de gráficos, ver
// nota de la tanda: recharts no está instalado y no queríamos sumar una
// dependencia nueva para un solo gráfico). El eje X NO tiene tope fijo: se
// recalcula en cada render a partir de los días transcurridos reales, así se
// extiende solo mientras el vial siga en uso (a diferencia de la planilla
// impresa de hasta 28 días).
//
// Se grafican dos cosas distintas a propósito: la curva teórica (asume
// volumen intacto, decaimiento puro) y un punto destacado en "hoy" con la
// actividad REAL restante (ya descontado lo extraído) -- el punto suele caer
// por debajo de la curva, y esa diferencia es justamente lo que hay que ver.
export function CurvaDecaimiento({ vial, volumenRestanteMl }) {
  const diasHoy = diasTranscurridos(vial.fechaCalibracion);
  const diasMax = Math.max(diasHoy + 2, 7);
  const nPuntos = 60;
  const puntos = Array.from({ length: nPuntos + 1 }, (_, i) => {
    const dia = (diasMax * i) / nPuntos;
    return { dia, actividad: actividadTeorica(vial.actividadCalibrada, dia) };
  });
  const actividadMax = vial.actividadCalibrada;

  const anchoUtil = ANCHO - PAD_IZQ - PAD_DER;
  const altoUtil = ALTO - PAD_ARRIBA - PAD_ABAJO;
  const x = (dia) => PAD_IZQ + (dia / diasMax) * anchoUtil;
  const y = (actividad) => PAD_ARRIBA + altoUtil - (actividad / actividadMax) * altoUtil;

  const path = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dia).toFixed(1)},${y(p.actividad).toFixed(1)}`).join(" ");

  const actividadHoy = actividadRestante(vial, volumenRestanteMl);
  const xHoy = x(diasHoy), yHoy = y(actividadHoy);

  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ valor: actividadMax * f, y: y(actividadMax * f) }));
  const pasoX = diasMax <= 14 ? 2 : diasMax <= 45 ? 7 : 14;
  const marcasX = [];
  for (let d = 0; d <= diasMax; d += pasoX) marcasX.push(d);

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto" role="img" aria-label="Curva de decaimiento del vial">
        {marcasY.map((m, i) => (
          <g key={i}>
            <line x1={PAD_IZQ} y1={m.y} x2={ANCHO - PAD_DER} y2={m.y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={PAD_IZQ - 6} y={m.y + 3} fontSize="9" textAnchor="end" fill="#94a3b8">{m.valor.toFixed(0)}</text>
          </g>
        ))}
        {marcasX.map((d) => (
          <text key={d} x={x(d)} y={ALTO - PAD_ABAJO + 14} fontSize="9" textAnchor="middle" fill="#94a3b8">{d}d</text>
        ))}
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" />
        <line x1={xHoy} y1={PAD_ARRIBA} x2={xHoy} y2={ALTO - PAD_ABAJO} stroke="#f97316" strokeWidth="1" strokeDasharray="3,3" />
        <circle cx={xHoy} cy={yHoy} r="4" fill="#f97316" />
        <text x={xHoy} y={PAD_ARRIBA - 6} fontSize="9" fontWeight="bold" textAnchor="middle" fill="#f97316">Hoy</text>
      </svg>
      <div className="text-xs text-gray-500 mt-2 text-center">
        Hoy ({diasHoy.toFixed(1)} días): <span className="font-bold text-orange-600">{actividadHoy.toFixed(2)} mCi restantes</span> en {volumenRestanteMl.toFixed(1)} mL — la curva de referencia asume volumen intacto, sin descontar extracciones
      </div>
    </div>
  );
}
