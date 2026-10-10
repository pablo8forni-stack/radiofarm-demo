// Antes: un <label> envolvía el input Y el texto -- por spec HTML, tocar
// CUALQUIER parte de un label asociado a un input lo activa, así que tocar
// el texto (o el padding/line-height del label, que sobresale un poco del
// texto visible) tildaba la excepción sin querer. Acá sólo el <input> es
// interactivo; el texto es un <span> sin interacción (aria-hidden, el
// nombre accesible vive en el aria-label del input), y Espacio con foco
// sigue funcionando porque sigue siendo un <input type="checkbox"> nativo.
export function CasilleroExcepcion({
  checked, onChange, etiqueta, mensajeActivo,
  inputClassName, textClassName, wrapClassName = "flex items-start gap-2",
  mensajeClassName = "mt-1.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5",
  className,
}) {
  return (
    <div className={className}>
      <div className={wrapClassName}>
        <input
          type="checkbox" className={inputClassName} checked={checked}
          onChange={(e) => onChange(e.target.checked)} aria-label={etiqueta}
        />
        <span aria-hidden="true" className={textClassName}>{etiqueta}</span>
      </div>
      {checked && mensajeActivo && <p className={mensajeClassName}>{mensajeActivo}</p>}
    </div>
  );
}
