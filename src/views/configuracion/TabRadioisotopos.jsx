import { useState } from "react";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { FormRadioisotopo } from "./FormRadioisotopo.jsx";
import { addRadioisotopo, updateRadioisotopo } from "../../services/firestore/radioisotopos.js";

const VACIO = { nombre: "" };

export function TabRadioisotopos({ catalogo, onToast }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [form, setForm] = useState(VACIO);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        Nombres de isótopo disponibles en los selectores de la app (Libro 2, Terapia I-131). Agregar uno acá sólo lo hace aparecer en la lista -- cualquier comportamiento especial (campos propios, permisos) sigue necesitando cambios de código aparte.
      </div>

      <div className="flex justify-end">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo isótopo</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isotopos.map((iso, i) => (
          <div key={iso.id} className={`flex items-center justify-between gap-3 px-5 py-4 ${i < isotopos.length - 1 ? "border-b border-gray-50" : ""}`}>
            <div>
              <div className="font-semibold text-sm text-gray-800">{iso.nombre}</div>
              <div className="text-xs text-gray-400 font-mono mt-0.5">{iso.id}</div>
            </div>
            <Btn size="sm" variant="ghost" onClick={() => abrirEditar(iso)}>Editar</Btn>
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
    </div>
  );
}
