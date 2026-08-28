// Encabezado compartido por los 4 libros impresos -- mismo logo oficial que
// header/login (ver App.jsx/PantallaLogin.jsx, /icon-192.png), título del
// libro, sede y mes/año del archivo, y la fecha real en que se generó el
// documento (para que quede claro en el papel cuándo se sacó, distinto del
// mes que cubre).
export function EncabezadoImpresion({ titulo, sedeNombre, mesTexto }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3 mb-4">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="RadioFarm" className="w-12 h-12 rounded-lg" />
        <div>
          <h1 className="text-lg font-bold">{titulo}</h1>
          <p className="text-sm">FUESMEN · Sistema de Radiofármacos</p>
        </div>
      </div>
      <div className="text-right text-sm">
        <p><span className="font-semibold">Sede:</span> {sedeNombre}</p>
        <p><span className="font-semibold">Período:</span> {mesTexto}</p>
        <p className="text-xs text-gray-500">Generado el {new Date().toLocaleDateString("es-AR")} a las {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </div>
  );
}
