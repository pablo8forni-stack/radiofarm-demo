import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ModalEgreso } from "../../components/movimientos/ModalEgreso.jsx";
import { ModalIngreso } from "../../components/movimientos/ModalIngreso.jsx";
import { ModalTransferencia } from "../../components/movimientos/ModalTransferencia.jsx";
import { BarraCarritoIngresos, CarritoIngresos } from "../../components/movimientos/CarritoIngresos.jsx";
import { ReordenForm } from "../../components/movimientos/ReordenForm.jsx";
import { fmtF, diasV } from "../../helpers/formato.js";
import { totStock, proxVenc, farmsDeSede, puntoReorden, proveedoresOrdenados } from "../../helpers/stock.js";
import { egresoTransaction, ingresoBatch, transferenciaTransaction } from "../../services/firestore/stock.js";
import { setPuntoReorden } from "../../services/firestore/sedes.js";
import { uid } from "../../helpers/id.js";

export function TablaInventario({ sedeId, catalogo, usuario, esAdmin, onToast }) {
  const [mEgreso, setMEgreso] = useState(null);
  const [mIngreso, setMIngreso] = useState(null);
  const [itemEditando, setItemEditando] = useState(null);
  const [carrito, setCarrito] = useState([]);
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [mReorden, setMReorden] = useState(null);
  const [mDetalle, setMDetalle] = useState(null);
  const [mTransf, setMTransf] = useState(null);
  const [busq, setBusq] = useState("");
  const sedeNombre = catalogo.sedes[sedeId]?.nombre;
  const farms = farmsDeSede(catalogo, sedeId).filter((f) => f.nombre.toLowerCase().includes(busq.toLowerCase()));

  // Avisa antes de cerrar/recargar si hay ingresos cargados en la lista pero
  // todavía no confirmados -- no persisten en ningún lado hasta "Cargar
  // Ingresos", así que un F5 accidental los perdería sin este aviso.
  useEffect(() => {
    if (!carrito.length) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [carrito.length]);

  // Cierra el resumen solo cuando ya no queda nada por revisar (todos
  // cargados/encolados y sacados de la lista) -- si quedó algún error, se
  // mantiene abierto para reintentar o quitar.
  useEffect(() => {
    if (mostrarCarrito && carrito.length === 0) setMostrarCarrito(false);
  }, [carrito.length]);

  async function handleEgreso({ loteId, cantidad, motivo, observacion, operacionId }) {
    const farm = mEgreso;
    try {
      await egresoTransaction({ sedeId, sedeNombre, farm, loteId, cantidad, motivo, observacion, usuario, operacionId });
      onToast(`Egreso: ${cantidad} vial${cantidad > 1 ? "es" : ""} de ${farm.nombre}`, "success", 6000);
      setMEgreso(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  function abrirNuevoIngreso(f) { setItemEditando(null); setMIngreso(f); }
  function abrirEditarIngreso(item) { setItemEditando(item); setMIngreso(item.farm); }
  function cerrarModalIngreso() { setMIngreso(null); setItemEditando(null); }

  // Ingreso: en vez de escribir directo, se agrega (o reemplaza, si se está
  // editando) a una lista local -- nada se guarda en Firestore hasta que se
  // confirme el carrito entero desde CarritoIngresos.
  function confirmarModalIngreso({ lote, vencimiento, cantidad, kits, proveedorNombre, observacion }) {
    const farm = mIngreso;
    if (itemEditando) {
      setCarrito((c) => c.map((it) => (it.id === itemEditando.id ? { ...it, lote, vencimiento, cantidad, kits, proveedorNombre, observacion, farm, estado: "pendiente", errorMsg: null } : it)));
      onToast(`Ítem actualizado: ${cantidad} viales de ${farm.nombre}`);
      setMostrarCarrito(true);
    } else {
      setCarrito((c) => [...c, { id: uid(), sedeId, sedeNombre, farm, lote, vencimiento, cantidad, kits, proveedorNombre, observacion, estado: "pendiente", errorMsg: null }]);
      onToast(`Agregado al carrito: ${cantidad} viales de ${farm.nombre}`);
    }
    cerrarModalIngreso();
  }

  function quitarDelCarrito(id) {
    setCarrito((c) => c.filter((it) => it.id !== id));
  }

  // Cada ítem se envía como su propio ingresoBatch (no todos juntos en un
  // solo batch): así uno con problema no tumba a los demás. Sin conexión,
  // ingresoBatch no rechaza -- con persistencia offline la promesa no
  // resuelve hasta reconectar -- así que ese caso se detecta con
  // navigator.onLine y el ítem se da por encolado/enviado de inmediato: si
  // se lo dejara reintentable mientras la promesa sigue pendiente, un
  // reintento accidental duplicaría el ingreso cuando vuelva la señal.
  function enviarItem(item) {
    const sinConexionAlEnviar = typeof navigator !== "undefined" && navigator.onLine === false;
    setCarrito((c) => c.map((it) => (it.id === item.id ? { ...it, estado: "enviando", errorMsg: null } : it)));
    ingresoBatch({
      sedeId: item.sedeId, sedeNombre: item.sedeNombre, farm: item.farm,
      lote: item.lote, vencimiento: item.vencimiento, cantidad: item.cantidad, kits: item.kits,
      proveedorNombre: item.proveedorNombre, observacion: item.observacion, usuario,
    })
      .then(() => {
        setCarrito((c) => c.filter((it) => it.id !== item.id));
        onToast(`Ingreso cargado: ${item.cantidad} viales de ${item.farm.nombre}`, "success");
      })
      .catch((e) => {
        const msg = e.message || "No se pudo cargar el ingreso";
        setCarrito((c) => (c.some((it) => it.id === item.id) ? c.map((it) => (it.id === item.id ? { ...it, estado: "error", errorMsg: msg } : it)) : c));
        onToast(`${item.farm.nombre}: ${msg}`, "error", 6000);
      });
    if (sinConexionAlEnviar) {
      setCarrito((c) => c.filter((it) => it.id !== item.id));
      onToast(`Sin conexión: ${item.cantidad} viales de ${item.farm.nombre} quedaron encolados y se van a cargar solos`, "info", 6000);
    }
  }

  function confirmarCarrito() {
    carrito.filter((it) => it.estado !== "enviando").forEach(enviarItem);
  }

  async function handleTransferencia({ loteId, cantidad, sedeDestino, observacion, operacionId }) {
    const farm = mTransf;
    const sedeDestNombre = catalogo.sedes[sedeDestino]?.nombre;
    try {
      await transferenciaTransaction({
        sedeOrigenId: sedeId, sedeOrigenNombre: sedeNombre, sedeDestinoId: sedeDestino, sedeDestinoNombre: sedeDestNombre,
        farm, loteId, cantidad, observacion, usuario, operacionId,
      });
      onToast(`Transferencia: ${cantidad} vial${cantidad > 1 ? "es" : ""} → ${sedeDestNombre}`, "info", 6000);
      setMTransf(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  async function guardarMinimo(farmId, min) {
    try {
      await setPuntoReorden(sedeId, farmId, min);
      onToast("Stock mínimo actualizado");
      setMReorden(null);
    } catch (e) {
      onToast(e.message, "error");
    }
  }

  // Calculado una sola vez y reusado por la tabla (desktop) y las tarjetas
  // (mobile) -- mismos datos, sólo cambia el layout que los muestra.
  const filas = farms.map((f) => {
    const lotes = catalogo.stock[sedeId]?.[f.id] || [];
    const tot = totStock(lotes);
    const mn = puntoReorden(catalogo, sedeId, f.id);
    const venc = proxVenc(lotes);
    const dias = diasV(venc);
    const pedir = tot <= mn;
    const vencido = dias !== null && dias < 0;
    const pronto = dias !== null && dias >= 0 && dias <= 30;
    const pendientesFarm = carrito.filter((it) => it.farm.id === f.id && it.sedeId === sedeId).length;
    return { f, tot, mn, venc, dias, pedir, vencido, pronto, pendientesFarm };
  });

  return (
    <>
      <div className="mb-3">
        <div className="relative w-full sm:w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Buscar..." value={busq} onChange={(e) => setBusq(e.target.value)} />
        </div>
      </div>
      <BarraCarritoIngresos cantidad={carrito.length} onAbrir={() => setMostrarCarrito(true)} />
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
        {/* Desktop: tabla de siempre. */}
        <table className="w-full text-sm min-w-[540px] hidden md:table">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {["Radiofármaco", "Stock", "Próx. Venc.", "Estado", "Acciones"].map((h, i) => (
                <th key={h} className={`px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide ${i === 0 ? "text-left" : i === 4 ? "text-right" : "text-center"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((row) => {
              const { f, tot, mn, venc, dias, pedir, vencido, pronto, pendientesFarm } = row;
              return (
                <tr key={f.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition ${pedir ? "bg-red-50/20" : ""}`}>
                  <td className="px-4 py-3">
                    <button onClick={() => setMDetalle({ f, sedeId })} className="text-left group">
                      <div className="font-semibold text-gray-800 group-hover:text-blue-600 transition text-sm flex items-center gap-1.5">
                        {f.nombre}
                        {pendientesFarm > 0 && <Badge color="green">🛒 {pendientesFarm} pendiente{pendientesFarm > 1 ? "s" : ""}</Badge>}
                      </div>
                      <div className="text-xs text-gray-400">
                        Mín: {mn} vial{mn !== 1 ? "es" : ""}
                        {f.viales_x_kit > 1 && <span className="ml-2 text-blue-400">· kit {f.viales_x_kit}u</span>}
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xl font-bold ${pedir ? "text-red-600" : "text-gray-800"}`}>{tot}</span>
                    <span className="text-xs text-gray-400 ml-1">vial{tot !== 1 ? "es" : ""}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {venc ? (
                      <>
                        <div className={`text-xs font-semibold ${vencido ? "text-red-600" : pronto ? "text-orange-500" : "text-gray-600"}`}>{fmtF(venc)}</div>
                        <div className="text-xs text-gray-400">{vencido ? "VENCIDO" : dias === 0 ? "Hoy" : `${dias}d`}</div>
                      </>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {vencido ? <Badge color="red">Vencido</Badge> : pedir ? <Badge color="red">PEDIR</Badge> : pronto ? <Badge color="orange">Vence {dias}d</Badge> : <Badge color="green">OK</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      {esAdmin && <Btn size="sm" variant="success" onClick={() => abrirNuevoIngreso(f)}>+ Ingreso</Btn>}
                      <Btn size="sm" variant="ghost" onClick={() => setMEgreso(f)} disabled={tot === 0}>− Egreso</Btn>
                      {esAdmin && <Btn size="sm" variant="teal" onClick={() => setMTransf(f)} disabled={tot === 0} title="Transferir a otra sede">⇄ Transf.</Btn>}
                      {esAdmin && (
                        <button onClick={() => setMReorden(f)} className="text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition min-w-11 min-h-11 md:min-w-0 md:min-h-0 md:p-1.5 flex items-center justify-center" title="Stock mínimo">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Mobile: tarjeta por radiofármaco -- la columna Acciones quedaba
            angosta y obligaba a scroll horizontal para ver nombre+acciones
            juntos. Vencimiento y estado en su propia línea (no junto al
            stock): en un teléfono chico los "Nd restantes" quedaban cortados
            si compartían fila con el número de stock. */}
        <div className="md:hidden divide-y divide-gray-50">
          {filas.map((row) => {
            const { f, tot, mn, venc, dias, pedir, vencido, pronto, pendientesFarm } = row;
            return (
              <div key={f.id} className={`p-4 flex flex-col gap-3 ${pedir ? "bg-red-50/20" : ""}`}>
                <button onClick={() => setMDetalle({ f, sedeId })} className="text-left">
                  <div className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 flex-wrap">
                    {f.nombre}
                    {pendientesFarm > 0 && <Badge color="green">🛒 {pendientesFarm} pendiente{pendientesFarm > 1 ? "s" : ""}</Badge>}
                  </div>
                  <div className="text-xs text-gray-400">
                    Mín: {mn} vial{mn !== 1 ? "es" : ""}
                    {f.viales_x_kit > 1 && <span className="ml-2 text-blue-400">· kit {f.viales_x_kit}u</span>}
                  </div>
                </button>
                <div className="flex flex-col gap-1">
                  <div>
                    <span className={`text-xl font-bold ${pedir ? "text-red-600" : "text-gray-800"}`}>{tot}</span>
                    <span className="text-xs text-gray-400 ml-1">vial{tot !== 1 ? "es" : ""}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {venc ? (
                      <span className={`text-xs font-semibold ${vencido ? "text-red-600" : pronto ? "text-orange-500" : "text-gray-600"}`}>
                        Venc: {fmtF(venc)} · {vencido ? "VENCIDO" : dias === 0 ? "Hoy" : `${dias}d`}
                      </span>
                    ) : <span className="text-gray-300 text-xs">Sin vencimiento</span>}
                    {vencido ? <Badge color="red">Vencido</Badge> : pedir ? <Badge color="red">PEDIR</Badge> : pronto ? <Badge color="orange">Vence {dias}d</Badge> : <Badge color="green">OK</Badge>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {esAdmin && <Btn size="sm" variant="success" onClick={() => abrirNuevoIngreso(f)} className="flex-1">+ Ingreso</Btn>}
                  <Btn size="sm" variant="ghost" onClick={() => setMEgreso(f)} disabled={tot === 0} className="flex-1">− Egreso</Btn>
                  {esAdmin && <Btn size="sm" variant="teal" onClick={() => setMTransf(f)} disabled={tot === 0} className="flex-1">⇄ Transf.</Btn>}
                  {esAdmin && (
                    <button onClick={() => setMReorden(f)} className="text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition min-w-11 min-h-11 flex items-center justify-center flex-shrink-0" title="Stock mínimo">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {farms.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">Sin radiofármacos asignados a esta sede.</div>}
      </div>

      <Modal open={!!mDetalle} title={`Lotes — ${mDetalle?.f?.nombre}`} onClose={() => setMDetalle(null)} size="lg">
        {!(catalogo.stock[mDetalle?.sedeId]?.[mDetalle?.f?.id] || []).length ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin lotes registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {["Lote", "Vencimiento", "Días", "Stock", "Proveedor"].map((h) => (
                  <th key={h} className="text-left pb-2 text-xs font-bold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(catalogo.stock[mDetalle?.sedeId]?.[mDetalle?.f?.id] || []).map((l) => {
                const d = diasV(l.vencimiento);
                return (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-gray-700">{l.lote}</td>
                    <td className="py-2 text-xs text-gray-600">{fmtF(l.vencimiento)}</td>
                    <td className="py-2 text-xs">{d === null ? "—" : d < 0 ? <Badge color="red">Vencido</Badge> : d <= 30 ? <Badge color="orange">{d}d</Badge> : <span className="text-gray-500">{d}d</span>}</td>
                    <td className="py-2 font-bold text-gray-800">{l.cantidad}</td>
                    <td className="py-2 text-xs text-gray-500">{l.proveedorNombre || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Modal>

      {mEgreso && <ModalEgreso open farm={mEgreso} lotes={catalogo.stock[sedeId]?.[mEgreso.id] || []} usuario={usuario} onConfirm={handleEgreso} onClose={() => setMEgreso(null)} />}
      {mIngreso && esAdmin && (
        <ModalIngreso open farm={mIngreso} proveedores={proveedoresOrdenados(catalogo)} itemEditando={itemEditando} onConfirm={confirmarModalIngreso} onClose={cerrarModalIngreso} />
      )}
      <CarritoIngresos
        open={mostrarCarrito}
        items={carrito}
        onEditar={(item) => { setMostrarCarrito(false); abrirEditarIngreso(item); }}
        onQuitar={quitarDelCarrito}
        onReintentar={enviarItem}
        onConfirmarTodo={confirmarCarrito}
        onCerrar={() => setMostrarCarrito(false)}
      />
      {mTransf && esAdmin && <ModalTransferencia open farm={mTransf} sedeOrigenId={sedeId} catalogo={catalogo} usuario={usuario} onConfirm={handleTransferencia} onClose={() => setMTransf(null)} />}
      {mReorden && (
        <Modal open title={`Stock mínimo — ${mReorden?.nombre}`} onClose={() => setMReorden(null)} size="sm">
          <ReordenForm min={puntoReorden(catalogo, sedeId, mReorden.id)} onGuardar={(m) => guardarMinimo(mReorden.id, m)} onClose={() => setMReorden(null)} />
        </Modal>
      )}
    </>
  );
}
