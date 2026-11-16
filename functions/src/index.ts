import { initializeApp } from 'firebase-admin/app';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { ZodError } from 'zod';
import { createHash } from 'node:crypto';
import * as service from './service.js';
initializeApp();
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
function actor(request: CallableRequest): service.Actor {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Iniciá sesión con Google.');
  const t = request.auth.token;
  if (
    t.email !== 'aleobustamante@gmail.com' ||
    !t.email_verified ||
    t.firebase?.sign_in_provider !== 'google.com' ||
    !t.email
  )
    throw new HttpsError('permission-denied', 'Usá una cuenta de Google con correo verificado.');
  return {
    uid: request.auth.uid,
    displayName: String(t.name || t.email).slice(0, 160),
    email: t.email,
  };
}
const callable = (operation: (a: service.Actor, input: unknown) => Promise<unknown>) =>
  onCall(
    { region: 'us-central1', enforceAppCheck: !emulator, maxInstances: 10, timeoutSeconds: 60 },
    async (request) => {
      const a = actor(request);
      try {
        return await operation(a, request.data);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        if (e instanceof ZodError)
          throw new HttpsError('invalid-argument', e.issues.map((i) => i.message).join(' '));
        // Do not expose database errors or private records to callers.
        console.error('Operation failed', e instanceof Error ? e.name : 'unknown');
        throw new HttpsError(
          'failed-precondition',
          'No se pudo completar la operación. Revisá los datos y volvé a intentar.',
        );
      }
    },
  );

export const verifyAdmin = callable(service.verifyAdmin);
export const moderate = callable(service.moderate);
export const editPerson = callable(service.editPerson);
export const manageRelationship = callable(service.manageRelationship);

export const resolvePrivacy = callable(service.resolvePrivacy);
export const deletePerson = callable(service.deletePerson);
export const importTree = callable(service.importTree);
// Public endpoints do not sign visitors in, including anonymously.
const publicCallable = (operation: (a: service.Actor, input: unknown) => Promise<unknown>) =>
  onCall(
    { region: 'us-central1', enforceAppCheck: !emulator, maxInstances: 5, timeoutSeconds: 60 },
    async (request) => {
      const day = new Date().toISOString().slice(0, 10);
      const uid =
        'public_' +
        createHash('sha256')
          .update(
            `${process.env.GCLOUD_PROJECT}|${day}|${request.rawRequest.ip || request.rawRequest.socket.remoteAddress || 'unknown'}`,
          )
          .digest('hex');
      try {
        return await operation({ uid, displayName: 'Visitante', email: '' }, request.data);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        if (e instanceof ZodError)
          throw new HttpsError('invalid-argument', e.issues.map((i) => i.message).join(' '));
        console.error('Public operation failed', e instanceof Error ? e.name : 'unknown');
        throw new HttpsError(
          'failed-precondition',
          'No se pudo enviar el aporte. Revisá los datos.',
        );
      }
    },
  );
export const submitContribution = publicCallable(service.submitContribution);
export const submitPrivacy = publicCallable(service.submitPrivacy);
