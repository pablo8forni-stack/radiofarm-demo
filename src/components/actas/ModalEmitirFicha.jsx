import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { Sel } from "../ui/Sel.jsx";
import { normalizarNombrePaciente } from "../../helpers/formato.js";
import { listenEstudios } from "../../services/firestore/estudios.js";
import { crearEmisionFicha } from "../../services/firestore/emisionesFicha.js";

const OTRO = "__otro__";

// Fase 2.1a (23/11) -- formulario a mano (sin QR, eso es Fase 2.2) para que
// la administrativa/admin emita una ficha. crearEmisionFicha calcula
// fichaIntentoObservado/emisionVersion internamente y tira un Error con
// mensaje claro si el bloqueo duro o la cadena de versión lo impiden -- ese
// mensaje se muestra tal cual, no se reinterpreta acá.
//
// Normalización (23/11, Pablo -- comparabilidad con la carga manual en
// Fase 2.2): nombre usa normalizarNombrePaciente (helpers/formato.js:90,
// mismo onBlur que TabPacientes.jsx:1878 -- mayúscula, acentos). DNI usa
// SOLO .trim() -- igual que TabPacientes.jsx:1066,1195,1228 (dni.trim()),
// que es lo que la carga manual de pacientes hace HOY de verdad. Ningún
// paso de esos 3 saca puntos/guiones del DNI -- eso sólo existe en
// helpers/importarTurnosI131.js:71 (import de turnos, un flujo DISTINTO) y
// aplicarlo acá haría que la emisión y la carga manual quedaran MENOS
// comparables, no más -- decisión de Pablo, no la tomo por mi cuenta.
export function ModalEmitirFicha({ sedeId, usuarioEmail, onClose, onEmitida }) {
  const [numero, setNumero] = useState("");
  const [dni, setDni] = useState("");
  const [nombre, setNombre] = useState("");
  const [estudios, setEstudios] = useState([]);
  const [estudioId, setEstudioId] = useState("");
  const [estudioOtro, setEstudioOtro] = useState("");
  const [peso, setPeso] = useState("");
  const [talla, setTalla] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => listenEstudios(setEstudios), []);

  const estudioTexto = estudioId === OTRO ? estudioOtro.trim() : (estudios.find((e) => e.id === estudioId)?.nombre || "");
  const valido = /^[0-9]+$/.test(numero) && dni.trim() && nombre.trim() && estudioTexto;

  async function confirmar() {
    setError("");
    setEnviando(true);
    try {
      await crearEmisionFicha({
        sedeId, numero: numero.trim(), dni: dni.trim(), nombre: normalizarNombrePaciente(nombre),
        estudio: estudioTexto, usuarioEmail, peso, talla,
      });
      onEmitida?.();
      onClose();
    } catch (e) {
      setError(e.message || "No se pudo emitir la ficha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open title="Emitir ficha" onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <Input label="N° de Ficha (VM RIS)" value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="Sólo números" />
        <Input label="DNI" value={dni} onChange={(e) => setDni(e.target.value)} inputMode="numeric" />
        <Input
          label="Nombre del paciente" value={nombre} onChange={(e) => setNombre(e.target.value)}
          onBlur={() => setNombre((n) => normalizarNombrePaciente(n))} className="uppercase"
        />
        <Sel label="Estudio" value={estudioId} onChange={(e) => setEstudioId(e.target.value)}>
          <option value="">Elegir...</option>
          {estudios.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          <option value={OTRO}>Otro...</option>
        </Sel>
        {estudioId === OTRO && (
          <Input label="¿Cuál?" value={estudioOtro} onChange={(e) => setEstudioOtro(e.target.value)} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Peso (kg, opcional)" type="number" value={peso} onChange={(e) => setPeso(e.target.value)} />
          <Input label="Talla (cm, opcional)" type="number" value={talla} onChange={(e) => setTalla(e.target.value)} />
        </div>
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
          <Btn variant="primary" onClick={confirmar} disabled={!valido || enviando}>{enviando ? "Emitiendo..." : "Emitir"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
