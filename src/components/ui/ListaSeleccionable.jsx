import { useEffect, useId, useRef, useState } from "react";

// Reemplazo de <Sel> SÓLO para donde hace falta mostrar opciones no
// elegibles sin ocultarlas (ver dedupeLotesPorFarm en TabPacientes.jsx) --
// un <option disabled> nativo no tiene tachado consistente entre
// navegadores (Chrome ignora casi todo el CSS sobre <option>, Safari/iOS
// peor), así que esto arma la lista a mano con role="listbox".
//
// Patrón de accesibilidad: el foco real se queda SIEMPRE en el botón
// disparador (nunca se mueve a la lista) -- aria-activedescendant en el
// botón apunta a la opción resaltada, mismo patrón que un <select> propio
// estándar (evita manejar focus-trap). Teclado, con la lista abierta:
//   - ArrowDown/ArrowUp: mueve el resaltado, SALTANDO las deshabilitadas.
//   - Home/End: primera/última opción habilitada.
//   - Enter/Espacio: elige la resaltada y cierra.
//   - Escape: cierra sin cambiar nada, el foco nunca se movió del botón.
// Con la lista cerrada, ArrowDown/ArrowUp/Enter/Espacio la abren (mismo
// comportamiento esperado de un <select> nativo).
//
// options: [{ value, label, disabled, disabledHint }] -- disabledHint es
// texto opcional que se muestra en una segunda línea, chica y SIN tachar,
// debajo del label de una fila deshabilitada (p. ej. "ya no es la
// marcación más reciente") -- mismo criterio que el resto de los avisos
// cortos de la app (ver "Ningún lote de este radiofármaco fue marcado hoy
// en esta sede." en TabPacientes.jsx).
export function ListaSeleccionable({ label, value, onChange, options, placeholder = "Seleccionar...", disabled }) {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value ?? null);
  const raizRef = useRef(null);
  const botonRef = useRef(null);
  const idBase = useId();

  const habilitadas = options.filter((o) => !o.disabled);
  const actual = options.find((o) => o.value === value) || null;

  useEffect(() => {
    if (!open) return;
    function onClickFuera(e) {
      if (raizRef.current && !raizRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, [open]);

  function abrir() {
    if (disabled || options.length === 0) return;
    setActiveValue(actual?.value ?? habilitadas[0]?.value ?? null);
    setOpen(true);
  }
  function elegir(opt) {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    botonRef.current?.focus();
  }
  function moverResaltado(delta) {
    if (habilitadas.length === 0) return;
    const idxActual = habilitadas.findIndex((o) => o.value === activeValue);
    const siguiente = idxActual === -1
      ? (delta > 0 ? 0 : habilitadas.length - 1)
      : (idxActual + delta + habilitadas.length) % habilitadas.length;
    setActiveValue(habilitadas[siguiente].value);
  }

  function onKeyDown(e) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); abrir(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); moverResaltado(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moverResaltado(-1); }
    else if (e.key === "Home") { e.preventDefault(); if (habilitadas[0]) setActiveValue(habilitadas[0].value); }
    else if (e.key === "End") { e.preventDefault(); if (habilitadas.length) setActiveValue(habilitadas[habilitadas.length - 1].value); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(options.find((o) => o.value === activeValue)); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") { setOpen(false); }
  }

  return (
    <div className="flex flex-col gap-1" ref={raizRef}>
      {label && <label className="text-xs font-semibold text-gray-600" id={`${idBase}-label`}>{label}</label>}
      <div className="relative">
        <button
          type="button" ref={botonRef} disabled={disabled}
          className="w-full text-left border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-11 md:min-h-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
          role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${idBase}-listbox`}
          aria-activedescendant={open && activeValue != null ? `${idBase}-opt-${activeValue}` : undefined}
          aria-labelledby={label ? `${idBase}-label` : undefined}
          onClick={() => (open ? setOpen(false) : abrir())}
          onKeyDown={onKeyDown}
        >
          <span className={actual ? "text-gray-900" : "text-gray-400"}>{actual ? actual.label : placeholder}</span>
          <span className="text-gray-400 text-xs">▾</span>
        </button>
        {open && (
          <ul
            id={`${idBase}-listbox`} role="listbox" tabIndex={-1}
            aria-labelledby={label ? `${idBase}-label` : undefined}
            className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg py-1 text-sm"
          >
            {options.map((o) => {
              const resaltada = o.value === activeValue;
              return (
                <li
                  key={o.value} id={`${idBase}-opt-${o.value}`} role="option"
                  aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                  // min-h-11 md:min-h-0: mismo tamaño mínimo de touch target
                  // que ya usa el resto de la app en mobile (ver el botón
                  // disparador de acá arriba, o cualquier <Btn>) -- cada fila
                  // es su propio tap target real, no sólo texto.
                  className={
                    o.disabled
                      ? "px-3 py-2 min-h-11 md:min-h-0 flex flex-col justify-center gap-0.5 cursor-not-allowed select-none"
                      : `px-3 py-2 min-h-11 md:min-h-0 flex items-center cursor-pointer select-none ${resaltada ? "bg-blue-50 text-blue-900" : "text-gray-900"}`
                  }
                  onMouseEnter={() => !o.disabled && setActiveValue(o.value)}
                  onClick={() => elegir(o)}
                >
                  {o.disabled ? (
                    <>
                      {/* El motivo va en su propia línea, SIN el tachado --
                          tacharlo también lo vuelve difícil de leer, justo
                          lo que se busca explicar (bug real encontrado en
                          la primera versión, ver captura de verificación en
                          staging: el motivo entre paréntesis quedaba tachado
                          junto con el lote). */}
                      <span className="text-gray-400 line-through">{o.label}</span>
                      {o.disabledHint && <span className="text-xs text-amber-600">{o.disabledHint}</span>}
                    </>
                  ) : o.label}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
