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
