// Marcado de actas anuladas en los documentos impresos -- confirmado que NO
// puede depender de un matiz de gris (muchas impresoras de oficina imprimen
// sólo blanco y negro): negrita + tachado + un borde izquierdo sólido son
// las tres señales, todas en tinta pura, ninguna depende de escala de
// grises. El fondo gris clarito queda sólo como refuerzo en pantalla/color
// (print:bg-transparent lo saca al imprimir, no gasta tóner de más).
export const claseFilaAnulada = (anulada) => (anulada ? "bg-gray-50 print:bg-transparent border-l-4 border-black" : "");
export const claseCampoAnulado = (anulada) => (anulada ? "line-through" : "");

export function LeyendaAnulado({ motivo }) {
  return <div className="font-bold uppercase text-[10px] tracking-wide">Anulado — {motivo}</div>;
}
