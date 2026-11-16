import { it, expect, vi, beforeAll, afterAll } from 'vitest';
const store = new Map<string, string>();
const handlers = new Map<string, () => void>();
let draft: typeof import('../src/draft');
beforeAll(async () => {
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
  });
  draft = await import('../src/draft');
});
afterAll(() => vi.unstubAllGlobals());
it('conserva el aporte sin foto durante una recarga de conexión', () => {
  draft.trackDraft({
    key: 'new',
    form: { fullName: 'Persona nueva' },
    name: 'Test Relative',
    birthDate: '1940',
    deathDate: '',
    links: {},
    contributorName: 'Test Contributor',
    photo: '',
    requestId: 'test-request',
  });
  handlers.get('beforeunload')!();
  expect(draft.readDraft()).toMatchObject({
    name: 'Test Relative',
    contributorName: 'Test Contributor',
    photo: '',
    birthDate: '1940',
  });
});
it('borra el borrador después de enviar, sin recuperarlo en otra recarga', () => {
  draft.clearDraft();
  handlers.get('beforeunload')!();
  expect(draft.readDraft()).toBeUndefined();
});
it('no recupera borradores vencidos o datos privados de una edición', () => {
  store.set(draft.draftKey, JSON.stringify({ key: 'new', updatedAt: Date.now() - 3 * 3600000 }));
  expect(draft.readDraft()).toBeUndefined();
  draft.trackDraft({
    key: 'private-person',
    form: {},
    name: 'Private',
    birthDate: '',
    deathDate: '',
    links: {},
    contributorName: '',
    photo: '',
    requestId: 'edit',
  });
  handlers.get('beforeunload')!();
  expect(draft.readDraft('private-person')).toBeUndefined();
});
