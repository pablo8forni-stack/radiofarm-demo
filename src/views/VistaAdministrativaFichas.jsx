import { useEffect, useMemo, useState } from "react";
import { CartelFichasFaltantes } from "../components/actas/CartelFichasFaltantes.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { listenAnulacionesActas } from "../services/firestore/actas.js";
import { listenFichasUsadasRecientes, listenFichasDescartadas } from "../services/firestore/fichasDescartadas.js";
import { idsFichaAnulados, calcularHuecos, huecosYaAnulados } from "../helpers/huecosFicha.js";

// Pantalla del rol "administrativa" (Fase 1A) -- control de N° de Ficha de
// su propia sede: encabezado (última vigente + anulada más reciente, si
// corresponde), tabla de solo lectura (N° ficha / nombre / estado / motivo
// de anulación) y cartel de huecos/sospechosas, mismo CartelFichasFaltantes
// que ya usa un técnico, con esAdmin={false} para que las acciones de
// escritura (Descartar/Auditoría/Deshacer) queden ocultas igual que para
// cualquier no-admin -- sin tocar ese componente.
//
// Decisión de Pablo sobre fichas anuladas sin recarga ("opción A"): el
// flujo de anulación/descarte sigue exactamente como está hoy -- el admin
// anula y, si no va a recargar, además descarta aparte. Esta pantalla sólo
// EXPLICA ese estado, nunca lo cambia. Por eso NADA de este archivo toca
// calcularHuecos, CartelFichasFaltantes.jsx ni el flujo de anulación.
//
// No lee el libro de actas (decisión de Pablo): sólo fichasUsadas,
// fichasDescartadas y anulaciones de su propia sede -- los 3 ya cubiertos
// por firestore.rules (ver plan Fase 1A). listenAnulacionesActas ahora
// sólo le trae tipo=="anulacion" de su sede (la regla nueva), nunca el
// contenido de otras actas.
//
// listenFichasUsadasRecientes y listenFichasDescartadas son los MISMOS
// queries (misma colección, mismo where, mismo orderBy/limit) que
// CartelFichasFaltantes.jsx ya corre para calcular huecos -- el SDK de
// Firestore comparte un único stream de Watch entre listeners idénticos,
// así que esto no suma lecturas de servidor nuevas, sólo listeners en
// memoria del lado del cliente. Mismo tope ya existente (120,
// LIMITE_FICHAS_USADAS) -- no se agregó ninguna ventana nueva.
export function VistaAdministrativaFichas({ usuario, onToast }) {
  const [anulacionesRaw, setAnulacionesRaw] = useState([]);
  const [fichasUsadas, setFichasUsadas] = useState([]);
  const [fichasDescartadas, setFichasDescartadas] = useState([]);

  useEffect(() => listenAnulacionesActas(setAnulacionesRaw, { sedeId: usuario.sede }), [usuario.sede]);
  useEffect(() => listenFichasUsadasRecientes(usuario.sede, setFichasUsadas), [usuario.sede]);
  useEffect(() => listenFichasDescartadas(usuario.sede, setFichasDescartadas), [usuario.sede]);

  const anulacionPorId = useMemo(() => new Map(anulacionesRaw.map((a) => [a.anulaId, a])), [anulacionesRaw]);

  // Mismo criterio de "ANULADA" que ya usa huecosFicha.js (numerosActivos) --
  // por INTENTO, no por número: un número con 2 intentos (uno anulado, uno
  // activo) muestra cada intento como su propia fila con su propio estado,
  // reflejo fiel de los documentos reales en vez de colapsarlos. `motivo`
  // sale del mismo doc de anulación, sin ninguna lectura nueva.
  const filas = useMemo(() => {
    const idsAnulados = idsFichaAnulados(anulacionesRaw);
    return fichasUsadas
      .filter((f) => f.sedeId === usuario.sede)
      .map((f) => {
        const anulaId = `ficha_${f.sedeId}_${f.pacienteFicha}_${f.fichaIntentoNro}`;
        const anulada = idsAnulados.has(anulaId);
        return { ...f, anulada, motivo: anulada ? anulacionPorId.get(anulaId)?.motivo : null };
      });
  }, [fichasUsadas, anulacionesRaw, anulacionPorId, usuario.sede]);

  // "Última ficha cargada" = mayor número entre las filas VIGENTES (no
  // anuladas) -- a propósito distinto de listenUltimaFicha/obtenerUltimaFicha
  // (services/firestore/actas.js), que consultan fichasUsadas directo sin
  // excluir anuladas: para esta pantalla esa función mostraría un número
  // anulado como si fuera el vigente, exactamente lo que Pablo pidió evitar.
  //
  // "Anulada más reciente": si el número más alto de TODOS (anulados
  // incluidos) es mayor al vigente, es una anulación sin reemplazo todavía
  // -- se muestra aparte. CASO ACEPTADO, documentado a pedido de Pablo: si
  // la corrección se recarga con un número MENOR al anulado (ej. se tipeó
  // 1000 en vez de 100, se corrige como 100), esta línea NO desaparece
  // sola -- 100 nunca va a superar a 1000 en términos numéricos puros, así
  // que "Anulada más reciente: 1000" queda mostrándose para siempre aunque
  // el caso ya esté resuelto. No se intenta detectar esto (requeriría
  // heurísticas de cercanía/tiempo fuera de alcance) -- aceptado así.
  const { vigente, anuladaMasReciente } = useMemo(() => {
    if (filas.length === 0) return { vigente: null, anuladaMasReciente: null };
    const activas = filas.filter((f) => !f.anulada);
    const vigenteNum = activas.length ? Math.max(...activas.map((f) => f.pacienteFichaNum)) : null;
    const maxTotal = Math.max(...filas.map((f) => f.pacienteFichaNum));
    const hayAnuladaMasAlta = vigenteNum == null || maxTotal > vigenteNum;
    return { vigente: vigenteNum, anuladaMasReciente: hayAnuladaMasAlta ? maxTotal : null };
  }, [filas]);

  // Mismo gate horario (13:00) que CartelFichasFaltantes.jsx -- duplicado a
  // propósito: ese archivo es compartido con técnicos y Pablo pidió no
  // tocarlo. Si el cartel de abajo no muestra nada antes de las 13:00, esta
  // aclaración tampoco debería aparecer sin nada que aclarar.
  const MINUTOS_INICIO_HUECOS = 13 * 60;
  const [huecosActivo, setHuecosActivo] = useState(() => {
    const ahora = new Date();
    return ahora.getHours() * 60 + ahora.getMinutes() >= MINUTOS_INICIO_HUECOS;
  });
  useEffect(() => {
    if (huecosActivo) return;
    const id = setInterval(() => {
      const ahora = new Date();
      if (ahora.getHours() * 60 + ahora.getMinutes() >= MINUTOS_INICIO_HUECOS) setHuecosActivo(true);
    }, 60000);
    return () => clearInterval(id);
  }, [huecosActivo]);

  // Aclaración sobre el cartel de huecos (Pablo, "opción A" -- no cambia el
  // cartel compartido, sólo lo explica acá al lado). Reusa calcularHuecos
  // (función pura, misma firma/inputs que ya usa CartelFichasFaltantes) sin
  // duplicar su lógica, y huecosYaAnulados (huecosFicha.js) para separar
  // los que ya figuran anulados (nota) de los huecos reales -- nunca
  // cargados -- que no llevan nota.
  const huecosAnuladosSinReemplazo = useMemo(() => {
    if (!huecosActivo) return [];
    const { huecos } = calcularHuecos(fichasUsadas, anulacionesRaw, fichasDescartadas, usuario.sede, new Date());
    return huecosYaAnulados(huecos, fichasUsadas, usuario.sede);
  }, [huecosActivo, fichasUsadas, anulacionesRaw, fichasDescartadas, usuario.sede]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">Control de fichas</h2>
        <p className="text-xs text-gray-400 mt-0.5">N° de Ficha de VM RIS, correlativo por sede</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex flex-col gap-1">
        <p className="text-xs text-gray-400">Última ficha cargada</p>
        <p className="text-2xl font-bold text-gray-800">{vigente ?? "—"}</p>
        {anuladaMasReciente != null && (
          <p className="text-xs text-orange-500 font-semibold">Anulada más reciente: {anuladaMasReciente}</p>
        )}
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
                <td className="px-4 py-2 font-semibold text-gray-800 align-top">{f.pacienteFichaNum}</td>
                <td className="px-4 py-2 text-gray-600 align-top">{f.pacienteNombre || "—"}</td>
                <td className="px-4 py-2 align-top">
                  {f.anulada ? <Badge color="red">ANULADA</Badge> : <Badge color="green">Activa</Badge>}
                  {f.anulada && f.motivo && (
                    <p className="text-xs text-gray-400 truncate max-w-[16rem] mt-1" title={f.motivo}>{f.motivo}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CartelFichasFaltantes sedeId={usuario.sede} esAdmin={false} usuario={usuario} anulacionesRaw={anulacionesRaw} onToast={onToast} />
      {huecosAnuladosSinReemplazo.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex flex-col gap-1">
          {huecosAnuladosSinReemplazo.map((n) => (
            <p key={n} className="text-xs text-blue-700">
              La ficha {n} ya figura anulada (ver tabla). Si no se va a recargar, el administrador debe descartarla.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
