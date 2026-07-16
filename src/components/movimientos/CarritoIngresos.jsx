import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Badge } from "../ui/Badge.jsx";
import { fmtF } from "../../helpers/formato.js";

// Barra fija que aparece mientras haya ítems sin cargar -- abre el resumen.
export function BarraCarritoIngresos({ cantidad, onAbrir }) {
  if (!cantidad) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
      <span className="text-xs font-semibold text-emerald-700">
        🛒 {cantidad} ingreso{cantidad > 1 ? "s" : ""} pendiente{cantidad > 1 ? "s" : ""} de cargar
      </span>
      <Btn size="sm" variant="success" onClick={onAbrir}>Ver y cargar</Btn>
    </div>
  );
}

const ESTADO_INFO = {
  enviando: { color: "blue", label: "Cargando..." },
  error: { color: "red", label: "Error" },
};

// Resumen + confirmación final. Antes de confirmar, cada ítem se puede
// editar o quitar. Al confirmar, cada ítem se envía por separado (no un
// solo batch con todos) para que uno con problema no tumbe a los demás --
// ver services/firestore/stock.js#ingresoBatch, cada llamada ya es atómica
// sola. Los que cargan bien (o quedan encolados sin conexión) se sacan de
// la lista al toque; los que fallan de verdad se quedan para reintentar o
// quitar, nunca se pierden solos.
export function CarritoIngresos({ open, items, onEditar, onQuitar, onReintentar, onConfirmarTodo, onCerrar }) {
  const hayErrores = items.some((it) => it.estado === "error");
  const enviando = items.some((it) => it.estado === "enviando");
  const multiSede = new Set(items.map((it) => it.sedeId)).size > 1;

  return (
    <Modal open={open} title={`Carrito de ingresos (${items.length})`} onClose={onCerrar} size="lg">
      <div className="flex flex-col gap-4">
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Carrito vacío.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((it) => {
              const info = ESTADO_INFO[it.estado];
              return (
                <div key={it.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800">{it.farm.nombre}</span>
                      {info && <Badge color={info.color}>{info.label}</Badge>}
                      {multiSede && <Badge color="gray">{it.sedeNombre}</Badge>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Lote {it.lote} · Venc: {fmtF(it.vencimiento)} · {it.cantidad} viales{it.proveedorNombre ? ` · ${it.proveedorNombre}` : ""}
                    </div>
                    {it.estado === "error" && <div className="text-xs text-red-600 mt-0.5">{it.errorMsg}</div>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {it.estado === "error" ? (
                      <Btn size="sm" variant="ghost" onClick={() => onReintentar(it)}>Reintentar</Btn>
                    ) : (
                      <Btn size="sm" variant="ghost" onClick={() => onEditar(it)} disabled={it.estado === "enviando"}>Editar</Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => onQuitar(it.id)} disabled={it.estado === "enviando"}>Quitar</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {hayErrores && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            Algunos ingresos no se pudieron cargar. Reintentalos o quitalos -- los demás ya se cargaron y no van a duplicarse.
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onCerrar}>Cerrar</Btn>
          <Btn variant="success" onClick={onConfirmarTodo} disabled={items.length === 0 || enviando}>
            {enviando ? "Cargando..." : `Cargar ${items.length} ingreso${items.length > 1 ? "s" : ""}`}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
