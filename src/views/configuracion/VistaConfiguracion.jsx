import { useEffect, useState } from "react";
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

export function VistaConfiguracion({ catalogo, usuario, onToast }) {
  const [tab, setTab] = useState("catalogo");
  const [roles, setRoles] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);

  useEffect(() => listenRoles(setRoles), []);
  useEffect(() => listenSolicitudes(setSolicitudes), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Configuración</h2>
        <p className="text-xs text-gray-400 mt-0.5">Catálogo de radiofármacos, sedes, usuarios y backup</p>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap ${tab === t.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "catalogo" && <TabCatalogo catalogo={catalogo} onToast={onToast} />}
      {tab === "proveedores" && <TabProveedores catalogo={catalogo} onToast={onToast} />}
      {tab === "sedes" && <TabSedes catalogo={catalogo} onToast={onToast} />}
      {tab === "activas" && <TabSedesActivas catalogo={catalogo} roles={roles} onToast={onToast} />}
      {tab === "usuarios" && <TabUsuarios catalogo={catalogo} roles={roles} solicitudes={solicitudes} usuarioActual={usuario} onToast={onToast} />}
      {tab === "backup" && <TabBackup catalogo={catalogo} onToast={onToast} />}
    </div>
  );
}
