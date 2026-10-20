// Única fuente de verdad para los motivos de egreso (antes duplicados: el
// array de opciones vivía en ModalEgreso.jsx y MOTIVOS_DESCARTE sólo en
// egresosDisponiblesParaMarcar.js) -- ModalEgreso.jsx también necesita saber
// cuáles son de descarte para decidir si fuerza cantidad = 1 o deja el campo
// libre (ver movimientoValido()/esMotivoDescarte() en firestore.rules, que
// aplican la misma regla del lado del servidor).
export const MOTIVOS_EGRESO = ["Estudio", "Control de calidad", "Derrame / accidente", "Vencimiento", "Otro"];

// Un radiofármaco vencido o derramado no se marca -- nunca es candidato en
// el selector de Libro 1 (egresosDisponiblesParaMarcar.js) y puede
// descartarse de a más de un vial por vez (cantidad libre). El resto de los
// motivos son de marcación: el flujo real es un vial por egreso, una
// marcación por egreso -- si hacen falta más viales, son más egresos.
export const MOTIVOS_DESCARTE = ["Vencimiento", "Derrame / accidente"];
