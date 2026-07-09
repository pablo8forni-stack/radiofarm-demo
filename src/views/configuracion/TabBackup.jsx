import { useRef, useState } from "react";
import { Btn } from "../../components/ui/Btn.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { exportarBackup, importarBackup } from "../../services/firestore/backup.js";
import { sembrarCatalogoInicial } from "../../services/firestore/seed.js";

const PALABRA_CONFIRMACION = "RESTAURAR";

export function TabBackup({ catalogo, onToast }) {
  const [exportando, setExportando] = useState(false);
  const [archivoPendiente, setArchivoPendiente] = useState(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [restaurando, setRestaurando] = useState(false);
  const [sembrando, setSembrando] = useState(false);
  const inputRef = useRef(null);

  async function handleSembrar() {
    setSembrando(true);
    try {
      await sembrarCatalogoInicial();
      onToast("Catálogo inicial sembrado: 11 radiofármacos, 4 sedes, 1 proveedor");
    } catch (e) {
      onToast(e.message || "No se pudo sembrar el catálogo", "error");
    } finally {
      setSembrando(false);
    }
  }

  async function handleExportar() {
    setExportando(true);
    try {
      await exportarBackup();
      onToast("Backup exportado");
    } catch (e) {
      onToast(e.message || "No se pudo exportar el backup", "error");
    } finally {
      setExportando(false);
    }
  }

  function handleElegirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        setArchivoPendiente(json);
        setConfirmacion("");
      } catch {
        onToast("El archivo no es un JSON válido", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function confirmarRestauracion() {
    setRestaurando(true);
    try {
      await importarBackup(archivoPendiente);
      onToast("Backup restaurado correctamente");
      setArchivoPendiente(null);
    } catch (e) {
      onToast(e.message || "No se pudo restaurar el backup", "error");
    } finally {
      setRestaurando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {catalogo.farms.length === 0 && (
        <div className="bg-emerald-50 rounded-2xl shadow-sm border border-emerald-100 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-gray-800">Sembrar catálogo inicial</h3>
          <p className="text-xs text-emerald-700">
            El catálogo está vacío. Este botón carga los 11 radiofármacos, las 4 sedes (con FUESMEN Central activa) y el proveedor por defecto — sin stock ni movimientos falsos. Sólo aparece cuando no hay ningún radiofármaco cargado todavía.
          </p>
          <div><Btn variant="success" onClick={handleSembrar} disabled={sembrando}>{sembrando ? "Sembrando..." : "Sembrar catálogo inicial"}</Btn></div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
        <h3 className="text-sm font-bold text-gray-800">Exportar backup</h3>
        <p className="text-xs text-gray-500">
          Descarga un JSON con catálogo, sedes, stock (lotes) y proveedores. No incluye movimientos ni actas — son inmutables, siempre viven solo en Firestore.
        </p>
        <div><Btn onClick={handleExportar} disabled={exportando}>{exportando ? "Exportando..." : "↓ Descargar backup"}</Btn></div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5 flex flex-col gap-3">
        <h3 className="text-sm font-bold text-gray-800">Restaurar desde backup</h3>
        <p className="text-xs text-red-600">
          Acción destructiva: sobrescribe catálogo, sedes y stock actuales con lo que traiga el archivo. Pensada para recuperación ante desastre, no para uso diario. No toca movimientos, actas ni usuarios.
        </p>
        <div>
          <input ref={inputRef} type="file" accept="application/json" onChange={handleElegirArchivo} className="hidden" />
          <Btn variant="outline" onClick={() => inputRef.current?.click()}>Elegir archivo de backup...</Btn>
        </div>
      </div>

      <Modal open={!!archivoPendiente} title="Confirmar restauración" onClose={() => setArchivoPendiente(null)} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">
            Esto va a reemplazar el catálogo, las sedes y todo el stock actual por lo que hay en el archivo. No se puede deshacer.
          </div>
          <Input label={`Escribí "${PALABRA_CONFIRMACION}" para confirmar`} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setArchivoPendiente(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={confirmarRestauracion} disabled={confirmacion !== PALABRA_CONFIRMACION || restaurando}>
              {restaurando ? "Restaurando..." : "Restaurar"}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
