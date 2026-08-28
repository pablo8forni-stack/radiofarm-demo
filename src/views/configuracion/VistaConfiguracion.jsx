import { useEffect, useState } from "react";
import { Sel } from "../../components/ui/Sel.jsx";
import { TabCatalogo } from "./TabCatalogo.jsx";
import { TabProveedores } from "./TabProveedores.jsx";
import { TabRadioisotopos } from "./TabRadioisotopos.jsx";
import { TabEstudios } from "./TabEstudios.jsx";
import { TabSedes } from "./TabSedes.jsx";
import { TabSedesActivas } from "./TabSedesActivas.jsx";
import { TabUsuarios } from "./TabUsuarios.jsx";
import { TabBackup } from "./TabBackup.jsx";
import { listenRoles, listenSolicitudes, setSedeAuditando } from "../../services/auth.js";
import { sedesActivas } from "../../helpers/stock.js";
import { GenerarActasImpresion } from "../../components/impresion/GenerarActasImpresion.jsx";

const TABS = [
  { id: "catalogo", label: "Catálogo" },
  { id: "proveedores", label: "Proveedores" },
  { id: "isotopos", label: "Isótopos" },
  { id: "estudios", label: "Estudios" },
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
export function VistaConfiguracion({ catalogo, usuario, refrescarUsuario, onToast, onIrAInventario, navConfiguracion }) {
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
      <SelectorSedeAuditando catalogo={catalogo} usuario={usuario} refrescarUsuario={refrescarUsuario} onToast={onToast} />
      <GenerarActasImpresion catalogo={catalogo} usuario={usuario} onToast={onToast} />
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
      {tab === "isotopos" && <TabRadioisotopos catalogo={catalogo} onToast={onToast} />}
      {tab === "estudios" && <TabEstudios catalogo={catalogo} onToast={onToast} />}
      {tab === "sedes" && <TabSedes catalogo={catalogo} onToast={onToast} />}
      {tab === "activas" && <TabSedesActivas catalogo={catalogo} roles={roles} onToast={onToast} onIrAInventario={onIrAInventario} />}
      {tab === "usuarios" && <TabUsuarios catalogo={catalogo} roles={roles} solicitudes={solicitudes} usuarioActual={usuario} onToast={onToast} />}
      {tab === "backup" && <TabBackup catalogo={catalogo} usuario={usuario} onToast={onToast} />}
    </div>
  );
}

// Sede que este admin está auditando ahora mismo -- controla qué sede
// muestran los 4 Libros de actas + Gestión I-131 (nunca varias mezcladas,
// ni siquiera para admin -- ver firestore.rules, roles/{email}). Es la
// ÚNICA forma de cambiar de sede en esas pantallas -- ya no tienen su
// propio selector "Todas las sedes". Escritura angosta: la regla de
// Firestore sólo permite tocar este campo del propio doc, nada más.
function SelectorSedeAuditando({ catalogo, usuario, refrescarUsuario, onToast }) {
  const [guardando, setGuardando] = useState(false);
  const sedes = sedesActivas(catalogo);

  async function cambiar(sedeId) {
    if (!sedeId || sedeId === usuario.sedeAuditando) return;
    setGuardando(true);
    try {
      await setSedeAuditando(usuario.email, sedeId);
      await refrescarUsuario();
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex-1">
        <p className="text-xs font-bold text-amber-800">Sede que estás auditando</p>
        <p className="text-xs text-amber-700/80 mt-0.5">
          Los Libros de actas (Pacientes, Marcación, Elución, Lutecio-177) y Gestión I-131 sólo muestran esta sede -- nunca varias mezcladas.
        </p>
      </div>
      <div className="sm:w-48">
        <Sel value={usuario.sedeAuditando || ""} onChange={(e) => cambiar(e.target.value)} disabled={guardando}>
          <option value="" disabled>Elegí una sede</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>
      </div>
    </div>
  );
}
