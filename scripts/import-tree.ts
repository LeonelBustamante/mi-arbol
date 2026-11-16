import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { validateImport } from '../functions/src/domain.js';
import { importTree } from '../functions/src/service.js';
const file = process.argv[2];
if (!file) throw new Error('Uso: npm run import:tree -- ruta.json [--apply]');
const data = validateImport(JSON.parse(readFileSync(file, 'utf8')));
console.log(
  `JSON válido: ${data.persons.length} personas, ${data.relationships.length} vínculos. Las hipótesis se conservan en la vista privada.`,
);
if (process.argv.includes('--apply')) {
  const projectId = process.env.GCLOUD_PROJECT;
  const uid = process.env.ADMIN_UID;
  if (!projectId || !uid)
    throw new Error('Definí GCLOUD_PROJECT y ADMIN_UID; se verifica el rol admin en Firestore.');
  initializeApp({ projectId });
  console.log(
    await importTree(
      { uid, displayName: 'Importador administrativo', email: 'aleobustamante@gmail.com' },
      data,
    ),
  );
} else
  console.log(
    'Vista previa sin escrituras. Agregá --apply para importar al proyecto seleccionado.',
  );
