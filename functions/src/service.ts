import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { photoSchema, prepareUploadedPhoto } from './photos.js';
import {
  findDuplicate,
  connectRelationship,
  relationConnectionSchema,
  relationshipSchema,
  idSchema,
  linksSchema,
  personSchema,
  publicPerson,
  replaceLinks,
  validateGraph,
  validateImport,
  type Person,
  type Relationship,
  type PersonData,
  type Links,
} from './domain.js';
export type Actor = { uid: string; displayName: string; email: string };
const db = () => getFirestore();
export const ref = (collection: string, id: string) => db().collection(collection).doc(id);
const stamp = () => FieldValue.serverTimestamp();
function fail(message: string): never {
  throw new HttpsError('failed-precondition', message);
}
export async function authorize(tx: Transaction, actor: Actor, allowed: string[]) {
  const member = await tx.get(ref('members', actor.uid));
  if (
    actor.email !== 'aleobustamante@gmail.com' ||
    !allowed.includes('admin') ||
    member.data()?.role !== 'admin'
  )
    throw new HttpsError('permission-denied', 'No tenés autorización para esta operación.');
}
async function throttle(tx: Transaction, actor: Actor, bucket: string, limit: number) {
  const doc = ref('rateLimits', `${actor.uid}_${bucket}`);
  const s = await tx.get(doc);
  const now = Date.now();
  const recent = (s.data()?.timestamps || []).filter((t: number) => t > now - 3600000);
  if (recent.length >= limit)
    throw new HttpsError('resource-exhausted', 'Alcanzaste el límite por hora. Intentá más tarde.');
  return () => tx.set(doc, { timestamps: [...recent, now] });
}
function audit(tx: Transaction, actor: Actor, action: string, entityId: string, changes: unknown) {
  tx.create(db().collection('auditLogs').doc(), {
    actorUid: actor.uid,
    action,
    entityId,
    timestamp: stamp(),
    changes,
  });
}
function notify(tx: Transaction, key: string, actor: Actor, event: string) {
  tx.create(ref('mailOutbox', key), { actor, event, status: 'pending', createdAt: stamp() });
}
const proposalSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(['new', 'correction']),
    personId: idSchema.optional(),
    baseRevision: z.number().int().min(1).optional(),
    person: personSchema,
    links: linksSchema,
  })
  .strict();
async function readGraph(tx: Transaction) {
  const [people, relations, version] = await Promise.all([
    tx.get(db().collection('persons')),
    tx.get(db().collection('relationships')),
    tx.get(ref('system', 'graph')),
  ]);
  return {
    people: people.docs.map((s) => ({ ...s.data(), id: s.id }) as Person),
    relations: relations.docs.map((s) => s.data() as Relationship),
    version: version.data()?.version || 0,
  };
}
function writePerson(
  tx: Transaction,
  id: string,
  data: PersonData,
  revision: number,
  existing: boolean,
) {
  tx.set(
    ref('persons', id),
    { id, ...data, revision, updatedAt: stamp(), ...(!existing ? { createdAt: stamp() } : {}) },
    { merge: true },
  );
  if (data.certainty === 'confirmed') tx.set(ref('publicPersons', id), publicPerson(id, data));
  else tx.delete(ref('publicPersons', id));
}
function writeRelations(
  tx: Transaction,
  before: Relationship[],
  after: Relationship[],
  peopleBefore: Person[],
  peopleAfter: Person[],
) {
  const afterIds = new Set(after.map((r) => r.id));
  for (const r of before)
    if (!afterIds.has(r.id)) {
      tx.delete(ref('relationships', r.id));
      tx.delete(ref('publicRelationships', r.id));
    }
  const confirmedBefore = new Set(
    peopleBefore.filter((p) => p.certainty === 'confirmed').map((p) => p.id),
  );
  const confirmedAfter = new Set(
    peopleAfter.filter((p) => p.certainty === 'confirmed').map((p) => p.id),
  );
  for (const r of after) {
    const old = before.find((x) => x.id === r.id);
    const changed = JSON.stringify(old) !== JSON.stringify(r);
    if (changed) tx.set(ref('relationships', r.id), r);
    const wasPublic =
      old?.certainty === 'confirmed' &&
      confirmedBefore.has(old.from) &&
      confirmedBefore.has(old.to);
    const isPublic =
      r.certainty === 'confirmed' && confirmedAfter.has(r.from) && confirmedAfter.has(r.to);
    if (changed || wasPublic !== isPublic) {
      if (isPublic)
        tx.set(ref('publicRelationships', r.id), {
          id: r.id,
          from: r.from,
          to: r.to,
          type: r.type,
        });
      else tx.delete(ref('publicRelationships', r.id));
    }
  }
}
function checkPerson(
  graph: Awaited<ReturnType<typeof readGraph>>,
  id: string,
  person: PersonData,
  links: Links,
  revision?: number,
) {
  const old = graph.people.find((p) => p.id === id);
  if (revision !== undefined && old?.revision !== revision)
    fail('Conflicto de edición: la persona cambió. Revisá la versión actual.');
  if (findDuplicate(graph.people, person, id))
    fail('Hay un posible duplicado. Corregí los datos antes de aprobar.');
  const relations = replaceLinks(id, links, graph.relations);
  try {
    validateGraph(new Set([...graph.people.map((p) => p.id), id]), relations);
  } catch (e) {
    fail((e as Error).message);
  }
  return { old, relations };
}
export async function moderate(actor: Actor, input: unknown) {
  const { id, decision, reason } = z
    .object({
      id: idSchema,
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().trim().max(1000).default(''),
    })
    .strict()
    .parse(input);
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const doc = await tx.get(ref('submissions', id));
    if (!doc.exists) fail('La propuesta no existe.');
    const s = doc.data()!;
    if (s.status !== 'pending') {
      if (s.status !== decision) fail('La propuesta ya fue revisada con otra decisión.');
      return { status: s.status };
    }
    if (decision === 'approved') {
      const p = proposalSchema.parse(
        Object.fromEntries(
          Object.entries(s).filter(([key]) =>
            ['requestId', 'kind', 'personId', 'baseRevision', 'person', 'links'].includes(key),
          ),
        ),
      );
      const graph = await readGraph(tx);
      const target = p.kind === 'new' ? `person_${id}` : p.personId!;
      const { old, relations } = checkPerson(
        graph,
        target,
        p.person,
        p.links,
        p.kind === 'correction' ? p.baseRevision : undefined,
      );
      const [incomingPhoto, currentPhoto] = await Promise.all([
        tx.get(ref('submissionPhotos', id)),
        tx.get(ref('personPhotos', target)),
      ]);
      const photo = incomingPhoto.data()?.dataUrl || currentPhoto.data()?.dataUrl;
      if (photo) tx.set(ref('personPhotos', target), { id: target, dataUrl: photo });
      if (photo && p.person.certainty === 'confirmed')
        tx.set(ref('publicPersonPhotos', target), { id: target, dataUrl: photo });
      else tx.delete(ref('publicPersonPhotos', target));
      writePerson(tx, target, p.person, (old?.revision || 0) + 1, !!old);
      writeRelations(tx, graph.relations, relations, graph.people, [
        ...graph.people.filter((p) => p.id !== target),
        { ...p.person, id: target, revision: (old?.revision || 0) + 1 },
      ]);
      tx.set(ref('system', 'graph'), { version: graph.version + 1 });
      audit(tx, actor, 'person.publish', target, {
        before: old || null,
        after: p.person,
        relationshipsBefore: graph.relations,
        relationshipsAfter: relations,
        submissionId: id,
      });
    }
    tx.update(doc.ref, { status: decision, reason, reviewedBy: actor.uid, reviewedAt: stamp() });
    audit(tx, actor, `submission.${decision}`, id, { reason });
    return { status: decision };
  });
}
export async function editPerson(actor: Actor, input: unknown) {
  const p = z
    .object({
      id: idSchema,
      baseRevision: z.number().int().min(1),
      person: personSchema,
      links: linksSchema,
      photo: photoSchema.optional(),
    })
    .strict()
    .parse(input);
  const photo = await prepareUploadedPhoto(p.photo);
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const graph = await readGraph(tx);
    const { old, relations } = checkPerson(graph, p.id, p.person, p.links, p.baseRevision);
    const existingPhoto = await tx.get(ref('personPhotos', p.id));
    const image = photo || existingPhoto.data()?.dataUrl;
    if (image) tx.set(ref('personPhotos', p.id), { id: p.id, dataUrl: image });
    if (image && p.person.certainty === 'confirmed')
      tx.set(ref('publicPersonPhotos', p.id), { id: p.id, dataUrl: image });
    else tx.delete(ref('publicPersonPhotos', p.id));
    writePerson(tx, p.id, p.person, p.baseRevision + 1, true);
    writeRelations(
      tx,
      graph.relations,
      relations,
      graph.people,
      graph.people.map((x) =>
        x.id === p.id ? { ...p.person, id: p.id, revision: p.baseRevision + 1 } : x,
      ),
    );
    tx.set(ref('system', 'graph'), { version: graph.version + 1 });
    audit(tx, actor, 'person.edit', p.id, {
      before: old,
      after: p.person,
      relationshipsBefore: graph.relations,
      relationshipsAfter: relations,
    });
    return { id: p.id };
  });
}
export async function resolvePrivacy(actor: Actor, input: unknown) {
  const p = z
    .object({ id: idSchema, resolution: z.string().trim().min(10).max(3000) })
    .strict()
    .parse(input);
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const s = await tx.get(ref('privacyRequests', p.id));
    if (!s.exists) fail('La solicitud no existe.');
    if (s.data()!.status === 'resolved') return { status: 'resolved' };
    tx.update(s.ref, {
      status: 'resolved',
      resolution: p.resolution,
      reviewedBy: actor.uid,
      reviewedAt: stamp(),
    });
    audit(tx, actor, 'privacy.resolve', p.id, { resolution: p.resolution });
    return { status: 'resolved' };
  });
}
export async function deletePerson(actor: Actor, input: unknown) {
  const { id, baseRevision, reason } = z
    .object({
      id: idSchema,
      baseRevision: z.number().int().min(1),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict()
    .parse(input);
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const graph = await readGraph(tx);
    const old = graph.people.find((p) => p.id === id);
    if (!old) return { deleted: true };
    if (old.revision !== baseRevision) fail('La persona cambió. Revisá antes de eliminar.');
    const after = graph.relations.filter((r) => r.from !== id && r.to !== id);
    tx.delete(ref('personPhotos', id));
    tx.delete(ref('publicPersonPhotos', id));
    tx.delete(ref('persons', id));
    tx.delete(ref('publicPersons', id));
    writeRelations(
      tx,
      graph.relations,
      after,
      graph.people,
      graph.people.filter((p) => p.id !== id),
    );
    tx.set(ref('system', 'graph'), { version: graph.version + 1 });
    audit(tx, actor, 'person.delete', id, {
      reason,
      removedRelationships: graph.relations.filter((r) => r.from === id || r.to === id),
    });
    return { deleted: true };
  });
}
export async function importTree(actor: Actor, input: unknown) {
  const data = validateImport(input);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const imported = await tx.get(ref('imports', hash));
    if (imported.exists) return { hash, alreadyImported: true };
    const graph = await readGraph(tx);
    const photoDocs = await tx.get(db().collection('personPhotos'));
    const people = new Map(graph.people.map((p) => [p.id, p]));
    for (const p of data.persons)
      people.set(p.id, { ...p.data, id: p.id, revision: (people.get(p.id)?.revision || 0) + 1 });
    const relations = new Map(graph.relations.map((r) => [r.id, r]));
    for (const r of data.relationships) relations.set(r.id, r);
    validateGraph(new Set(people.keys()), [...relations.values()]);
    for (const p of data.persons)
      if (findDuplicate([...people.values()], p.data, p.id))
        fail('La importación contiene posibles duplicados con el árbol actual.');
    for (const p of data.persons) {
      const photo = photoDocs.docs.find((d) => d.id === p.id)?.data()?.dataUrl;
      if (photo && p.data.certainty === 'confirmed')
        tx.set(ref('publicPersonPhotos', p.id), { id: p.id, dataUrl: photo });
      else tx.delete(ref('publicPersonPhotos', p.id));
    }
    for (const p of data.persons)
      writePerson(
        tx,
        p.id,
        p.data,
        people.get(p.id)!.revision,
        graph.people.some((x) => x.id === p.id),
      );
    writeRelations(tx, graph.relations, [...relations.values()], graph.people, [
      ...people.values(),
    ]);
    tx.set(ref('system', 'graph'), { version: graph.version + 1 });
    tx.create(ref('imports', hash), {
      actorUid: actor.uid,
      importedAt: stamp(),
      persons: data.persons.length,
    });
    audit(tx, actor, 'tree.import', hash, {
      persons: data.persons.length,
      relationships: data.relationships.length,
    });
    return { hash, alreadyImported: false };
  });
}

const contributorSchema = z
  .object({
    displayName: z.string().trim().max(160).default(''),
    email: z.union([z.string().trim().email().max(254), z.literal('')]).default(''),
  })
  .strict();
const publicContributionSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(['new', 'correction']),
    personId: idSchema.optional(),
    person: personSchema,
    links: linksSchema,
    contributor: contributorSchema.extend({
      displayName: z.string().trim().min(2, 'Ingresá el nombre de quien lo carga.').max(160),
    }),
    photo: photoSchema.optional(),
    website: z.literal('').default(''),
  })
  .strict();
export async function submitContribution(actor: Actor, input: unknown) {
  const p = publicContributionSchema.parse(input);
  if (p.kind === 'correction' && !p.personId) fail('Seleccioná la persona que querés corregir.');
  const fingerprint = createHash('sha256').update(JSON.stringify(p)).digest('hex');
  const photo = await prepareUploadedPhoto(p.photo);
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(ref('submissions', p.requestId));
    if (existing.exists) {
      if (existing.data()?.fingerprint !== fingerprint)
        throw new HttpsError(
          'already-exists',
          'No se pudo usar ese identificador. Volvé a abrir el formulario.',
        );
      return { id: p.requestId, status: 'pending' };
    }
    const graph = await readGraph(tx);
    const published = await tx.get(db().collection('publicPersons'));
    const publicIds = new Set(published.docs.map((d) => d.id));
    const old = p.kind === 'correction' ? graph.people.find((x) => x.id === p.personId) : undefined;
    if (p.kind === 'correction' && (!old || !publicIds.has(p.personId!)))
      fail('La persona seleccionada no está disponible.');
    for (const type of ['father', 'mother', 'partner'] as const)
      if (p.links[type] && !publicIds.has(p.links[type]))
        fail('Seleccioná los parentescos desde el árbol público.');
    let person = p.person;
    const links = { ...p.links };
    if (old) {
      // Empty inputs mean no change. Never erase private values the visitor could not see.
      person = personSchema.parse({
        ...Object.fromEntries(
          Object.entries(old).filter(([key]) =>
            [
              'fullName',
              'birthDate',
              'birthPlace',
              'deathDate',
              'deathPlace',
              'deceased',
              'observations',
              'sources',
              'branch',
              'certainty',
            ].includes(key),
          ),
        ),
        ...Object.fromEntries(
          Object.entries(p.person).filter(
            ([key, value]) =>
              typeof value === 'string' &&
              value !== '' &&
              !['certainty', 'id', 'revision'].includes(key),
          ),
        ),
        fullName: p.person.fullName,
        deceased: old.deceased || p.person.deceased,
        branch: p.person.branch || old.branch,
        certainty: p.person.certainty,
      } satisfies Partial<PersonData>);
      for (const type of ['father', 'mother', 'partner'] as const)
        if (!links[type]) {
          const r = graph.relations.find((r) =>
            type === 'partner'
              ? r.type === 'partner' && (r.from === old.id || r.to === old.id)
              : r.type === type && r.to === old.id,
          );
          if (r) {
            links[type] = type === 'partner' ? (r.from === old.id ? r.to : r.from) : r.from;
            links[`${type}Certainty`] = r.certainty;
          }
        }
    }
    if (findDuplicate(graph.people, person, old?.id))
      fail('Revisá si la persona ya figura en el árbol antes de enviar el aporte.');
    const target = old?.id || `person_${p.requestId}`;
    try {
      validateGraph(
        new Set([...graph.people.map((x) => x.id), target]),
        replaceLinks(target, links, graph.relations),
      );
    } catch {
      fail('Los parentescos propuestos no son válidos. Revisá los vínculos seleccionados.');
    }
    const rate = await throttle(tx, actor, 'public_proposal', 10);
    const contributor = {
      uid: actor.uid,
      displayName: p.contributor.displayName || 'Visitante',
      email: p.contributor.email,
      identityVerified: false,
    };
    rate();
    if (photo) tx.create(ref('submissionPhotos', p.requestId), { id: p.requestId, dataUrl: photo });
    tx.create(ref('submissions', p.requestId), {
      requestId: p.requestId,
      kind: p.kind,
      ...(old ? { personId: old.id, baseRevision: old.revision } : {}),
      person,
      links,
      submittedByUid: actor.uid,
      submittedBy: contributor,
      identityVerified: false,
      fingerprint,
      status: 'pending',
      submittedAt: stamp(),
      reviewedBy: null,
      reviewedAt: null,
    });
    notify(
      tx,
      `submission_${p.requestId}`,
      contributor,
      p.kind === 'new' ? 'Nuevo familiar propuesto' : 'Corrección propuesta',
    );
    audit(tx, actor, 'submission.create', p.requestId, { kind: p.kind, identityVerified: false });
    return { id: p.requestId, status: 'pending' };
  });
}
export async function submitPrivacy(actor: Actor, input: unknown) {
  const p = z
    .object({
      requestId: z.string().uuid(),
      type: z.enum(['correction', 'deletion']),
      message: z.string().trim().min(10).max(3000),
      contributor: contributorSchema,
      website: z.literal('').default(''),
    })
    .strict()
    .parse(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(p)).digest('hex');
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(ref('privacyRequests', p.requestId));
    if (existing.exists) {
      if (existing.data()?.fingerprint !== fingerprint)
        throw new HttpsError('already-exists', 'No se pudo usar ese identificador.');
      return { id: p.requestId };
    }
    const rate = await throttle(tx, actor, 'public_privacy', 5);
    const contributor = {
      uid: actor.uid,
      displayName: p.contributor.displayName || 'Visitante',
      email: p.contributor.email,
      identityVerified: false,
    };
    rate();
    tx.create(ref('privacyRequests', p.requestId), {
      ...p,
      submittedByUid: actor.uid,
      submittedBy: contributor,
      identityVerified: false,
      fingerprint,
      status: 'pending',
      submittedAt: stamp(),
    });
    notify(tx, `privacy_${p.requestId}`, contributor, 'Solicitud de privacidad');
    audit(tx, actor, 'privacy.request', p.requestId, { type: p.type });
    return { id: p.requestId };
  });
}

export async function verifyAdmin(actor: Actor) {
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    return { admin: true };
  });
}

// Connecting nodes changes only the selected relationship, never other parents or partners.
export async function manageRelationship(actor: Actor, input: unknown) {
  const schema = z.discriminatedUnion('action', [
    relationConnectionSchema
      .extend({ action: z.literal('connect'), requestId: z.string().uuid() })
      .strict(),
    z
      .object({
        action: z.literal('remove'),
        requestId: z.string().uuid(),
        relationship: relationshipSchema,
      })
      .strict(),
  ]);
  const p = schema.parse(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(p)).digest('hex');
  return db().runTransaction(async (tx) => {
    await authorize(tx, actor, ['admin']);
    const operation = ref('relationshipOperations', p.requestId);
    const previous = await tx.get(operation);
    if (previous.exists) {
      if (previous.data()?.fingerprint !== fingerprint)
        throw new HttpsError('already-exists', 'La operación ya se usó para otro parentesco.');
      return previous.data()!.result;
    }
    const graph = await readGraph(tx);
    let after: Relationship[];
    if (p.action === 'connect') {
      try {
        after = connectRelationship(new Set(graph.people.map((x) => x.id)), graph.relations, p);
      } catch (e) {
        fail((e as Error).message);
      }
    } else {
      const old = graph.relations.find((r) => r.id === p.relationship.id);
      if (
        old &&
        (['from', 'to', 'type', 'certainty'] as const).some(
          (key) => old[key] !== p.relationship[key],
        )
      )
        fail('El parentesco cambió. Revisá la versión actual antes de quitarlo.');
      after = graph.relations.filter((r) => r.id !== p.relationship.id);
    }
    const changed =
      after !== graph.relations &&
      (after.length !== graph.relations.length ||
        after.some((r) => {
          const old = graph.relations.find((x) => x.id === r.id);
          return (
            !old ||
            old.from !== r.from ||
            old.to !== r.to ||
            old.type !== r.type ||
            old.certainty !== r.certainty
          );
        }));
    if (changed) {
      writeRelations(tx, graph.relations, after, graph.people, graph.people);
      const affected = new Set<string>();
      for (const r of [...graph.relations, ...after]) {
        const other = (after.includes(r) ? graph.relations : after).find((x) => x.id === r.id);
        if (
          !other ||
          other.from !== r.from ||
          other.to !== r.to ||
          other.type !== r.type ||
          other.certainty !== r.certainty
        ) {
          affected.add(r.from);
          affected.add(r.to);
        }
      }
      for (const id of affected) {
        const person = graph.people.find((x) => x.id === id);
        if (person)
          tx.update(ref('persons', id), { revision: person.revision + 1, updatedAt: stamp() });
      }
      tx.set(ref('system', 'graph'), { version: graph.version + 1 });
      audit(
        tx,
        actor,
        p.action === 'connect' ? 'relationship.connect' : 'relationship.remove',
        p.requestId,
        { before: graph.relations, after },
      );
    }
    const result = { changed };
    tx.create(operation, { actorUid: actor.uid, fingerprint, result, createdAt: stamp() });
    return result;
  });
}
