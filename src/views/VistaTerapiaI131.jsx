import { useState } from "react";
import { Sel } from "../components/ui/Sel.jsx";
import { TabRegistrosI131 } from "./terapiaI131/TabRegistrosI131.jsx";
import { TabStockViales } from "./terapiaI131/TabStockViales.jsx";
import { TabResultadosCaptacion } from "./terapiaI131/TabResultadosCaptacion.jsx";
import { TabAgendaI131 } from "./terapiaI131/TabAgendaI131.jsx";
import { TabLoteDosisUnica } from "./terapiaI131/TabLoteDosisUnica.jsx";

// "Stock de viales" (Parte A) y "Resultados %Captación" (Parte B) del
// espacio de cálculo I-131 quedan gateados completo por accesoTerapiaI131 --
// a diferencia de "Registros", que cualquier técnico de la sede puede
// consultar, acá ni la lectura queda abierta: es inventario de material
// controlado / resultados derivados de él, no un registro de atención
// puntual. Mismo respaldo server-side en firestore.rules (esTipoStockI131).
// "Agenda de turnos" (Parte C) usa un permiso DISTINTO y separado
// (accesoAgendaI131) -- pensado para poder dárselo a personal
// administrativo sin exponer los cálculos clínicos de las otras dos.
// "MIBG" (131I-MIBG) va SIN gate, como "Registros" -- abierto a cualquier
// técnico, igual que Barrido corporal (ver TabLoteDosisUnica.jsx/
// firestore.rules). Comparte componente con Libro 4 -- Lutecio-177 (Actas
// ARN, VistaAdministracion.jsx), parametrizado por isotopoId; nunca se
// mezclan en la navegación aunque compartan modelo de datos.
export function VistaTerapiaI131({ catalogo, usuario, esAdmin, onToast, onIrAAdministracion }) {
  const puedeVerStock = esAdmin || !!usuario.accesoTerapiaI131;
  const puedeVerAgenda = esAdmin || !!usuario.accesoAgendaI131;
  const TABS = [
    { id: "registros", label: "Registros" },
    ...(puedeVerStock ? [{ id: "stock", label: "Stock de viales" }, { id: "captacion", label: "Resultados %Captación" }] : []),
    { id: "mibg", label: "MIBG" },
    ...(puedeVerAgenda ? [{ id: "agenda", label: "Agenda de turnos" }] : []),
  ];
  const [tab, setTab] = useState("registros");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Gestión I-131</h2>
        <p className="text-xs text-gray-400 mt-0.5">Registros de dosis/estudios y stock de viales con cálculo de decaimiento</p>
      </div>

      {TABS.length > 1 && (
        <>
          <div className="md:hidden">
            <Sel value={tab} onChange={(e) => setTab(e.target.value)}>
              {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Sel>
          </div>
          <div className="hidden md:flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 min-h-11 md:min-h-0 text-xs font-semibold rounded-lg transition ${tab === t.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "registros" && <TabRegistrosI131 catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "stock" && puedeVerStock && <TabStockViales catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "captacion" && puedeVerStock && <TabResultadosCaptacion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
      {tab === "mibg" && (
        <TabLoteDosisUnica
          catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast}
          isotopoId="mibg" titulo="MIBG" placeholderLote="Ej: MIBG-2026-014" placeholderActividad="2,5"
          descripcion={'131I-MIBG (neuroblastoma/feocromocitoma/paraganglioma) -- cada lote es una dosis completa para un único paciente, se administra al llegar. Sin curva de decaimiento ni balance de volumen: para eso está "Stock de viales", que es otro material. La administración a un paciente se carga en Libro 2, eligiendo "MIBG" como tipo de registro.'}
          onIrALibro2={onIrAAdministracion}
        />
      )}
      {tab === "agenda" && puedeVerAgenda && <TabAgendaI131 catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={onToast} />}
    </div>
  );
}
