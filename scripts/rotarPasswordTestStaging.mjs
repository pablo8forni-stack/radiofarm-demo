// Rotación de la contraseña de una cuenta de prueba de staging -- directo
// por Admin SDK, no por mail de reset (los emails son inventados, no
// existen de verdad, un reset por mail nunca llegaría a ningún lado).
// Mismo patrón de acceso que scripts/seed.mjs: service account local,
// nunca se importa desde src/.
//
// Email opcional (default admin.test@radiofarm.local) -- fixtures.mjs usa
// UNA sola PASSWORD_TEST compartida por las 4 personas de prueba (admin,
// tecnicoA, tecnicoB, sinRol); rotar sólo una de las 4 las desincroniza
// (bug real encontrado: loguearComo tira auth/email-already-in-use para
// las otras 3 después de rotar sólo admin.test) -- correr esto una vez por
// cada email cuando se rota, no sólo para admin.test.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PASSWORD_NUEVA = process.argv[2];
const EMAIL = process.argv[3] || "admin.test@radiofarm.local";
if (!PASSWORD_NUEVA) {
  console.error("Uso: node scripts/rotarPasswordTestStaging.mjs '<password nueva>' [email]");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(new URL("../serviceAccountKey.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });

const usuario = await getAuth().getUserByEmail(EMAIL);
await getAuth().updateUser(usuario.uid, { password: PASSWORD_NUEVA });
console.log(`Contraseña actualizada para ${EMAIL} en el proyecto ${serviceAccount.project_id}.`);
