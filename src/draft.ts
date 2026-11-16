// Keep only this tab's unsent new-person form across local connection reloads.
// Nothing is shared with the server until the visitor presses Send.
export const draftKey = 'mi-arbol-unsent-person';
type Draft = {
  key: string;
  updatedAt: number;
  form: any;
  name: string;
  birthDate: string;
  deathDate: string;
  links: any;
  contributorName: string;
  photo: string;
  requestId: string;
};
let activeDraft: Draft | undefined;
export function readDraft(key = 'new'): Draft | undefined {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    return draft?.key === key && Date.now() - draft.updatedAt < 2 * 3600000 ? draft : undefined;
  } catch {
    return undefined;
  }
}
export function trackDraft(draft: Omit<Draft, 'updatedAt'>) {
  activeDraft = draft.key === 'new' ? { ...draft, updatedAt: Date.now() } : undefined;
  saveDraft();
}
function saveDraft() {
  if (!activeDraft) return;
  try {
    sessionStorage.setItem(draftKey, JSON.stringify(activeDraft));
  } catch {
    /* A storage quota does not prevent submitting the form. */
  }
}
export function clearDraft() {
  activeDraft = undefined;
  try {
    sessionStorage.removeItem(draftKey);
  } catch {}
}
window.addEventListener('pagehide', saveDraft);
window.addEventListener('beforeunload', saveDraft);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    saveDraft();
    window.removeEventListener('pagehide', saveDraft);
    window.removeEventListener('beforeunload', saveDraft);
  });
