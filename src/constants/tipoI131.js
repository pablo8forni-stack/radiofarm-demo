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
