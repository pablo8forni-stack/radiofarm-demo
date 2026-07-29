// Badge (label + color) de cada tipo de registro de I-131 -- lo usan tanto
// el listado unificado de Libro 2 (Pacientes) como la vista de consulta
// "Terapia I-131", para no mantener las mismas 6 etiquetas en dos archivos.
// Colores distintos entre Ablativa (30-200 mCi) y Dosis terapéutica
// (5-15 mCi) a propósito: son rangos de actividad muy distintos, no
// deberían confundirse a simple vista en un listado compartido.
export const TIPO_LABEL_I131 = {
  i131_ablativa: { label: "Ablativa I-131", color: "red" },
  i131_dosis: { label: "Dosis I-131", color: "orange" },
  i131_barrido: { label: "Barrido I-131", color: "teal" },
  i131_captacion: { label: "Captación I-131", color: "blue" },
  i131_centellograma: { label: "Centellograma I-131", color: "green" },
  i131_captacion_centellograma: { label: "Capt.+Centellograma I-131", color: "purple" },
  i131_captacion_resultado: { label: "Resultado %Captación", color: "blue" },
  i131_seguimiento_fin: { label: "Fin de seguimiento", color: "gray" },
};

// Terapéutico (dosis ablativa/hipertiroidismo) vs. diagnóstico (solución de
// captación, ~10 mCi/100 mL) -- mismo modelo de vial+decaimiento para los
// dos (ver TabStockViales.jsx), sólo se distinguen por este campo. Viales
// viejos sin `categoria` (anteriores a este campo) se tratan como
// terapéutico por ausencia, mismo criterio que isotopoId/unidadActividad
// faltantes en actas más viejas. Vive acá (no en TabStockViales.jsx) para
// que VialDetalle.jsx pueda importarlo sin crear un ciclo entre los dos.
export const CATEGORIA_VIAL_LABEL = {
  terapeutico: { label: "Terapéutico", color: "blue" },
  diagnostico: { label: "Diagnóstico", color: "purple" },
};
export const categoriaVial = (v) => v.categoria || "terapeutico";

// Control de secuencia de %Captación (Parte C) -- 3 momentos fijos por
// dosis, en orden. "48h" es el último posible: sólo al guardarlo se ofrece
// "Finalizar seguimiento". Compartido entre TabResultadosCaptacion.jsx (la
// carga) y HistorialPacienteI131.jsx (el CSV/vista consolidada) para no
// mantener el mismo mapa en los dos.
export const MOMENTOS_CAPTACION = ["hora", "24h", "48h"];
export const MOMENTO_LABEL = { hora: "Hora", "24h": "24 h", "48h": "48 h" };
