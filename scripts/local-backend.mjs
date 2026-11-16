import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Deliberately isolated from production AND the automated test project.
const projectId = 'demo-mi-arbol-local';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const snapshot = resolve(root, '.local/firebase-data');
mkdirSync(resolve(root, '.local'), { recursive: true });
const env = {
  ...process.env,
  GCLOUD_PROJECT: projectId,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};
// Reuse the temporary Java runtime prepared for this workspace when available.
if (!env.JAVA_HOME && existsSync('/private/tmp/mi-arbol-java')) {
  const runtime = readdirSync('/private/tmp/mi-arbol-java')
    .map((name) => resolve('/private/tmp/mi-arbol-java', name, 'Contents/Home'))
    .find((path) => existsSync(resolve(path, 'bin/java')));
  if (runtime) env.JAVA_HOME = runtime;
}
if (!env.FIREBASE_EMULATORS_PATH && existsSync('/private/tmp/mi-arbol-emulator-cache'))
  env.FIREBASE_EMULATORS_PATH = '/private/tmp/mi-arbol-emulator-cache';
const args = [
  cli,
  'emulators:start',
  '--project',
  projectId,
  '--only',
  'auth,firestore,functions',
  `--export-on-exit=${snapshot}`,
];
if (existsSync(resolve(snapshot, 'firebase-export-metadata.json')))
  args.push(`--import=${snapshot}`);
const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
let stopping = false;
let exporting = false;
let interval;
child.on('exit', (code) => {
  clearInterval(interval);
  process.exit(code || 0);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    child.kill('SIGINT');
  });
async function checkpoint() {
  if (exporting || stopping) return;
  exporting = true;
  try {
    await new Promise((ok, no) =>
      execFile(
        process.execPath,
        [cli, 'emulators:export', snapshot, '--project', projectId, '--force'],
        { cwd: root, env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
        (error) => (error ? no(error) : ok()),
      ),
    );
  } catch (error) {
    console.error(
      'No se pudo actualizar la copia local; se volverá a intentar.',
      error.code || 'export',
    );
  } finally {
    exporting = false;
  }
}
async function initializeLocalOwner() {
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = env.FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.FIREBASE_AUTH_EMULATOR_HOST;
  initializeApp({ projectId });
  const auth = getAuth();
  const user = await auth.getUserByEmail('aleobustamante@gmail.com').catch((error) => {
    if (error.code !== 'auth/user-not-found') throw error;
    return auth.createUser({
      uid: 'local-owner',
      email: 'aleobustamante@gmail.com',
      emailVerified: true,
      displayName: 'Administrador local',
    });
  });
  await getFirestore()
    .doc(`members/${user.uid}`)
    .set({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || 'Administrador local',
      role: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
  await checkpoint();
  console.log(
    'BACKEND LOCAL LISTO · demo-mi-arbol-local · copias automáticas en .local/firebase-data',
  );
  interval = setInterval(checkpoint, 20000);
}
async function ready() {
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/verifyAdmin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"data":{}}',
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 401) {
        await initializeLocalOwner();
        return;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  if (!stopping) {
    console.error(
      'No se pudo iniciar el backend local. Revisá Java 21 y los puertos 8080, 9099 y 5001.',
    );
    child.kill('SIGINT');
  }
}
void ready();
