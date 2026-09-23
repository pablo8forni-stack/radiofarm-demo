// Red de seguridad antes de cualquier deploy (prod o staging): confirma que
// dist/ no tiene ningún rastro del arnés de login de prueba (__test_login.js,
// ver historial de esta sesión -- quedó pegado sin querer en main.jsx más de
// una vez) ni de las credenciales de la cuenta de prueba de staging.
//
// Node puro, no bash/cmd -- `npm run` en Windows ejecuta los scripts vía
// cmd.exe por default, que no entiende sintaxis de negación de shell POSIX
// (`!`); un script de Node decide su propio exit code con process.exit(),
// así que el chequeo funciona igual sin importar qué shell invoque `npm run`
// en cada máquina.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// La contraseña de prueba vive en .env.staging (gitignored), nunca acá --
// se arma el patrón en runtime a partir de esa variable, no un literal
// escrito en el archivo (así una futura rotación no exige tocar código
// trackeado). Falla fuerte si falta: si se dejara pasar como undefined,
// new RegExp(undefined) busca literalmente la palabra "undefined" -- el
// chequeo "pasaría" siempre sin detectar nunca una contraseña real filtrada,
// un camino silencioso peor que no tener el chequeo.
const PASSWORD_TEST_STAGING = process.env.PASSWORD_TEST_STAGING;
if (!PASSWORD_TEST_STAGING) {
  console.error("Falta PASSWORD_TEST_STAGING -- correr con: node --env-file=.env.staging scripts/checkBundle.mjs");
  process.exit(1);
}
// Escapada antes de meterla en el RegExp -- una rotación futura podría
// generar una contraseña con caracteres especiales de regex (. + ( etc.),
// que sin escapar se interpretarían como sintaxis en vez de texto literal.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATRONES = [/__test_login/, /admin\.test@radiofarm\.local/, new RegExp(escapeRegExp(PASSWORD_TEST_STAGING))];

function archivosDe(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : [ruta];
  });
}

let encontroAlgo = false;
for (const archivo of archivosDe("dist")) {
  let contenido;
  try {
    contenido = readFileSync(archivo, "utf8");
  } catch (e) {
    // readFileSync con "utf8" NO tira error por contenido binario (decodifica
    // igual, con caracteres de reemplazo) -- si este catch se dispara alguna
    // vez es por un motivo real (permisos, el archivo se movió/borró a mitad
    // del recorrido), nunca "es una imagen, se ignora sin más". Este chequeo
    // no debería tener ningún camino silencioso -- si algo no se pudo leer,
    // que quede visible en vez de saltearlo sin avisar.
    console.warn(`AVISO: no se pudo leer ${archivo} -- ${e.message}`);
    continue;
  }
  for (const patron of PATRONES) {
    if (patron.test(contenido)) {
      console.error(`ENCONTRADO ${patron} en ${archivo}`);
      encontroAlgo = true;
    }
  }
}

if (encontroAlgo) {
  console.error("\ncheck:bundle FALLÓ -- dist/ tiene rastros del arnés/credenciales de prueba. NO deployar.");
  process.exit(1);
} else {
  console.log("check:bundle OK -- sin rastro del arnés de prueba en dist/");
}
