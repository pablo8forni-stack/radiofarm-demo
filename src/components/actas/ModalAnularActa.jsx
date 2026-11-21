import { useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { Btn } from "../ui/Btn.jsx";
import { Input } from "../ui/Input.jsx";
import { fmtTs } from "../../helpers/formato.js";
import { TIPOS_ANULACION } from "../../constants/tipoAnulacion.js";

// Más simple que ModalAnular.jsx (movimientos): un acta no tiene efecto de
// stock que revertir ni caso de transferencia, sólo motivo obligatorio.
//
// Tipo de anulación (Paso T, 19/11): obligatorio SOLO cuando acta.pacienteFicha
// existe -- señal ya disponible, sin prop nuevo: de los 7 llamadores de este
// modal, únicamente Tc-99m/Lutecio-177 ("paciente") y los 8 subtipos de I-131
// oral (incluido MIBG, "i131_mibg") llegan con ese campo. Elución, marcación
// y los dos anuladores de lotes (mibg_lote/lote_dosis_unica) nunca lo tienen
// -- para ellos requiereTipo queda false y el selector no se renderiza,
// ningún cambio en esos 5 llamadores. Dos Btn grandes (no un <select>): es
// una elección binaria con consecuencias distintas (una libera la ficha, la
// otra no), más clara siempre visible que escondida en un desplegable.
export function ModalAnularActa({ acta, resumen, notaExtra, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState("");
  const [tipoAnulacion, setTipoAnulacion] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const requiereTipo = !!acta.pacienteFicha;

  async function confirmar() {
    // Defensivo (Paso 1c, 21/11): asegura que el teclado virtual del celular
    // se cierre antes de que el toast de confirmación (ej. "Ficha N° X
    // liberada...") aparezca, para que no quede detrás. En un navegador real
    // tocar el botón ya suele quitar el foco del input; esto lo garantiza
    // igual. Un solo lugar acá alcanza para los 7 llamadores de este modal
    // compartido (Tc-99m, I-131, elución, marcación, lotes).
    document.activeElement?.blur();
    setEnviando(true);
    try {
      await onConfirm(acta, motivo.trim(), tipoAnulacion);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open title="Anular acta" onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-xs text-orange-800">
          Vas a anular: <span className="font-bold">{resumen}</span>, registrada el {fmtTs(acta.fecha)}.
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
          El acta original queda en el listado marcada como ANULADA junto con el motivo -- nunca se edita ni se borra.
        </div>
        {requiereTipo && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-700">Tipo de anulación (obligatorio)</p>
            {TIPOS_ANULACION.map((t) => (
              <Btn
                key={t.codigo}
                type="button"
                variant={tipoAnulacion === t.codigo ? "primary" : "outline"}
                className="w-full text-left"
                onClick={() => setTipoAnulacion(t.codigo)}
              >
                {t.etiqueta}
              </Btn>
            ))}
          </div>
        )}
        {notaExtra && (
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-xs text-orange-800">
            {notaExtra}
          </div>
        )}
        <Input label="Motivo de la anulación (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Error en la dosis cargada, paciente equivocado..." />
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Btn>
          <Btn variant="danger" onClick={confirmar} disabled={!motivo.trim() || (requiereTipo && !tipoAnulacion) || enviando}>{enviando ? "Anulando..." : "Confirmar anulación"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
