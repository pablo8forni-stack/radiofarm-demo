import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormFarm } from "./FormFarm.jsx";
import { totStock, todasLasSedes, proveedoresOrdenados } from "../../helpers/stock.js";
import { addFarm, updateFarm, deleteFarm } from "../../services/firestore/farms.js";
import { quitarFarmDeTodasLasSedes } from "../../services/firestore/sedes.js";

export function TabCatalogo({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [mEliminar, setMEliminar] = useState(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [kit, setKit] = useState(1);
  const [proveedorHabitualId, setProveedorHabitualId] = useState("");

  const proveedores = proveedoresOrdenados(catalogo);
  const nombreProveedor = (id) => proveedores.find((p) => p.id === id)?.nombre;

  async function agregar() {
    if (!nombre.trim()) return;
    try {
      await addFarm({ nombre: nombre.trim(), viales_x_kit: parseInt(kit) || 1, proveedorHabitualId });
      onToast(`${nombre.trim()} agregado al catálogo`);
      setNombre(""); setKit(1); setProveedorHabitualId(""); setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !nombre.trim()) return;
    try {
      await updateFarm(mEditar.id, { nombre: nombre.trim(), viales_x_kit: parseInt(kit) || 1, proveedorHabitualId });
      onToast("Radiofármaco actualizado");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function abrirEliminar(farm) {
    const conStock = todasLasSedes(catalogo).some((s) => totStock(catalogo.stock[s.id]?.[farm.id] || []) > 0);
    if (conStock) { onToast("No se puede eliminar: tiene stock en alguna sede", "error"); return; }
    setConfirmacion("");
    setMEliminar(farm);
  }

  async function confirmarEliminacion() {
    if (!mEliminar || confirmacion !== mEliminar.nombre) return;
    setEliminando(true);
    try {
      const sedes = todasLasSedes(catalogo);
      await quitarFarmDeTodasLasSedes(mEliminar.id, sedes.map((s) => s.id));
      await deleteFarm(mEliminar.id);
      onToast(`${mEliminar.nombre} eliminado del catálogo`);
      setMEliminar(null);
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setEliminando(false);
    }
  }

  function abrirEditar(f) { setMEditar(f); setNombre(f.nombre); setKit(f.viales_x_kit); setProveedorHabitualId(f.proveedorHabitualId || ""); }
  function abrirNuevo() { setNombre(""); setKit(1); setProveedorHabitualId(""); setMNuevo(true); }

  return (
    <>
      <div className="flex justify-end mb-1">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo radiofármaco</Btn>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Desktop: tabla de siempre. */}
        <table className="w-full text-sm hidden md:table">
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
              const sedesConFarm = todasLasSedes(catalogo).filter((s) => (s.farmIds || []).includes(f.id));
              return (
                <tr key={f.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-800 text-sm">{f.nombre}</div>
                    {f.proveedorHabitualId && <div className="text-xs text-gray-400 mt-0.5">Proveedor: {nombreProveedor(f.proveedorHabitualId) || "—"}</div>}
                  </td>
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
                      <Btn size="sm" variant="ghost" onClick={() => abrirEliminar(f)}>Quitar</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Mobile: tarjeta por radiofármaco en vez de columnas comprimidas. */}
        <div className="md:hidden divide-y divide-gray-50">
          {catalogo.farms.map((f) => {
            const sedesConFarm = todasLasSedes(catalogo).filter((s) => (s.farmIds || []).includes(f.id));
            return (
              <div key={f.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800 text-sm">{f.nombre}</span>
                  {f.viales_x_kit > 1 ? <Badge color="blue">Kit {f.viales_x_kit} viales</Badge> : <Badge color="gray">Por unidad</Badge>}
                </div>
                {f.proveedorHabitualId && <div className="text-xs text-gray-400 -mt-1">Proveedor: {nombreProveedor(f.proveedorHabitualId) || "—"}</div>}
                <div className="flex flex-wrap gap-1">
                  {sedesConFarm.length === 0 ? <Badge color="gray">Ninguna sede</Badge> : sedesConFarm.map((s) => <Badge key={s.id} color="teal">{s.short}</Badge>)}
                </div>
                <div className="flex gap-1.5 justify-end mt-1">
                  <Btn size="sm" variant="ghost" onClick={() => abrirEditar(f)}>Editar</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => abrirEliminar(f)}>Quitar</Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={mNuevo} title="Nuevo radiofármaco" onClose={() => setMNuevo(false)} size="sm">
        <FormFarm
          nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit}
          proveedorHabitualId={proveedorHabitualId} setProveedorHabitualId={setProveedorHabitualId} proveedores={proveedores}
          onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar"
        />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormFarm
          nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit}
          proveedorHabitualId={proveedorHabitualId} setProveedorHabitualId={setProveedorHabitualId} proveedores={proveedores}
          onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios"
        />
      </Modal>

      <Modal open={!!mEliminar} title="Eliminar radiofármaco" onClose={() => setMEliminar(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            Vas a eliminar <span className="font-bold">{mEliminar?.nombre}</span> del catálogo.{" "}
            {(() => {
              const sedesDelEliminar = mEliminar ? todasLasSedes(catalogo).filter((s) => (s.farmIds || []).includes(mEliminar.id)) : [];
              return sedesDelEliminar.length > 0
                ? `Está asignado actualmente en ${sedesDelEliminar.length} sede${sedesDelEliminar.length > 1 ? "s" : ""} (${sedesDelEliminar.map((s) => s.short).join(", ")}).`
                : "No está asignado a ninguna sede actualmente.";
            })()}
            {" "}Se va a quitar de esas sedes y del catálogo. No afecta el historial ni las actas ya registradas — solo impide que se vuelva a usar de ahora en adelante.
          </div>
          <Input label={`Escribí "${mEliminar?.nombre}" para confirmar`} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMEliminar(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={confirmarEliminacion} disabled={confirmacion !== mEliminar?.nombre || eliminando}>
              {eliminando ? "Eliminando..." : "Eliminar"}
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}
