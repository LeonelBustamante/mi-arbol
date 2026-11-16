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
