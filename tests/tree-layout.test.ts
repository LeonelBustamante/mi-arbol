import { describe, it, expect } from 'vitest';
import {
  familyLayout,
  drawPartner,
  branchPeople,
  CARD_WIDTH,
  CARD_HEIGHT,
  type Point,
} from '../src/tree-layout';
import type { TreePerson, Relationship } from '../src/model';
const person = (id: string): TreePerson => ({ id, fullName: `Persona ${id}`, birthDate: '' });
const edge = (from: string, to: string, type: Relationship['type']): Relationship => ({
  id: `${type}-${from}-${to}`,
  from,
  to,
  type,
  certainty: 'confirmed',
});
const people = [
  'ga',
  'gma',
  'gb',
  'gmb',
  'a',
  'b',
  'sibling-a',
  'spouse-a',
  'sibling-b',
  'spouse-b',
  'child-a',
  'child-b',
  'grandchild-a',
  'grandchild-b',
].map(person);
const relationships = [
  edge('ga', 'gma', 'partner'),
  edge('gb', 'gmb', 'partner'),
  edge('ga', 'a', 'father'),
  edge('gma', 'a', 'mother'),
  edge('ga', 'sibling-a', 'father'),
  edge('gma', 'sibling-a', 'mother'),
  edge('gb', 'b', 'father'),
  edge('gmb', 'b', 'mother'),
  edge('gb', 'sibling-b', 'father'),
  edge('gmb', 'sibling-b', 'mother'),
  edge('a', 'b', 'partner'),
  edge('sibling-a', 'spouse-a', 'partner'),
  edge('sibling-b', 'spouse-b', 'partner'),
  edge('a', 'child-a', 'father'),
  edge('b', 'child-a', 'mother'),
  edge('a', 'child-b', 'father'),
  edge('b', 'child-b', 'mother'),
  edge('sibling-a', 'grandchild-a', 'mother'),
  edge('sibling-a', 'grandchild-b', 'mother'),
];
function segments(path: string) {
  const tokens = path.match(/[MLHV]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) || [];
  const result: [Point, Point][] = [];
  let point: Point = { x: 0, y: 0 };
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++],
      a = Number(tokens[i++]);
    const next =
      command === 'H'
        ? { x: a, y: point.y }
        : command === 'V'
          ? { x: point.x, y: a }
          : { x: a, y: Number(tokens[i++]) };
    if (command !== 'M') result.push([point, next]);
    point = next;
  }
  return result;
}
function crossesCard(a: Point, b: Point, p: Point) {
  const pad = 0.1;
  return a.x === b.x
    ? a.x > p.x + pad &&
        a.x < p.x + CARD_WIDTH - pad &&
        Math.max(a.y, b.y) > p.y + pad &&
        Math.min(a.y, b.y) < p.y + CARD_HEIGHT - pad
    : a.y > p.y + pad &&
        a.y < p.y + CARD_HEIGHT - pad &&
        Math.max(a.x, b.x) > p.x + pad &&
        Math.min(a.x, b.x) < p.x + CARD_WIDTH - pad;
}
describe('ramas familiares con espacio propio y trazado de conexiones', () => {
  it('admite el estado inicial sin personas mientras Firebase carga', async () => {
    const graph = await familyLayout([], []);
    expect(graph.positions.size).toBe(0);
    expect(graph.connections).toEqual([]);
  });
  it('cada descendiente queda debajo de todos sus padres y las parejas comparten fila', async () => {
    const graph = await familyLayout(people, relationships);
    for (const r of relationships) {
      const a = graph.positions.get(r.from)!,
        b = graph.positions.get(r.to)!;
      if (r.type === 'partner') {
        expect(a.y).toBe(b.y);
        expect(Math.abs(a.x - b.x)).toBe(CARD_WIDTH + 56);
      } else expect(b.y).toBeGreaterThan(a.y + CARD_HEIGHT);
    }
  });
  it('ninguna conexión atraviesa una tarjeta, incluso al unir dos árboles extensos por una pareja', async () => {
    const graph = await familyLayout(people, relationships);
    for (const c of graph.connections)
      for (const part of c.drawing.paths)
        for (const [a, b] of segments(part.path))
          for (const [id, p] of graph.positions)
            expect(crossesCard(a, b, p), `${c.id} atraviesa ${id}`).toBe(false);
  });
  it('las tarjetas tienen espacio propio, sin superponerse entre ramas', async () => {
    const graph = await familyLayout(people, relationships);
    for (const [a, p] of graph.positions)
      for (const [b, q] of graph.positions)
        if (a !== b)
          expect(
            p.x + CARD_WIDTH <= q.x ||
              q.x + CARD_WIDTH <= p.x ||
              p.y + CARD_HEIGHT <= q.y ||
              q.y + CARD_HEIGHT <= p.y,
          ).toBe(true);
  });
  it('el orden de llegada de datos no cambia la distribución', async () => {
    const a = await familyLayout(people, relationships),
      b = await familyLayout([...people].reverse(), [...relationships].reverse());
    for (const p of people) expect(a.positions.get(p.id)).toEqual(b.positions.get(p.id));
  });
  it('cada familia agrupa sus hijos y conserva los vínculos hipotéticos', async () => {
    const graph = await familyLayout(
      people,
      relationships.map((r) =>
        r.to === 'child-b' && r.type === 'mother' ? { ...r, certainty: 'hypothesis' } : r,
      ),
    );
    const family = graph.connections.find(
      (c) => !c.partner && c.description.startsWith('Persona a y Persona b:'),
    )!;
    expect(family.description).toContain('2 hijos/as');
    expect(family.drawing.paths.some((p) => p.hypothesis)).toBe(true);
    expect(family.drawing.paths.some((p) => !p.hypothesis)).toBe(true);
  });
  it('ver una rama incluye descendientes y parejas, sin mezclar la ascendencia ni los hermanos del cónyuge', () => {
    const ids = branchPeople(people, relationships, ['a']);
    expect(ids).toEqual(new Set(['a', 'b', 'child-a', 'child-b']));
    expect(ids.has('gb')).toBe(false);
    expect(ids.has('sibling-b')).toBe(false);
  });
  it('el selector ofrece también las familias intermedias, no solo los antepasados más antiguos', async () => {
    const graph = await familyLayout(people, relationships);
    expect(graph.roots.some((r) => r.people.includes('a') && r.people.includes('b'))).toBe(true);
    expect(graph.roots.some((r) => r.people.includes('sibling-a'))).toBe(true);
  });
  it('un parentesco entre generaciones distintas se conserva sin colapsarlas en una fila', async () => {
    const p = ['x', 'y', 'z'].map(person),
      r = [edge('x', 'y', 'mother'), edge('x', 'z', 'mother'), edge('y', 'z', 'father')];
    const graph = await familyLayout(p, r);
    expect(graph.positions.get('x')!.y).toBeLessThan(graph.positions.get('y')!.y);
    expect(graph.positions.get('y')!.y).toBeLessThan(graph.positions.get('z')!.y);
    for (const c of graph.connections)
      for (const part of c.drawing.paths)
        for (const [a, b] of segments(part.path))
          for (const pos of graph.positions.values()) expect(crossesCard(a, b, pos)).toBe(false);
  });
  it('una pareja normal se dibuja de costado y otra no adyacente pasa por arriba', () => {
    expect(drawPartner({ x: 0, y: 0 }, { x: 304, y: 0 })).toBe(
      `M ${CARD_WIDTH} ${CARD_HEIGHT / 2} H 304`,
    );
    expect(drawPartner({ x: 0, y: 0 }, { x: 608, y: 0 })).toContain('V -28');
  });
});
