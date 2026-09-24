// Texto que reemplaza al radiofármaco en el listado, el CSV y la impresión de
// Libro 2 cuando el acta trae sinRadiofarmaco: true (Tc-99m puro, sin marcar
// ningún radiofármaco -- centellograma de tiroides, glóbulos rojos marcados,
// etc.). Deliberadamente SIN aclarar "Tc-99m puro" entre paréntesis: eso
// sugeriría que sólo cubre el centellograma de tiroides y no también los
// glóbulos rojos marcados. El checkbox del formulario sí lleva esa aclaración
// como ayuda para quien carga (ver TabPacientes.jsx).
export const TEXTO_SIN_RADIOFARMACO = "Sin marcación de radiofármaco";
