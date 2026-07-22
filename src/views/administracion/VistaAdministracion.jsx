import { useState } from "react";
import { TabPacientes } from "./TabPacientes.jsx";
import { TabMarcacion } from "./TabMarcacion.jsx";
import { TabElucion } from "./TabElucion.jsx";

const TABS = [
  { id: "pacientes", label: "Libro 2 — Pacientes" },
  { id: "marcacion", label: "Libro 1 — Marcación" },
  { id: "elucion", label: "Libro 3 — Elución" },
];

export function VistaAdministracion({ catalogo, usuario, esAdmin, onToast }) {
  const [tab, setTab] = useState("pacientes");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Administración de dosis</h2>
        <p className="text-xs text-gray-400 mt-0.5">Registro equivalente a los Libros de Actas ARN</p>
      </div>
      {/* overflow-x-auto: con 3 pestañas ("Libro 3 — Elución" sumado a las
          otras dos) el ancho fijo podía desbordar la pantalla en mobile sin
          ningún indicio de que había más contenido -- mismo criterio que ya
          aplicamos en Configuración. */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto max-w-full">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition whitespace-nowrap ${tab === t.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "pacientes" && <TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "marcacion" && <TabMarcacion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "elucion" && <TabElucion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
    </div>
  );
}
