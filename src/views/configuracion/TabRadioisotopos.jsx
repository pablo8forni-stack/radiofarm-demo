import { useState } from "react";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormRadioisotopo } from "./FormRadioisotopo.jsx";
import { addRadioisotopo, updateRadioisotopo, deleteRadioisotopo, sembrarRadioisotoposBase } from "../../services/firestore/radioisotopos.js";

const VACIO = { nombre: "" };

export function TabRadioisotopos({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [mEliminar, setMEliminar] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [eliminando, setEliminando] = useState(false);
  const [restaurando, setRestaurando] = useState(false);

  const isotopos = catalogo.radioisotopos || [];

  function abrirNuevo() { setForm(VACIO); setMNuevo(true); }
  function abrirEditar(iso) { setForm({ nombre: iso.nombre }); setMEditar(iso); }

  async function agregar() {
    if (!form.nombre.trim()) return;
    try {
      await addRadioisotopo({ nombre: form.nombre.trim() });
      onToast(`${form.nombre.trim()} agregado`);
      setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !form.nombre.trim()) return;
    try {
      await updateRadioisotopo(mEditar.id, { nombre: form.nombre.trim() });
      onToast("Isótopo actualizado");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function confirmarEliminacion() {
    if (!mEliminar) return;
    setEliminando(true);
    try {
      await deleteRadioisotopo(mEliminar.id);
      onToast(`${mEliminar.nombre} eliminado`);
      setMEliminar(null);
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setEliminando(false);
    }
  }

  // "+ Nuevo isótopo" siempre genera un id aleatorio -- nunca los 3 ids fijos
  // (tc99m/lu177/i131) que el código reconoce. Esta acción los crea/corrige
  // directo con esos ids, sin importar qué haya en la colección hoy --
  // segura de tocar varias veces, no duplica ni toca isótopos con otro id.
  async function restaurarBase() {
    setRestaurando(true);
    try {
      await sembrarRadioisotoposBase();
      onToast("Tc-99m, Lutecio-177 e I-131 restaurados con sus ids correctos");
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setRestaurando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        Nombres de isótopo disponibles en los selectores de la app (Libro 2, Gestión I-131). Agregar uno acá sólo lo hace aparecer en la lista -- cualquier comportamiento especial (campos propios, permisos) sigue necesitando cambios de código aparte.
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
        Tc-99m, Lutecio-177 e I-131 necesitan un id interno fijo (no el que genera "+ Nuevo isótopo") para que el selector de Libro 2/Gestión I-131 los reconozca. Si no aparecen ahí aunque estén en esta lista, usá "Restaurar isótopos base" -- es seguro tocarlo aunque ya existan, sólo corrige esos 3.
      </div>

      <div className="flex justify-end gap-2">
        <Btn size="sm" variant="outline" onClick={restaurarBase} disabled={restaurando}>{restaurando ? "Restaurando..." : "Restaurar isótopos base"}</Btn>
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo isótopo</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isotopos.map((iso, i) => (
          <div key={iso.id} className={`flex items-center justify-between gap-3 px-5 py-4 ${i < isotopos.length - 1 ? "border-b border-gray-50" : ""}`}>
            <div>
              <div className="font-semibold text-sm text-gray-800">{iso.nombre}</div>
              <div className="text-xs text-gray-400 font-mono mt-0.5">{iso.id}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => abrirEditar(iso)}>Editar</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setMEliminar(iso)}>Quitar</Btn>
            </div>
          </div>
        ))}
        {isotopos.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin isótopos cargados todavía.</div>}
      </div>

      <Modal open={mNuevo} title="Nuevo isótopo" onClose={() => setMNuevo(false)} size="sm">
        <FormRadioisotopo form={form} setForm={setForm} onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar" />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormRadioisotopo form={form} setForm={setForm} onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios" />
      </Modal>

      <Modal open={!!mEliminar} title="Eliminar isótopo" onClose={() => setMEliminar(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            ¿Eliminar <span className="font-bold">{mEliminar?.nombre}</span>? Deja de aparecer en los selectores. No afecta registros ya guardados, que conservan el isótopo tal como estaba en ese momento.
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
