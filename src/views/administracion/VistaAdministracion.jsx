import { useState } from "react";
import { Sel } from "../../components/ui/Sel.jsx";
import { TabPacientes } from "./TabPacientes.jsx";
import { TabMarcacion } from "./TabMarcacion.jsx";
import { TabElucion } from "./TabElucion.jsx";
import { TabLoteDosisUnica } from "../terapiaI131/TabLoteDosisUnica.jsx";

const TABS = [
  { id: "pacientes", label: "Libro 2 — Pacientes" },
  { id: "marcacion", label: "Libro 1 — Marcación" },
  { id: "elucion", label: "Libro 3 — Elución" },
  { id: "lutecio", label: "Libro 4 — Lutecio-177" },
];

export function VistaAdministracion({ catalogo, usuario, esAdmin, onToast }) {
  const [tab, setTab] = useState("pacientes");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Administración de dosis</h2>
        <p className="text-xs text-gray-400 mt-0.5">Registro equivalente a los Libros de Actas ARN</p>
      </div>
      {/* Mobile: dropdown en vez de la fila de pestañas -- mismo criterio que
          Configuración: con 4 pestañas la fila fija queda grande/apretada en
          un celular, sin ningún indicio de que había más contenido. */}
      <div className="md:hidden">
        <Sel value={tab} onChange={(e) => setTab(e.target.value)}>
          {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Sel>
      </div>
      <div className="hidden md:flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
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
      {tab === "lutecio" && (
        <TabLoteDosisUnica
          catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast}
          isotopoId="lutecio177" titulo="Lutecio-177" placeholderLote="Ej: LU177-2026-014"
          descripcion='Lutecio-177 (Teragnosis) -- cada lote es una dosis completa para un único paciente, se administra al llegar. La administración a un paciente se carga en Libro 2, eligiendo Lutecio-177 como isótopo.'
        />
      )}
    </div>
  );
}
