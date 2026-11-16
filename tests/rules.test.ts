import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
let env: RulesTestEnvironment;
const owner = {
  email: 'aleobustamante@gmail.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
};
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mi-arbol-rules',
    firestore: {
      host: '127.0.0.1',
      port: Number(process.env.TEST_FIRESTORE_PORT || 8180),
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    for (const [path, data] of Object.entries({
      'publicPersons/p': { id: 'p', fullName: 'Persona sintética', birthDate: '' },
      'publicRelationships/r': { id: 'r', from: 'p', to: 'q', type: 'father' },
      'submissionPhotos/p': { dataUrl: 'data:image/jpeg;base64,private' },
      'personPhotos/p': { dataUrl: 'data:image/jpeg;base64,private' },
      'publicPersonPhotos/p': { dataUrl: 'data:image/jpeg;base64,approved' },
      'persons/p': { fullName: 'Persona sintética', birthPlace: 'Privado' },
      'relationships/r': { certainty: 'hypothesis' },
      'members/admin': { role: 'admin' },
      'members/family': { role: 'family_member' },
      'members/otheradmin': { role: 'admin' },
      'submissions/s': { status: 'pending', submittedByUid: 'family' },
      'privacyRequests/p': { message: 'Privado', submittedByUid: 'family' },
      'accessRequests/family': { status: 'approved' },
      'auditLogs/log': { action: 'private' },
      'mailOutbox/m': { actor: { email: 'private@example.test' } },
      'system/graph': { version: 1 },
    }))
      await setDoc(doc(c.firestore(), path), data);
  });
});
afterAll(async () => env?.cleanup());
describe('solo el propietario administra; colaboradores sin sesión', () => {
  it('el público recibe exclusivamente las proyecciones autorizadas', async () => {
    const db = env.unauthenticatedContext().firestore();
    expect((await assertSucceeds(getDoc(doc(db, 'publicPersons/p')))).data()).toEqual({
      id: 'p',
      fullName: 'Persona sintética',
      birthDate: '',
    });
    await assertSucceeds(getDocs(collection(db, 'publicPersons')));
    await assertSucceeds(getDocs(collection(db, 'publicRelationships')));
  });
  it.each([
    'personPhotos/p',
    'submissionPhotos/p',
    'persons/p',
    'relationships/r',
    'submissions/s',
    'privacyRequests/p',
    'auditLogs/log',
    'mailOutbox/m',
    'accessRequests/family',
    'members/admin',
    'system/graph',
  ])('deniega al público la lectura de %s', async (path) =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path))),
  );
  it.each(['family', 'otheradmin'])(
    'un antiguo familiar o un admin de otro correo no accede: %s',
    async (uid) => {
      const db = env
        .authenticatedContext(uid, { ...owner, email: 'other@example.test', admin: true })
        .firestore();
      for (const name of [
        'persons',
        'relationships',
        'submissions',
        'privacyRequests',
        'auditLogs',
      ])
        await assertFails(getDocs(collection(db, name)));
    },
  );
  it('el propietario con Google verificado y rol admin accede al panel y privados', async () => {
    const db = env.authenticatedContext('admin', owner).firestore();
    for (const name of [
      'persons',
      'relationships',
      'submissions',
      'privacyRequests',
      'auditLogs',
      'mailOutbox',
    ])
      await assertSucceeds(getDocs(collection(db, name)));
  });
  it.each([
    { ...owner, email_verified: false },
    { ...owner, firebase: { sign_in_provider: 'password' } },
  ])('el rol no basta sin Google verificado', async (claims) =>
    assertFails(getDoc(doc(env.authenticatedContext('admin', claims).firestore(), 'persons/p'))),
  );
  it.each([
    'submissionPhotos',
    'personPhotos',
    'publicPersonPhotos',
    'publicPersons',
    'publicRelationships',
    'persons',
    'relationships',
    'members',
    'submissions',
    'privacyRequests',
    'auditLogs',
    'mailOutbox',
    'accessRequests',
  ])('ni público ni administrador escriben %s directamente', async (name) => {
    await assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), `${name}/forged`), {
        status: 'approved',
      }),
    );
    await assertFails(
      setDoc(doc(env.authenticatedContext('admin', owner).firestore(), `${name}/forged`), {
        status: 'approved',
      }),
    );
  });
  it('revocar el registro administrativo bloquea el mismo token', async () => {
    const db = env.authenticatedContext('admin', owner).firestore();
    await assertSucceeds(getDoc(doc(db, 'persons/p')));
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), 'members/admin'), { role: 'visitor' }),
    );
    await assertFails(getDoc(doc(db, 'persons/p')));
  });
});
