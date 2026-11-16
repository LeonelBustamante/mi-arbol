import sharp from 'sharp';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
  type Functions,
} from 'firebase/functions';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { personSchema, linksSchema } from '../functions/src/domain';
const firestorePort = Number(process.env.TEST_FIRESTORE_PORT || 8180);
const authPort = Number(process.env.TEST_AUTH_PORT || 9199);
const functionsPort = Number(process.env.TEST_FUNCTIONS_PORT || 5101);
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
const projectId = 'demo-mi-arbol';
const adminApp = initializeAdmin({ projectId }, 'integration-admin');
const db = getFirestore(adminApp);
type Session = { app: FirebaseApp; functions: Functions; uid: string };
let admin: Session;
let outsider: Session;
let guest: Session;
const apps: FirebaseApp[] = [];
async function session(key: string, login = true) {
  const app = initializeApp({ projectId, apiKey: 'fake-api-key', authDomain: 'localhost' }, key);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });
  const functions = getFunctions(app);
  connectFunctionsEmulator(functions, '127.0.0.1', functionsPort);
  if (!login) return { app, functions, uid: '' };
  const payload = {
    sub: `test-${key}`,
    email: key === 'admin' ? 'aleobustamante@gmail.com' : `${key}@example.test`,
    email_verified: true,
    name: `Test ${key}`,
    iss: 'https://accounts.google.com',
    aud: 'fake-client-id',
    iat: 1700000000,
    exp: 4102444800,
  };
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(jwt));
  return { app, functions, uid: user.uid };
}
const invoke = <T = any>(s: Session, name: string, data: unknown = {}) =>
  httpsCallable<unknown, T>(s.functions, name)(data).then((r) => r.data);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (name = 'Test Person One', extra = {}) =>
  personSchema.parse({
    fullName: name,
    birthDate: '1900-01-01',
    birthPlace: 'Private town',
    observations: 'Private note',
    sources: 'Authorized source',
    ...extra,
  });
const proposal = (n = 1, extra = {}) => ({
  requestId: uuid(n),
  kind: 'new',
  person: person(),
  links: linksSchema.parse({}),
  contributor: { displayName: 'Test Contributor', email: 'contact@example.test' },
  website: '',
  ...extra,
});
async function seedPerson(id: string, name: string) {
  await db.doc(`persons/${id}`).set({ ...person(name), id, revision: 1 });
  await db.doc(`publicPersons/${id}`).set({ id, fullName: name, birthDate: '1900-01-01' });
}
beforeAll(async () => {
  [admin, outsider, guest] = await Promise.all([
    session('admin'),
    session('outsider'),
    session('guest', false),
  ]);
});
beforeEach(async () => {
  const r = await fetch(
    `http://127.0.0.1:${firestorePort}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!r.ok) throw new Error('Cannot reset emulator');
  await db
    .doc(`members/${admin.uid}`)
    .set({ uid: admin.uid, role: 'admin', email: 'aleobustamante@gmail.com' });
});
afterAll(async () => {
  await Promise.all(apps.map(deleteApp));
  await db.terminate();
  await deleteAdmin(adminApp);
});
describe('aportes sin sesión y administrador único', () => {
  it('acepta aportes sin ningún usuario de Firebase Auth y no publica pendientes', async () => {
    expect(getAuth(guest.app).currentUser).toBeNull();
    expect((await invoke(guest, 'submitContribution', proposal())).status).toBe('pending');
    expect(getAuth(guest.app).currentUser).toBeNull();
    expect((await db.collection('persons').get()).empty).toBe(true);
    expect((await db.collection('publicPersons').get()).empty).toBe(true);
    const s = (await db.doc(`submissions/${uuid(1)}`).get()).data()!;
    expect(s.identityVerified).toBe(false);
    expect((await db.doc(`submissionPhotos/${uuid(1)}`).get()).exists).toBe(false);
    expect(s.submittedBy.email).toBe('contact@example.test');
    expect((await db.doc(`mailOutbox/submission_${uuid(1)}`).get()).exists).toBe(true);
  });
  it('exige el nombre de quien lo carga y permite omitir el correo', async () => {
    await expect(
      invoke(guest, 'submitContribution', proposal(1, { contributor: {} })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    await expect(
      invoke(guest, 'submitContribution', proposal(1, { contributor: { displayName: '  ' } })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    await invoke(
      guest,
      'submitContribution',
      proposal(1, { contributor: { displayName: 'Test Contributor' } }),
    );
    expect((await db.doc(`submissions/${uuid(1)}`).get()).data()?.submittedBy.displayName).toBe(
      'Test Contributor',
    );
  });
  it('exige autenticación administrativa para aprobar, editar, importar y eliminar', async () => {
    for (const method of ['moderate', 'editPerson', 'deletePerson', 'importTree', 'verifyAdmin'])
      await expect(invoke(guest, method, {})).rejects.toMatchObject({
        code: 'functions/unauthenticated',
      });
    await db.doc(`members/${outsider.uid}`).set({ role: 'admin' });
    await expect(invoke(outsider, 'verifyAdmin')).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
  });
  it('el correo del propietario sin rol administrativo no alcanza', async () => {
    expect((await invoke(admin, 'verifyAdmin')).admin).toBe(true);
    await db.doc(`members/${admin.uid}`).set({ role: 'visitor' });
    await expect(invoke(admin, 'verifyAdmin')).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
  });
  it('una propuesta repetida no duplica solicitudes, avisos ni auditorías', async () => {
    await Promise.all([
      invoke(guest, 'submitContribution', proposal()),
      invoke(guest, 'submitContribution', proposal()),
    ]);
    expect((await db.collection('submissions').get()).size).toBe(1);
    expect((await db.collection('mailOutbox').get()).size).toBe(1);
    expect(
      (await db.collection('auditLogs').where('action', '==', 'submission.create').get()).size,
    ).toBe(1);
    await expect(
      invoke(guest, 'submitContribution', proposal(1, { person: person('Changed Payload') })),
    ).rejects.toMatchObject({ code: 'functions/already-exists' });
  });
  it('solo la aprobación administrativa publica y es atómica e idempotente', async () => {
    await invoke(guest, 'submitContribution', proposal());
    await expect(
      invoke(outsider, 'moderate', { id: uuid(1), decision: 'approved' }),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await Promise.all([
      invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' }),
      invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' }),
    ]);
    expect((await db.doc(`publicPersons/person_${uuid(1)}`).get()).data()).toEqual({
      id: `person_${uuid(1)}`,
      fullName: 'Test Person One',
      birthDate: '1900-01-01',
    });
    expect((await db.doc(`persons/person_${uuid(1)}`).get()).data()?.birthPlace).toBe(
      'Private town',
    );
    expect(
      (await db.collection('auditLogs').where('action', '==', 'person.publish').get()).size,
    ).toBe(1);
  });
  it('rechazar no publica y no puede convertirse en aprobación por reintento', async () => {
    await invoke(guest, 'submitContribution', proposal());
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'rejected' });
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'rejected' });
    expect((await db.collection('persons').get()).empty).toBe(true);
    await expect(
      invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' }),
    ).rejects.toBeDefined();
  });
  it('impide duplicados con aprobaciones concurrentes', async () => {
    await invoke(guest, 'submitContribution', proposal());
    await invoke(guest, 'submitContribution', proposal(2));
    const r = await Promise.allSettled([
      invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' }),
      invoke(admin, 'moderate', { id: uuid(2), decision: 'approved' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('persons').get()).size).toBe(1);
  });
  it('permite corregir sin descargar ni borrar datos privados desconocidos', async () => {
    await seedPerson('existing', 'Test Original');
    const response = await invoke(
      guest,
      'submitContribution',
      proposal(1, {
        kind: 'correction',
        personId: 'existing',
        person: personSchema.parse({ fullName: 'Test Corrected', birthDate: '1900-01-01' }),
      }),
    );
    expect(Object.keys(response).sort()).toEqual(['id', 'status']);
    expect(JSON.stringify(response)).not.toContain('Private');
    const s = (await db.doc(`submissions/${uuid(1)}`).get()).data()!;
    expect(s.person.observations).toBe('Private note');
    expect(s.baseRevision).toBe(1);
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' });
    expect((await db.doc('persons/existing').get()).data()?.fullName).toBe('Test Corrected');
    expect((await db.doc('persons/existing').get()).data()?.birthPlace).toBe('Private town');
  });
  it('no permite corregir o relacionar IDs privados ni agregar campos de privilegio', async () => {
    await seedPerson('hidden', 'Test Hidden');
    await db.doc('publicPersons/hidden').delete();
    await expect(
      invoke(guest, 'submitContribution', proposal(1, { kind: 'correction', personId: 'hidden' })),
    ).rejects.toBeDefined();
    await expect(
      invoke(
        guest,
        'submitContribution',
        proposal(2, { links: linksSchema.parse({ father: 'hidden' }) }),
      ),
    ).rejects.toBeDefined();
    await expect(
      invoke(guest, 'submitContribution', { ...proposal(3), role: 'admin' }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  });
  it('preserva vínculos privados al proponer una corrección con vínculos vacíos', async () => {
    await seedPerson('parent', 'Test Hidden Parent');
    await seedPerson('child', 'Test Child');
    await db.doc('publicPersons/parent').delete();
    await db
      .doc('relationships/r')
      .set({ id: 'r', from: 'parent', to: 'child', type: 'father', certainty: 'hypothesis' });
    await invoke(
      guest,
      'submitContribution',
      proposal(1, {
        kind: 'correction',
        personId: 'child',
        person: personSchema.parse({ fullName: 'Test Child' }),
      }),
    );
    const s = (await db.doc(`submissions/${uuid(1)}`).get()).data()!;
    expect(s.links.father).toBe('parent');
    expect(s.links.fatherCertainty).toBe('hypothesis');
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' });
    expect((await db.collection('relationships').get()).docs[0].data().from).toBe('parent');
    expect((await db.collection('publicRelationships').get()).size).toBe(0);
  });
  it('rechaza correcciones desactualizadas y ciclos sin cambiar el árbol', async () => {
    await seedPerson('a', 'Test Ancestor');
    await seedPerson('b', 'Test Child');
    await db
      .doc('relationships/r')
      .set({ id: 'r', from: 'a', to: 'b', type: 'father', certainty: 'confirmed' });
    await expect(
      invoke(
        guest,
        'submitContribution',
        proposal(1, {
          kind: 'correction',
          personId: 'a',
          person: person('Test Ancestor'),
          links: linksSchema.parse({ father: 'b' }),
        }),
      ),
    ).rejects.toBeDefined();
    await invoke(
      guest,
      'submitContribution',
      proposal(2, { kind: 'correction', personId: 'a', person: person('Test Changed Ancestor') }),
    );
    await invoke(admin, 'editPerson', {
      id: 'a',
      baseRevision: 1,
      person: person('Test Admin Change'),
      links: linksSchema.parse({}),
    });
    await expect(
      invoke(admin, 'moderate', { id: uuid(2), decision: 'approved' }),
    ).rejects.toBeDefined();
  });
  it('mantiene hipótesis privadas y publica vínculos sin metadatos privados', async () => {
    await seedPerson('a', 'Test Parent');
    await invoke(
      guest,
      'submitContribution',
      proposal(1, {
        person: person('Test Hypothesis', { certainty: 'hypothesis' }),
        links: linksSchema.parse({ father: 'a' }),
      }),
    );
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' });
    expect((await db.doc(`publicPersons/person_${uuid(1)}`).get()).exists).toBe(false);
    await invoke(admin, 'editPerson', {
      id: `person_${uuid(1)}`,
      baseRevision: 1,
      person: person('Test Confirmed'),
      links: linksSchema.parse({ father: 'a' }),
    });
    expect(
      Object.keys((await db.collection('publicRelationships').get()).docs[0].data()).sort(),
    ).toEqual(['from', 'id', 'to', 'type']);
  });
  it('limita spam por origen sin sesión y rechaza el campo trampa', async () => {
    await expect(
      invoke(guest, 'submitContribution', proposal(50, { website: 'bot.example' })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    for (let i = 0; i < 10; i++)
      await invoke(
        guest,
        'submitContribution',
        proposal(i + 20, { person: person(`Test Spam Person ${i}`) }),
      );
    await invoke(
      guest,
      'submitContribution',
      proposal(20, { person: person('Test Spam Person 0') }),
    );
    await expect(
      invoke(guest, 'submitContribution', proposal(40, { person: person('Test Limited') })),
    ).rejects.toMatchObject({ code: 'functions/resource-exhausted' });
  });
  it('permite privacidad sin cuenta; solo el administrador resuelve y elimina', async () => {
    await invoke(guest, 'submitPrivacy', {
      requestId: uuid(8),
      type: 'deletion',
      message: 'Test request for removal',
      contributor: {},
      website: '',
    });
    await expect(
      invoke(guest, 'resolvePrivacy', { id: uuid(8), resolution: 'Test resolved' }),
    ).rejects.toMatchObject({ code: 'functions/unauthenticated' });
    await seedPerson('a', 'Test Removed');
    await invoke(admin, 'deletePerson', {
      id: 'a',
      baseRevision: 1,
      reason: 'Test verified removal request',
    });
    await invoke(admin, 'resolvePrivacy', { id: uuid(8), resolution: 'Test removal completed' });
    expect((await db.doc('publicPersons/a').get()).exists).toBe(false);
    expect((await db.doc(`privacyRequests/${uuid(8)}`).get()).data()?.status).toBe('resolved');
  });
  it('importa solo como propietario autorizado y conserva idempotencia', async () => {
    const data = {
      version: 1,
      branches: ['Hecht'],
      persons: [{ id: 'one', data: person('Test Import') }],
      relationships: [],
    };
    await expect(invoke(guest, 'importTree', data)).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    expect((await invoke(admin, 'importTree', data)).alreadyImported).toBe(false);
    expect((await invoke(admin, 'importTree', data)).alreadyImported).toBe(true);
    expect((await db.doc('persons/one').get()).data()?.revision).toBe(1);
  });
  it('la foto queda privada hasta aprobar y se publica separada de la proyección de nombres', async () => {
    const buffer = await sharp({
      create: { width: 16, height: 12, channels: 3, background: '#789c79' },
    })
      .jpeg()
      .toBuffer();
    const photo = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    await invoke(guest, 'submitContribution', proposal(1, { photo }));
    expect((await db.doc(`submissionPhotos/${uuid(1)}`).get()).exists).toBe(true);
    expect((await db.collection('publicPersonPhotos').get()).size).toBe(0);
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' });
    expect((await db.doc(`publicPersonPhotos/person_${uuid(1)}`).get()).data()?.dataUrl).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(
      Object.keys((await db.doc(`publicPersons/person_${uuid(1)}`).get()).data()!).sort(),
    ).toEqual(['birthDate', 'fullName', 'id']);
    await invoke(admin, 'editPerson', {
      id: `person_${uuid(1)}`,
      baseRevision: 1,
      person: person('Test Person One', { certainty: 'hypothesis' }),
      links: linksSchema.parse({}),
    });
    expect((await db.doc(`publicPersonPhotos/person_${uuid(1)}`).get()).exists).toBe(false);
    expect((await db.doc(`personPhotos/person_${uuid(1)}`).get()).exists).toBe(true);
  });
  it('acepta fechas parciales sin inventar datos y no requiere checkbox de consentimiento', async () => {
    await invoke(
      guest,
      'submitContribution',
      proposal(1, {
        person: person('Test Partial Date', {
          birthDate: '061940',
          deceased: true,
          deathDate: '2000',
        }),
        contributor: { displayName: 'Test Named Contributor' },
      }),
    );
    await invoke(admin, 'moderate', { id: uuid(1), decision: 'approved' });
    expect((await db.doc(`publicPersons/person_${uuid(1)}`).get()).data()?.birthDate).toBe(
      '1940-06',
    );
    expect((await db.doc(`persons/person_${uuid(1)}`).get()).data()?.deathDate).toBe('2000');
  });
  it('rechaza archivos disfrazados de imagen', async () => {
    await expect(
      invoke(
        guest,
        'submitContribution',
        proposal(1, { photo: 'data:image/jpeg;base64,aGVsbG8=' }),
      ),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect((await db.collection('submissions').get()).size).toBe(0);
  });
  it('solo el administrador une familiares y publica relaciones sin exponer metadatos', async () => {
    await seedPerson('parent', 'Test Parent');
    await seedPerson('child', 'Test Child');
    const operation = {
      requestId: uuid(81),
      action: 'connect',
      from: 'parent',
      to: 'child',
      type: 'father',
      certainty: 'confirmed',
    };
    await expect(invoke(guest, 'manageRelationship', operation)).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(invoke(outsider, 'manageRelationship', operation)).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect((await invoke(admin, 'manageRelationship', operation)).changed).toBe(true);
    expect((await db.collection('publicRelationships').get()).docs.map((d) => d.data())).toEqual([
      { id: 'father_6_parent_child', from: 'parent', to: 'child', type: 'father' },
    ]);
    expect((await db.doc('persons/child').get()).data()?.revision).toBe(2);
    await invoke(admin, 'manageRelationship', operation);
    expect((await db.doc('persons/child').get()).data()?.revision).toBe(2);
    expect(
      (await db.collection('auditLogs').where('action', '==', 'relationship.connect').get()).size,
    ).toBe(1);
  });
  it('exige confirmar el padre que se reemplaza y conserva los demás vínculos', async () => {
    for (const [id, name] of [
      ['a', 'Test Parent A'],
      ['b', 'Test Parent B'],
      ['c', 'Test Child'],
      ['m', 'Test Mother'],
    ])
      await seedPerson(id, name);
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(82),
      action: 'connect',
      from: 'a',
      to: 'c',
      type: 'father',
    });
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(83),
      action: 'connect',
      from: 'm',
      to: 'c',
      type: 'mother',
    });
    const operation = {
      requestId: uuid(84),
      action: 'connect',
      from: 'b',
      to: 'c',
      type: 'father',
    };
    await expect(invoke(admin, 'manageRelationship', operation)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    await invoke(admin, 'manageRelationship', { ...operation, replaceId: 'father_1_a_c' });
    const links = (await db.collection('relationships').get()).docs.map((d) => d.data());
    expect(links.find((r) => r.type === 'father')?.from).toBe('b');
    expect(links.find((r) => r.type === 'mother')?.from).toBe('m');
  });
  it('rechaza ciclos, vínculos propios y confirma idempotencia sin duplicar parejas', async () => {
    await seedPerson('a', 'Test Ancestor');
    await seedPerson('b', 'Test Child');
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(85),
      action: 'connect',
      from: 'a',
      to: 'b',
      type: 'father',
    });
    await expect(
      invoke(admin, 'manageRelationship', {
        requestId: uuid(86),
        action: 'connect',
        from: 'b',
        to: 'a',
        type: 'father',
      }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await expect(
      invoke(admin, 'manageRelationship', {
        requestId: uuid(87),
        action: 'connect',
        from: 'a',
        to: 'a',
        type: 'partner',
      }),
    ).rejects.toBeDefined();
    await seedPerson('c', 'Test Partner');
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(88),
      action: 'connect',
      from: 'b',
      to: 'c',
      type: 'partner',
    });
    const before = (await db.collection('auditLogs').get()).size;
    expect(
      (
        await invoke(admin, 'manageRelationship', {
          requestId: uuid(89),
          action: 'connect',
          from: 'c',
          to: 'b',
          type: 'partner',
        })
      ).changed,
    ).toBe(false);
    expect((await db.collection('auditLogs').get()).size).toBe(before);
  });
  it('los vínculos hipotéticos permanecen privados y quitar un vínculo conserva personas y fotos', async () => {
    await seedPerson('a', 'Test One');
    await seedPerson('b', 'Test Two');
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(90),
      action: 'connect',
      from: 'a',
      to: 'b',
      type: 'partner',
      certainty: 'hypothesis',
    });
    expect((await db.collection('publicRelationships').get()).size).toBe(0);
    const relationship = (await db.collection('relationships').get()).docs[0].data();
    await expect(
      invoke(guest, 'manageRelationship', { requestId: uuid(91), action: 'remove', relationship }),
    ).rejects.toBeDefined();
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(91),
      action: 'remove',
      relationship,
    });
    expect((await db.collection('relationships').get()).size).toBe(0);
    expect((await db.collection('persons').get()).size).toBe(2);
  });
  it('cambiar un vínculo invalida propuestas previas que contienen otros parentescos', async () => {
    await seedPerson('a', 'Test Parent');
    await seedPerson('b', 'Test Child');
    await invoke(
      guest,
      'submitContribution',
      proposal(92, { kind: 'correction', personId: 'b', person: person('Test Corrected Child') }),
    );
    await invoke(admin, 'manageRelationship', {
      requestId: uuid(93),
      action: 'connect',
      from: 'a',
      to: 'b',
      type: 'father',
    });
    await expect(
      invoke(admin, 'moderate', { id: uuid(92), decision: 'approved' }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect((await db.collection('relationships').get()).size).toBe(1);
  });
});
