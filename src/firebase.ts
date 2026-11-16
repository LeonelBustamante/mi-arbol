import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
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
const functions = app ? getFunctions(app, env.VITE_FUNCTIONS_REGION || 'us-central1') : null;
if (env.VITE_USE_EMULATORS === 'true' && auth && db && functions) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
export async function googleSignIn() {
  if (!auth) throw new Error('Falta conectar Firebase. Revisá la configuración en README.md.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const user = (await signInWithPopup(auth, provider)).user;
  if (user.email !== 'aleobustamante@gmail.com') {
    await signOut(auth);
    throw new Error(
      'El ingreso está reservado al administrador. Para enviar aportes no necesitás iniciar sesión.',
    );
  }
  return user;
}
export async function call<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!functions) throw new Error('Falta conectar Firebase. Revisá la configuración en README.md.');
  return (await httpsCallable<unknown, T>(functions, name)(data)).data;
}
