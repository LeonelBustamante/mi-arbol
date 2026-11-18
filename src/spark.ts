import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import { z } from 'zod';
import {
  personSchema,
  linksSchema,
  idSchema,
  relationshipSchema,
  relationConnectionSchema,
  findDuplicate,
  validateGraph,
  replaceLinks,
  publicPerson,
  connectRelationship,
  type Person,
  type PersonData,
  type Relationship,
  type Links,
} from '../functions/src/domain';
import { preparePhoto } from './photo';

const ownerEmail = 'aleobustamante@gmail.com';
const uuid = z.string().uuid();
const image = z
  .string()
  .max(180000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
const contributor = z
  .object({
    displayName: z.string().trim().max(160).default(''),
    email: z.string().trim().max(254).default(''),
  })
  .strict();
export function mergeCorrection(old: Person, incoming: PersonData): PersonData {
  const previous = personSchema.parse(
    Object.fromEntries(Object.keys(incoming).map((k) => [k, old[k as keyof Person]])),
  );
  return personSchema.parse({
    ...previous,
    ...Object.fromEntries(
      Object.entries(incoming).filter(
        ([k, v]) => typeof v === 'string' && v !== '' && k !== 'certainty',
      ),
    ),
    fullName: incoming.fullName,
    deceased: old.deceased || incoming.deceased,
    branch: incoming.branch || old.branch,
    certainty: incoming.certainty,
  });
}
export function preserveLinks(id: string, links: Links, relations: Relationship[]): Links {
  const result = { ...links };
  for (const type of ['father', 'mother', 'partner'] as const)
    if (!result[type]) {
      const r = relations.find(
        (r) => r.type === type && (type === 'partner' ? r.from === id || r.to === id : r.to === id),
      );
      if (r) {
        result[type] = type === 'partner' && r.from === id ? r.to : r.from;
        result[`${type}Certainty`] = r.certainty;
      }
    }
  return result;
}
function sameRelationship(a?: Relationship, b?: Relationship) {
  return Boolean(
    a &&
    b &&
    (['id', 'from', 'to', 'type', 'certainty'] as const).every((key) => a[key] === b[key]),
  );
}
class GraphConflict extends Error {}
export function createSparkApi(db: Firestore, auth: Auth) {
  const ref = (path: string, id: string) => doc(db, path, id);
  async function verifyAdmin() {
    const user = auth.currentUser;
    if (!user || !user.email || !user.emailVerified)
      throw new Error('Ingresá con tu cuenta de Google administradora.');
    const token = await user.getIdTokenResult();
    if (token.signInProvider !== 'google.com') throw new Error('Ingresá con Google.');
    if (user.email !== ownerEmail) {
      const invitation = await getDocFromServer(ref('adminInvitations', user.email.toLowerCase()));
      if (invitation.data()?.status !== 'active')
        throw new Error(
          'Esta cuenta no tiene una invitación activa. Pedile acceso al propietario.',
        );
    }
    const member = await getDocFromServer(ref('members', user.uid));
    if (!member.exists()) {
      const batch = writeBatch(db);
      batch.set(member.ref, { uid: user.uid, email: user.email.toLowerCase(), role: 'admin' });
      await batch.commit();
    } else if (member.data().role !== 'admin')
      throw new Error('Tu acceso administrativo fue revocado.');
    return { admin: true };
  }
  async function manageAdmin(input: unknown) {
    const p = z
      .object({
        email: z.email().trim().toLowerCase().max(254),
        status: z.enum(['active', 'revoked']),
      })
      .strict()
      .parse(input);
    if (auth.currentUser?.email !== ownerEmail)
      throw new Error('Solo el propietario puede administrar los accesos.');
    if (p.email === ownerEmail)
      throw new Error('El acceso del propietario no se modifica desde este panel.');
    return runTransaction(db, async (tx) => {
      const invitation = ref('adminInvitations', p.email);
      await tx.get(invitation);
      tx.set(invitation, {
        email: p.email,
        status: p.status,
        updatedBy: auth.currentUser!.uid,
        updatedAt: serverTimestamp(),
      });
      audit(tx, `admin.${p.status === 'active' ? 'grant' : 'revoke'}`, p.email, {
        status: p.status,
      });
      return { status: p.status };
    });
  }
  async function submit(name: 'submissions' | 'privacyRequests', input: unknown) {
    const common = { requestId: uuid, contributor, website: z.literal('').default('') };
    const p =
      name === 'submissions'
        ? z
            .object({
              ...common,
              kind: z.enum(['new', 'correction']),
              personId: idSchema.optional(),
              person: personSchema,
              links: linksSchema,
              photo: image.optional(),
              contributor: contributor.extend({
                displayName: z
                  .string()
                  .trim()
                  .min(2, 'Ingresá el nombre de quien lo carga.')
                  .max(160),
              }),
            })
            .strict()
            .parse(input)
        : z
            .object({
              ...common,
              type: z.enum(['correction', 'deletion']),
              message: z.string().trim().min(10).max(3000),
            })
            .strict()
            .parse(input);
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p))),
      ),
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const receiptRef = ref('publicReceipts', p.requestId);
    const receipt = await getDocFromServer(receiptRef);
    if (receipt.exists()) {
      if (receipt.data().fingerprint !== fingerprint || receipt.data().collection !== name)
        throw new Error('Este identificador ya se usó para otro aporte. Abrí un formulario nuevo.');
      return { id: p.requestId, status: 'pending' };
    }
    let revision = 0;
    if ('kind' in p && p.kind === 'correction') {
      if (!p.personId) throw new Error('Seleccioná un familiar del árbol.');
      const version = await getDocFromServer(ref('publicPersonVersions', p.personId));
      if (!version.exists()) throw new Error('Este familiar ya no está disponible.');
      revision = version.data().revision;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      let previousCount: number | undefined;
      let previousStart: number | undefined;
      try {
        return await runTransaction(db, async (tx) => {
          const existing = await tx.get(receiptRef);
          if (existing.exists()) {
            if (existing.data().fingerprint !== fingerprint || existing.data().collection !== name)
              throw new Error('El identificador corresponde a otro aporte.');
            return { id: p.requestId, status: 'pending' };
          }
          const limitRef = ref('publicLimits', name);
          const limit = await tx.get(limitRef);
          const old = limit.data();
          previousCount = old?.count;
          previousStart = old?.windowStart.toMillis();
          const fresh = !old || old.windowStart.toMillis() + 86400000 <= Date.now();
          const count = fresh ? 1 : old.count + 1;
          if (count > (name === 'submissions' ? 100 : 20))
            throw new Error('Se alcanzó el límite de aportes por hoy. Probá mañana.');
          const { requestId, website, contributor: who, ...data } = p;
          const photo = 'photo' in data ? data.photo : undefined;
          if ('photo' in data) delete data.photo;
          const payload = {
            ...data,
            requestId,
            ...(revision ? { baseRevision: revision } : {}),
            submittedBy: {
              displayName: who.displayName,
              email: who.email,
              identityVerified: false,
            },
            identityVerified: false,
            status: 'pending',
            submittedAt: serverTimestamp(),
            hasPhoto: Boolean(photo),
            reviewedBy: null,
            reviewedAt: null,
          };
          tx.set(ref(name, requestId), payload);
          if (photo) tx.set(ref('submissionPhotos', requestId), { id: requestId, dataUrl: photo });
          tx.set(receiptRef, { id: requestId, collection: name, fingerprint });
          tx.set(limitRef, {
            count,
            windowStart: fresh ? serverTimestamp() : old.windowStart,
            requestId,
          });
          return { id: requestId, status: 'pending' };
        });
      } catch (e) {
        if (attempt === 3) throw e;
        const latest = (await getDocFromServer(ref('publicLimits', name))).data();
        if (latest?.count === previousCount && latest?.windowStart.toMillis() === previousStart)
          throw e;
      }
    }
    throw new Error('Se recibieron varios aportes juntos. Volvé a intentar.');
  }
  async function graphMutation<T>(
    work: (
      tx: Transaction,
      graph: { people: Person[]; relations: Relationship[]; version: number },
    ) => Promise<T>,
  ) {
    // Web SDK transactions cannot query collections. Read a server snapshot first;
    // the version document makes every accepted graph edit invalidate stale snapshots.
    for (let attempt = 0; attempt < 4; attempt++) {
      const version = await getDocFromServer(ref('system', 'graph'));
      const [people, relations] = await Promise.all([
        getDocsFromServer(collection(db, 'persons')),
        getDocsFromServer(collection(db, 'relationships')),
      ]);
      const graph = {
        version: version.data()?.version || 0,
        people: people.docs.map((d) => ({ ...d.data(), id: d.id }) as Person),
        relations: relations.docs.map((d) => d.data() as Relationship),
      };
      try {
        return await runTransaction(db, async (tx) => {
          const current = await tx.get(ref('system', 'graph'));
          if ((current.data()?.version || 0) !== graph.version) throw new GraphConflict();
          return work(tx, graph);
        });
      } catch (e) {
        if (attempt === 3) throw e;
        if (!(e instanceof GraphConflict)) {
          const current = await getDocFromServer(ref('system', 'graph'));
          if ((current.data()?.version || 0) === graph.version) throw e;
        }
      }
    }
    throw new Error('El árbol cambió. Volvé a intentar.');
  }
  function audit(tx: Transaction, action: string, entityId: string, changes: unknown) {
    tx.set(doc(collection(db, 'auditLogs')), {
      actorUid: auth.currentUser!.uid,
      action,
      entityId,
      changes,
      timestamp: serverTimestamp(),
    });
  }
  function writePerson(tx: Transaction, person: Person, photo?: string) {
    tx.set(ref('persons', person.id), { ...person, updatedAt: serverTimestamp() });
    if (photo) tx.set(ref('personPhotos', person.id), { id: person.id, dataUrl: photo });
    if (person.certainty === 'confirmed') {
      tx.set(ref('publicPersons', person.id), publicPerson(person.id, person));
      tx.set(ref('publicPersonVersions', person.id), { revision: person.revision });
      if (photo) tx.set(ref('publicPersonPhotos', person.id), { id: person.id, dataUrl: photo });
    } else {
      tx.delete(ref('publicPersons', person.id));
      tx.delete(ref('publicPersonVersions', person.id));
      tx.delete(ref('publicPersonPhotos', person.id));
    }
  }
  function writeGraph(
    tx: Transaction,
    before: Relationship[],
    after: Relationship[],
    people: Person[],
    version: number,
    previousPeople: Person[],
  ) {
    const previouslyConfirmed = new Set(
      previousPeople.filter((p) => p.certainty === 'confirmed').map((p) => p.id),
    );
    const confirmed = new Set(people.filter((p) => p.certainty === 'confirmed').map((p) => p.id));
    for (const r of before)
      if (!after.some((a) => a.id === r.id)) {
        tx.delete(ref('relationships', r.id));
        tx.delete(ref('publicRelationships', r.id));
      }
    for (const r of after) {
      const previous = before.find((a) => a.id === r.id);
      if (!sameRelationship(previous, r)) tx.set(ref('relationships', r.id), r);
      const published = r.certainty === 'confirmed' && confirmed.has(r.from) && confirmed.has(r.to);
      const wasPublished =
        previous?.certainty === 'confirmed' &&
        previouslyConfirmed.has(previous.from) &&
        previouslyConfirmed.has(previous.to);
      if (sameRelationship(previous, r) && published === wasPublished) continue;
      if (published)
        tx.set(ref('publicRelationships', r.id), {
          id: r.id,
          from: r.from,
          to: r.to,
          type: r.type,
        });
      else tx.delete(ref('publicRelationships', r.id));
    }
    tx.set(ref('system', 'graph'), { version: version + 1 });
  }
  function check(
    people: Person[],
    relations: Relationship[],
    target: string,
    person: PersonData,
    links: Links,
    revision?: number,
  ) {
    const old = people.find((p) => p.id === target);
    if (revision !== undefined && old?.revision !== revision)
      throw new Error('La persona cambió. Revisá la versión actual antes de aprobar.');
    if (findDuplicate(people, person, target))
      throw new Error('Hay un posible familiar duplicado.');
    const after = replaceLinks(target, links, relations);
    validateGraph(new Set([...people.map((p) => p.id), target]), after);
    return { old, after };
  }
  async function cleanPhoto(value?: string) {
    if (!value) return undefined;
    image.parse(value);
    const blob = await (await fetch(value)).blob();
    return preparePhoto(new File([blob], 'familiar.jpg', { type: 'image/jpeg' }));
  }
  async function moderate(input: unknown) {
    const p = z
      .object({
        id: idSchema,
        decision: z.enum(['approved', 'rejected']),
        reason: z.string().trim().max(1000).default(''),
      })
      .strict()
      .parse(input);
    return graphMutation(async (tx, graph) => {
      const snapshot = await tx.get(ref('submissions', p.id));
      if (!snapshot.exists()) throw new Error('El aporte no existe.');
      const s = snapshot.data();
      if (s.status !== 'pending') {
        if (s.status !== p.decision) throw new Error('El aporte ya fue revisado.');
        return { status: s.status };
      }
      if (p.decision === 'approved') {
        const target = s.kind === 'new' ? `person_${p.id}` : idSchema.parse(s.personId);
        const old = graph.people.find((x) => x.id === target);
        if (s.kind === 'correction' && !old) throw new Error('La persona fue eliminada.');
        const proposed = personSchema.parse(s.person);
        const person = old ? mergeCorrection(old, proposed) : proposed;
        const links = old
          ? preserveLinks(target, linksSchema.parse(s.links), graph.relations)
          : linksSchema.parse(s.links);
        const { after } = check(
          graph.people,
          graph.relations,
          target,
          person,
          links,
          s.kind === 'correction' ? s.baseRevision : undefined,
        );
        const [incoming, existing] = await Promise.all([
          tx.get(ref('submissionPhotos', p.id)),
          tx.get(ref('personPhotos', target)),
        ]);
        const photo = await cleanPhoto(incoming.data()?.dataUrl || existing.data()?.dataUrl);
        const published = { ...person, id: target, revision: (old?.revision || 0) + 1 };
        writePerson(tx, published, photo);
        writeGraph(
          tx,
          graph.relations,
          after,
          [...graph.people.filter((x) => x.id !== target), published],
          graph.version,
          graph.people,
        );
        audit(tx, 'person.publish', target, {
          before: old || null,
          after: person,
          submissionId: p.id,
        });
      }
      tx.update(snapshot.ref, {
        status: p.decision,
        reason: p.reason,
        reviewedBy: auth.currentUser!.uid,
        reviewedAt: serverTimestamp(),
      });
      audit(tx, `submission.${p.decision}`, p.id, { reason: p.reason });
      return { status: p.decision };
    });
  }
  async function createPerson(input: unknown) {
    const p = z
      .object({
        requestId: uuid,
        person: personSchema,
        links: linksSchema,
        photo: image.optional(),
      })
      .strict()
      .parse(input);
    const photo = await cleanPhoto(p.photo);
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p))),
      ),
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    return graphMutation(async (tx, graph) => {
      const operation = await tx.get(ref('personOperations', p.requestId));
      if (operation.exists()) {
        if (operation.data().fingerprint !== fingerprint)
          throw new Error(
            'El identificador ya corresponde a otro familiar. Abrí un formulario nuevo.',
          );
        return operation.data().result;
      }
      const target = `person_${p.requestId}`;
      if (graph.people.some((x) => x.id === target))
        throw new Error('Ese familiar ya existe. Abrí un formulario nuevo.');
      const { after } = check(graph.people, graph.relations, target, p.person, p.links);
      const person = { ...p.person, id: target, revision: 1 };
      writePerson(tx, person, photo);
      writeGraph(
        tx,
        graph.relations,
        after,
        [...graph.people, person],
        graph.version,
        graph.people,
      );
      audit(tx, 'person.create', target, { after: p.person });
      const result = { id: target };
      tx.set(operation.ref, {
        fingerprint,
        result,
        actorUid: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
      });
      return result;
    });
  }
  async function editPerson(input: unknown) {
    const p = z
      .object({
        id: idSchema,
        baseRevision: z.number().int().min(1),
        person: personSchema,
        links: linksSchema,
        photo: image.optional(),
      })
      .strict()
      .parse(input);
    const uploaded = await cleanPhoto(p.photo);
    return graphMutation(async (tx, graph) => {
      const { old, after } = check(
        graph.people,
        graph.relations,
        p.id,
        p.person,
        p.links,
        p.baseRevision,
      );
      const existing = await tx.get(ref('personPhotos', p.id));
      const person = { ...p.person, id: p.id, revision: p.baseRevision + 1 };
      writePerson(tx, person, uploaded || existing.data()?.dataUrl);
      writeGraph(
        tx,
        graph.relations,
        after,
        graph.people.map((x) => (x.id === p.id ? person : x)),
        graph.version,
        graph.people,
      );
      audit(tx, 'person.edit', p.id, { before: old, after: p.person });
      return { id: p.id };
    });
  }
  async function manageRelationship(input: unknown) {
    const p = z
      .discriminatedUnion('action', [
        relationConnectionSchema.extend({ action: z.literal('connect'), requestId: uuid }).strict(),
        z
          .object({
            action: z.literal('remove'),
            requestId: uuid,
            relationship: relationshipSchema,
          })
          .strict(),
      ])
      .parse(input);
    return graphMutation(async (tx, graph) => {
      const operation = await tx.get(ref('relationshipOperations', p.requestId));
      const fingerprint = JSON.stringify(p);
      if (operation.exists()) {
        if (operation.data().fingerprint !== fingerprint)
          throw new Error('La operación ya se usó para otro parentesco.');
        return operation.data().result;
      }
      let after: Relationship[];
      if (p.action === 'connect')
        after = connectRelationship(new Set(graph.people.map((x) => x.id)), graph.relations, p);
      else {
        const old = graph.relations.find((r) => r.id === p.relationship.id);
        if (old && !sameRelationship(old, p.relationship))
          throw new Error('El parentesco cambió. Revisá antes de quitarlo.');
        after = graph.relations.filter((r) => r.id !== p.relationship.id);
      }
      const changed = JSON.stringify(after) !== JSON.stringify(graph.relations);
      if (changed) {
        const affected = new Set<string>();
        for (const r of [...graph.relations, ...after]) {
          const other = (after.includes(r) ? graph.relations : after).find((x) => x.id === r.id);
          if (!sameRelationship(r, other)) {
            affected.add(r.from);
            affected.add(r.to);
          }
        }
        const people = graph.people.map((p) =>
          affected.has(p.id) ? { ...p, revision: p.revision + 1 } : p,
        );
        for (const person of people)
          if (affected.has(person.id)) {
            tx.update(ref('persons', person.id), {
              revision: person.revision,
              updatedAt: serverTimestamp(),
            });
            if (person.certainty === 'confirmed')
              tx.set(ref('publicPersonVersions', person.id), { revision: person.revision });
          }
        writeGraph(tx, graph.relations, after, people, graph.version, graph.people);
        audit(tx, `relationship.${p.action}`, p.requestId, { before: graph.relations, after });
      }
      const result = { changed };
      tx.set(operation.ref, {
        fingerprint,
        result,
        actorUid: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
      });
      return result;
    });
  }
  async function deletePerson(input: unknown) {
    const p = z
      .object({
        id: idSchema,
        baseRevision: z.number().int().min(1),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(input);
    return graphMutation(async (tx, graph) => {
      const old = graph.people.find((x) => x.id === p.id);
      if (!old) return { deleted: true };
      if (old.revision !== p.baseRevision)
        throw new Error('La persona cambió. Revisá antes de eliminar.');
      for (const path of [
        'persons',
        'publicPersons',
        'publicPersonVersions',
        'personPhotos',
        'publicPersonPhotos',
      ])
        tx.delete(ref(path, p.id));
      writeGraph(
        tx,
        graph.relations,
        graph.relations.filter((r) => r.from !== p.id && r.to !== p.id),
        graph.people.filter((x) => x.id !== p.id),
        graph.version,
        graph.people,
      );
      audit(tx, 'person.delete', p.id, { reason: p.reason });
      return { deleted: true };
    });
  }
  async function resolvePrivacy(input: unknown) {
    const p = z
      .object({ id: idSchema, resolution: z.string().trim().min(10).max(3000) })
      .strict()
      .parse(input);
    return runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref('privacyRequests', p.id));
      if (!snapshot.exists()) throw new Error('La solicitud no existe.');
      if (snapshot.data().status === 'resolved') return { status: 'resolved' };
      tx.update(snapshot.ref, {
        status: 'resolved',
        resolution: p.resolution,
        reviewedBy: auth.currentUser!.uid,
        reviewedAt: serverTimestamp(),
      });
      audit(tx, 'privacy.resolve', p.id, { resolution: p.resolution });
      return { status: 'resolved' };
    });
  }
  return async (name: string, input: unknown = {}) => {
    if (name === 'submitContribution') return submit('submissions', input);
    if (name === 'submitPrivacy') return submit('privacyRequests', input);
    if (name === 'verifyAdmin') return verifyAdmin();
    if (!auth.currentUser) throw new Error('Ingresá como administrador.');
    switch (name) {
      case 'manageAdmin':
        return manageAdmin(input);
      case 'moderate':
        return moderate(input);
      case 'createPerson':
        return createPerson(input);
      case 'editPerson':
        return editPerson(input);
      case 'manageRelationship':
        return manageRelationship(input);
      case 'deletePerson':
        return deletePerson(input);
      case 'resolvePrivacy':
        return resolvePrivacy(input);
      default:
        throw new Error('Operación no disponible.');
    }
  };
}
