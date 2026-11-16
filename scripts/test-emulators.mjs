import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const env = {
  ...process.env,
  TEST_FIRESTORE_PORT: '8180',
  TEST_AUTH_PORT: '9199',
  TEST_FUNCTIONS_PORT: '5101',
};
// Separate ports and project keep manual local contributions untouched during tests.
if (!env.JAVA_HOME && existsSync('/private/tmp/mi-arbol-java')) {
  const java = readdirSync('/private/tmp/mi-arbol-java')
    .map((x) => resolve('/private/tmp/mi-arbol-java', x, 'Contents/Home'))
    .find((x) => existsSync(resolve(x, 'bin/java')));
  if (java) env.JAVA_HOME = java;
}
if (!env.FIREBASE_EMULATORS_PATH && existsSync('/private/tmp/mi-arbol-emulator-cache'))
  env.FIREBASE_EMULATORS_PATH = '/private/tmp/mi-arbol-emulator-cache';
const child = spawn(
  process.execPath,
  [
    'node_modules/firebase-tools/lib/bin/firebase.js',
    'emulators:exec',
    '--project',
    'demo-mi-arbol',
    '--config',
    'firebase.test.json',
    '--only',
    'auth,firestore,functions',
    'vitest run tests/rules.test.ts tests/integration.test.ts --reporter=default --reporter=json --outputFile=.local/emulator-tests.json',
  ],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
