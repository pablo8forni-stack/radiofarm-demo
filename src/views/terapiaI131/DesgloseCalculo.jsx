import { fmtTs } from "../../helpers/formato.js";

function Fila({ label, valor }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-right">{valor}</span>
    </div>
  );
}

// Principio de transparencia (no opcional): cualquier número que salga del
// motor de decaimiento se muestra siempre junto a este desglose completo --
// nunca solo el resultado final sin poder ver de dónde sale. Un solo
// componente para las 3 pantallas que lo necesitan (detalle de vial, vista
// previa de extracción, historial de extracciones ya guardadas).
export function DesgloseCalculo({ titulo = "Cálculo por decaimiento", actividadCalibrada, volumenInicial, fechaCalibracion, dias, filasExtra = [], resultado, unidadResultado }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 flex flex-col gap-1">
      <div className="font-semibold text-gray-700 mb-0.5">{titulo}</div>
      <Fila label="Actividad calibrada" valor={`${actividadCalibrada} mCi`} />
      <Fila label="Volumen inicial" valor={`${volumenInicial} mL`} />
      <Fila label="Fecha de calibración" valor={fmtTs(fechaCalibracion)} />
      <Fila label="Días transcurridos" valor={dias.toFixed(2)} />
      {filasExtra.map((f, i) => <Fila key={i} label={f.label} valor={f.valor} />)}
      <div className="text-gray-400 italic mt-1">Fórmula: A(t) = A₀ × e^(−λt), λ = ln(2) / 8,02 días (vida media del I-131)</div>
      <div className="mt-1 pt-1.5 border-t border-gray-200 flex items-baseline justify-between">
        <span className="font-semibold text-gray-700">Resultado</span>
        <span className="font-bold text-blue-700 text-sm">{resultado.toFixed(2)} {unidadResultado}</span>
      </div>
    </div>
  );
}

// Banner fijo, sin botón de cerrar -- a propósito no es un modal ni tiene
// estado de "ya lo vi": tiene que verse cada vez que se consulta o registra
// una extracción, no sólo la primera vez.
export function AvisoGuiaNoOficial() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 font-medium">
      ⚠ Este cálculo es una guía — confirmá siempre con el activímetro antes de administrar.
    </div>
  );
}
