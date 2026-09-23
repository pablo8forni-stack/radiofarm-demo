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

const PATRONES = [/__test_login/, /admin\.test@radiofarm\.local/, /Test-Radiofarm-2026/];

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
