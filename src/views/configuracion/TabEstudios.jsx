import { useState } from "react";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormEstudio } from "./FormEstudio.jsx";
import { addEstudio, updateEstudio, deleteEstudio } from "../../services/firestore/estudios.js";

const VACIO = { nombre: "" };

export function TabEstudios({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [mEliminar, setMEliminar] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [eliminando, setEliminando] = useState(false);

  const estudios = catalogo.estudios || [];

  function abrirNuevo() { setForm(VACIO); setMNuevo(true); }
  function abrirEditar(es) { setForm({ nombre: es.nombre }); setMEditar(es); }

  async function agregar() {
    if (!form.nombre.trim()) return;
    try {
      await addEstudio({ nombre: form.nombre.trim() });
      onToast(`${form.nombre.trim()} agregado`);
      setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !form.nombre.trim()) return;
    try {
      await updateEstudio(mEditar.id, { nombre: form.nombre.trim() });
      onToast("Estudio actualizado");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function confirmarEliminacion() {
    if (!mEliminar) return;
    setEliminando(true);
    try {
      await deleteEstudio(mEliminar.id);
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
        Estudios disponibles en el selector de Libro 2 (Pacientes). "Otro" siempre queda disponible ahí como última opción, con texto libre -- no hace falta cargarlo acá.
      </div>

      <div className="flex justify-end">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo estudio</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {estudios.map((es, i) => (
          <div key={es.id} className={`flex items-center justify-between gap-3 px-5 py-4 ${i < estudios.length - 1 ? "border-b border-gray-50" : ""}`}>
            <span className="font-semibold text-sm text-gray-800">{es.nombre}</span>
            <div className="flex items-center gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => abrirEditar(es)}>Editar</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setMEliminar(es)}>Quitar</Btn>
            </div>
          </div>
        ))}
        {estudios.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin estudios cargados todavía.</div>}
      </div>

      <Modal open={mNuevo} title="Nuevo estudio" onClose={() => setMNuevo(false)} size="sm">
        <FormEstudio form={form} setForm={setForm} onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar" />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormEstudio form={form} setForm={setForm} onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios" />
      </Modal>

      <Modal open={!!mEliminar} title="Eliminar estudio" onClose={() => setMEliminar(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            ¿Eliminar <span className="font-bold">{mEliminar?.nombre}</span>? Deja de aparecer en el selector de Libro 2. No afecta registros ya guardados, que conservan el nombre del estudio tal como estaba en ese momento.
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
