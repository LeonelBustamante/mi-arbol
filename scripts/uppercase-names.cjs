const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { configstore } = require('../node_modules/firebase-tools/lib/configstore');
const { getAccessToken } = require('../node_modules/firebase-tools/lib/auth');
const project = 'mi-arbol-19103';
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const collectionNames = [
  'persons',
  'publicPersons',
  'submissions',
  'privacyRequests',
  'members',
  'accessRequests',
];
async function main() {
  const tokens = await getAccessToken(configstore.get('tokens').refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'Content-Type': 'application/json',
  };
  async function request(url, options = {}) {
    const r = await fetch(url, { ...options, headers });
    const data = await r.json();
    if (!r.ok) throw new Error(`Firestore ${r.status}: ${data.error?.message || 'Error'}`);
    return data;
  }
  async function list(collection) {
    const docs = [];
    let page = '';
    do {
      const data = await request(
        `${base}/${collection}?pageSize=300${page ? '&pageToken=' + encodeURIComponent(page) : ''}`,
      );
      docs.push(...(data.documents || []));
      page = data.nextPageToken || '';
    } while (page);
    return docs;
  }
  function convert(fields, prefix = '', paths = []) {
    for (const [key, value] of Object.entries(fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (['fullName', 'displayName'].includes(key) && typeof value.stringValue === 'string') {
        const upper = value.stringValue.toLocaleUpperCase('es');
        if (upper !== value.stringValue) {
          value.stringValue = upper;
          paths.push(path);
        }
      } else if (value.mapValue?.fields) convert(value.mapValue.fields, path, paths);
    }
    return paths;
  }
  const graph = await request(`${base}/system/graph`);
  const collections = Object.fromEntries(
    await Promise.all(collectionNames.map(async (c) => [c, await list(c)])),
  );
  const afterGraph = await request(`${base}/system/graph`);
  if (graph.updateTime !== afterGraph.updateTime)
    throw new Error('El árbol cambió durante la lectura; reintentar. No se escribió.');
  const people = new Map(collections.persons.map((d) => [d.name.split('/').pop(), d]));
  for (const doc of collections.publicPersons) {
    const privateDoc = people.get(doc.name.split('/').pop());
    if (
      !privateDoc ||
      doc.fields.fullName.stringValue.toLocaleUpperCase('es') !==
        privateDoc.fields.fullName.stringValue.toLocaleUpperCase('es')
    )
      throw new Error('Una proyección pública difiere de su persona privada. No se escribió.');
  }
  const changes = [];
  const counts = {};
  for (const [collection, docs] of Object.entries(collections)) {
    counts[collection] = 0;
    for (const doc of docs) {
      const fields = structuredClone(doc.fields);
      const paths = convert(fields);
      if (paths.length) {
        changes.push({ original: doc, fields, paths });
        counts[collection]++;
      }
    }
  }
  console.log(
    JSON.stringify({
      project,
      mode: process.argv.includes('--apply') ? 'apply' : 'preview',
      documentsToUpdate: changes.length,
      counts,
    }),
  );
  if (!process.argv.includes('--apply') || !changes.length) return;
  const backup = `.local/uppercase-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(backup, JSON.stringify({ project, graph, collections }, null, 2), {
    mode: 0o600,
  });
  const writes = changes.map((c) => ({
    update: { name: c.original.name, fields: c.fields },
    updateMask: { fieldPaths: c.paths },
    currentDocument: { updateTime: c.original.updateTime },
  }));
  writes.push({
    update: {
      name: graph.name,
      fields: { version: { integerValue: String(Number(graph.fields.version.integerValue) + 1) } },
    },
    updateMask: { fieldPaths: ['version'] },
    currentDocument: { updateTime: graph.updateTime },
  });
  const auditName = `projects/${project}/databases/(default)/documents/auditLogs/uppercase_${Date.now()}`;
  writes.push({
    update: {
      name: auditName,
      fields: {
        actorUid: { stringValue: 'owner-maintenance' },
        action: { stringValue: 'person.names.uppercase' },
        entityId: { stringValue: 'all-names' },
        changes: { mapValue: { fields: { documents: { integerValue: String(changes.length) } } } },
      },
    },
    updateTransforms: [{ fieldPath: 'timestamp', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: false },
  });
  if (writes.length > 400 || Buffer.byteLength(JSON.stringify({ writes })) > 8000000)
    throw new Error('Lote demasiado grande: no se escribió.');
  await request(`${base}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
  let verified = 0;
  for (const [collection, before] of Object.entries(collections)) {
    const current = await list(collection);
    const byName = new Map(current.map((d) => [d.name, d]));
    for (const change of changes.filter((c) => c.original.name.split('/').at(-2) === collection)) {
      if (!isDeepStrictEqual(byName.get(change.original.name)?.fields, change.fields))
        throw new Error(
          'La verificación detectó una modificación concurrente; revisar el respaldo.',
        );
      verified++;
    }
    if (current.length < before.length)
      throw new Error('La verificación detectó una eliminación concurrente.');
  }
  console.log(
    JSON.stringify({
      success: true,
      verified,
      backup,
      graphVersion: Number(graph.fields.version.integerValue) + 1,
    }),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
