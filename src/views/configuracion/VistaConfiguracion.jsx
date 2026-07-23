import { useEffect, useState } from "react";
import { Sel } from "../../components/ui/Sel.jsx";
import { TabCatalogo } from "./TabCatalogo.jsx";
import { TabProveedores } from "./TabProveedores.jsx";
import { TabSedes } from "./TabSedes.jsx";
import { TabSedesActivas } from "./TabSedesActivas.jsx";
import { TabUsuarios } from "./TabUsuarios.jsx";
import { TabBackup } from "./TabBackup.jsx";
import { listenRoles, listenSolicitudes } from "../../services/auth.js";

const TABS = [
  { id: "catalogo", label: "Catálogo" },
  { id: "proveedores", label: "Proveedores" },
  { id: "sedes", label: "Asignación por sede" },
  { id: "activas", label: "Sedes activas" },
  { id: "usuarios", label: "Usuarios" },
  { id: "backup", label: "Backup" },
];

// navConfiguracion ({tab, token}) llega desde App.jsx cuando otra pantalla
// (el chip "N solicitudes" o el click en la notificación del sistema) pide
// mostrar una pestaña puntual acá -- mismo patrón que navInventario en
// VistaInventario. El token cambia en cada pedido aunque tab se repita, para
// que el efecto dispare siempre aunque ya estuvieras en esa misma pestaña.
export function VistaConfiguracion({ catalogo, usuario, onToast, onIrAInventario, navConfiguracion }) {
  const [tab, setTab] = useState("catalogo");
  const [roles, setRoles] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);

  useEffect(() => listenRoles(setRoles), []);
  useEffect(() => listenSolicitudes(setSolicitudes), []);
  useEffect(() => {
    if (navConfiguracion?.tab) setTab(navConfiguracion.tab);
  }, [navConfiguracion]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Configuración</h2>
        <p className="text-xs text-gray-400 mt-0.5">Catálogo de radiofármacos, sedes, usuarios y backup</p>
      </div>
      {/* Mobile: dropdown en vez de la fila de pestañas -- con 6 secciones,
          el scroll horizontal silencioso cortaba Usuarios/Backup sin ningún
          indicio visual de que había más a la derecha. */}
      <div className="md:hidden">
        <Sel value={tab} onChange={(e) => setTab(e.target.value)}>
          {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Sel>
      </div>
      <div className="hidden md:flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition whitespace-nowrap ${tab === t.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "catalogo" && <TabCatalogo catalogo={catalogo} onToast={onToast} />}
      {tab === "proveedores" && <TabProveedores catalogo={catalogo} onToast={onToast} />}
      {tab === "sedes" && <TabSedes catalogo={catalogo} onToast={onToast} />}
      {tab === "activas" && <TabSedesActivas catalogo={catalogo} roles={roles} onToast={onToast} onIrAInventario={onIrAInventario} />}
      {tab === "usuarios" && <TabUsuarios catalogo={catalogo} roles={roles} solicitudes={solicitudes} usuarioActual={usuario} onToast={onToast} />}
      {tab === "backup" && <TabBackup catalogo={catalogo} usuario={usuario} onToast={onToast} />}
    </div>
  );
}
