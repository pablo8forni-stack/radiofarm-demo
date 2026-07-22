import { useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { idsSedesActivas, todasLasSedes, sedesArchivadas, farmsDeSede, totStock } from "../../helpers/stock.js";
import { toggleSedeActiva, addSede, updateSede, archivarSede, desarchivarSede, toggleSedeEluye } from "../../services/firestore/sedes.js";

export function TabSedesActivas({ catalogo, roles, onToast, onIrAInventario }) {
  const [mNuevo, setMNuevo] = useState(false);
  const [mEditar, setMEditar] = useState(null);
  const [mStockPendiente, setMStockPendiente] = useState(null);
  const [nombre, setNombre] = useState("");
  const [short, setShort] = useState("");
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);

  const activas = idsSedesActivas(catalogo);
  const sedes = todasLasSedes(catalogo);
  const archivadas = sedesArchivadas(catalogo);

  async function toggle(sede) {
    if (sede.principal) return;
    const activa = activas.includes(sede.id);
    try {
      await toggleSedeActiva(sede.id, !activa, sede.principal);
      onToast(activa ? `${sede.short} desactivada — oculta en toda la app` : `${sede.short} activada`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function abrirNuevo() { setNombre(""); setShort(""); setMNuevo(true); }
  function abrirEditar(s) { setMEditar(s); setNombre(s.nombre); setShort(s.short); }

  async function agregar() {
    if (!nombre.trim()) return;
    try {
      await addSede({ nombre: nombre.trim(), short: short.trim() });
      onToast(`${nombre.trim()} agregada — activala cuando esté lista para operar`);
      setMNuevo(false);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarEdicion() {
    if (!mEditar || !nombre.trim()) return;
    try {
      await updateSede(mEditar.id, { nombre: nombre.trim(), short: short.trim() });
      onToast("Sede actualizada");
      setMEditar(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function archivar(sede) {
    if (sede.principal) { onToast("No se puede archivar la sede principal", "error"); return; }
    const conStock = (sede.farmIds || []).some((fid) => totStock(catalogo.stock[sede.id]?.[fid] || []) > 0);
    if (conStock) { setMStockPendiente(sede); return; }
    try {
      await archivarSede(sede.id);
      onToast(`${sede.short} archivada`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function irAInventarioDeSede() {
    onIrAInventario(mStockPendiente.id);
    setMStockPendiente(null);
  }

  const farmsConStockPendiente = mStockPendiente
    ? farmsDeSede(catalogo, mStockPendiente.id)
        .map((f) => ({ ...f, stock: totStock(catalogo.stock[mStockPendiente.id]?.[f.id] || []) }))
        .filter((f) => f.stock > 0)
    : [];

  async function toggleEluye(sede) {
    try {
      await toggleSedeEluye(sede.id, !sede.eluye);
      onToast(sede.eluye ? `Elución desactivada para ${sede.short}` : `Elución activada para ${sede.short}`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function reactivar(sede) {
    try {
      await desarchivarSede(sede.id);
      onToast(`${sede.short} reactivada`);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        <span className="font-semibold">Modo piloto:</span> desactivá las sedes que aún no operan con la app. Las sedes desactivadas desaparecen del inventario, pedidos, historial y actas, pero <span className="font-semibold">sus datos se conservan intactos</span> y reaparecen al reactivarlas. La sede principal no se puede desactivar.
        <br />
        <span className="font-semibold">El interruptor es una pausa temporal y reversible.</span> Archivar es distinto — es una baja más definitiva que exige stock en cero — no lo uses para pausar una sede.
      </div>

      <div className="flex justify-end">
        <Btn size="sm" onClick={abrirNuevo}>+ Nueva sede</Btn>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {sedes.map((s, i) => {
          const activa = activas.includes(s.id);
          const usuariosSede = roles.filter((r) => r.sede === s.id && r.rol !== "admin").length;
          return (
            <div key={s.id} className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 py-4 ${i < sedes.length - 1 ? "border-b border-gray-50" : ""} ${!activa ? "bg-gray-50/50" : ""}`}>
              <div>
                <div className={`font-semibold text-sm ${activa ? "text-gray-800" : "text-gray-400"}`}>{s.nombre}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {s.principal ? "Sede principal — siempre activa" : activa ? `Operativa · ${usuariosSede} técnico${usuariosSede !== 1 ? "s" : ""} asignado${usuariosSede !== 1 ? "s" : ""}` : "Desactivada — datos conservados"}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Btn size="sm" variant="ghost" onClick={() => abrirEditar(s)}>Editar</Btn>
                {!s.principal && (
                  <Btn size="sm" variant="warning" onClick={() => archivar(s)} title="Baja de la sede — requiere stock en cero, no es lo mismo que desactivar">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-7 4h0" />
                      </svg>
                      Archivar
                    </span>
                  </Btn>
                )}
                <div className="flex items-center gap-1.5" title="Habilita el Libro 3 — Elución (Mo-99/Tc-99m) para esta sede">
                  <span className="text-xs text-gray-500">Elución</span>
                  <button onClick={() => toggleEluye(s)} className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${s.eluye ? "bg-purple-600" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.eluye ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                {s.principal ? (
                  <Badge color="blue">Siempre activa</Badge>
                ) : (
                  <button onClick={() => toggle(s)} title="Pausa temporal — oculta la sede sin perder datos, se puede reactivar en cualquier momento"
                    className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${activa ? "bg-blue-600" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${activa ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {sedes.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin sedes cargadas todavía.</div>}
      </div>

      {archivadas.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button onClick={() => setMostrarArchivadas((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide hover:bg-gray-50/60 transition">
            <span>Sedes archivadas ({archivadas.length})</span>
            <svg className={`w-4 h-4 transition-transform ${mostrarArchivadas ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {mostrarArchivadas && archivadas.map((s, i) => (
            <div key={s.id} className={`flex items-center justify-between px-5 py-3.5 ${i < archivadas.length - 1 ? "border-b border-gray-50" : ""} border-t border-gray-50`}>
              <div className="font-semibold text-sm text-gray-400">{s.nombre}</div>
              <Btn size="sm" variant="ghost" onClick={() => reactivar(s)}>Reactivar</Btn>
            </div>
          ))}
        </div>
      )}

      <Modal open={mNuevo} title="Nueva sede" onClose={() => setMNuevo(false)} size="sm">
        <FormSede nombre={nombre} setNombre={setNombre} short={short} setShort={setShort} onConfirm={agregar} onCancel={() => setMNuevo(false)} confirmLabel="Agregar" />
      </Modal>

      <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={() => setMEditar(null)} size="sm">
        <FormSede nombre={nombre} setNombre={setNombre} short={short} setShort={setShort} onConfirm={guardarEdicion} onCancel={() => setMEditar(null)} confirmLabel="Guardar cambios" />
      </Modal>

      <Modal open={!!mStockPendiente} title="No se puede archivar — stock pendiente" onClose={() => setMStockPendiente(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            <span className="font-bold">{mStockPendiente?.nombre}</span> todavía tiene stock activo en {farmsConStockPendiente.length} radiofármaco{farmsConStockPendiente.length !== 1 ? "s" : ""}. Antes de archivar la sede hay que dejar el stock en cero: transferí esos viales a otra sede activa (botón ⇄ Transf.) o registrá su egreso correspondiente.
          </div>
          <div className="flex flex-col gap-1.5">
            {farmsConStockPendiente.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl text-sm">
                <span className="text-gray-700">{f.nombre}</span>
                <span className="font-bold text-gray-800">{f.stock} vial{f.stock !== 1 ? "es" : ""}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setMStockPendiente(null)}>Entendido</Btn>
            <Btn variant="teal" onClick={irAInventarioDeSede}>Ir a Inventario de {mStockPendiente?.short}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FormSede({ nombre, setNombre, short, setShort, onConfirm, onCancel, confirmLabel }) {
  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: C. Gamma Hospital Central" />
      <Input label="Nombre corto (para tabs y tablas)" value={short} onChange={(e) => setShort(e.target.value)} placeholder="Ej: H. Central" hint="Si lo dejás vacío, se usa el nombre completo." />
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
        <Btn onClick={onConfirm} disabled={!nombre.trim()}>{confirmLabel}</Btn>
      </div>
    </div>
  );
}
