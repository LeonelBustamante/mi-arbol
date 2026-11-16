import { describe, it, expect } from 'vitest';
import { familyLayout, drawFamily, drawPartner, CARD_WIDTH, CARD_HEIGHT } from '../src/tree-layout';
import type { TreePerson, Relationship } from '../src/model';
const person = (id: string, name = id): TreePerson => ({ id, fullName: name, birthDate: '' });
const edge = (from: string, to: string, type: Relationship['type']): Relationship => ({
  id: `${type}-${from}-${to}`,
  from,
  to,
  type,
  certainty: 'confirmed',
});
const people = [
  person('grandfather-left'),
  person('grandfather-right'),
  person('z-father'),
  person('a-mother'),
  person('child-a'),
  person('child-b'),
];
const relationships = [
  edge('grandfather-left', 'z-father', 'father'),
  edge('grandfather-right', 'a-mother', 'father'),
  edge('z-father', 'a-mother', 'partner'),
  edge('z-father', 'child-a', 'father'),
  edge('a-mother', 'child-a', 'mother'),
  edge('z-father', 'child-b', 'father'),
  edge('a-mother', 'child-b', 'mother'),
];
describe('distribución y conexiones genealógicas', () => {
  it('cada abuelo se ubica sobre su propio hijo dentro de la pareja', () => {
    const { positions: p, levels } = familyLayout(people, relationships);
    expect(Math.abs(p.get('grandfather-left')!.x - p.get('z-father')!.x)).toBeLessThan(32);
    expect(Math.abs(p.get('grandfather-right')!.x - p.get('a-mother')!.x)).toBeLessThan(32);
    expect(p.get('z-father')!.x).toBeLessThan(p.get('a-mother')!.x);
    expect(levels.get('z-father')).toBe(levels.get('a-mother'));
    expect(levels.get('child-a')).toBe(levels.get('z-father')! + 1);
  });
  it('los hermanos quedan juntos debajo de sus padres y ninguna tarjeta se superpone', () => {
    const { positions: p, levels } = familyLayout(people, relationships);
    const childrenMiddle = (p.get('child-a')!.x + p.get('child-b')!.x) / 2;
    const parentsMiddle = (p.get('z-father')!.x + p.get('a-mother')!.x) / 2;
    expect(Math.abs(childrenMiddle - parentsMiddle)).toBeLessThan(1);
    for (const a of people)
      for (const b of people)
        if (a.id !== b.id && levels.get(a.id) === levels.get(b.id))
          expect(Math.abs(p.get(a.id)!.x - p.get(b.id)!.x)).toBeGreaterThan(CARD_WIDTH);
  });
  it('recibir las personas y relaciones en otro orden no cambia la distribución', () => {
    const a = familyLayout(people, relationships),
      b = familyLayout([...people].reverse(), [...relationships].reverse());
    for (const p of people) {
      expect(a.positions.get(p.id)!.x).toBeCloseTo(b.positions.get(p.id)!.x);
      expect(a.positions.get(p.id)!.y).toBe(b.positions.get(p.id)!.y);
    }
  });
  it('una pareja usa una línea horizontal sin retornar por encima de las tarjetas', () => {
    expect(drawPartner({ x: 0, y: 0 }, { x: 304, y: 0 })).toBe(
      `M ${CARD_WIDTH} ${CARD_HEIGHT / 2} H 304`,
    );
  });
  it('una segunda pareja salta por arriba, sin atravesar a otra persona', () => {
    expect(drawPartner({ x: 0, y: 0 }, { x: 608, y: 0 })).toContain('V -30');
  });
  it('los hijos de una pareja comparten una sola bajada y conservan las hipótesis', () => {
    const children = [
      { point: { x: 0, y: 310 }, hypothesis: false },
      { point: { x: 348, y: 310 }, hypothesis: true },
    ];
    const drawing = drawFamily(
      [
        { x: 0, y: 0 },
        { x: 304, y: 0 },
      ],
      children,
      true,
    );
    expect(drawing.paths).toHaveLength(3);
    expect(drawing.junction).toEqual({ x: 276, y: 76 });
    expect(drawing.paths[0].path).toContain('V 252');
    expect(drawing.paths[2].hypothesis).toBe(true);
    expect(
      drawFamily(
        [
          { x: 0, y: 0 },
          { x: 304, y: 0 },
        ],
        children,
        false,
      ).paths,
    ).toHaveLength(5);
  });
  it('alinear co-progenitores no inventa una pareja ni contradice la ascendencia', () => {
    const p = [person('a'), person('b'), person('c')];
    const r = [edge('a', 'b', 'father'), edge('a', 'c', 'father'), edge('b', 'c', 'mother')];
    const result = familyLayout(p, r);
    expect(result.levels.get('a')).toBeLessThan(result.levels.get('b')!);
    expect(result.levels.get('b')).toBeLessThan(result.levels.get('c')!);
    expect(r.filter((x) => x.type === 'partner')).toHaveLength(0);
  });
});
