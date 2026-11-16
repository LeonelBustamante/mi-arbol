import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error('Definí GCLOUD_PROJECT explícitamente.');
initializeApp({ projectId });
const user = await getAuth().getUserByEmail('aleobustamante@gmail.com');
if (!user.emailVerified) throw new Error('El correo de Google debe estar verificado.');
if (!process.argv.includes('--apply')) {
  console.log(
    'Vista previa: se asignaría el rol admin a la cuenta verificada aleobustamante@gmail.com. Ejecutá con --apply solo después de revisar el proyecto.',
  );
} else {
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`members/${user.uid}`), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email,
      role: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(db.collection('auditLogs').doc(), {
      actorUid: 'trusted-bootstrap',
      action: 'admin.bootstrap',
      entityId: user.uid,
      timestamp: FieldValue.serverTimestamp(),
      changes: { role: 'admin' },
    });
  });
  console.log('Rol administrativo asignado en el proyecto seleccionado.');
}
