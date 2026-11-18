import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
const env = import.meta.env;
export const configured = Boolean(
  env.VITE_FIREBASE_API_KEY &&
  env.VITE_FIREBASE_AUTH_DOMAIN &&
  env.VITE_FIREBASE_PROJECT_ID &&
  env.VITE_FIREBASE_APP_ID,
);
const app = configured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null;
if (app && env.VITE_FIREBASE_APPCHECK_SITE_KEY && env.VITE_USE_EMULATORS !== 'true')
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_FIREBASE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (env.VITE_USE_EMULATORS === 'true' && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
export async function googleSignIn() {
  if (!auth) throw new Error('Falta conectar Firebase. Revisá la configuración en README.md.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const user = (await signInWithPopup(auth, provider)).user;
  return user;
}
export async function call<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!db || !auth)
    throw new Error('Falta conectar Firebase. Revisá la configuración en README.md.');
  const { createSparkApi } = await import('./spark');
  return (await createSparkApi(db, auth)(name, data)) as T;
}
