import {
  BRANCHES,
  type PublicPerson,
  type Person,
  type Relationship,
  type Links,
} from '../functions/src/domain';
export { BRANCHES };
export type { PublicPerson, Person, Relationship, Links };
export type TreePerson = (PublicPerson | Person) & { photoData?: string };
export function isPerson(person: TreePerson): person is Person {
  return 'revision' in person && 'observations' in person;
}
export type Row = { id: string; [key: string]: any };
export type Role = 'visitor' | 'admin';
export const colors = [
  '#789c79',
  '#c49569',
  '#879fc0',
  '#b190ac',
  '#b8a96b',
  '#80aaa3',
  '#c58b88',
  '#89977c',
];
export function date(value: string) {
  if (!value) return 'Fecha desconocida';
  const [year, month, day] = value.split('-');
  return day ? `${day}/${month}/${year}` : month ? `${month}/${year}` : year;
}
export function linksFor(id: string, relationships: Relationship[]): Links {
  return {
    fatherCertainty:
      relationships.find((r) => r.to === id && r.type === 'father')?.certainty || 'confirmed',
    motherCertainty:
      relationships.find((r) => r.to === id && r.type === 'mother')?.certainty || 'confirmed',
    partnerCertainty:
      relationships.find((r) => r.type === 'partner' && (r.from === id || r.to === id))
        ?.certainty || 'confirmed',
    father: relationships.find((r) => r.to === id && r.type === 'father')?.from || '',
    mother: relationships.find((r) => r.to === id && r.type === 'mother')?.from || '',
    partner: (() => {
      const r = relationships.find((r) => r.type === 'partner' && (r.from === id || r.to === id));
      return r ? (r.from === id ? r.to : r.from) : '';
    })(),
  };
}
export function layout(people: TreePerson[], relationships: Relationship[]) {
  // Partners share a generation. Parent edges determine generation order.
  const ids = new Set(people.map((p) => p.id));
  const roots = new Map(people.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    const parent = roots.get(id)!;
    if (parent === id) return id;
    const found = root(parent);
    roots.set(id, found);
    return found;
  };
  for (const r of relationships)
    if (r.type === 'partner' && ids.has(r.from) && ids.has(r.to))
      roots.set(root(r.to), root(r.from));
  const ranks = new Map<string, number>();
  const indegree = new Map<string, number>();
  const next = new Map<string, Set<string>>();
  people.forEach((p) => {
    ranks.set(root(p.id), 0);
    indegree.set(root(p.id), 0);
  });
  for (const r of relationships)
    if (r.type !== 'partner' && ids.has(r.from) && ids.has(r.to)) {
      const from = root(r.from),
        to = root(r.to);
      if (from === to) continue;
      if (!next.get(from)?.has(to)) {
        next.set(from, new Set([...(next.get(from) || []), to]));
        indegree.set(to, (indegree.get(to) || 0) + 1);
      }
    }
  const queue = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of next.get(id) || []) {
      ranks.set(child, Math.max(ranks.get(child) || 0, (ranks.get(id) || 0) + 1));
      indegree.set(child, indegree.get(child)! - 1);
      if (!indegree.get(child)) queue.push(child);
    }
  }
  const levels = new Map(people.map((p) => [p.id, ranks.get(root(p.id)) || 0]));
  const groups = new Map<number, TreePerson[]>();
  people.forEach((p) => {
    const g = levels.get(p.id)!;
    groups.set(g, [...(groups.get(g) || []), p]);
  });
  const ordered = [...groups].sort(([a], [b]) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, list] of ordered)
    list
      .sort(
        (a, b) =>
          root(a.id).localeCompare(root(b.id)) || a.fullName.localeCompare(b.fullName, 'es'),
      )
      .forEach((p, i) =>
        positions.set(p.id, { x: i * 260 - (list.length - 1) * 130, y: level * 175 }),
      );
  // Connected components color actual links. Names never infer relationships.
  const components = new Map<string, number>();
  let component = 0;
  for (const p of people)
    if (!components.has(p.id)) {
      const stack = [p.id];
      while (stack.length) {
        const id = stack.pop()!;
        if (components.has(id)) continue;
        components.set(id, component);
        for (const r of relationships)
          if (r.from === id && !components.has(r.to)) stack.push(r.to);
          else if (r.to === id && !components.has(r.from)) stack.push(r.from);
      }
      component++;
    }
  return { levels, positions, components, generations: ordered.map(([n]) => n) };
}
