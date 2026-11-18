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
  expect(within(dialog).getByText('TEST CURRENT')).toBeTruthy();
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

it('solo el propietario ve la gestión de administradores', () => {
  setup();
  expect(screen.queryByRole('button', { name: 'Administradores' })).toBeNull();
});
it('el propietario habilita una cuenta y confirma antes de revocarla', async () => {
  mocks.rows.adminInvitations = [
    { id: 'mod@example.test', email: 'mod@example.test', status: 'active' },
  ];
  mocks.call.mockResolvedValue({ status: 'active' });
  const user = userEvent.setup();
  render(
    <Admin
      owner
      people={[]}
      relationships={[]}
      onError={vi.fn()}
      onSuccess={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Administradores' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Correo de la cuenta de Google' }),
    'nuevo@example.test',
  );
  await user.click(screen.getByRole('button', { name: 'Habilitar administrador' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('manageAdmin', {
      email: 'nuevo@example.test',
      status: 'active',
    }),
  );
  mocks.call.mockClear();
  await user.click(screen.getByRole('button', { name: 'Revocar acceso' }));
  expect(mocks.call).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Revocar acceso administrativo' });
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar revocación' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('manageAdmin', {
      email: 'mod@example.test',
      status: 'revoked',
    }),
  );
});
