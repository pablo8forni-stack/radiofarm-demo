// Formato real de BACON (hoy el proveedor de la mayoría de los
// radiofármacos, y también de los generadores de Tc-99m) -- hace años, sin
// garantía de que dure para siempre: 1 dígito - 5 dígitos (ej. "1-11111"),
// tipeado por distintos técnicos con guion, sin guion, o en mal lugar.
// Compartida entre Libro 3 (Elución, lote del generador) e Ingreso
// (Inventario, lote del radiofármaco) -- es EXACTAMENTE la misma regla de
// numeración del mismo proveedor en los dos casos, no una coincidencia
// parecida (a diferencia del T½ de decaimiento, que sí es genuinamente
// distinto por isótopo, ver helpers/decaimientoLu177.js -- ahí sí había
// motivo real para no compartir).
// Sólo reformatea si el texto ORIGINAL es puramente numérico (dígitos,
// espacios y/o guiones, nada más) Y da exactamente 6 dígitos al sacar los
// separadores -- si tiene CUALQUIER letra u otro carácter, se deja intacto
// tal cual (otro proveedor, formato futuro). Chequear sólo la cantidad de
// dígitos extraídos, sin primero confirmar que el original no tenía nada
// más, fue un bug real encontrado y corregido acá.
export function normalizarLoteSeisDigitos(lote) {
  const limpio = (lote || "").trim().toUpperCase();
  if (!/^[\d\s-]+$/.test(limpio)) return limpio;
  const soloDigitos = limpio.replace(/[^0-9]/g, "");
  if (/^\d{6}$/.test(soloDigitos)) return `${soloDigitos[0]}-${soloDigitos.slice(1)}`;
  return limpio;
}
