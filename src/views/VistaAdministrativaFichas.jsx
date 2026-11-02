import { useEffect, useMemo, useState } from "react";
import { CartelFichasFaltantes } from "../components/actas/CartelFichasFaltantes.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { listenUltimaFicha, listenAnulacionesActas } from "../services/firestore/actas.js";
import { listenFichasUsadasRecientes } from "../services/firestore/fichasDescartadas.js";
import { idsFichaAnulados } from "../helpers/huecosFicha.js";

// Pantalla del rol "administrativa" (Fase 1A) -- control de N° de Ficha de
// su propia sede: última cargada, tabla de solo lectura (N° ficha / nombre
// / estado) y cartel de huecos/sospechosas, mismo CartelFichasFaltantes que
// ya usa un técnico, con esAdmin={false} para que las acciones de escritura
// (Descartar/Auditoría/Deshacer) queden ocultas igual que para cualquier
// no-admin -- sin tocar ese componente.
//
// No lee el libro de actas (decisión de Pablo): sólo fichasUsadas,
// fichasDescartadas y anulaciones de su propia sede -- los 3 ya cubiertos
// por firestore.rules (ver plan Fase 1A). listenAnulacionesActas ahora
// sólo le trae tipo=="anulacion" de su sede (la regla nueva), nunca el
// contenido de otras actas.
//
// listenFichasUsadasRecientes es EL MISMO query (misma colección, mismo
// where, mismo orderBy, mismo limit) que CartelFichasFaltantes.jsx ya
// corre para calcular huecos -- el SDK de Firestore comparte un único
// stream de Watch entre listeners idénticos, así que esto no suma lecturas
// de servidor nuevas, sólo un segundo listener en memoria del lado del
// cliente. Mismo tope ya existente (120, LIMITE_FICHAS_USADAS) -- no se
// agregó ninguna ventana nueva.
export function VistaAdministrativaFichas({ usuario, onToast }) {
  const [ultimaFicha, setUltimaFicha] = useState(null);
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [fichasUsadas, setFichasUsadas] = useState([]);

  useEffect(() => listenUltimaFicha(usuario.sede, setUltimaFicha), [usuario.sede]);
  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { sedeId: usuario.sede }), [usuario.sede]);
  useEffect(() => listenFichasUsadasRecientes(usuario.sede, setFichasUsadas), [usuario.sede]);

  // Mismo criterio de "ANULADA" que ya usa huecosFicha.js (numerosActivos) --
  // por INTENTO, no por número: un número con 2 intentos (uno anulado, uno
  // activo) muestra cada intento como su propia fila con su propio estado,
  // reflejo fiel de los documentos reales en vez de colapsarlos.
  const filas = useMemo(() => {
    const idsAnulados = idsFichaAnulados(anulacionesRaw);
    return fichasUsadas
      .filter((f) => f.sedeId === usuario.sede)
      .map((f) => ({
        ...f,
        anulada: idsAnulados.has(`ficha_${f.sedeId}_${f.pacienteFicha}_${f.fichaIntentoNro}`),
      }));
  }, [fichasUsadas, anulacionesRaw, usuario.sede]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Control de fichas</h2>
        <p className="text-xs text-gray-400 mt-0.5">N° de Ficha de VM RIS, correlativo por sede</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
        <p className="text-xs text-gray-400">Última ficha cargada</p>
        <p className="text-2xl font-bold text-gray-800">{ultimaFicha ?? "—"}</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
              <th className="px-4 py-2 font-semibold">N° Ficha</th>
              <th className="px-4 py-2 font-semibold">Nombre</th>
              <th className="px-4 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-3 text-xs text-gray-400 text-center">Sin fichas cargadas todavía.</td></tr>
            )}
            {filas.map((f) => (
              <tr key={f.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 font-semibold text-gray-800">{f.pacienteFichaNum}</td>
                <td className="px-4 py-2 text-gray-600">{f.pacienteNombre || "—"}</td>
                <td className="px-4 py-2">
                  {f.anulada ? <Badge color="red">ANULADA</Badge> : <Badge color="green">Activa</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CartelFichasFaltantes sedeId={usuario.sede} esAdmin={false} usuario={usuario} anulacionesRaw={anulacionesRaw} onToast={onToast} />
    </div>
  );
}
