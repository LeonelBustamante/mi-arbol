// @vitest-environment jsdom
import React, { useState } from 'react';
import { beforeAll, afterEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tree from '../src/Tree';
import type { TreePerson } from '../src/model';

// React Flow measures DOM geometry; jsdom has no layout engine.
beforeAll(() => {
  class TestResizeObserver {
    private timers: ReturnType<typeof setTimeout>[] = [];
    constructor(private notify: ResizeObserverCallback) {}
    observe(target: Element) {
      this.timers.push(
        setTimeout(
          () => this.notify([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver),
          0,
        ),
      );
    }
    unobserve() {}
    disconnect() {
      this.timers.forEach(clearTimeout);
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
    },
  );
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      configurable: true,
      get() {
        return this.classList.contains('react-flow') ? 800 : 223;
      },
    },
    offsetHeight: {
      configurable: true,
      get() {
        return this.classList.contains('react-flow') ? 600 : 100;
      },
    },
  });
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
});
afterEach(cleanup);
const relative = { id: 'clickable', fullName: 'Test Relative', birthDate: '1940' };
function Harness({
  admin = false,
  onSelect = () => {},
}: {
  admin?: boolean;
  onSelect?: (p: TreePerson) => void;
}) {
  const [selected, setSelected] = useState<TreePerson | null>(null);
  return (
    <>
      <Tree
        people={[relative]}
        relationships={[]}
        privateView={admin}
        loading={false}
        onSelect={(p) => {
          onSelect(p);
          setSelected(p);
        }}
        onAccess={() => {}}
        onJoin={() => {}}
      />
      {selected && (
        <div role="dialog" aria-label={admin ? 'Datos del familiar' : 'Proponer editar datos'}>
          {selected.fullName}
        </div>
      )}
    </>
  );
}
it('el contenedor real de React Flow permite recibir clics aunque el nodo no se mueva ni se seleccione', async () => {
  render(<Harness />);
  const wrapper = await screen.findByTestId('rf__node-clickable');
  expect(getComputedStyle(wrapper).pointerEvents).toBe('all');
  const button = await screen.findByRole('button', {
    name: 'Proponer editar datos de Test Relative',
  });
  await userEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Proponer editar datos' }).textContent).toBe(
    'Test Relative',
  );
});
it('el administrador puede abrir la ficha del nodo con un solo clic', async () => {
  const selected = vi.fn();
  render(<Harness admin onSelect={selected} />);
  const button = await screen.findByRole('button', { name: 'Ver y unir a Test Relative' });
  await userEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Datos del familiar' })).toBeTruthy();
  expect(selected).toHaveBeenCalledExactlyOnceWith(relative);
});
it('el botón del nodo también se activa con Enter', async () => {
  render(<Harness />);
  const button = await screen.findByRole('button', {
    name: 'Proponer editar datos de Test Relative',
  });
  button.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('dialog', { name: 'Proponer editar datos' })).toBeTruthy(),
  );
});

it('elegir una familia muestra solo su rama y mantiene la edición del nodo', async () => {
  const a = { id: 'ancestor-a', fullName: 'Familia A', birthDate: '' },
    b = { id: 'ancestor-b', fullName: 'Familia B', birthDate: '' },
    c = { id: 'child-a', fullName: 'Hijo A', birthDate: '' },
    d = { id: 'child-b', fullName: 'Hijo B', birthDate: '' };
  const select = vi.fn();
  render(
    <Tree
      people={[a, b, c, d]}
      relationships={[
        { id: 'a-c', from: a.id, to: c.id, type: 'father', certainty: 'confirmed' },
        { id: 'b-d', from: b.id, to: d.id, type: 'mother', certainty: 'confirmed' },
      ]}
      privateView={false}
      loading={false}
      onSelect={select}
      onAccess={() => {}}
      onJoin={() => {}}
    />,
  );
  await screen.findByRole('button', { name: 'Proponer editar datos de Hijo B' });
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Familia o rama del árbol' }),
    'ancestor-a',
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Proponer editar datos de Hijo B' })).toBeNull(),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Proponer editar datos de Hijo A' }));
  expect(select).toHaveBeenCalledWith(c);
});

it('el buscador localiza con Enter sin tildes y resalta la tarjeta', async () => {
  const user = userEvent.setup();
  render(
    <Tree
      people={[{ id: 'jose', fullName: 'JOSÉ NÚÑEZ', birthDate: '' }]}
      relationships={[]}
      privateView={false}
      loading={false}
      onSelect={vi.fn()}
      onAccess={vi.fn()}
      onJoin={vi.fn()}
    />,
  );
  await screen.findByTestId('rf__node-jose');
  const input = screen.getByRole('combobox', { name: 'Buscar un familiar' });
  await user.type(input, 'jose nunez');
  expect(screen.getByRole('option', { name: 'JOSÉ NÚÑEZ' })).toBeTruthy();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Proponer editar datos de JOSÉ NÚÑEZ' })
        .classList.contains('is-located'),
    ).toBe(true),
  );
  expect(screen.getByRole('status').textContent).toContain('Ubicamos a JOSÉ NÚÑEZ');
  await user.click(screen.getByRole('button', { name: 'Cerrar aviso de ubicación' }));
  expect(
    screen
      .getByRole('button', { name: 'Proponer editar datos de JOSÉ NÚÑEZ' })
      .classList.contains('is-located'),
  ).toBe(true);
  expect(screen.queryByLabelText('Mini Map')).toBeNull();
});

it('buscar a alguien fuera de la rama vuelve al árbol completo y permite localizarlo otra vez', async () => {
  const people = [
    { id: 'parent-a', fullName: 'ANA', birthDate: '' },
    { id: 'child-a', fullName: 'ALICIA', birthDate: '' },
    { id: 'parent-b', fullName: 'BEATRIZ', birthDate: '' },
    { id: 'child-b', fullName: 'BRUNO', birthDate: '' },
  ];
  const user = userEvent.setup();
  render(
    <Tree
      people={people}
      relationships={[
        { id: 'rel-a', from: 'parent-a', to: 'child-a', type: 'mother', certainty: 'confirmed' },
        { id: 'rel-b', from: 'parent-b', to: 'child-b', type: 'mother', certainty: 'confirmed' },
      ]}
      privateView={false}
      loading={false}
      onSelect={vi.fn()}
      onAccess={vi.fn()}
      onJoin={vi.fn()}
    />,
  );
  await screen.findByTestId('rf__node-child-b');
  const branch = screen.getByRole('combobox', {
    name: 'Familia o rama del árbol',
  }) as HTMLSelectElement;
  await user.selectOptions(branch, 'parent-a');
  await waitFor(() => expect(screen.queryByTestId('rf__node-child-b')).toBeNull());
  const input = screen.getByRole('combobox', { name: 'Buscar un familiar' });
  await user.type(input, 'bruno');
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Proponer editar datos de BRUNO' })
        .classList.contains('is-located'),
    ).toBe(true),
  );
  expect(branch.value).toBe('all');
  await user.type(input, 'bruno');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Ubicamos a BRUNO'));
});
