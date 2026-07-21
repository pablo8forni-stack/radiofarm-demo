import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormProveedor } from "./FormProveedor.jsx";
import { proveedoresOrdenados } from "../../helpers/stock.js";
import { addProveedor, updateProveedor, deleteProveedor, setProveedorPrincipal } from "../../services/firestore/proveedores.js";

const VACIO = { nombre: "", cuit: "", direccion: "", contactoNombre: "", contactoEmail: "", contactoTelefono: "" };

export function TabProveedores({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [mEliminar, setMEliminar] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [eliminando, setEliminando] = useState(false);

  const proveedores = proveedoresOrdenados(catalogo);

  function abrirNuevo() { setForm(VACIO); setMNuevo(true); }
  function abrirEditar(p) { setForm({ nombre: p.nombre, cuit: p.cuit, direccion: p.direccion, contactoNombre: p.contactoNombre, contactoEmail: p.contactoEmail, contactoTelefono: p.contactoTelefono }); setMEditar(p); }

  async function agregar() {
    if (!form.nombre.trim()) return;
    try {
      await addProveedor({ ...form, nombre: form.nombre.trim() });
      onToast(`${form.nombre.trim()} agregado`);
      setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !form.nombre.trim()) return;
    try {
      await updateProveedor(mEditar.id, { ...form, nombre: form.nombre.trim() });
      onToast("Proveedor actualizado");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function marcarPrincipal(p) {
    try {
      const actual = proveedores.find((x) => x.principal);
      await setProveedorPrincipal(p.id, actual?.id);
      onToast(`${p.nombre} marcado como proveedor principal`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function confirmarEliminacion() {
    if (!mEliminar) return;
    if (proveedores.length <= 1) { onToast("No se puede eliminar: tiene que quedar al menos un proveedor cargado", "error"); return; }
    setEliminando(true);
    try {
      await deleteProveedor(mEliminar.id);
      onToast(`${mEliminar.nombre} eliminado`);
      setMEliminar(null);
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setEliminando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        Proveedores disponibles al registrar un ingreso. El principal aparece primero y preseleccionado en el formulario de ingreso.
      </div>

      <div className="flex justify-end">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo proveedor</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {proveedores.map((p, i) => {
          const datosBasicos = [p.cuit, p.direccion].filter(Boolean).join(" · ");
          const datosContacto = [p.contactoNombre, p.contactoEmail, p.contactoTelefono].filter(Boolean).join(" · ");
          return (
            <div key={p.id} className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 py-4 ${i < proveedores.length - 1 ? "border-b border-gray-50" : ""}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800">{p.nombre}</span>
                  {p.principal && <Badge color="blue">Principal</Badge>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{datosBasicos || "Sin CUIT ni dirección cargados"}</div>
                <div className="text-xs text-gray-400">{datosContacto || "Sin datos de contacto cargados"}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Btn size="sm" variant="ghost" onClick={() => abrirEditar(p)}>Editar</Btn>
                {!p.principal && <Btn size="sm" variant="ghost" onClick={() => marcarPrincipal(p)}>Marcar principal</Btn>}
                {proveedores.length > 1 && <Btn size="sm" variant="ghost" onClick={() => setMEliminar(p)}>Quitar</Btn>}
              </div>
            </div>
          );
        })}
        {proveedores.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin proveedores cargados todavía.</div>}
      </div>

      <Modal open={mNuevo} title="Nuevo proveedor" onClose={() => setMNuevo(false)} size="sm">
        <FormProveedor form={form} setForm={setForm} onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar" />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormProveedor form={form} setForm={setForm} onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios" />
      </Modal>

      <Modal open={!!mEliminar} title="Eliminar proveedor" onClose={() => setMEliminar(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            ¿Eliminar a <span className="font-bold">{mEliminar?.nombre}</span>? Se va a quitar de la lista de proveedores disponibles para futuros ingresos. No afecta ingresos ya registrados, que conservan el nombre del proveedor tal como estaba en ese momento.
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMEliminar(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={confirmarEliminacion} disabled={eliminando}>{eliminando ? "Eliminando..." : "Eliminar"}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
