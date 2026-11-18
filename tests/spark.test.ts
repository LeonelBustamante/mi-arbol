import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import sharp from 'sharp';
import { createSparkApi } from '../src/spark';
import { personSchema, linksSchema } from '../functions/src/domain';
vi.mock('../src/photo', () => ({
  preparePhoto: async (file: File) =>
    `data:image/jpeg;base64,${(
      await sharp(Buffer.from(await file.arrayBuffer()))
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .jpeg()
        .toBuffer()
    ).toString('base64')}`,
}));
let env: RulesTestEnvironment;
const owner = {
  email: 'aleobustamante@gmail.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
};
const fakeAuth = (uid: string, email = owner.email, provider = 'google.com', verified = true) =>
  ({
    currentUser: {
      uid,
      email,
      emailVerified: verified,
      getIdTokenResult: async () => ({ signInProvider: provider }),
    },
  }) as unknown as Auth;
const person = (name: string, extra = {}) => personSchema.parse({ fullName: name, ...extra });
const proposal = (name = 'Persona de prueba', extra = {}) => ({
  requestId: crypto.randomUUID(),
  kind: 'new',
  person: person(name),
  links: linksSchema.parse({}),
  contributor: { displayName: 'Colaborador sintético' },
  ...extra,
});
const adminDb = () => env.authenticatedContext('owner', owner).firestore();
const publicDb = () => env.unauthenticatedContext().firestore();
const ownerApi = () => createSparkApi(adminDb(), fakeAuth('owner'));
const guestApi = () => createSparkApi(publicDb(), { currentUser: null } as Auth);
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mi-arbol-spark',
    firestore: {
      host: '127.0.0.1',
      port: Number(process.env.TEST_FIRESTORE_PORT || 8180),
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await ownerApi()('verifyAdmin');
});
afterAll(async () => env?.cleanup());
async function publish(name: string, extra = {}) {
  const p = proposal(name, extra);
  await guestApi()('submitContribution', p);
  await ownerApi()('moderate', { id: p.requestId, decision: 'approved' });
  return `person_${p.requestId}`;
}
describe('Spark sin Functions: reglas y operaciones reales', () => {
  it('solo Google verificado del propietario puede inicializar el rol', async () => {
    for (const [id, claims] of [
      ['other', { ...owner, email: 'other@example.test' }],
      ['password', { ...owner, firebase: { sign_in_provider: 'password' } }],
      ['unverified', { ...owner, email_verified: false }],
    ] as const) {
      const db = env.authenticatedContext(id, claims).firestore();
      await assertFails(
        setDoc(doc(db, 'members', id), { uid: id, email: owner.email, role: 'admin' }),
      );
      await assertFails(getDocs(collection(db, 'persons')));
    }
    await assertFails(setDoc(doc(publicDb(), 'members', 'forged'), { role: 'admin' }));
    await assertFails(
      setDoc(doc(adminDb(), 'members', 'other'), {
        uid: 'other',
        email: owner.email,
        role: 'admin',
      }),
    );
  });
  it('un administrador invitado puede aprobar y pierde acceso al revocarlo', async () => {
    const email = 'moderador@example.test';
    await ownerApi()('manageAdmin', { email, status: 'active' });
    const db = env.authenticatedContext('moderator', { ...owner, email }).firestore();
    const api = createSparkApi(db, fakeAuth('moderator', email));
    await api('verifyAdmin');
    const p = proposal('Familiar revisado por moderador');
    await guestApi()('submitContribution', p);
    await api('moderate', { id: p.requestId, decision: 'approved' });
    expect((await getDocs(collection(db, 'persons'))).size).toBe(1);
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDocs(collection(db, 'adminInvitations')));
    await expect(
      api('manageAdmin', { email: 'tercero@example.test', status: 'active' }),
    ).rejects.toThrow();
    await assertFails(
      setDoc(doc(db, 'adminInvitations', 'tercero@example.test'), {
        email: 'tercero@example.test',
        status: 'active',
        updatedBy: 'moderator',
        updatedAt: serverTimestamp(),
      }),
    );
    await ownerApi()('manageAdmin', { email, status: 'revoked' });
    await assertFails(getDocs(collection(db, 'persons')));
    await expect(api('verifyAdmin')).rejects.toThrow('invitación activa');
    await expect(api('moderate', { id: p.requestId, decision: 'approved' })).rejects.toThrow();
    await ownerApi()('manageAdmin', { email, status: 'active' });
    await api('verifyAdmin');
    await assertSucceeds(getDocs(collection(db, 'persons')));
  });
  it('una invitación no autoriza otro correo, Google sin verificar ni contraseña', async () => {
    const email = 'invitado@example.test';
    await ownerApi()('manageAdmin', { email, status: 'active' });
    for (const [uid, claims] of [
      ['stranger', { ...owner, email: 'stranger@example.test' }],
      ['unverified-invite', { ...owner, email, email_verified: false }],
      ['password-invite', { ...owner, email, firebase: { sign_in_provider: 'password' } }],
    ] as const) {
      const db = env.authenticatedContext(uid, claims).firestore();
      await assertFails(setDoc(doc(db, 'members', uid), { uid, email, role: 'admin' }));
      await assertFails(getDocs(collection(db, 'persons')));
    }
    await expect(
      ownerApi()('manageAdmin', { email: owner.email, status: 'revoked' }),
    ).rejects.toThrow('propietario');
    const other = env
      .authenticatedContext('other-invite', { ...owner, email: 'other@example.test' })
      .firestore();
    await assertFails(getDoc(doc(other, 'adminInvitations', email)));
    await assertFails(
      setDoc(doc(adminDb(), 'adminInvitations', owner.email), {
        email: owner.email,
        status: 'revoked',
        updatedBy: 'owner',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('el administrador crea y publica directamente, sin propuesta pendiente y sin duplicar al reintentar', async () => {
    const input = {
      requestId: crypto.randomUUID(),
      person: person('Alta directa'),
      links: linksSchema.parse({}),
    };
    const api = ownerApi();
    const result = (await api('createPerson', input)) as { id: string };
    expect((await getDoc(doc(publicDb(), 'publicPersons', result.id))).data()?.fullName).toBe(
      'Alta directa',
    );
    expect((await getDocs(collection(adminDb(), 'submissions'))).empty).toBe(true);
    expect(await api('createPerson', input)).toEqual(result);
    expect((await getDocs(collection(adminDb(), 'persons'))).size).toBe(1);
    await expect(api('createPerson', { ...input, person: person('Otro nombre') })).rejects.toThrow(
      'identificador',
    );
    await expect(
      guestApi()('createPerson', { ...input, requestId: crypto.randomUUID() }),
    ).rejects.toThrow();
  });
  it('el alta directa por invitado valida duplicados y vínculos; las hipótesis quedan privadas', async () => {
    const email = 'creador@example.test';
    await ownerApi()('manageAdmin', { email, status: 'active' });
    const db = env.authenticatedContext('creator', { ...owner, email }).firestore();
    const api = createSparkApi(db, fakeAuth('creator', email));
    await api('verifyAdmin');
    const input = {
      requestId: crypto.randomUUID(),
      person: person('Hipótesis directa', { certainty: 'hypothesis' }),
      links: linksSchema.parse({}),
    };
    const result = (await api('createPerson', input)) as { id: string };
    expect((await getDoc(doc(db, 'persons', result.id))).exists()).toBe(true);
    expect((await getDoc(doc(publicDb(), 'publicPersons', result.id))).exists()).toBe(false);
    await expect(api('createPerson', { ...input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'duplicado',
    );
    await expect(
      api('createPerson', {
        ...input,
        requestId: crypto.randomUUID(),
        person: person('Vínculo inválido'),
        links: { ...input.links, father: 'missing' },
      }),
    ).rejects.toThrow();
    await ownerApi()('manageAdmin', { email, status: 'revoked' });
    await expect(
      api('createPerson', {
        ...input,
        requestId: crypto.randomUUID(),
        person: person('Ya revocado'),
      }),
    ).rejects.toThrow();
  });
  it('guarda un aporte sin login ni foto; es privado y no publica ni crea correo', async () => {
    const p = proposal();
    await guestApi()('submitContribution', p);
    expect((await getDoc(doc(adminDb(), 'submissions', p.requestId))).data()).toMatchObject({
      status: 'pending',
      hasPhoto: false,
      submittedBy: { displayName: 'Colaborador sintético' },
    });
    await assertFails(getDoc(doc(publicDb(), 'submissions', p.requestId)));
    expect((await getDocs(collection(publicDb(), 'publicPersons'))).empty).toBe(true);
    await env.withSecurityRulesDisabled(async (c) => {
      expect((await getDocs(collection(c.firestore(), 'mailOutbox'))).empty).toBe(true);
    });
  });
  it('solo aprobar publica la proyección exacta y se puede repetir sin duplicar', async () => {
    const p = proposal('Persona confirmada', {
      person: person('Persona confirmada', { birthDate: '1910', birthPlace: 'Lugar privado' }),
    });
    await guestApi()('submitContribution', p);
    await ownerApi()('moderate', { id: p.requestId, decision: 'approved' });
    await ownerApi()('moderate', { id: p.requestId, decision: 'approved' });
    expect((await getDocs(collection(publicDb(), 'publicPersons'))).docs[0].data()).toEqual({
      id: `person_${p.requestId}`,
      fullName: 'Persona confirmada',
      birthDate: '1910',
    });
    expect((await getDocs(collection(adminDb(), 'persons'))).size).toBe(1);
  });
  it('un visitante no puede aprobar, editar, publicar ni leer privados', async () => {
    const p = proposal();
    await guestApi()('submitContribution', p);
    await assertFails(
      updateDoc(doc(publicDb(), 'submissions', p.requestId), { status: 'approved' }),
    );
    for (const path of [
      'persons/p',
      'relationships/r',
      'publicPersons/p',
      'publicPersonPhotos/p',
      'system/graph',
      'auditLogs/log',
    ])
      await assertFails(setDoc(doc(publicDb(), path), { id: 'p' }));
    for (const path of [
      'persons/p',
      'submissionPhotos/p',
      'personPhotos/p',
      'submissions/p',
      'privacyRequests/p',
      'auditLogs/p',
      'system/graph',
    ])
      await assertFails(getDoc(doc(publicDb(), path)));
  });
  it('rechazar no publica y no admite cambiar la decisión', async () => {
    const p = proposal();
    await guestApi()('submitContribution', p);
    await ownerApi()('moderate', { id: p.requestId, decision: 'rejected' });
    await expect(ownerApi()('moderate', { id: p.requestId, decision: 'approved' })).rejects.toThrow(
      'revisado',
    );
    expect((await getDocs(collection(publicDb(), 'publicPersons'))).empty).toBe(true);
  });
  it('foto pendiente privada, saneada y publicada únicamente al aprobar', async () => {
    const photo = `data:image/jpeg;base64,${(
      await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
        .jpeg()
        .toBuffer()
    ).toString('base64')}`;
    const p = proposal('Persona con foto', { photo });
    await guestApi()('submitContribution', p);
    await assertFails(getDoc(doc(publicDb(), 'submissionPhotos', p.requestId)));
    expect((await getDocs(collection(publicDb(), 'publicPersonPhotos'))).empty).toBe(true);
    await ownerApi()('moderate', { id: p.requestId, decision: 'approved' });
    expect(
      (await getDoc(doc(publicDb(), 'publicPersonPhotos', `person_${p.requestId}`))).data()
        ?.dataUrl,
    ).toMatch(/^data:image\/jpeg;base64,/);
    await assertFails(
      setDoc(doc(publicDb(), 'submissionPhotos', p.requestId), { id: p.requestId, dataUrl: photo }),
    );
  });
  it('corregir conserva datos privados y rechaza una revisión desactualizada', async () => {
    const id = await publish('Persona inicial', {
      person: person('Persona inicial', { birthDate: '1900', birthPlace: 'Dato privado' }),
    });
    const p = proposal('Persona corregida', {
      kind: 'correction',
      personId: id,
      person: person('Persona corregida'),
    });
    await guestApi()('submitContribution', p);
    await ownerApi()('moderate', { id: p.requestId, decision: 'approved' });
    expect((await getDoc(doc(adminDb(), 'persons', id))).data()).toMatchObject({
      fullName: 'Persona corregida',
      birthDate: '1900',
      birthPlace: 'Dato privado',
      revision: 2,
    });
    const stale = proposal('Otra corrección', { kind: 'correction', personId: id });
    await guestApi()('submitContribution', stale);
    await ownerApi()('editPerson', {
      id,
      baseRevision: 2,
      person: person('Cambio administrativo'),
      links: linksSchema.parse({}),
    });
    await expect(
      ownerApi()('moderate', { id: stale.requestId, decision: 'approved' }),
    ).rejects.toThrow('cambió');
  });
  it('el administrador une nodos, impide ciclos y quita un vínculo sin borrar personas', async () => {
    const parent = await publish('Padre sintético'),
      child = await publish('Hijo sintético');
    const input = {
      action: 'connect',
      requestId: crypto.randomUUID(),
      from: parent,
      to: child,
      type: 'father',
      certainty: 'confirmed',
    };
    await ownerApi()('manageRelationship', input);
    await ownerApi()('manageRelationship', input);
    const links = (await getDocs(collection(adminDb(), 'relationships'))).docs.map((d) => d.data());
    expect(links).toHaveLength(1);
    await expect(
      ownerApi()('manageRelationship', {
        ...input,
        requestId: crypto.randomUUID(),
        from: child,
        to: parent,
      }),
    ).rejects.toThrow();
    await ownerApi()('manageRelationship', {
      action: 'remove',
      requestId: crypto.randomUUID(),
      relationship: links[0],
    });
    expect((await getDocs(collection(publicDb(), 'publicRelationships'))).empty).toBe(true);
    expect((await getDocs(collection(adminDb(), 'persons'))).size).toBe(2);
  });
  it('hipótesis permanece privada; eliminar borra fotos, proyecciones y vínculos', async () => {
    const id = await publish('Hipótesis', {
      person: person('Hipótesis', { certainty: 'hypothesis' }),
    });
    expect((await getDocs(collection(publicDb(), 'publicPersons'))).empty).toBe(true);
    await ownerApi()('deletePerson', {
      id,
      baseRevision: 1,
      reason: 'Solicitud de prueba para eliminar',
    });
    expect((await getDocs(collection(adminDb(), 'persons'))).empty).toBe(true);
  });
  it('revocar el rol bloquea operaciones con el mismo token y no se reotorga solo', async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), 'members', 'owner'), { role: 'visitor' }),
    );
    await expect(ownerApi()('verifyAdmin')).rejects.toThrow('revocado');
    await assertFails(getDocs(collection(adminDb(), 'persons')));
  });
  it('reintentar el mismo aporte no consume cuota ni lo duplica', async () => {
    const p = proposal();
    await guestApi()('submitContribution', p);
    await guestApi()('submitContribution', p);
    expect((await getDoc(doc(publicDb(), 'publicLimits', 'submissions'))).data()?.count).toBe(1);
    expect((await getDocs(collection(adminDb(), 'submissions'))).size).toBe(1);
  });
  it('envíos públicos simultáneos conservan el contador y los aportes', async () => {
    const a = proposal('Aporte concurrente A'),
      b = proposal('Aporte concurrente B');
    await Promise.all([guestApi()('submitContribution', a), guestApi()('submitContribution', b)]);
    expect((await getDoc(doc(publicDb(), 'publicLimits', 'submissions'))).data()?.count).toBe(2);
    expect((await getDocs(collection(adminDb(), 'submissions'))).size).toBe(2);
  });
  it('reutilizar un recibo con otros datos se rechaza', async () => {
    const p = proposal();
    await guestApi()('submitContribution', p);
    await expect(
      guestApi()('submitContribution', { ...p, person: person('Datos diferentes') }),
    ).rejects.toThrow('identificador');
  });
  it('no se puede escribir una propuesta sin recibo y contador atómicos ni con campos falsos', async () => {
    const p = proposal();
    await assertFails(
      setDoc(doc(publicDb(), 'submissions', p.requestId), { ...p, status: 'pending' }),
    );
    await assertFails(
      setDoc(doc(publicDb(), 'publicLimits', 'submissions'), {
        count: 1,
        windowStart: serverTimestamp(),
        requestId: p.requestId,
      }),
    );
    await assertFails(
      setDoc(doc(publicDb(), 'publicReceipts', p.requestId), {
        id: p.requestId,
        collection: 'submissions',
      }),
    );
    await expect(
      guestApi()('submitContribution', proposal('Nombre', { contributor: { displayName: '' } })),
    ).rejects.toThrow();
    await expect(
      guestApi()('submitContribution', proposal('Nombre', { website: 'spam' })),
    ).rejects.toThrow();
  });
  it('la cuota global no se puede reiniciar desde el cliente y se renueva al vencer', async () => {
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'publicLimits', 'submissions'), {
        count: 100,
        windowStart: Timestamp.now(),
        requestId: crypto.randomUUID(),
      }),
    );
    await expect(guestApi()('submitContribution', proposal())).rejects.toThrow('límite');
    await assertFails(
      updateDoc(doc(publicDb(), 'publicLimits', 'submissions'), {
        count: 0,
        windowStart: serverTimestamp(),
      }),
    );
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), 'publicLimits', 'submissions'), {
        windowStart: Timestamp.fromMillis(Date.now() - 86400001),
      }),
    );
    await guestApi()('submitContribution', proposal());
    expect((await getDoc(doc(publicDb(), 'publicLimits', 'submissions'))).data()?.count).toBe(1);
  });
  it('solicitudes de privacidad sin login; solo el administrador puede resolverlas', async () => {
    const p = {
      requestId: crypto.randomUUID(),
      type: 'deletion',
      message: 'Solicitud sintética de eliminación',
      contributor: { displayName: 'Solicitante' },
    };
    await guestApi()('submitPrivacy', p);
    await assertFails(getDoc(doc(publicDb(), 'privacyRequests', p.requestId)));
    await ownerApi()('resolvePrivacy', {
      id: p.requestId,
      resolution: 'Se revisó y resolvió esta solicitud.',
    });
    expect((await getDoc(doc(adminDb(), 'privacyRequests', p.requestId))).data()?.status).toBe(
      'resolved',
    );
  });
  it('dos aprobaciones simultáneas conservan ambas personas', async () => {
    const a = proposal('Persona concurrente A'),
      b = proposal('Persona concurrente B');
    await guestApi()('submitContribution', a);
    await guestApi()('submitContribution', b);
    await Promise.all([
      ownerApi()('moderate', { id: a.requestId, decision: 'approved' }),
      ownerApi()('moderate', { id: b.requestId, decision: 'approved' }),
    ]);
    expect((await getDocs(collection(adminDb(), 'persons'))).size).toBe(2);
    expect((await getDoc(doc(adminDb(), 'system', 'graph'))).data()?.version).toBe(2);
  });
  it('las proyecciones públicas no permiten agregar datos privados ni editar sin versión', async () => {
    const id = await publish('Persona pública');
    const db = adminDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'system', 'graph'), { version: 2 });
    batch.update(doc(db, 'publicPersons', id), { birthPlace: 'privado' });
    await assertFails(batch.commit());
    await assertFails(updateDoc(doc(adminDb(), 'persons', id), { fullName: 'Sin bloqueo' }));
  });
});
