import { useEffect, useState } from "react";
import { Sel } from "../../components/ui/Sel.jsx";
import { TabPacientes } from "./TabPacientes.jsx";
import { TabMarcacion } from "./TabMarcacion.jsx";
import { TabElucion } from "./TabElucion.jsx";
import { TabLoteDosisUnica } from "../terapiaI131/TabLoteDosisUnica.jsx";

const TABS = [
  { id: "marcacion", label: "Libro 1 — Marcación" },
  { id: "pacientes", label: "Libro 2 — Pacientes" },
  { id: "elucion", label: "Libro 3 — Elución" },
  { id: "lutecio", label: "Libro 4 — Lutecio-177" },
];

// navAdministracion ({tab, busqueda, token}) llega desde App.jsx -- mismo
// patrón que navConfiguracion. Lo dispara "Ir a Libro 2" desde el bloqueo de
// anulación de un lote de MIBG/Lutecio-177 (TabLoteDosisUnica.jsx), tanto
// desde acá mismo (pestaña Lutecio-177) como desde Gestión I-131 (MIBG) --
// por eso onIrAAdministracion se reenvía también hacia abajo, para que
// Lutecio-177 pueda pedir el mismo salto sin salir de esta vista.
export function VistaAdministracion({ catalogo, usuario, esAdmin, onToast, navAdministracion, onIrAAdministracion }) {
  const [tab, setTab] = useState("pacientes");

  useEffect(() => {
    if (navAdministracion?.tab) setTab(navAdministracion.tab);
  }, [navAdministracion]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Actas ARN</h2>
        <p className="text-sm text-gray-400 mt-0.5">Registro regulatorio para la Autoridad Regulatoria Nuclear</p>
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
      {tab === "pacientes" && <TabPacientes catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} nav={navAdministracion} />}
      {tab === "marcacion" && <TabMarcacion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "elucion" && <TabElucion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "lutecio" && (
        <TabLoteDosisUnica
          catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast}
          isotopoId="lutecio177" titulo="Lutecio-177" placeholderLote="Ej: LU177-2026-014"
          descripcion='Lutecio-177 (Teragnosis) -- cada lote es una dosis completa para un único paciente, se administra al llegar. La administración a un paciente se carga en Libro 2, eligiendo Lutecio-177 como isótopo.'
          onIrALibro2={onIrAAdministracion}
        />
      )}
    </div>
  );
}
