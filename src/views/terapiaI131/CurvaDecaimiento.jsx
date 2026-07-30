import { actividadTeorica, actividadRestante, diasTranscurridos } from "../../helpers/decaimientoI131.js";

const ANCHO = 600, ALTO = 220, PAD_IZQ = 46, PAD_DER = 16, PAD_ARRIBA = 20, PAD_ABAJO = 28;

// Curva teórica de decaimiento -- SVG a mano (sin librería de gráficos, ver
// nota de la tanda: recharts no está instalado y no queríamos sumar una
// dependencia nueva para un solo gráfico). El eje X NO tiene tope fijo: se
// recalcula en cada render a partir de los días transcurridos reales.
//
// Puramente gráfica y sin Firestore/dominio -- no sabe si "actividadInicial"
// es un vial real (Stock de viales, Parte A) o una proyección de pedido
// semanal (Parte C, PedidoSemanalI131.jsx): quien la usa calcula
// actividadHoy con la fórmula que corresponda a su caso y sólo le pasa el
// número. Esto evita reimplementar el path/ejes en dos lugares -- la única
// fuente de verdad del dibujo de la curva es esta función.
export function CurvaTeoricaSVG({ actividadInicial, diasHoy, actividadHoy, colorLinea = "#2563eb", colorHoy = "#f97316", labelHoy = "Hoy" }) {
  const diasMax = Math.max(diasHoy + 2, 7);
  const nPuntos = 60;
  const puntos = Array.from({ length: nPuntos + 1 }, (_, i) => {
    const dia = (diasMax * i) / nPuntos;
    return { dia, actividad: actividadTeorica(actividadInicial, dia) };
  });
  const actividadMax = actividadInicial;

  const anchoUtil = ANCHO - PAD_IZQ - PAD_DER;
  const altoUtil = ALTO - PAD_ARRIBA - PAD_ABAJO;
  const x = (dia) => PAD_IZQ + (dia / diasMax) * anchoUtil;
  const y = (actividad) => PAD_ARRIBA + altoUtil - (actividad / actividadMax) * altoUtil;

  const path = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dia).toFixed(1)},${y(p.actividad).toFixed(1)}`).join(" ");

  const xHoy = x(diasHoy), yHoy = y(actividadHoy);

  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ valor: actividadMax * f, y: y(actividadMax * f) }));
  const pasoX = diasMax <= 14 ? 2 : diasMax <= 45 ? 7 : 14;
  const marcasX = [];
  for (let d = 0; d <= diasMax; d += pasoX) marcasX.push(d);

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto" role="img" aria-label="Curva de decaimiento">
      {marcasY.map((m, i) => (
        <g key={i}>
          <line x1={PAD_IZQ} y1={m.y} x2={ANCHO - PAD_DER} y2={m.y} stroke="#f1f5f9" strokeWidth="1" />
          <text x={PAD_IZQ - 6} y={m.y + 3} fontSize="9" textAnchor="end" fill="#94a3b8">{m.valor.toFixed(0)}</text>
        </g>
      ))}
      {marcasX.map((d) => (
        <text key={d} x={x(d)} y={ALTO - PAD_ABAJO + 14} fontSize="9" textAnchor="middle" fill="#94a3b8">{d}d</text>
      ))}
      <path d={path} fill="none" stroke={colorLinea} strokeWidth="2" />
      <line x1={xHoy} y1={PAD_ARRIBA} x2={xHoy} y2={ALTO - PAD_ABAJO} stroke={colorHoy} strokeWidth="1" strokeDasharray="3,3" />
      <circle cx={xHoy} cy={yHoy} r="4" fill={colorHoy} />
      <text x={xHoy} y={PAD_ARRIBA - 6} fontSize="9" fontWeight="bold" textAnchor="middle" fill={colorHoy}>{labelHoy}</text>
    </svg>
  );
}

// Curva de decaimiento por vial (Stock de viales, Parte A) -- wrapper fino
// sobre CurvaTeoricaSVG con el cálculo y el caption específicos de un vial
// real: la actividad REAL restante (ya descontado lo extraído, vía
// actividadRestante) suele caer por debajo de la curva teórica, y esa
// diferencia es justamente lo que hay que ver.
export function CurvaDecaimiento({ vial, volumenRestanteMl }) {
  const diasHoy = diasTranscurridos(vial.fechaCalibracion);
  const actividadHoy = actividadRestante(vial, volumenRestanteMl);
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <CurvaTeoricaSVG actividadInicial={vial.actividadCalibrada} diasHoy={diasHoy} actividadHoy={actividadHoy} />
      <div className="text-xs text-gray-500 mt-2 text-center">
        Hoy ({diasHoy.toFixed(1)} días): <span className="font-bold text-orange-600">{actividadHoy.toFixed(2)} mCi restantes</span> en {volumenRestanteMl.toFixed(1)} mL — la curva de referencia asume volumen intacto, sin descontar extracciones
      </div>
    </div>
  );
}
