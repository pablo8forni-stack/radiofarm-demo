/**
 * RadioFarm — Sistema de Gestión de Radiofármacos
 *
 * Copyright © 2025 Pablo Forni. Todos los derechos reservados.
 *
 * Este software y su documentación asociada son propiedad exclusiva
 * de Pablo Forni (en adelante "el Autor"). Queda estrictamente prohibido,
 * sin autorización expresa y por escrito del Autor:
 *
 *   - Copiar, reproducir o duplicar este software total o parcialmente
 *   - Modificar, adaptar o crear obras derivadas
 *   - Distribuir, sublicenciar o transferir a terceros
 *   - Usar con fines comerciales sin licencia vigente
 *
 * El uso de este software por parte de una institución no implica
 * transferencia de propiedad ni de derechos de autor.
 *
 * Para licencias comerciales, contacto o autorizaciones:
 * pablo@email.com — Mendoza, Argentina
 *
 * Obra registrada ante la Dirección Nacional del Derecho de Autor
 * (DNDA), República Argentina. Ley 11.723.
 */

import { useState } from "react";
import { useAuth } from "./hooks/useAuth.js";
import { useCatalogo } from "./hooks/useCatalogo.js";
import { CatalogoProvider } from "./context/CatalogoContext.jsx";
import { PantallaLogin } from "./views/PantallaLogin.jsx";
import { VistaInventario } from "./views/inventario/VistaInventario.jsx";
import { VistaPedidos } from "./views/VistaPedidos.jsx";
import { VistaHistorial } from "./views/VistaHistorial.jsx";
import { VistaAdministracion } from "./views/administracion/VistaAdministracion.jsx";
import { VistaConfiguracion } from "./views/configuracion/VistaConfiguracion.jsx";
import { Badge } from "./components/ui/Badge.jsx";
import { Btn } from "./components/ui/Btn.jsx";
import { Toast } from "./components/ui/Toast.jsx";
import { SEDES } from "./constants/sedes.js";
import { signOutUser } from "./services/auth.js";
import { totStock, farmsDeSede, sedesActivas, idsSedesActivas, puntoReorden } from "./helpers/stock.js";

export default function App() {
  const { usuario, cargando } = useAuth();

  if (cargando) return <PantallaCargando />;
  if (!usuario) return <PantallaLogin />;
  if (usuario.sinAcceso) return <PantallaSinAcceso usuario={usuario} />;

  return (
    <CatalogoProvider>
      <AppAutenticada usuario={usuario} />
    </CatalogoProvider>
  );
}

function AppAutenticada({ usuario }) {
  const catalogo = useCatalogo();
  const [vista, setVista] = useState("inventario");
  const [toast, setToast] = useState(null);
  const esAdmin = usuario.rol === "admin";

  if (catalogo.cargando) return <PantallaCargando />;

  if (!esAdmin && !idsSedesActivas(catalogo).includes(usuario.sede)) {
    return <PantallaSedeNoHabilitada usuario={usuario} />;
  }

  let countPedirTotal = 0;
  sedesActivas(catalogo).forEach((sede) =>
    farmsDeSede(catalogo, sede.id).forEach((f) => {
      if (totStock(catalogo.stock[sede.id]?.[f.id] || []) <= puntoReorden(catalogo, sede.id, f.id)) countPedirTotal++;
    })
  );

  const navItems = [
    { id: "inventario", label: "Inventario", path: "M4 6h16M4 10h16M4 14h16M4 18h16" },
    { id: "pedidos", label: "Pedidos", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { id: "historial", label: "Historial", path: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "administracion", label: "Actas ARN", path: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    ...(esAdmin ? [{ id: "configuracion", label: "Config.", path: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-800 leading-tight">RadioFarm</div>
              <div className="text-xs text-gray-400 leading-tight">{SEDES.find((s) => s.id === usuario.sede)?.nombre || "FUESMEN"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {countPedirTotal > 0 && (
              <button onClick={() => setVista("pedidos")} className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full hover:bg-red-100 transition">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />{countPedirTotal} para pedir
              </button>
            )}
            <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${esAdmin ? "bg-purple-500" : "bg-blue-500"}`}>{usuario.initial}</div>
              <div className="hidden sm:block">
                <div className="text-xs font-semibold text-gray-700 leading-tight">{usuario.nombre}</div>
                <div className="text-xs leading-tight"><Badge color={esAdmin ? "purple" : "blue"}>{esAdmin ? "Encargada" : "Técnico"}</Badge></div>
              </div>
              <button onClick={() => signOutUser()} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 flex gap-0 overflow-x-auto">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setVista(item.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${vista === item.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200"}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.path} />
              </svg>
              <span className="hidden sm:inline">{item.label}</span>
              {item.id === "pedidos" && countPedirTotal > 0 && <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{countPedirTotal}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {vista === "inventario" && <VistaInventario catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={(m, t) => setToast({ m, t })} />}
        {vista === "pedidos" && <VistaPedidos catalogo={catalogo} esAdmin={esAdmin} onToast={(m, t) => setToast({ m, t })} />}
        {vista === "historial" && <VistaHistorial catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={(m, t) => setToast({ m, t })} />}
        {vista === "administracion" && <VistaAdministracion catalogo={catalogo} usuario={usuario} esAdmin={esAdmin} onToast={(m, t) => setToast({ m, t })} />}
        {vista === "configuracion" && esAdmin && <VistaConfiguracion catalogo={catalogo} usuario={usuario} onToast={(m, t) => setToast({ m, t })} />}
      </main>

      {toast && <Toast msg={toast.m} type={toast.t || "success"} onDone={() => setToast(null)} />}
    </div>
  );
}

function PantallaCargando() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function PantallaSinAcceso({ usuario }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-gray-800 mb-2">Cuenta no autorizada</h2>
        <p className="text-sm text-gray-500 mb-6">
          {usuario.email} todavía no tiene acceso a RadioFarm. Consultá con la encargada de radiofarmacia para que te dé de alta.
        </p>
        <Btn variant="outline" onClick={() => signOutUser()}>Volver al inicio</Btn>
      </div>
    </div>
  );
}

function PantallaSedeNoHabilitada({ usuario }) {
  const sede = SEDES.find((s) => s.id === usuario.sede);
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-gray-800 mb-2">Sede no habilitada</h2>
        <p className="text-sm text-gray-500 mb-6">
          {sede?.nombre} aún no está operando con RadioFarm. Consultá con la encargada de radiofarmacia.
        </p>
        <Btn variant="outline" onClick={() => signOutUser()}>Volver al inicio</Btn>
      </div>
    </div>
  );
}
