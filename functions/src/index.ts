import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { ZodError } from 'zod';
import { createHash } from 'node:crypto';
import * as service from './service.js';
initializeApp();
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
const mailKey = defineSecret('RESEND_API_KEY');
const appUrl = defineString('APP_URL', { default: 'http://localhost:5173/' });
const mailFrom = defineString('MAIL_FROM', {
  default: 'Mi árbol familiar <onboarding@resend.dev>',
});
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
export const sendNotification = onDocumentCreated(
  {
    document: 'mailOutbox/{id}',
    region: 'us-central1',
    secrets: emulator ? [] : [mailKey],
    retry: true,
    maxInstances: 3,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const current = await snapshot.ref.get();
    if (!current.exists || current.data()?.status === 'sent') return;
    const data = snapshot.data();
    if (emulator) {
      await snapshot.ref.update({ status: 'emulated', sentAt: FieldValue.serverTimestamp() });
      return;
    }
    const url = new URL(appUrl.value());
    if (url.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production');
    url.hash = '/admin';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mailKey.value()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `mi-arbol-${snapshot.id}`,
      },
      body: JSON.stringify({
        from: mailFrom.value(),
        to: ['aleobustamante@gmail.com'],
        subject: `Mi árbol familiar · ${data.event}`,
        text: `${data.event}\n\nNombre informado (sin verificar para aportes públicos): ${data.actor.displayName}\nCorreo informado: ${data.actor.email || 'No informado'}\nUID: ${data.actor.uid}\n\nRevisá la solicitud con tu cuenta administradora:\n${url.toString()}\n\nEste enlace requiere autenticación. No aprueba solicitudes automáticamente.`,
      }),
    });
    if (!response.ok) {
      await snapshot.ref.update({
        status: 'failed',
        lastAttemptAt: FieldValue.serverTimestamp(),
        httpStatus: response.status,
      });
      throw new Error(`Mail provider status ${response.status}`);
    }
    await snapshot.ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp() });
  },
);
