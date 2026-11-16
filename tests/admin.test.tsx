// @vitest-environment jsdom
import React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Admin from '../src/Admin';
import { personSchema } from '../functions/src/domain';
const mocks = vi.hoisted(() => ({ call: vi.fn(), rows: {} as Record<string, any[]> }));
vi.mock('../src/firebase', () => ({ db: null, call: mocks.call }));
vi.mock('../src/hooks', () => ({
  useRows: (path: string) => ({ rows: mocks.rows[path] || [], error: '', loading: false }),
  usePhoto: () => '',
}));
afterEach(() => {
  cleanup();
  mocks.call.mockReset();
  mocks.rows = {};
});
const base = personSchema.parse({ fullName: 'Test Current', birthDate: '1940' });
const proposal = {
  id: 'test-proposal',
  kind: 'correction',
  personId: 'test-person',
  baseRevision: 1,
  person: { ...base, fullName: 'Test Updated' },
  links: {},
  status: 'pending',
  submittedBy: { displayName: 'Test Contributor' },
};
function setup(revision = 1) {
  mocks.rows.submissions = [proposal];
  mocks.call.mockResolvedValue({ status: 'approved' });
  const success = vi.fn();
  render(
    <Admin
      people={[{ ...base, id: 'test-person', revision }]}
      relationships={[]}
      onError={vi.fn()}
      onSuccess={success}
      onEdit={vi.fn()}
    />,
  );
  return { success, user: userEvent.setup() };
}
it('Revisar abre un modal con datos actuales y nuevos antes de publicar', async () => {
  const { user, success } = setup();
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  const dialog = screen.getByRole('dialog', { name: 'Revisar cambios propuestos' });
  expect(within(dialog).getByText('Test Current')).toBeTruthy();
  expect(within(dialog).getByText('Test Updated')).toBeTruthy();
  expect(within(dialog).getByText('Test Contributor')).toBeTruthy();
  expect(mocks.call).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Aprobar y publicar en el árbol' }));
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('moderate', {
    id: 'test-proposal',
    decision: 'approved',
    reason: '',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(success).toHaveBeenCalled();
});
it('cerrar la revisión no aprueba ni publica el aporte', async () => {
  const { user } = setup();
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.call).not.toHaveBeenCalled();
});
it('impide aprobar una corrección desactualizada desde el modal', async () => {
  const { user } = setup(2);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  expect(
    screen.getByRole('button', { name: 'Aprobar y publicar en el árbol' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(mocks.call).not.toHaveBeenCalled();
});
