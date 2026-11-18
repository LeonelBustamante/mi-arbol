// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchSelect from '../src/SearchSelect';
import PersonForm from '../src/PersonForm';
import Modal from '../src/Modal';
import { uppercaseNames } from '../src/model';
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../src/firebase', () => ({ configured: true, auth: null, call: mocks.call }));
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.call.mockReset();
});
const options = [
  { value: 'z', label: 'Zulema' },
  { value: 'e', label: 'Érica' },
  { value: 'a', label: 'ana' },
];
function Fixture() {
  const [value, setValue] = useState('e');
  return (
    <SearchSelect
      label="Familiar"
      value={value}
      onChange={setValue}
      options={options}
      emptyLabel="Sin registrar"
    />
  );
}
it('ordena alfabéticamente en español y busca sin distinguir acentos ni mayúsculas', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  const input = screen.getByRole('combobox', { name: 'Familiar' }) as HTMLInputElement;
  expect(input.value).toBe('Érica');
  await user.click(input);
  expect(screen.getAllByRole('option').map((o) => o.textContent?.replace(' ✓', ''))).toEqual([
    'Sin registrar',
    'ana',
    'Érica',
    'Zulema',
  ]);
  await user.type(input, 'ERICA');
  expect(screen.queryByRole('option', { name: 'Zulema' })).toBeNull();
  await user.click(screen.getByRole('option', { name: /Érica/ }));
  expect(input.value).toBe('Érica');
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('permite elegir con teclado y Escape cierra la lista antes que el modal', async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <Modal title="Editar" onClose={close}>
      <Fixture />
    </Modal>,
  );
  const input = screen.getByRole('combobox', { name: 'Familiar' }) as HTMLInputElement;
  await user.click(input);
  await user.type(input, 'zul');
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(input.value).toBe('Zulema');
  await user.click(input);
  await user.keyboard('{Escape}');
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
});
it('una búsqueda sin coincidencias no reemplaza el vínculo guardado', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  const input = screen.getByRole('combobox', { name: 'Familiar' }) as HTMLInputElement;
  await user.click(input);
  await user.type(input, 'inexistente');
  expect(screen.getByRole('status').textContent).toContain('No encontramos');
  await user.tab();
  expect(input.value).toBe('Érica');
});
it('el alta de un administrador usa guardado directo y no pide colaborador', async () => {
  const user = userEvent.setup();
  mocks.call.mockResolvedValue({ id: 'person_test' });
  const done = vi.fn();
  render(<PersonForm people={[]} relationships={[]} admin onDone={done} onError={vi.fn()} />);
  expect(screen.queryByLabelText(/Nombre de quien lo carga/)).toBeNull();
  await user.type(screen.getByLabelText(/Nombre del familiar/), 'Nuevo Familiar');
  await user.click(screen.getByRole('button', { name: 'Agregar familiar' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'createPerson',
      expect.objectContaining({ person: expect.objectContaining({ fullName: 'NUEVO FAMILIAR' }) }),
    ),
  );
  expect(mocks.call).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledWith('Familiar agregado al árbol.');
});
it('los visitantes conservan el envío para aprobación', async () => {
  const user = userEvent.setup();
  mocks.call.mockResolvedValue({ status: 'pending' });
  render(
    <PersonForm people={[]} relationships={[]} admin={false} onDone={vi.fn()} onError={vi.fn()} />,
  );
  await user.type(screen.getByLabelText(/Nombre de quien lo carga/), 'Colaborador');
  await user.type(screen.getByLabelText(/Nombre del familiar/), 'Familiar propuesto');
  await user.click(screen.getByRole('button', { name: 'Enviar para revisión' }));
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'submitContribution',
      expect.objectContaining({ kind: 'new' }),
    ),
  );
});

it('muestra nombres históricos en mayúsculas sin modificar correos ni fechas', () => {
  class DateValue {
    toDate() {
      return new Date(0);
    }
  }
  const timestamp = new DateValue();
  const source = {
    person: { fullName: 'María Núñez' },
    submittedBy: { displayName: 'José', email: 'Jose@example.test' },
    timestamp,
  };
  const normalized = uppercaseNames(source);
  expect(normalized.person.fullName).toBe('MARÍA NÚÑEZ');
  expect(normalized.submittedBy.displayName).toBe('JOSÉ');
  expect(normalized.submittedBy.email).toBe('Jose@example.test');
  expect(normalized.timestamp).toBe(timestamp);
  expect(source.person.fullName).toBe('María Núñez');
});
