// Espacio de firma al pie de cada documento impreso -- diseño confirmado:
// línea para firmar + fecha, nombre del responsable pre-completado (quien
// generó el documento; se puede tachar/corregir a mano en papel si firma
// otra persona). .impresion-firma (ver index.css): break-inside:avoid, para
// que este bloque nunca quede partido entre dos páginas.
export function BloqueFirma({ nombreResponsable }) {
  return (
    <div className="impresion-firma mt-10 pt-6 flex items-end justify-between gap-8">
      <div className="flex-1">
        <div className="border-t border-black w-64 pt-1 text-xs">
          Firma y aclaración del responsable
        </div>
        <p className="text-sm mt-1">{nombreResponsable}</p>
      </div>
      <div className="text-sm">
        Fecha: ____ / ____ / ______
      </div>
    </div>
  );
}
