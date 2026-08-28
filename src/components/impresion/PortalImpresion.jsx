import { createPortal } from "react-dom";

// Portal genérico para impresión nativa (window.print() + @media print, ver
// index.css) -- se monta como hermano directo de #root en document.body.
// En pantalla queda invisible; al imprimir, sólo se ve esto (el resto de la
// app se oculta). Reusado por los 4 libros -- cuál libro se imprime depende
// de qué se monte adentro en cada momento, no de este componente.
export function PortalImpresion({ children }) {
  return createPortal(<div className="portal-impresion">{children}</div>, document.body);
}
