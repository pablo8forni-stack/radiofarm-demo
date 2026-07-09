import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormFarm } from "./FormFarm.jsx";
import { SEDES } from "../../constants/sedes.js";
import { totStock } from "../../helpers/stock.js";
import { addFarm, updateFarm, deleteFarm } from "../../services/firestore/farms.js";
import { quitarFarmDeTodasLasSedes } from "../../services/firestore/sedes.js";

export function TabCatalogo({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [nombre, setNombre] = useState("");
  const [kit, setKit] = useState(1);

  async function agregar() {
    if (!nombre.trim()) return;
    try {
      await addFarm({ nombre: nombre.trim(), viales_x_kit: parseInt(kit) || 1 });
      onToast(`${nombre.trim()} agregado al catálogo`);
      setNombre(""); setKit(1); setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !nombre.trim()) return;
    try {
      await updateFarm(mEditar.id, { nombre: nombre.trim(), viales_x_kit: parseInt(kit) || 1 });
      onToast("Radiofármaco actualizado");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function eliminar(farm) {
    const conStock = SEDES.some((s) => totStock(catalogo.stock[s.id]?.[farm.id] || []) > 0);
    if (conStock) { onToast("No se puede eliminar: tiene stock en alguna sede", "error"); return; }
    try {
      await quitarFarmDeTodasLasSedes(farm.id);
      await deleteFarm(farm.id);
      onToast(`${farm.nombre} eliminado del catálogo`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function abrirEditar(f) { setMEditar(f); setNombre(f.nombre); setKit(f.viales_x_kit); }
  function abrirNuevo() { setNombre(""); setKit(1); setMNuevo(true); }

  return (
    <>
      <div className="flex justify-end mb-1">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo radiofármaco</Btn>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Nombre</th>
              <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Presentación</th>
              <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Sedes activas</th>
              <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {catalogo.farms.map((f) => {
              const sedesConFarm = SEDES.filter((s) => (catalogo.sedes[s.id]?.farmIds || []).includes(f.id));
              return (
                <tr key={f.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                  <td className="px-4 py-3 font-semibold text-gray-800 text-sm">{f.nombre}</td>
                  <td className="px-4 py-3 text-center">
                    {f.viales_x_kit > 1 ? <Badge color="blue">Kit {f.viales_x_kit} viales</Badge> : <Badge color="gray">Por unidad</Badge>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {sedesConFarm.length === 0 ? <Badge color="gray">Ninguna</Badge> : sedesConFarm.map((s) => <Badge key={s.id} color="teal">{s.short}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end">
                      <Btn size="sm" variant="ghost" onClick={() => abrirEditar(f)}>Editar</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => eliminar(f)}>Quitar</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={mNuevo} title="Nuevo radiofármaco" onClose={() => setMNuevo(false)} size="sm">
        <FormFarm nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit} onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar" />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormFarm nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit} onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios" />
      </Modal>
    </>
  );
}
