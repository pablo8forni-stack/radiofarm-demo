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

import { useState, useEffect, useMemo, useRef } from "react";
import * as React from "react";

// ─── Sedes (fijas) ────────────────────────────────────────────────────────────
const SEDES = [
  { id:"central",   nombre:"FUESMEN Central",            short:"Central"   },
  { id:"italiano",  nombre:"C. Gamma Hospital Italiano", short:"Italiano"  },
  { id:"espanol",   nombre:"C. Gamma Hospital Español",  short:"Español"   },
  { id:"sanrafael", nombre:"C. Gamma San Rafael",        short:"San Rafael"},
];

// ─── Usuarios demo ────────────────────────────────────────────────────────────
const USUARIOS = [
  { pin:"9999", nombre:"Ana R.",    rol:"admin",   sede:"central",   initial:"A" },
  { pin:"1234", nombre:"Carlos T.", rol:"tecnico", sede:"central",   initial:"C" },
  { pin:"2222", nombre:"Laura M.",  rol:"tecnico", sede:"italiano",  initial:"L" },
  { pin:"3333", nombre:"Diego P.",  rol:"tecnico", sede:"espanol",   initial:"D" },
  { pin:"4444", nombre:"Sofía G.",  rol:"tecnico", sede:"sanrafael", initial:"S" },
];

// ─── Catálogo y asignaciones por defecto ──────────────────────────────────────
const FARMS_DEFAULT = [
  { id:"mibi",        nombre:"MIBI (Sestamibi)",           viales_x_kit:1 },
  { id:"osteobac",    nombre:"Osteobac",                   viales_x_kit:5 },
  { id:"cipro",       nombre:"Ciprofloxacina",             viales_x_kit:1 },
  { id:"dmsa",        nombre:"DMSA",                       viales_x_kit:5 },
  { id:"dtpa",        nombre:"DTPA",                       viales_x_kit:5 },
  { id:"maa",         nombre:"Macroagregados de Albúmina", viales_x_kit:1 },
  { id:"fitato",      nombre:"Fitato",                     viales_x_kit:5 },
  { id:"neurobac",    nombre:"Neurobac",                   viales_x_kit:1 },
  { id:"trodat",      nombre:"Trodat",                     viales_x_kit:1 },
  { id:"pirofosfato", nombre:"Pirofosfato",                viales_x_kit:1 },
  { id:"estannoso",   nombre:"Cloruro Estañoso",           viales_x_kit:5 },
];

// sedesFarms: qué farmIds están activos en cada sede
const SEDE_FARMS_DEFAULT = {
  central:   FARMS_DEFAULT.map(f=>f.id),
  italiano:  ["mibi","osteobac","dtpa","maa","fitato"],
  espanol:   ["mibi","osteobac","dmsa","dtpa","trodat"],
  sanrafael: ["osteobac","dtpa","maa","pirofosfato","estannoso"],
};

// ─── Estado inicial demo ──────────────────────────────────────────────────────
function estadoInicial() {
  const stock={}, pr={};
  SEDES.forEach(sede=>{
    stock[sede.id]={}; pr[sede.id]={};
    const farms = SEDE_FARMS_DEFAULT[sede.id];
    farms.forEach((fid,i)=>{
      const cantidades = sede.id==="central"?[3,5,0,4,2,6,1,3,2,4,1]:[2,1,3,1,2,4,1,2];
      stock[sede.id][fid]=[{ id:`${sede.id}-${fid}-l1`, lote:`ARN-2025-0${30+i}`,
        vencimiento:`2025-${String(7+Math.floor(i/3)).padStart(2,"0")}-${String(10+(i*5)%18).padStart(2,"0")}`,
        cantidad:cantidades[i]??2, proveedorNombre:"Proveedor Principal" }];
      pr[sede.id][fid]=sede.id==="central"?3:2;
    });
  });
  return {
    farms: FARMS_DEFAULT,
    sedeFarms: SEDE_FARMS_DEFAULT,
    stock, puntosReorden: pr,
    movimientos: [
      { id:"m1", fecha:new Date(Date.now()-3600000).toISOString(), tipo:"egreso", sedeId:"central", sedeNombre:"FUESMEN Central", farmId:"mibi", farmNombre:"MIBI (Sestamibi)", cantidad:1, lote:"ARN-2025-030", motivo:"Estudio", usuarioNombre:"Carlos T." },
      { id:"m2", fecha:new Date(Date.now()-7200000).toISOString(), tipo:"egreso", sedeId:"italiano", sedeNombre:"C. Gamma Hospital Italiano", farmId:"osteobac", farmNombre:"Osteobac", cantidad:1, lote:"ARN-2025-031", motivo:"Estudio", usuarioNombre:"Laura M." },
      { id:"m3", fecha:new Date(Date.now()-86400000).toISOString(), tipo:"ingreso", sedeId:"central", sedeNombre:"FUESMEN Central", farmId:"mibi", farmNombre:"MIBI (Sestamibi)", cantidad:4, lote:"ARN-2025-030", motivo:"Recepción de pedido", usuarioNombre:"Ana R." },
    ],
    actas: [
      { id:"a1", fecha:new Date(Date.now()-3600000).toISOString(), tipo:"marcacion", sedeId:"central", sedeNombre:"FUESMEN Central", farmId:"mibi", farmNombre:"MIBI (Sestamibi)", lote:"ARN-2025-030", mciMarcacion:20, usuarioNombre:"Carlos T.", observacion:"" },
      { id:"a2", fecha:new Date(Date.now()-3600000).toISOString(), tipo:"paciente", sedeId:"central", sedeNombre:"FUESMEN Central", pacienteNombre:"García Juan", pacienteDni:"28456789", estudio:"Centellograma de perfusión miocárdica", peso:78, talla:172, mciAdministrados:10, farmNombre:"MIBI (Sestamibi)", lote:"ARN-2025-030", usuarioNombre:"Carlos T.", observacion:"" },
    ],
    proveedores:[{ id:"principal", nombre:"Proveedor Principal", contacto:"0800-555-0001", principal:true }],
  };
}

function cargar() {
  try { const r=localStorage.getItem("radiofarm_v3"); if(r) return JSON.parse(r); } catch {}
  return estadoInicial();
}
function guardar(e) { localStorage.setItem("radiofarm_v3",JSON.stringify(e)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _uidCounter = 0;
const uid = () => `${Date.now().toString(36)}${(_uidCounter++).toString(36)}${Math.random().toString(36).slice(2,6)}`;
const hoy    = () => new Date().toISOString().slice(0,10);
const fmtF   = iso => { if(!iso) return "—"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
const fmtTs  = iso => { if(!iso) return "—"; const d=new Date(iso); return `${d.toLocaleDateString("es-AR")} ${d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}`; };
const totStock = (lotes=[]) => lotes.reduce((s,l)=>s+(l.cantidad||0),0);
const proxVenc = (lotes=[]) => { const a=lotes.filter(l=>l.cantidad>0&&l.vencimiento); return a.length?a.reduce((mn,l)=>(!mn||l.vencimiento<mn?l.vencimiento:mn),null):null; };
const diasV    = f => { if(!f) return null; const h=new Date(); h.setHours(0,0,0,0); return Math.ceil((new Date(f+"T00:00:00")-h)/86400000); };
const farmsDeSede = (estado,sid) => estado.farms.filter(f=>(estado.sedeFarms[sid]||[]).includes(f.id));
const idsSedesActivas = e => e.sedesActivas || SEDES.map(s=>s.id);
const sedesActivas = e => SEDES.filter(s=>idsSedesActivas(e).includes(s.id));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

// ─── UI Primitivos ────────────────────────────────────────────────────────────
function Badge({color,children}){
  const c={red:"bg-red-100 text-red-700 border border-red-200",orange:"bg-orange-100 text-orange-700 border border-orange-200",
    green:"bg-emerald-100 text-emerald-700 border border-emerald-200",blue:"bg-blue-100 text-blue-700 border border-blue-200",
    gray:"bg-gray-100 text-gray-500 border border-gray-200",purple:"bg-purple-100 text-purple-700 border border-purple-200",
    teal:"bg-teal-100 text-teal-700 border border-teal-200"};
  return <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${c[color]||c.gray}`}>{children}</span>;
}
function Btn({variant="primary",size="md",disabled,children,className="",...p}){
  const base="font-semibold rounded-xl transition-all focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed";
  const v={primary:"bg-blue-600 text-white hover:bg-blue-700 shadow-sm",danger:"bg-red-500 text-white hover:bg-red-600 shadow-sm",
    ghost:"bg-gray-100 text-gray-700 hover:bg-gray-200",outline:"border border-gray-300 text-gray-700 hover:bg-gray-50",
    success:"bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"};
  const s={sm:"px-3 py-1.5 text-xs",md:"px-4 py-2 text-sm",lg:"px-5 py-2.5 text-sm"};
  return <button disabled={disabled} className={`${base} ${v[variant]} ${s[size]} ${className}`} {...p}>{children}</button>;
}
function Input({label,hint,...p}){
  return <div className="flex flex-col gap-1">
    {label&&<label className="text-xs font-semibold text-gray-600">{label}</label>}
    <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" {...p}/>
    {hint&&<span className="text-xs text-gray-400">{hint}</span>}
  </div>;
}
function Sel({label,children,...p}){
  return <div className="flex flex-col gap-1">
    {label&&<label className="text-xs font-semibold text-gray-600">{label}</label>}
    <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" {...p}>{children}</select>
  </div>;
}
function Modal({open,title,onClose,children,size="md"}){
  if(!open) return null;
  const w={sm:"max-w-sm",md:"max-w-md",lg:"max-w-lg",xl:"max-w-2xl"};
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
    <div className={`bg-white rounded-2xl shadow-2xl w-full ${w[size]} overflow-hidden`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="px-6 py-5 max-h-[75vh] overflow-y-auto">{children}</div>
    </div>
  </div>;
}
function Toast({msg,type,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[]);
  const bg={success:"bg-emerald-600",error:"bg-red-500",info:"bg-blue-600"};
  return <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] ${bg[type]||bg.success} text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl`}>{msg}</div>;
}

// ─── Login PIN ────────────────────────────────────────────────────────────────
function PantallaLogin({onLogin}){
  const [pin,setPin]=useState(""); const [error,setError]=useState(""); const [shake,setShake]=useState(false);
  function tecla(v){
    if(v==="←"){setPin(p=>p.slice(0,-1));return;}
    if(pin.length>=4) return;
    const n=pin+v; setPin(n);
    if(n.length===4){
      const u=USUARIOS.find(u=>u.pin===n);
      if(u){setTimeout(()=>{onLogin(u);setPin("");setError("");},150);}
      else{setTimeout(()=>{setError("PIN incorrecto");setPin("");setShake(true);setTimeout(()=>setShake(false),500);},300);}
    }
  }
  return <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6 gap-8">
    <div className="text-center">
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
        <svg className="w-8 h-8 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-white">RadioFarm</h1>
      <p className="text-blue-300/60 text-sm mt-1">FUESMEN · Sistema de Radiofármacos</p>
    </div>
    <div className={`bg-white/5 border border-white/10 rounded-3xl p-8 w-full max-w-xs ${shake?"animate-bounce":""}`}>
      <p className="text-white/50 text-xs text-center mb-5 uppercase tracking-widest font-semibold">Ingresá tu PIN</p>
      <div className="flex justify-center gap-4 mb-6">
        {[0,1,2,3].map(i=><div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${pin.length>i?"bg-blue-400 border-blue-400 scale-110":"border-white/30"}`}/>)}
      </div>
      {error&&<p className="text-red-400 text-xs text-center mb-4 font-semibold">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {["1","2","3","4","5","6","7","8","9","","0","←"].map((k,i)=>
          k===""?<div key={i}/>:
          <button key={k} onClick={()=>tecla(k)} className="aspect-square rounded-2xl text-white font-bold text-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all">{k}</button>
        )}
      </div>
      <div className="mt-6 pt-5 border-t border-white/10 text-center space-y-1">
        <p className="text-white/30 text-xs mb-2">PINs de prueba:</p>
        {USUARIOS.map(u=><p key={u.pin} className="text-white/40 text-xs">
          <span className="font-mono text-blue-300">{u.pin}</span> — {u.nombre} <span className="text-white/25">({SEDES.find(s=>s.id===u.sede)?.short})</span>
        </p>)}
      </div>
    </div>
  </div>;
}

// ─── Modals de movimientos ────────────────────────────────────────────────────
function ModalEgreso({open,farm,lotes,usuario,onConfirm,onClose}){
  const [loteId,setLoteId]=useState(""); const [cantidad,setCantidad]=useState(1); const [motivo,setMotivo]=useState("Estudio"); const [obs,setObs]=useState("");
  const disp=(lotes||[]).filter(l=>l.cantidad>0);
  useEffect(()=>{if(disp.length)setLoteId(disp[0].id);setCantidad(1);setMotivo("Estudio");setObs("");},[open,farm?.id]);
  const lote=disp.find(l=>l.id===loteId);
  return <Modal open={open} title={`Egreso — ${farm?.nombre}`} onClose={onClose} size="sm">
    <div className="flex flex-col gap-4">
      {!disp.length?<p className="text-sm text-gray-400 text-center py-6">Sin stock disponible.</p>:<>
        <Sel label="Lote" value={loteId} onChange={e=>setLoteId(e.target.value)}>
          {disp.map(l=><option key={l.id} value={l.id}>{l.lote} · Venc: {fmtF(l.vencimiento)} · {l.cantidad} disp.</option>)}
        </Sel>
        <Input label="Cantidad (viales)" type="number" min={1} max={lote?.cantidad||1} value={cantidad} onChange={e=>setCantidad(Math.max(1,parseInt(e.target.value)||1))}/>
        <Sel label="Motivo" value={motivo} onChange={e=>setMotivo(e.target.value)}>
          {["Estudio","Control de calidad","Derrame / accidente","Vencimiento","Otro"].map(m=><option key={m}>{m}</option>)}
        </Sel>
        <Input label="Observación (opcional)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: Paciente suspendido, vial roto..."/>
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">Por: <span className="font-semibold text-gray-700">{usuario?.nombre}</span></div>
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="danger" onClick={()=>onConfirm({loteId,cantidad,motivo,lote:lote?.lote,observacion:obs.trim()})}>Registrar egreso</Btn>
        </div>
      </>}
    </div>
  </Modal>;
}

function ModalIngreso({open,farm,proveedores,onConfirm,onClose}){
  const [lote,setLote]=useState(""); const [venc,setVenc]=useState(""); const [cant,setCant]=useState(1); const [provId,setProvId]=useState("principal"); const [obs,setObs]=useState("");
  useEffect(()=>{setLote("");setVenc("");setCant(1);setProvId("principal");setObs("");},[open]);
  const prov=proveedores.find(p=>p.id===provId);
  const vxk=farm?.viales_x_kit||1; const enKit=vxk>1; const totalViales=cant*vxk;
  return <Modal open={open} title={`Ingreso — ${farm?.nombre}`} onClose={onClose} size="sm">
    <div className="flex flex-col gap-4">
      <Input label="N° de lote" value={lote} onChange={e=>setLote(e.target.value)} placeholder="Ej: ARN-2025-050"/>
      <Input label="Fecha de vencimiento" type="date" value={venc} onChange={e=>setVenc(e.target.value)} min={hoy()}/>
      <div className="flex flex-col gap-1">
        <Input label={enKit?`Cantidad (kits de ${vxk} viales)`:"Cantidad (viales)"} type="number" min={1} value={cant} onChange={e=>setCant(Math.max(1,parseInt(e.target.value)||1))}/>
        {enKit&&<div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
          {cant} kit{cant>1?"s":""} × {vxk} viales = <span className="font-bold">{totalViales} viales</span> en stock
        </div>}
      </div>
      <Sel label="Proveedor" value={provId} onChange={e=>setProvId(e.target.value)}>
        {proveedores.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Sel>
      <Input label="Observación (opcional)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: Pedido parcial, faltó un lote..."/>
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={()=>onConfirm({lote,vencimiento:venc,cantidad:totalViales,kits:enKit?cant:null,proveedorNombre:prov?.nombre,observacion:obs.trim()})} disabled={!lote||!venc}>Registrar ingreso</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── Panel resumen (admin) ────────────────────────────────────────────────────
function PanelResumen({estado}){
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
    {sedesActivas(estado).map(sede=>{
      const farms=farmsDeSede(estado,sede.id);
      const pedir=farms.filter(f=>totStock(estado.stock[sede.id]?.[f.id]||[])<=(estado.puntosReorden[sede.id]?.[f.id]??2));
      const conStock=farms.filter(f=>totStock(estado.stock[sede.id]?.[f.id]||[])>0);
      return <div key={sede.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">{sede.short}</div>
        <div className="text-2xl font-bold text-gray-800">{conStock.length}<span className="text-sm font-normal text-gray-400">/{farms.length}</span></div>
        <div className="text-xs text-gray-400 mb-2">con stock</div>
        {pedir.length>0?<Badge color="red">⚠ {pedir.length} para pedir</Badge>:<Badge color="green">Stock OK</Badge>}
      </div>;
    })}
  </div>;
}

// ─── Tabla inventario por sede ────────────────────────────────────────────────
function TablaInventario({sedeId,estado,setEstado,usuario,esAdmin,onToast}){
  const [mEgreso,setMEgreso]=useState(null); const [mIngreso,setMIngreso]=useState(null);
  const [mReorden,setMReorden]=useState(null); const [mDetalle,setMDetalle]=useState(null);
  const [mTransf,setMTransf]=useState(null);
  const [busq,setBusq]=useState("");
  const farms=farmsDeSede(estado,sedeId).filter(f=>f.nombre.toLowerCase().includes(busq.toLowerCase()));

  function handleEgreso({loteId,cantidad,motivo,lote,observacion}){
    const farm=mEgreso;
    const nuevosLotes=(estado.stock[sedeId]?.[farm.id]||[]).map(l=>l.id===loteId?{...l,cantidad:l.cantidad-cantidad}:l);
    const mov={id:uid(),fecha:new Date().toISOString(),tipo:"egreso",
      sedeId,sedeNombre:SEDES.find(s=>s.id===sedeId)?.nombre,
      farmId:farm.id,farmNombre:farm.nombre,cantidad,lote,loteId,motivo,observacion,usuarioNombre:usuario.nombre};
    const nuevo={...estado,stock:{...estado.stock,[sedeId]:{...estado.stock[sedeId],[farm.id]:nuevosLotes}},movimientos:[mov,...estado.movimientos]};
    guardar(nuevo);setEstado(nuevo);onToast(`Egreso: ${cantidad} vial${cantidad>1?"es":""} de ${farm.nombre}`);setMEgreso(null);
  }

  function handleIngreso({lote,vencimiento,cantidad,kits,proveedorNombre,observacion}){
    const farm=mIngreso;
    const loteId=uid();
    const nuevoLote={id:loteId,lote,vencimiento,cantidad,proveedorNombre};
    const motivo=kits?`Recepción (${kits} kit${kits>1?"s":""} × ${farm.viales_x_kit} = ${cantidad} viales)`:"Recepción de pedido";
    const mov={id:uid(),fecha:new Date().toISOString(),tipo:"ingreso",
      sedeId,sedeNombre:SEDES.find(s=>s.id===sedeId)?.nombre,
      farmId:farm.id,farmNombre:farm.nombre,cantidad,lote,loteId,motivo,observacion,proveedorNombre,usuarioNombre:usuario.nombre};
    const lotesActuales=estado.stock[sedeId]?.[farm.id]||[];
    const nuevo={...estado,stock:{...estado.stock,[sedeId]:{...estado.stock[sedeId],[farm.id]:[...lotesActuales,nuevoLote]}},movimientos:[mov,...estado.movimientos]};
    guardar(nuevo);setEstado(nuevo);onToast(`Ingreso: ${cantidad} viales de ${farm.nombre}`);setMIngreso(null);
  }

  function handleTransferencia({loteId,cantidad,sedeDestino,observacion}){
    const farm=mTransf;
    const lote=(estado.stock[sedeId]?.[farm.id]||[]).find(l=>l.id===loteId);
    if(!lote) return;
    const grupoId=uid();
    const sedeDestNombre=SEDES.find(s=>s.id===sedeDestino)?.nombre;
    // Descontar del origen
    const lotesOrigen=(estado.stock[sedeId]?.[farm.id]||[]).map(l=>l.id===loteId?{...l,cantidad:l.cantidad-cantidad}:l);
    // Acreditar en destino (mismo lote si ya existe, sino nuevo)
    const lotesDest=estado.stock[sedeDestino]?.[farm.id]||[];
    const existente=lotesDest.find(l=>l.lote===lote.lote&&l.vencimiento===lote.vencimiento);
    const lotesDestNuevo=existente
      ?lotesDest.map(l=>l===existente?{...l,cantidad:l.cantidad+cantidad}:l)
      :[...lotesDest,{id:uid(),lote:lote.lote,vencimiento:lote.vencimiento,cantidad,proveedorNombre:lote.proveedorNombre}];
    const fecha=new Date().toISOString();
    // Dos movimientos vinculados por grupoId
    const movSalida={id:uid(),grupoId,fecha,tipo:"transferencia_salida",
      sedeId,sedeNombre:SEDES.find(s=>s.id===sedeId)?.nombre,sedeRelacionada:sedeDestNombre,
      farmId:farm.id,farmNombre:farm.nombre,cantidad,lote:lote.lote,
      motivo:`Transferencia a ${sedeDestNombre}`,observacion,usuarioNombre:usuario.nombre};
    const movEntrada={id:uid(),grupoId,fecha,tipo:"transferencia_entrada",
      sedeId:sedeDestino,sedeNombre:sedeDestNombre,sedeRelacionada:SEDES.find(s=>s.id===sedeId)?.nombre,
      farmId:farm.id,farmNombre:farm.nombre,cantidad,lote:lote.lote,
      motivo:`Transferencia desde ${SEDES.find(s=>s.id===sedeId)?.nombre}`,observacion,usuarioNombre:usuario.nombre};
    const nuevo={...estado,stock:{...estado.stock,
      [sedeId]:{...estado.stock[sedeId],[farm.id]:lotesOrigen},
      [sedeDestino]:{...estado.stock[sedeDestino],[farm.id]:lotesDestNuevo}},
      movimientos:[movEntrada,movSalida,...estado.movimientos]};
    guardar(nuevo);setEstado(nuevo);
    onToast(`Transferencia: ${cantidad} vial${cantidad>1?"es":""} → ${sedeDestNombre}`,"teal");setMTransf(null);
  }

  function guardarMinimo(farmId,min){
    const nuevo={...estado,puntosReorden:{...estado.puntosReorden,[sedeId]:{...estado.puntosReorden[sedeId],[farmId]:parseInt(min)||1}}};
    guardar(nuevo);setEstado(nuevo);onToast("Stock mínimo actualizado");setMReorden(null);
  }

  return <>
    <div className="mb-3">
      <div className="relative w-full sm:w-64">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
        </svg>
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Buscar..." value={busq} onChange={e=>setBusq(e.target.value)}/>
      </div>
    </div>
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm min-w-[540px]">
        <thead><tr className="border-b border-gray-100 bg-gray-50/60">
          {["Radiofármaco","Stock","Próx. Venc.","Estado","Acciones"].map((h,i)=>(
            <th key={h} className={`px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide ${i===0?"text-left":i===4?"text-right":"text-center"}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {farms.map(f=>{
            const lotes=estado.stock[sedeId]?.[f.id]||[];
            const tot=totStock(lotes); const mn=estado.puntosReorden[sedeId]?.[f.id]??2;
            const venc=proxVenc(lotes); const dias=diasV(venc);
            const pedir=tot<=mn; const vencido=dias!==null&&dias<0; const pronto=dias!==null&&dias>=0&&dias<=30;
            return <tr key={f.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition ${pedir?"bg-red-50/20":""}`}>
              <td className="px-4 py-3">
                <button onClick={()=>setMDetalle({f,sedeId})} className="text-left group">
                  <div className="font-semibold text-gray-800 group-hover:text-blue-600 transition text-sm">{f.nombre}</div>
                  <div className="text-xs text-gray-400">
                    Mín: {mn} vial{mn!==1?"es":""}
                    {f.viales_x_kit>1&&<span className="ml-2 text-blue-400">· kit {f.viales_x_kit}u</span>}
                  </div>
                </button>
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xl font-bold ${pedir?"text-red-600":"text-gray-800"}`}>{tot}</span>
                <span className="text-xs text-gray-400 ml-1">vial{tot!==1?"es":""}</span>
              </td>
              <td className="px-4 py-3 text-center">
                {venc?<><div className={`text-xs font-semibold ${vencido?"text-red-600":pronto?"text-orange-500":"text-gray-600"}`}>{fmtF(venc)}</div>
                  <div className="text-xs text-gray-400">{vencido?"VENCIDO":dias===0?"Hoy":`${dias}d`}</div></>
                :<span className="text-gray-300 text-xs">—</span>}
              </td>
              <td className="px-4 py-3 text-center">
                {vencido?<Badge color="red">Vencido</Badge>:pedir?<Badge color="red">PEDIR</Badge>:pronto?<Badge color="orange">Vence {dias}d</Badge>:<Badge color="green">OK</Badge>}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1.5 justify-end flex-wrap">
                  {esAdmin&&<Btn size="sm" variant="success" onClick={()=>setMIngreso(f)}>+ Ingreso</Btn>}
                  <Btn size="sm" variant="ghost" onClick={()=>setMEgreso(f)} disabled={tot===0}>− Egreso</Btn>
                  {esAdmin&&<Btn size="sm" variant="teal" onClick={()=>setMTransf(f)} disabled={tot===0} title="Transferir a otra sede">⇄ Transf.</Btn>}
                  {esAdmin&&<button onClick={()=>setMReorden(f)} className="text-gray-400 hover:text-blue-500 p-1.5 rounded-lg hover:bg-blue-50 transition" title="Stock mínimo">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
                    </svg>
                  </button>}
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
      {farms.length===0&&<div className="text-center py-12 text-gray-400 text-sm">Sin radiofármacos asignados a esta sede.</div>}
    </div>

    {/* Modal detalle lotes */}
    <Modal open={!!mDetalle} title={`Lotes — ${mDetalle?.f?.nombre}`} onClose={()=>setMDetalle(null)} size="lg">
      {!(estado.stock[mDetalle?.sedeId]?.[mDetalle?.f?.id]||[]).length
        ?<p className="text-sm text-gray-400 text-center py-6">Sin lotes registrados.</p>
        :<table className="w-full text-sm"><thead><tr className="border-b border-gray-100">
            {["Lote","Vencimiento","Días","Stock","Proveedor"].map(h=><th key={h} className="text-left pb-2 text-xs font-bold text-gray-500 uppercase">{h}</th>)}
          </tr></thead><tbody>
          {(estado.stock[mDetalle?.sedeId]?.[mDetalle?.f?.id]||[]).map(l=>{
            const d=diasV(l.vencimiento);
            return <tr key={l.id} className="border-b border-gray-50 last:border-0">
              <td className="py-2 font-mono text-xs text-gray-700">{l.lote}</td>
              <td className="py-2 text-xs text-gray-600">{fmtF(l.vencimiento)}</td>
              <td className="py-2 text-xs">{d===null?"—":d<0?<Badge color="red">Vencido</Badge>:d<=30?<Badge color="orange">{d}d</Badge>:<span className="text-gray-500">{d}d</span>}</td>
              <td className="py-2 font-bold text-gray-800">{l.cantidad}</td>
              <td className="py-2 text-xs text-gray-500">{l.proveedorNombre||"—"}</td>
            </tr>;
          })}
        </tbody></table>}
    </Modal>

    {mEgreso&&<ModalEgreso open farm={mEgreso} lotes={estado.stock[sedeId]?.[mEgreso.id]||[]} usuario={usuario} onConfirm={handleEgreso} onClose={()=>setMEgreso(null)}/>}
    {mIngreso&&esAdmin&&<ModalIngreso open farm={mIngreso} proveedores={estado.proveedores} onConfirm={handleIngreso} onClose={()=>setMIngreso(null)}/>}
    {mTransf&&esAdmin&&<ModalTransferencia open farm={mTransf} sedeOrigenId={sedeId} estado={estado} usuario={usuario} onConfirm={handleTransferencia} onClose={()=>setMTransf(null)}/>}
    {mReorden&&<Modal open title={`Stock mínimo — ${mReorden?.nombre}`} onClose={()=>setMReorden(null)} size="sm">
      <ReordenForm farm={mReorden} min={estado.puntosReorden[sedeId]?.[mReorden.id]??2} onGuardar={m=>guardarMinimo(mReorden.id,m)} onClose={()=>setMReorden(null)}/>
    </Modal>}
  </>;
}

function ReordenForm({farm,min,onGuardar,onClose}){
  const [val,setVal]=useState(min);
  useEffect(()=>setVal(min),[min]);
  return <div className="flex flex-col gap-4">
    <p className="text-sm text-gray-500">Cuando el stock llegue o baje de este número, el producto aparece como PEDIR.</p>
    <Input label="Viales mínimos" type="number" min={0} value={val} onChange={e=>setVal(e.target.value)}/>
    <div className="flex gap-2 justify-end"><Btn variant="outline" onClick={onClose}>Cancelar</Btn><Btn onClick={()=>onGuardar(val)}>Guardar</Btn></div>
  </div>;
}

function ModalTransferencia({open,farm,sedeOrigenId,estado,usuario,onConfirm,onClose}){
  const [loteId,setLoteId]=useState(""); const [cantidad,setCantidad]=useState(1); const [destino,setDestino]=useState(""); const [obs,setObs]=useState("");
  const disp=(estado.stock[sedeOrigenId]?.[farm?.id]||[]).filter(l=>l.cantidad>0);
  // Sedes destino: las que tienen este farmaco asignado y no son el origen
  const destinos=sedesActivas(estado).filter(s=>s.id!==sedeOrigenId&&(estado.sedeFarms[s.id]||[]).includes(farm?.id));
  useEffect(()=>{if(disp.length)setLoteId(disp[0].id);setCantidad(1);setDestino(destinos[0]?.id||"");setObs("");},[open,farm?.id]);
  const lote=disp.find(l=>l.id===loteId);
  const sedeOrigen=SEDES.find(s=>s.id===sedeOrigenId);
  return <Modal open={open} title={`Transferencia — ${farm?.nombre}`} onClose={onClose} size="sm">
    <div className="flex flex-col gap-4">
      {!disp.length
        ?<p className="text-sm text-gray-400 text-center py-6">Sin stock disponible para transferir.</p>
        :!destinos.length
        ?<p className="text-sm text-gray-400 text-center py-6">Ninguna otra sede tiene este radiofármaco asignado. Activalo primero en Configuración.</p>
        :<>
        <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2 text-xs text-teal-700">
          Desde <span className="font-bold">{sedeOrigen?.short}</span>. Se descuenta acá y se acredita en la sede destino, vinculado como un solo movimiento.
        </div>
        <Sel label="Lote a transferir" value={loteId} onChange={e=>setLoteId(e.target.value)}>
          {disp.map(l=><option key={l.id} value={l.id}>{l.lote} · Venc: {fmtF(l.vencimiento)} · {l.cantidad} disp.</option>)}
        </Sel>
        <Input label="Cantidad (viales)" type="number" min={1} max={lote?.cantidad||1} value={cantidad} onChange={e=>setCantidad(Math.max(1,parseInt(e.target.value)||1))}/>
        <Sel label="Sede destino" value={destino} onChange={e=>setDestino(e.target.value)}>
          {destinos.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Sel>
        <Input label="Observación (opcional)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: Préstamo por faltante puntual"/>
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">Por: <span className="font-semibold text-gray-700">{usuario?.nombre}</span></div>
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="teal" onClick={()=>onConfirm({loteId,cantidad,sedeDestino:destino,observacion:obs.trim()})} disabled={!loteId||!destino}>Confirmar transferencia</Btn>
        </div>
      </>}
    </div>
  </Modal>;
}

// ─── Vista Inventario ─────────────────────────────────────────────────────────
function VistaInventario({estado,setEstado,usuario,esAdmin,onToast}){
  const sedesVisibles=esAdmin?sedesActivas(estado):sedesActivas(estado).filter(s=>s.id===usuario.sede);
  const [sedeActiva,setSedeActiva]=useState(usuario.sede);
  const countPedirSede=sid=>farmsDeSede(estado,sid).filter(f=>totStock(estado.stock[sid]?.[f.id]||[])<=(estado.puntosReorden[sid]?.[f.id]??2)).length;
  return <div className="flex flex-col gap-4">
    {esAdmin&&<PanelResumen estado={estado}/>}
    <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl overflow-x-auto">
      {sedesVisibles.map(sede=>{
        const cp=countPedirSede(sede.id);
        return <button key={sede.id} onClick={()=>setSedeActiva(sede.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition whitespace-nowrap ${sedeActiva===sede.id?"bg-white text-gray-800 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
          {sede.short}
          {cp>0&&<span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{cp}</span>}
        </button>;
      })}
    </div>
    <TablaInventario sedeId={sedeActiva} estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={onToast}/>
  </div>;
}

// ─── Vista Pedidos ────────────────────────────────────────────────────────────
function VistaPedidos({estado,esAdmin,onToast}){
  const [sedeF,setSedeF]=useState("");
  const items=useMemo(()=>{
    const res=[];
    sedesActivas(estado).forEach(sede=>{
      if(sedeF&&sede.id!==sedeF) return;
      farmsDeSede(estado,sede.id).forEach(f=>{
        const tot=totStock(estado.stock[sede.id]?.[f.id]||[]);
        const mn=estado.puntosReorden[sede.id]?.[f.id]??2;
        if(tot<=mn) res.push({sede,farm:f,tot,mn,sugerido:Math.max(0,mn*2-tot)});
      });
    });
    return res;
  },[estado,sedeF]);

  function exportarTxt(){
    const agr={};
    items.forEach(i=>{if(!agr[i.sede.id])agr[i.sede.id]={sede:i.sede,items:[]};agr[i.sede.id].items.push(i);});
    const l=[`PEDIDO / REPOSICIÓN — FUESMEN`,`Fecha: ${fmtF(hoy())}`,``];
    Object.values(agr).forEach(({sede,items:its})=>{
      l.push(`── ${sede.nombre} ──`);
      its.forEach(i=>l.push(`  • ${i.farm.nombre} | Stock: ${i.tot} (mín: ${i.mn}) | Pedir: ~${i.sugerido}`));
      l.push(``);
    });
    l.push(`— RadioFarm · FUESMEN`);
    const a=document.createElement("a");
    a.href="data:text/plain;charset=utf-8,"+encodeURIComponent(l.join("\n"));
    a.download=`pedido_${hoy()}.txt`;a.click();
    onToast("Pedido exportado");
  }

  return <div className="flex flex-col gap-4">
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div><h2 className="text-base font-bold text-gray-800">Lista de pedido</h2><p className="text-xs text-gray-400 mt-0.5">Stock por debajo del mínimo · todas las sedes</p></div>
      <div className="flex gap-2 flex-wrap">
        {esAdmin&&<Sel value={sedeF} onChange={e=>setSedeF(e.target.value)}>
          <option value="">Todas las sedes</option>
          {sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
        {esAdmin&&items.length>0&&<Btn size="sm" variant="outline" onClick={exportarTxt}>↓ .txt</Btn>}
      </div>
    </div>
    {items.length===0
      ?<div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-sm font-bold text-emerald-700">Todo el stock al día</div>
          <div className="text-xs text-emerald-500 mt-1">No hay productos por debajo del mínimo</div>
        </div>
      :<div className="flex flex-col gap-2">
        {sedesActivas(estado).map(sede=>{
          const its=items.filter(i=>i.sede.id===sede.id);
          if(!its.length) return null;
          return <div key={sede.id}>
            <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{sede.nombre}</span>
              <div className="flex-1 h-px bg-gray-100"/><Badge color="red">{its.length} para pedir</Badge>
            </div>
            {its.map(({farm,tot,mn,sugerido})=>(
              <div key={farm.id} className="bg-white border border-red-100 rounded-xl px-4 py-3 shadow-sm flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="font-semibold text-gray-800 text-sm">{farm.nombre}</div>
                  <div className="text-xs text-gray-500 mt-0.5 flex gap-3">
                    <span>Stock: <span className="text-red-600 font-bold">{tot}</span></span>
                    <span>Mín: {mn}</span>
                    {esAdmin&&<span className="text-blue-600 font-semibold">Pedir: ~{sugerido}</span>}
                  </div>
                </div>
                <Badge color="red">PEDIR</Badge>
              </div>
            ))}
          </div>;
        })}
      </div>}
  </div>;
}

// ─── Vista Historial ──────────────────────────────────────────────────────────
const TIPO_INFO = {
  ingreso:               { label:"↑ Ingreso",      color:"green"  },
  egreso:                { label:"↓ Egreso",       color:"red"    },
  transferencia_salida:  { label:"⇄ Transf. salida",color:"teal"  },
  transferencia_entrada: { label:"⇄ Transf. entrada",color:"teal" },
  anulacion:             { label:"⊘ Anulación",    color:"orange" },
};

function VistaHistorial({estado,setEstado,usuario,esAdmin,onToast}){
  const [filtroSede,setFiltroSede]=useState(esAdmin?"":usuario.sede);
  const [filtroF,setFiltroF]=useState(""); const [filtroT,setFiltroT]=useState("");
  const [mAnular,setMAnular]=useState(null);

  const filtrados=useMemo(()=>estado.movimientos.filter(m=>{
    if(filtroSede&&m.sedeId!==filtroSede) return false;
    if(filtroF&&m.farmId!==filtroF) return false;
    if(filtroT&&m.tipo!==filtroT) return false;
    return true;
  }),[estado.movimientos,filtroSede,filtroF,filtroT]);

  // IDs de movimientos ya anulados (para no permitir doble anulación)
  const anulados=useMemo(()=>new Set(estado.movimientos.filter(m=>m.tipo==="anulacion").map(m=>m.anulaId)),[estado.movimientos]);

  function confirmarAnulacion(mov,observacion){
    // Revierte el efecto del movimiento sobre el stock
    const sid=mov.sedeId, fid=mov.farmId;
    let lotes=estado.stock[sid]?.[fid]||[];
    const esEntrada=mov.tipo==="ingreso"||mov.tipo==="transferencia_entrada";
    if(esEntrada){
      // Revertir un ingreso/entrada: descontar. Si fue un lote nuevo (ingreso con loteId), quitarlo o restar.
      if(mov.loteId&&lotes.find(l=>l.id===mov.loteId)){
        lotes=lotes.map(l=>l.id===mov.loteId?{...l,cantidad:Math.max(0,l.cantidad-mov.cantidad)}:l);
      } else {
        // buscar por número de lote
        const t=lotes.find(l=>l.lote===mov.lote);
        if(t) lotes=lotes.map(l=>l===t?{...l,cantidad:Math.max(0,l.cantidad-mov.cantidad)}:l);
      }
    } else {
      // Revertir un egreso/salida: devolver al stock
      if(mov.loteId&&lotes.find(l=>l.id===mov.loteId)){
        lotes=lotes.map(l=>l.id===mov.loteId?{...l,cantidad:l.cantidad+mov.cantidad}:l);
      } else {
        const t=lotes.find(l=>l.lote===mov.lote);
        if(t) lotes=lotes.map(l=>l===t?{...l,cantidad:l.cantidad+mov.cantidad}:l);
        else lotes=[...lotes,{id:uid(),lote:mov.lote,vencimiento:"",cantidad:mov.cantidad,proveedorNombre:""}];
      }
    }
    const movAnul={id:uid(),fecha:new Date().toISOString(),tipo:"anulacion",anulaId:mov.id,
      sedeId:sid,sedeNombre:mov.sedeNombre,farmId:fid,farmNombre:mov.farmNombre,
      cantidad:mov.cantidad,lote:mov.lote,
      motivo:`Anula ${TIPO_INFO[mov.tipo]?.label||mov.tipo} del ${fmtTs(mov.fecha)}`,
      observacion,usuarioNombre:usuario.nombre};
    const nuevo={...estado,stock:{...estado.stock,[sid]:{...estado.stock[sid],[fid]:lotes}},movimientos:[movAnul,...estado.movimientos]};
    guardar(nuevo);setEstado(nuevo);onToast("Movimiento anulado","info");setMAnular(null);
  }

  function exportarCSV(){
    const filas=[["Fecha","Sede","Radiofármaco","Tipo","Cantidad","Lote","Motivo","Observación","Usuario","Anulado"],
      ...filtrados.map(m=>[fmtTs(m.fecha),m.sedeNombre||"—",m.farmNombre,TIPO_INFO[m.tipo]?.label||m.tipo,m.cantidad,m.lote||"—",m.motivo||"—",m.observacion||"—",m.usuarioNombre||"—",anulados.has(m.id)?"SÍ":"—"])];
    const csv=filas.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);a.download=`historial_${hoy()}.csv`;a.click();
  }

  // Movimientos anulables: ingreso/egreso/transferencia (no anulaciones), no ya anulados
  const esAnulable=m=>esAdmin&&m.tipo!=="anulacion"&&!anulados.has(m.id);

  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex gap-2 flex-wrap">
        {esAdmin&&<Sel value={filtroSede} onChange={e=>setFiltroSede(e.target.value)}>
          <option value="">Todas las sedes</option>{sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
        <Sel value={filtroF} onChange={e=>setFiltroF(e.target.value)}>
          <option value="">Todos los radiofármacos</option>{estado.farms.map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}
        </Sel>
        <Sel value={filtroT} onChange={e=>setFiltroT(e.target.value)}>
          <option value="">Todos</option>
          <option value="ingreso">Ingresos</option>
          <option value="egreso">Egresos</option>
          <option value="transferencia_salida">Transf. salida</option>
          <option value="transferencia_entrada">Transf. entrada</option>
          <option value="anulacion">Anulaciones</option>
        </Sel>
      </div>
      {esAdmin&&filtrados.length>0&&<Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>}
    </div>

    {esAdmin&&<div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-700">
      <span className="font-semibold">Trazabilidad:</span> los movimientos no se editan ni se borran. Para corregir un error, usá el botón Anular — genera un movimiento compensatorio que revierte el stock y queda registrado.
    </div>}

    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead><tr className="border-b border-gray-100 bg-gray-50/60">
          {["Fecha","Sede","Radiofármaco","Tipo","Cant.","Lote","Usuario",""].map((h,i)=>(
            <th key={i} className={`px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide ${i<3||i>=5?"text-left":"text-center"}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {filtrados.slice(0,120).map(m=>{
            const info=TIPO_INFO[m.tipo]||{label:m.tipo,color:"gray"};
            const fueAnulado=anulados.has(m.id);
            return <tr key={m.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/30 ${fueAnulado?"opacity-50":""}`}>
              <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTs(m.fecha)}</td>
              <td className="px-3 py-2.5 text-xs text-gray-600 font-medium">
                {SEDES.find(s=>s.id===m.sedeId)?.short||"—"}
                {m.sedeRelacionada&&<span className="text-teal-600"> {m.tipo==="transferencia_salida"?"→":"←"} {SEDES.find(s=>s.nombre===m.sedeRelacionada)?.short||m.sedeRelacionada}</span>}
              </td>
              <td className="px-3 py-2.5 font-medium text-gray-700 text-xs">
                {m.farmNombre}
                {m.observacion&&<div className="text-xs text-gray-400 italic font-normal mt-0.5">“{m.observacion}”</div>}
                {fueAnulado&&<div className="text-xs text-orange-500 font-semibold mt-0.5">ANULADO</div>}
              </td>
              <td className="px-3 py-2.5 text-center"><Badge color={info.color}>{info.label}</Badge></td>
              <td className="px-3 py-2.5 text-center font-bold text-gray-700">{m.cantidad}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{m.lote||"—"}</td>
              <td className="px-3 py-2.5 text-xs text-gray-500">{m.usuarioNombre||"—"}</td>
              <td className="px-3 py-2.5 text-right">
                {esAnulable(m)&&<button onClick={()=>setMAnular(m)} className="text-xs text-orange-500 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50 transition">Anular</button>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
      {filtrados.length===0&&<div className="text-center py-12 text-gray-400 text-sm">Sin movimientos.</div>}
    </div>

    {mAnular&&<ModalAnular mov={mAnular} onConfirm={confirmarAnulacion} onClose={()=>setMAnular(null)}/>}
  </div>;
}

function ModalAnular({mov,onConfirm,onClose}){
  const [obs,setObs]=useState("");
  const info=TIPO_INFO[mov.tipo]||{label:mov.tipo};
  const esEntrada=mov.tipo==="ingreso"||mov.tipo==="transferencia_entrada";
  return <Modal open title="Anular movimiento" onClose={onClose} size="sm">
    <div className="flex flex-col gap-4">
      <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
        Vas a anular: <span className="font-bold">{info.label}</span> de <span className="font-bold">{mov.cantidad}</span> vial{mov.cantidad>1?"es":""} de <span className="font-bold">{mov.farmNombre}</span> ({mov.sedeNombre}), registrado el {fmtTs(mov.fecha)}.
      </div>
      <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
        Efecto en stock: {esEntrada?`se descontarán ${mov.cantidad} viales`:`se devolverán ${mov.cantidad} viales`}. El movimiento original queda en el historial marcado como ANULADO.
      </div>
      <Input label="Motivo de la anulación (obligatorio)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: Estudio cancelado, error de carga..."/>
      <div className="flex gap-2 justify-end">
        <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
        <Btn variant="danger" onClick={()=>onConfirm(mov,obs.trim())} disabled={!obs.trim()}>Confirmar anulación</Btn>
      </div>
    </div>
  </Modal>;
}


// ─── Vista Administración / Actas ARN ────────────────────────────────────────
function VistaAdministracion({estado,setEstado,usuario,esAdmin,onToast}){
  const [tab,setTab]=useState("pacientes");
  return <div className="flex flex-col gap-4">
    <div>
      <h2 className="text-base font-bold text-gray-800">Administración de dosis</h2>
      <p className="text-xs text-gray-400 mt-0.5">Registro equivalente a los Libros de Actas ARN</p>
    </div>
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
      {[{id:"pacientes",label:"Libro 2 — Pacientes"},{id:"marcacion",label:"Libro 1 — Marcación"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${tab===t.id?"bg-white text-gray-800 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
          {t.label}
        </button>
      ))}
    </div>
    {tab==="pacientes"&&<TabPacientes estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={onToast}/>}
    {tab==="marcacion"&&<TabMarcacion estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={onToast}/>}
  </div>;
}

// ─── QR Scanner Component ────────────────────────────────────────────────────
function QRScanner({onResult,onClose}){
  const videoRef = useRef(null);
  const [error,setError]=useState("");
  const [scanning,setScanning]=useState(false);
  const streamRef = useRef(null);

  useEffect(()=>{
    let animFrame;
    async function startCamera(){
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video:{ facingMode:"environment", width:{ideal:1280}, height:{ideal:720} }
        });
        streamRef.current=stream;
        if(videoRef.current){
          videoRef.current.srcObject=stream;
          videoRef.current.play();
          setScanning(true);
        }
      } catch(e){
        setError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
      }
    }
    startCamera();
    return ()=>{
      if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
      cancelAnimationFrame(animFrame);
    };
  },[]);

  // Escaneo con BarcodeDetector API (nativa en Chrome/Android)
  useEffect(()=>{
    if(!scanning||!videoRef.current) return;
    let active=true;
    async function scan(){
      if(!active) return;
      if(!("BarcodeDetector" in window)){
        setError("Tu navegador no soporta escaneo nativo. Ingresá los datos manualmente.");
        return;
      }
      const detector = new window.BarcodeDetector({formats:["qr_code"]});
      async function tick(){
        if(!active||!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if(codes.length>0){
            if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
            onResult(codes[0].rawValue);
            return;
          }
        } catch {}
        if(active) requestAnimationFrame(tick);
      }
      tick();
    }
    scan();
    return ()=>{ active=false; };
  },[scanning]);

  return <Modal open title="Escanear pulsera QR" onClose={()=>{
    if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    onClose();
  }} size="md">
    <div className="flex flex-col gap-4">
      {error
        ? <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
        : <>
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted/>
            {/* Marco de escaneo */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-blue-400 rounded-xl opacity-80">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl"/>
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr"/>
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl"/>
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br"/>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center">Apuntá la cámara al QR de la pulsera del paciente</p>
        </>}
      <Btn variant="outline" onClick={()=>{
        if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
        onClose();
      }}>Cancelar</Btn>
    </div>
  </Modal>;
}

function parseQR(raw){
  // Formato: nombre|dni|peso|talla|estudio
  const parts = raw.split("|");
  if(parts.length>=2) return {
    pacienteNombre: parts[0]?.trim()||"",
    pacienteDni:    parts[1]?.trim()||"",
    peso:           parseFloat(parts[2])||"",
    talla:          parseFloat(parts[3])||"",
    estudio:        parts[4]?.trim()||"",
  };
  return null;
}

// ─── Tab Pacientes (Libro 2) ─────────────────────────────────────────────────
function TabPacientes({estado,setEstado,usuario,esAdmin,onToast}){
  const [mostrarForm,setMostrarForm]=useState(false);
  const [mostrarQR,setMostrarQR]=useState(false);
  const [filtroFecha,setFiltroFecha]=useState(hoy());
  const [filtroSede,setFiltroSede]=useState(usuario.sede);

  // Form fields
  const [nombre,setNombre]=useState(""); const [dni,setDni]=useState("");
  const [peso,setPeso]=useState(""); const [talla,setTalla]=useState("");
  const [estudio,setEstudio]=useState(""); const [mci,setMci]=useState("");
  const [farmId,setFarmId]=useState(""); const [lote,setLote]=useState("");
  const [obs,setObs]=useState("");
  const [sedeId,setSedeId]=useState(usuario.sede);

  const ESTUDIOS=[
    "Centellograma de perfusión miocárdica","Centellograma óseo","Centellograma renal con DMSA",
    "Renograma con DTPA","Centellograma pulmonar","Centellograma hepatobiliar",
    "Centellograma de infección/inflamación","Centellograma cerebral","Otro"
  ];

  function handleQRResult(raw){
    setMostrarQR(false);
    const data=parseQR(raw);
    if(data){
      setNombre(data.pacienteNombre); setDni(data.pacienteDni);
      setPeso(data.peso); setTalla(data.talla); setEstudio(data.estudio||"");
      setMostrarForm(true);
      onToast("Pulsera leída correctamente","success");
    } else {
      onToast("QR no reconocido. Ingresá los datos manualmente.","error");
      setMostrarForm(true);
    }
  }

  function limpiarForm(){
    setNombre("");setDni("");setPeso("");setTalla("");setEstudio("");setMci("");setFarmId("");setLote("");setObs("");
    setSedeId(usuario.sede);
  }

  function guardar(){
    if(!nombre.trim()||!dni.trim()||!mci||!estudio) return;
    const farm=estado.farms.find(f=>f.id===farmId);
    const reg={id:uid(),fecha:new Date().toISOString(),tipo:"paciente",
      sedeId,sedeNombre:SEDES.find(s=>s.id===sedeId)?.nombre,
      pacienteNombre:nombre.trim(),pacienteDni:dni.trim(),
      peso:parseFloat(peso)||0,talla:parseFloat(talla)||0,
      estudio,mciAdministrados:parseFloat(mci)||0,
      farmId,farmNombre:farm?.nombre||"",lote,
      usuarioNombre:usuario.nombre,observacion:obs.trim()};
    const nuevo={...estado,actas:[reg,...(estado.actas||[])]};
    guardar(nuevo);setEstado(nuevo);
    onToast("Registro guardado");limpiarForm();setMostrarForm(false);
  }

  const actas=(estado.actas||[]).filter(a=>{
    if(a.tipo!=="paciente") return false;
    if(filtroFecha&&!a.fecha.startsWith(filtroFecha)) return false;
    if(filtroSede&&a.sedeId!==filtroSede) return false;
    return true;
  });

  // Lotes disponibles para la sede y farmaco seleccionado
  const lotesDisp=(estado.stock[sedeId]?.[farmId]||[]).filter(l=>l.cantidad>0);

  function exportarCSV(){
    const filas=[["Fecha","Hora","Sede","Paciente","DNI","Peso (kg)","Talla (cm)","Estudio","Radiofármaco","Lote","mCi administrados","Técnico","Observación"],
      ...actas.map(a=>{
        const d=new Date(a.fecha);
        return[d.toLocaleDateString("es-AR"),d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}),
          a.sedeNombre,a.pacienteNombre,a.pacienteDni,a.peso,a.talla,a.estudio,a.farmNombre||"—",a.lote||"—",a.mciAdministrados,a.usuarioNombre,a.observacion||"—"];
      })];
    const csv=filas.map(r=>r.map(x=>`"${x}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);
    a.download=`libro2_pacientes_${filtroFecha||hoy()}.csv`;a.click();
    onToast("Libro 2 exportado");
  }

  return <div className="flex flex-col gap-4">
    {/* Barra de acciones */}
    <div className="flex flex-wrap gap-2 items-center justify-between">
      <div className="flex gap-2 flex-wrap">
        <Input type="date" value={filtroFecha} onChange={e=>setFiltroFecha(e.target.value)}/>
        {esAdmin&&<Sel value={filtroSede} onChange={e=>setFiltroSede(e.target.value)}>
          <option value="">Todas las sedes</option>
          {sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
      </div>
      <div className="flex gap-2">
        {actas.length>0&&<Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>}
        <Btn size="sm" variant="primary" onClick={()=>setMostrarQR(true)}>
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
            </svg>
            Escanear pulsera
          </span>
        </Btn>
        <Btn size="sm" variant="ghost" onClick={()=>{limpiarForm();setMostrarForm(true)}}>+ Manual</Btn>
      </div>
    </div>

    {/* Formulario de registro */}
    {mostrarForm&&<div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-800">Nuevo registro de paciente</h3>
        <button onClick={()=>{setMostrarForm(false);limpiarForm();}} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Apellido y nombre" value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="García Juan"/>
        <Input label="DNI" value={dni} onChange={e=>setDni(e.target.value)} placeholder="28456789"/>
        <Input label="Peso (kg)" type="number" min={0} value={peso} onChange={e=>setPeso(e.target.value)} placeholder="78"/>
        <Input label="Talla (cm)" type="number" min={0} value={talla} onChange={e=>setTalla(e.target.value)} placeholder="172"/>
        <div className="sm:col-span-2">
          <Sel label="Estudio" value={estudio} onChange={e=>setEstudio(e.target.value)}>
            <option value="">Seleccionar estudio...</option>
            {ESTUDIOS.map(e=><option key={e}>{e}</option>)}
          </Sel>
        </div>
        {esAdmin&&<Sel label="Sede" value={sedeId} onChange={e=>{setSedeId(e.target.value);setFarmId("");setLote("");}}>
          {sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
        <Sel label="Radiofármaco utilizado" value={farmId} onChange={e=>{setFarmId(e.target.value);setLote("");}}>
          <option value="">Seleccionar...</option>
          {farmsDeSede(estado,sedeId).map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}
        </Sel>
        <Sel label="Lote" value={lote} onChange={e=>setLote(e.target.value)} disabled={!farmId}>
          <option value="">Seleccionar lote...</option>
          {lotesDisp.map(l=><option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
        </Sel>
        <Input label="Dosis administrada (mCi)" type="number" min={0} step={0.1} value={mci} onChange={e=>setMci(e.target.value)} placeholder="10.5"/>
        <Input label="Observación (opcional)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: paciente con marcapasos"/>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Btn variant="outline" onClick={()=>{setMostrarForm(false);limpiarForm();}}>Cancelar</Btn>
        <Btn onClick={guardar} disabled={!nombre.trim()||!dni.trim()||!mci||!estudio}>Guardar registro</Btn>
      </div>
    </div>}

    {/* Tabla de registros del día */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          {filtroFecha?`Registros del ${fmtF(filtroFecha)}`:"Todos los registros"}
        </span>
        <Badge color="blue">{actas.length} paciente{actas.length!==1?"s":""}</Badge>
      </div>
      <table className="w-full text-sm min-w-[700px]">
        <thead><tr className="border-b border-gray-100 bg-gray-50/60">
          {["Hora","Paciente","DNI","Estudio","Radiofármaco / Lote","Dosis (mCi)","Técnico"].map((h,i)=>(
            <th key={h} className={`px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide ${i===0||i>=4?"text-left":"text-left"}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {actas.map(a=>{
            const d=new Date(a.fecha);
            return <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
              <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</td>
              <td className="px-3 py-2.5 font-semibold text-gray-800 text-xs">
                {a.pacienteNombre}
                {(a.peso||a.talla)&&<div className="text-xs font-normal text-gray-400">{a.peso&&`${a.peso}kg`}{a.talla&&` · ${a.talla}cm`}</div>}
              </td>
              <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.pacienteDni}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700">{a.estudio}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700">
                {a.farmNombre||"—"}
                {a.lote&&<div className="text-xs text-gray-400 font-mono">{a.lote}</div>}
              </td>
              <td className="px-3 py-2.5">
                <span className="font-bold text-blue-700 text-sm">{a.mciAdministrados}</span>
                <span className="text-xs text-gray-400 ml-1">mCi</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {actas.length===0&&<div className="text-center py-12 text-gray-400 text-sm">No hay registros para la fecha seleccionada.</div>}
    </div>

    {mostrarQR&&<QRScanner onResult={handleQRResult} onClose={()=>setMostrarQR(false)}/>}
  </div>;
}

// ─── Tab Marcación (Libro 1) ─────────────────────────────────────────────────
function TabMarcacion({estado,setEstado,usuario,esAdmin,onToast}){
  const [mostrarForm,setMostrarForm]=useState(false);
  const [filtroFecha,setFiltroFecha]=useState(hoy());
  const [filtroSede,setFiltroSede]=useState(usuario.sede);

  const [farmId,setFarmId]=useState(""); const [lote,setLote]=useState("");
  const [mciMarcacion,setMciMarcacion]=useState(""); const [obs,setObs]=useState("");
  const [sedeId,setSedeId]=useState(usuario.sede);

  const lotesDisp=(estado.stock[sedeId]?.[farmId]||[]).filter(l=>l.cantidad>0);

  function guardar(){
    if(!farmId||!mciMarcacion) return;
    const farm=estado.farms.find(f=>f.id===farmId);
    const reg={id:uid(),fecha:new Date().toISOString(),tipo:"marcacion",
      sedeId,sedeNombre:SEDES.find(s=>s.id===sedeId)?.nombre,
      farmId,farmNombre:farm?.nombre||"",lote,
      mciMarcacion:parseFloat(mciMarcacion)||0,
      usuarioNombre:usuario.nombre,observacion:obs.trim()};
    const nuevo={...estado,actas:[reg,...(estado.actas||[])]};
    guardar(nuevo);setEstado(nuevo);
    onToast("Marcación registrada");
    setFarmId("");setLote("");setMciMarcacion("");setObs("");setMostrarForm(false);
  }

  const actas=(estado.actas||[]).filter(a=>{
    if(a.tipo!=="marcacion") return false;
    if(filtroFecha&&!a.fecha.startsWith(filtroFecha)) return false;
    if(filtroSede&&a.sedeId!==filtroSede) return false;
    return true;
  });

  function exportarCSV(){
    const filas=[["Fecha","Hora","Sede","Radiofármaco","Lote","mCi marcación","Técnico","Observación"],
      ...actas.map(a=>{
        const d=new Date(a.fecha);
        return[d.toLocaleDateString("es-AR"),d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}),
          a.sedeNombre,a.farmNombre,a.lote||"—",a.mciMarcacion,a.usuarioNombre,a.observacion||"—"];
      })];
    const csv=filas.map(r=>r.map(x=>`"${x}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);
    a.download=`libro1_marcacion_${filtroFecha||hoy()}.csv`;a.click();
    onToast("Libro 1 exportado");
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap gap-2 items-center justify-between">
      <div className="flex gap-2 flex-wrap">
        <Input type="date" value={filtroFecha} onChange={e=>setFiltroFecha(e.target.value)}/>
        {esAdmin&&<Sel value={filtroSede} onChange={e=>setFiltroSede(e.target.value)}>
          <option value="">Todas las sedes</option>
          {sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
      </div>
      <div className="flex gap-2">
        {actas.length>0&&<Btn size="sm" variant="outline" onClick={exportarCSV}>↓ CSV</Btn>}
        <Btn size="sm" variant="primary" onClick={()=>setMostrarForm(true)}>+ Registrar marcación</Btn>
      </div>
    </div>

    {mostrarForm&&<div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-800">Nueva marcación</h3>
        <button onClick={()=>setMostrarForm(false)} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {esAdmin&&<Sel label="Sede" value={sedeId} onChange={e=>{setSedeId(e.target.value);setFarmId("");setLote("");}}>
          {sedesActivas(estado).map(s=><option key={s.id} value={s.id}>{s.short}</option>)}
        </Sel>}
        <Sel label="Radiofármaco" value={farmId} onChange={e=>{setFarmId(e.target.value);setLote("");}}>
          <option value="">Seleccionar...</option>
          {farmsDeSede(estado,sedeId).map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}
        </Sel>
        <Sel label="Lote" value={lote} onChange={e=>setLote(e.target.value)} disabled={!farmId}>
          <option value="">Seleccionar lote...</option>
          {lotesDisp.map(l=><option key={l.id} value={l.lote}>{l.lote} · Venc: {fmtF(l.vencimiento)}</option>)}
        </Sel>
        <Input label="mCi utilizados en marcación" type="number" min={0} step={0.1} value={mciMarcacion} onChange={e=>setMciMarcacion(e.target.value)} placeholder="20"/>
        <Input label="Observación (opcional)" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ej: rendimiento del kit, incidencias..."/>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Btn variant="outline" onClick={()=>setMostrarForm(false)}>Cancelar</Btn>
        <Btn onClick={guardar} disabled={!farmId||!mciMarcacion}>Guardar marcación</Btn>
      </div>
    </div>}

    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          {filtroFecha?`Marcaciones del ${fmtF(filtroFecha)}`:"Todas las marcaciones"}
        </span>
        <Badge color="blue">{actas.length} registro{actas.length!==1?"s":""}</Badge>
      </div>
      <table className="w-full text-sm min-w-[560px]">
        <thead><tr className="border-b border-gray-100 bg-gray-50/60">
          {["Hora","Sede","Radiofármaco","Lote","mCi marcación","Técnico","Observación"].map(h=>(
            <th key={h} className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide text-left">{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {actas.map(a=>{
            const d=new Date(a.fecha);
            return <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
              <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</td>
              <td className="px-3 py-2.5 text-xs text-gray-600">{SEDES.find(s=>s.id===a.sedeId)?.short||"—"}</td>
              <td className="px-3 py-2.5 text-xs font-semibold text-gray-800">{a.farmNombre}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{a.lote||"—"}</td>
              <td className="px-3 py-2.5"><span className="font-bold text-blue-700 text-sm">{a.mciMarcacion}</span><span className="text-xs text-gray-400 ml-1">mCi</span></td>
              <td className="px-3 py-2.5 text-xs text-gray-500">{a.usuarioNombre}</td>
              <td className="px-3 py-2.5 text-xs text-gray-400 italic">{a.observacion||"—"}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {actas.length===0&&<div className="text-center py-12 text-gray-400 text-sm">No hay marcaciones para la fecha seleccionada.</div>}
    </div>
  </div>;
}

// ─── Vista Configuración (solo admin) ────────────────────────────────────────
function VistaConfiguracion({estado,setEstado,onToast}){
  const [tab,setTab]=useState("catalogo");
  return <div className="flex flex-col gap-4">
    <div>
      <h2 className="text-base font-bold text-gray-800">Configuración</h2>
      <p className="text-xs text-gray-400 mt-0.5">Catálogo de radiofármacos y asignación por sede</p>
    </div>
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
      {[{id:"catalogo",label:"Catálogo"},{id:"sedes",label:"Asignación por sede"},{id:"activas",label:"Sedes activas"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${tab===t.id?"bg-white text-gray-800 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
          {t.label}
        </button>
      ))}
    </div>
    {tab==="catalogo"&&<TabCatalogo estado={estado} setEstado={setEstado} onToast={onToast}/>}
    {tab==="sedes"&&<TabSedes estado={estado} setEstado={setEstado} onToast={onToast}/>}
    {tab==="activas"&&<TabSedesActivas estado={estado} setEstado={setEstado} onToast={onToast}/>}
  </div>;
}

function TabCatalogo({estado,setEstado,onToast}){
  const [mNuevo,setMNuevo]=useState(false); const [mEditar,setMEditar]=useState(null);
  const [nombre,setNombre]=useState(""); const [kit,setKit]=useState(1);

  function agregar(){
    if(!nombre.trim()) return;
    const id=slugify(nombre)+"-"+Date.now().toString().slice(-4);
    const nuevo={id,nombre:nombre.trim(),viales_x_kit:parseInt(kit)||1};
    const e={...estado,farms:[...estado.farms,nuevo]};
    guardar(e);setEstado(e);onToast(`${nuevo.nombre} agregado al catálogo`);setNombre("");setKit(1);setMNuevo(false);
  }

  function guardarEdicion(){
    if(!mEditar||!nombre.trim()) return;
    const e={...estado,farms:estado.farms.map(f=>f.id===mEditar.id?{...f,nombre:nombre.trim(),viales_x_kit:parseInt(kit)||1}:f)};
    guardar(e);setEstado(e);onToast("Radiofármaco actualizado");setMEditar(null);
  }

  function eliminar(farm){
    // Verificar que no tiene stock en ninguna sede
    const conStock=SEDES.some(s=>totStock(estado.stock[s.id]?.[farm.id]||[])>0);
    if(conStock){onToast("No se puede eliminar: tiene stock en alguna sede","error");return;}
    const e={...estado,
      farms:estado.farms.filter(f=>f.id!==farm.id),
      sedeFarms:Object.fromEntries(Object.entries(estado.sedeFarms).map(([sid,fids])=>[sid,fids.filter(id=>id!==farm.id)]))
    };
    guardar(e);setEstado(e);onToast(`${farm.nombre} eliminado del catálogo`);
  }

  function abrirEditar(f){setMEditar(f);setNombre(f.nombre);setKit(f.viales_x_kit);}
  function abrirNuevo(){setNombre("");setKit(1);setMNuevo(true);}

  return <>
    <div className="flex justify-end mb-1">
      <Btn size="sm" onClick={abrirNuevo}>+ Nuevo radiofármaco</Btn>
    </div>
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 bg-gray-50/60">
          <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Nombre</th>
          <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Presentación</th>
          <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Sedes activas</th>
          <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Acciones</th>
        </tr></thead>
        <tbody>
          {estado.farms.map(f=>{
            const sedesActivas=SEDES.filter(s=>(estado.sedeFarms[s.id]||[]).includes(f.id));
            return <tr key={f.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
              <td className="px-4 py-3 font-semibold text-gray-800 text-sm">{f.nombre}</td>
              <td className="px-4 py-3 text-center">
                {f.viales_x_kit>1
                  ?<Badge color="blue">Kit {f.viales_x_kit} viales</Badge>
                  :<Badge color="gray">Por unidad</Badge>}
              </td>
              <td className="px-4 py-3 text-center">
                <div className="flex flex-wrap gap-1 justify-center">
                  {sedesActivas.length===0
                    ?<Badge color="gray">Ninguna</Badge>
                    :sedesActivas.map(s=><Badge key={s.id} color="teal">{s.short}</Badge>)}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1.5 justify-end">
                  <Btn size="sm" variant="ghost" onClick={()=>abrirEditar(f)}>Editar</Btn>
                  <Btn size="sm" variant="ghost" onClick={()=>eliminar(f)}>Quitar</Btn>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    {/* Modal nuevo */}
    <Modal open={mNuevo} title="Nuevo radiofármaco" onClose={()=>setMNuevo(false)} size="sm">
      <FormFarm nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit}
        onConfirm={agregar} onCancel={()=>setMNuevo(false)} confirmLabel="Agregar"/>
    </Modal>

    {/* Modal editar */}
    <Modal open={!!mEditar} title={`Editar — ${mEditar?.nombre}`} onClose={()=>setMEditar(null)} size="sm">
      <FormFarm nombre={nombre} setNombre={setNombre} kit={kit} setKit={setKit}
        onConfirm={guardarEdicion} onCancel={()=>setMEditar(null)} confirmLabel="Guardar cambios"/>
    </Modal>
  </>;
}

function FormFarm({nombre,setNombre,kit,setKit,onConfirm,onCancel,confirmLabel}){
  return <div className="flex flex-col gap-4">
    <Input label="Nombre" value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Ej: Macroagregados de Albúmina"/>
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">Presentación del distribuidor</label>
      <div className="flex gap-2">
        <button onClick={()=>setKit(1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${kit===1||kit==="1"?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          Por unidad
        </button>
        <button onClick={()=>setKit(k=>(k===1||k==="1")?5:k)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${(kit>1||kit>"1")?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          En kit
        </button>
      </div>
      {(kit>1||kit>"1")&&<Input label="Viales por kit" type="number" min={2} max={50} value={kit} onChange={e=>setKit(parseInt(e.target.value)||2)}/>}
    </div>
    {(kit>1||kit>"1")&&<div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
      Al ingresar, se pedirá cantidad de kits y se calculará automáticamente el total de viales.
    </div>}
    <div className="flex gap-2 justify-end">
      <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
      <Btn onClick={onConfirm} disabled={!nombre.trim()}>{confirmLabel}</Btn>
    </div>
  </div>;
}

function TabSedesActivas({estado,setEstado,onToast}){
  const activas=idsSedesActivas(estado);

  function toggleSede(sedeId){
    if(sedeId==="central") return; // Central siempre activa
    const nuevas=activas.includes(sedeId)
      ? activas.filter(id=>id!==sedeId)
      : [...activas, sedeId];
    const nuevo={...estado, sedesActivas:nuevas};
    guardar(nuevo);setEstado(nuevo);
    const sede=SEDES.find(s=>s.id===sedeId);
    onToast(activas.includes(sedeId)
      ? `${sede?.short} desactivada — oculta en toda la app`
      : `${sede?.short} activada`);
  }

  return <div className="flex flex-col gap-4">
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
      <span className="font-semibold">Modo piloto:</span> desactivá las sedes que aún no operan con la app. Las sedes desactivadas desaparecen del inventario, pedidos, historial y actas, pero <span className="font-semibold">sus datos se conservan intactos</span> y reaparecen al reactivarlas. FUESMEN Central no se puede desactivar.
    </div>
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {SEDES.map((s,i)=>{
        const activa=activas.includes(s.id);
        const esCentral=s.id==="central";
        const usuariosSede=USUARIOS.filter(u=>u.sede===s.id&&u.rol!=="admin").length;
        return <div key={s.id} className={`flex items-center justify-between px-5 py-4 ${i<SEDES.length-1?"border-b border-gray-50":""} ${!activa?"bg-gray-50/50":""}`}>
          <div>
            <div className={`font-semibold text-sm ${activa?"text-gray-800":"text-gray-400"}`}>{s.nombre}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {esCentral
                ? "Sede principal — siempre activa"
                : activa ? `Operativa · ${usuariosSede} técnico${usuariosSede!==1?"s":""} asignado${usuariosSede!==1?"s":""}` : "Desactivada — datos conservados"}
            </div>
          </div>
          {esCentral
            ? <Badge color="blue">Siempre activa</Badge>
            : <button onClick={()=>toggleSede(s.id)}
                className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${activa?"bg-blue-600":"bg-gray-200"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${activa?"translate-x-5":"translate-x-0"}`}/>
              </button>}
        </div>;
      })}
    </div>
  </div>;
}

function TabSedes({estado,setEstado,onToast}){
  const [sedeActiva,setSedeActiva]=useState("central");

  function toggleFarm(farmId){
    const actuales=estado.sedeFarms[sedeActiva]||[];
    const nuevos=actuales.includes(farmId)?actuales.filter(id=>id!==farmId):[...actuales,farmId];
    // Si se desactiva, verificar que no tenga stock
    if(actuales.includes(farmId)){
      const conStock=totStock(estado.stock[sedeActiva]?.[farmId]||[])>0;
      if(conStock){onToast("Tiene stock activo en esta sede. Primero registrá el egreso.","error");return;}
    }
    const e={...estado,sedeFarms:{...estado.sedeFarms,[sedeActiva]:nuevos}};
    guardar(e);setEstado(e);
    const farm=estado.farms.find(f=>f.id===farmId);
    onToast(actuales.includes(farmId)?`${farm?.nombre} quitado de ${SEDES.find(s=>s.id===sedeActiva)?.short}`:`${farm?.nombre} agregado a ${SEDES.find(s=>s.id===sedeActiva)?.short}`);
  }

  const activos=estado.sedeFarms[sedeActiva]||[];

  return <div className="flex flex-col gap-4">
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
      {SEDES.map(s=>(
        <button key={s.id} onClick={()=>setSedeActiva(s.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${sedeActiva===s.id?"bg-white text-gray-800 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
          {s.short}
        </button>
      ))}
    </div>
    <p className="text-xs text-gray-500">
      Activá o desactivá radiofármacos para <span className="font-semibold text-gray-700">{SEDES.find(s=>s.id===sedeActiva)?.nombre}</span>.
      Los desactivados dejan de aparecer en el inventario de esa sede.
    </p>
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {estado.farms.map((f,i)=>{
        const activo=activos.includes(f.id);
        const conStock=totStock(estado.stock[sedeActiva]?.[f.id]||[])>0;
        return <div key={f.id} className={`flex items-center justify-between px-5 py-3.5 ${i<estado.farms.length-1?"border-b border-gray-50":""} hover:bg-gray-50/40 transition`}>
          <div>
            <div className={`font-semibold text-sm ${activo?"text-gray-800":"text-gray-400"}`}>{f.nombre}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {f.viales_x_kit>1?`Kit ${f.viales_x_kit}u`:"Por unidad"}
              {activo&&conStock&&<span className="ml-2 text-emerald-600 font-medium">· {totStock(estado.stock[sedeActiva]?.[f.id]||[])} viales en stock</span>}
            </div>
          </div>
          <button onClick={()=>toggleFarm(f.id)}
            className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${activo?"bg-blue-600":"bg-gray-200"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${activo?"translate-x-5":"translate-x-0"}`}/>
          </button>
        </div>;
      })}
    </div>
  </div>;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [usuario,setUsuario]=useState(null);
  const [estado,setEstado]=useState(cargar);
  const [vista,setVista]=useState("inventario");
  const [toast,setToast]=useState(null);
  const esAdmin=usuario?.rol==="admin";

  const countPedirTotal=useMemo(()=>{
    let n=0;
    sedesActivas(estado).forEach(sede=>farmsDeSede(estado,sede.id).forEach(f=>{
      if(totStock(estado.stock[sede.id]?.[f.id]||[])<=(estado.puntosReorden[sede.id]?.[f.id]??2)) n++;
    }));
    return n;
  },[estado]);

  const navItems=[
    {id:"inventario",label:"Inventario",path:"M4 6h16M4 10h16M4 14h16M4 18h16"},
    {id:"pedidos",label:"Pedidos",path:"M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"},
    {id:"historial",label:"Historial",path:"M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"},
    {id:"administracion",label:"Actas ARN",path:"M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"},
    ...(esAdmin?[{id:"configuracion",label:"Config.",path:"M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"}]:[]),
  ];

  if(!usuario) return <PantallaLogin onLogin={u=>{setUsuario(u);setVista("inventario");}}/>;

  // Bloqueo para técnicos de sedes desactivadas (la encargada siempre entra)
  if(!esAdmin && !idsSedesActivas(estado).includes(usuario.sede)){
    const sede=SEDES.find(s=>s.id===usuario.sede);
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <h2 className="text-base font-bold text-gray-800 mb-2">Sede no habilitada</h2>
        <p className="text-sm text-gray-500 mb-6">
          {sede?.nombre} aún no está operando con RadioFarm. Consultá con la encargada de radiofarmacia.
        </p>
        <Btn variant="outline" onClick={()=>setUsuario(null)}>Volver al inicio</Btn>
      </div>
    </div>;
  }

  return <div className="min-h-screen bg-gray-50 font-sans">
    <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800 leading-tight">RadioFarm</div>
            <div className="text-xs text-gray-400 leading-tight">{SEDES.find(s=>s.id===usuario.sede)?.nombre||"FUESMEN"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {countPedirTotal>0&&<button onClick={()=>setVista("pedidos")}
            className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full hover:bg-red-100 transition">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>{countPedirTotal} para pedir
          </button>}
          <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${esAdmin?"bg-purple-500":"bg-blue-500"}`}>{usuario.initial}</div>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold text-gray-700 leading-tight">{usuario.nombre}</div>
              <div className="text-xs leading-tight"><Badge color={esAdmin?"purple":"blue"}>{esAdmin?"Encargada":"Técnico"}</Badge></div>
            </div>
            <button onClick={()=>{setUsuario(null);setVista("inventario");}} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <nav className="bg-white border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 flex gap-0 overflow-x-auto">
        {navItems.map(item=>(
          <button key={item.id} onClick={()=>setVista(item.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${vista===item.id?"border-blue-600 text-blue-600":"border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200"}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.path}/>
            </svg>
            <span className="hidden sm:inline">{item.label}</span>
            {item.id==="pedidos"&&countPedirTotal>0&&<span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{countPedirTotal}</span>}
          </button>
        ))}
      </div>
    </nav>

    <main className="max-w-5xl mx-auto px-4 py-6">
      {vista==="inventario"    &&<VistaInventario estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={(m,t)=>setToast({m,t})}/>}
      {vista==="pedidos"       &&<VistaPedidos estado={estado} esAdmin={esAdmin} onToast={(m,t)=>setToast({m,t})}/>}
      {vista==="historial"     &&<VistaHistorial estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={(m,t)=>setToast({m,t})}/>}
      {vista==="administracion"&&<VistaAdministracion estado={estado} setEstado={setEstado} usuario={usuario} esAdmin={esAdmin} onToast={(m,t)=>setToast({m,t})}/>}
      {vista==="configuracion" &&esAdmin&&<VistaConfiguracion estado={estado} setEstado={setEstado} onToast={(m,t)=>setToast({m,t})}/>}
    </main>

    {toast&&<Toast msg={toast.m} type={toast.t||"success"} onDone={()=>setToast(null)}/>}
  </div>;
}
