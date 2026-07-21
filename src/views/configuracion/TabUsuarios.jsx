import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Sel } from "../../components/ui/Sel.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { todasLasSedes } from "../../helpers/stock.js";
import { setRol, eliminarRol, aprobarSolicitud, eliminarSolicitud } from "../../services/auth.js";

function formatFecha(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TabUsuarios({ catalogo, roles, solicitudes, usuarioActual, onToast }) {
  const sedes = todasLasSedes(catalogo);
  const sedeDefault = (sedes.find((s) => s.principal) || sedes.find((s) => s.activo) || sedes[0])?.id;
  const vacio = { email: "", nombre: "", rol: "tecnico", sede: sedeDefault };

  const [mForm, setMForm] = useState(null); // null | "nuevo" | "editar" | "aprobar"
  const [form, setForm] = useState(vacio);

  function abrirNuevo() { setForm(vacio); setMForm("nuevo"); }
  function abrirEditar(r) { setForm({ email: r.email, nombre: r.nombre, rol: r.rol, sede: r.sede }); setMForm("editar"); }
  function abrirAprobar(s) { setForm({ email: s.email, nombre: s.nombre, rol: "tecnico", sede: sedeDefault }); setMForm("aprobar"); }

  async function guardar() {
    if (!form.email.trim() || !form.nombre.trim()) return;
    try {
      if (mForm === "aprobar") {
        await aprobarSolicitud(form.email, { nombre: form.nombre.trim(), rol: form.rol, sede: form.sede });
        onToast(`Acceso otorgado a ${form.nombre.trim()}`);
      } else {
        await setRol(form.email, { nombre: form.nombre.trim(), rol: form.rol, sede: form.sede });
        onToast(mForm === "nuevo" ? "Usuario dado de alta" : "Usuario actualizado");
      }
      setMForm(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function eliminar(r) {
    if (r.email === usuarioActual.email) { onToast("No podés quitarte tu propio acceso.", "error"); return; }
    try {
      await eliminarRol(r.email);
      onToast(`Acceso de ${r.nombre} revocado`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function rechazar(s) {
    try {
      await eliminarSolicitud(s.email);
      onToast(`Solicitud de ${s.nombre} rechazada`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {solicitudes.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs font-bold text-amber-700 uppercase tracking-wide">
            Solicitudes pendientes
          </div>
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Fecha</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.email} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                  <td className="px-4 py-3 font-semibold text-gray-800 text-sm">{s.nombre || "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{s.email}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatFecha(s.fecha)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end">
                      <Btn size="sm" variant="ghost" onClick={() => abrirAprobar(s)}>Aprobar</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => rechazar(s)}>Rechazar</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="md:hidden divide-y divide-gray-50">
            {solicitudes.map((s) => (
              <div key={s.email} className="p-4 flex flex-col gap-1.5">
                <div className="font-semibold text-gray-800 text-sm">{s.nombre || "—"}</div>
                <div className="text-xs text-gray-500 font-mono">{s.email}</div>
                <div className="text-xs text-gray-500">{formatFecha(s.fecha)}</div>
                <div className="flex gap-1.5 justify-end mt-1">
                  <Btn size="sm" variant="ghost" onClick={() => abrirAprobar(s)}>Aprobar</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => rechazar(s)}>Rechazar</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        Dar de alta a alguien acá le otorga acceso a RadioFarm con su cuenta de Google (identificada por email) — no hace falta que haya iniciado sesión todavía.
      </div>
      <div className="flex justify-end">
        <Btn size="sm" onClick={abrirNuevo}>+ Nuevo usuario</Btn>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Nombre</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Email</th>
              <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Rol</th>
              <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Sede</th>
              <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.email} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                <td className="px-4 py-3 font-semibold text-gray-800 text-sm">{r.nombre}</td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{r.email}</td>
                <td className="px-4 py-3 text-center"><Badge color={r.rol === "admin" ? "purple" : "blue"}>{r.rol === "admin" ? "Responsable" : "Técnico"}</Badge></td>
                <td className="px-4 py-3 text-center text-xs text-gray-600">{catalogo.sedes[r.sede]?.short || r.sede}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => abrirEditar(r)}>Editar</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => eliminar(r)}>Quitar</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="md:hidden divide-y divide-gray-50">
          {roles.map((r) => (
            <div key={r.email} className="p-4 flex flex-col gap-2">
              <div>
                <div className="font-semibold text-gray-800 text-sm">{r.nombre}</div>
                <div className="text-xs text-gray-500 font-mono">{r.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={r.rol === "admin" ? "purple" : "blue"}>{r.rol === "admin" ? "Responsable" : "Técnico"}</Badge>
                <span className="text-xs text-gray-600">{catalogo.sedes[r.sede]?.short || r.sede}</span>
              </div>
              <div className="flex gap-1.5 justify-end mt-1">
                <Btn size="sm" variant="ghost" onClick={() => abrirEditar(r)}>Editar</Btn>
                <Btn size="sm" variant="ghost" onClick={() => eliminar(r)}>Quitar</Btn>
              </div>
            </div>
          ))}
        </div>
        {roles.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin usuarios dados de alta todavía.</div>}
      </div>

      <Modal open={!!mForm} title={mForm === "nuevo" ? "Nuevo usuario" : mForm === "aprobar" ? "Aprobar solicitud" : "Editar usuario"} onClose={() => setMForm(null)} size="sm">
        <div className="flex flex-col gap-4">
          <Input label="Email (cuenta de Google)" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="tecnica@fuesmen.com.ar" disabled={mForm === "editar" || mForm === "aprobar"} />
          <Input label="Nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Carlos T." />
          <Sel label="Rol" value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}>
            <option value="tecnico">Técnico</option>
            <option value="admin">Responsable (admin)</option>
          </Sel>
          <Sel label="Sede" value={form.sede} onChange={(e) => setForm((f) => ({ ...f, sede: e.target.value }))}>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </Sel>
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMForm(null)}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!form.email.trim() || !form.nombre.trim()}>Guardar</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
