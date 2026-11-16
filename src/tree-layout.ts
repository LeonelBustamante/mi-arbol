import type { TreePerson, Relationship } from './model';
export const CARD_WIDTH = 248;
export const CARD_HEIGHT = 152;
const PARTNER_GAP = 56;
const FAMILY_GAP = 100;
const GENERATION_STEP = 310;

export function familyLayout(people: TreePerson[], relationships: Relationship[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const links = relationships.filter((r) => byId.has(r.from) && byId.has(r.to));
  const stable = (a: string, b: string) => {
    const x = byId.get(a)!,
      y = byId.get(b)!;
    return (
      (x.birthDate || '9999').localeCompare(y.birthDate || '9999') ||
      x.fullName.localeCompare(y.fullName, 'es') ||
      a.localeCompare(b)
    );
  };
  const components = new Map<string, number>();
  for (const person of [...people].sort((a, b) => stable(a.id, b.id))) {
    if (components.has(person.id)) continue;
    const component = new Set(components.values()).size,
      stack = [person.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (components.has(id)) continue;
      components.set(id, component);
      for (const r of links) {
        if (r.from === id) stack.push(r.to);
        if (r.to === id) stack.push(r.from);
      }
    }
  }
  const roots = new Map(people.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    const parent = roots.get(id)!;
    if (parent === id) return id;
    const value = root(parent);
    roots.set(id, value);
    return value;
  };
  const parentLinks = links.filter((r) => r.type !== 'partner');
  function reaches(from: string, to: string) {
    const stack = [from],
      seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of parentLinks)
        if (root(r.from) === id && root(r.to) !== id) stack.push(root(r.to));
    }
    return false;
  }
  function align(a: string, b: string) {
    a = root(a);
    b = root(b);
    if (a === b || reaches(a, b) || reaches(b, a)) return;
    const [keep, move] = [a, b].sort();
    roots.set(move, keep);
  }
  // Sharing a row does not create a partner relationship. Co-parents are aligned
  // only when it does not contradict the recorded ancestry.
  for (const r of links
    .filter((r) => r.type === 'partner')
    .sort((a, b) => a.id.localeCompare(b.id)))
    align(r.from, r.to);
  for (const child of [...people].sort((a, b) => stable(a.id, b.id))) {
    const parents = parentLinks
      .filter((r) => r.to === child.id)
      .map((r) => r.from)
      .sort(stable);
    if (parents.length === 2) align(parents[0], parents[1]);
  }
  const units = new Map<
    string,
    {
      id: string;
      members: string[];
      width: number;
      level: number;
      center: number;
      component: number;
    }
  >();
  for (const p of people) {
    const id = root(p.id);
    if (!units.has(id))
      units.set(id, {
        id,
        members: [],
        width: 0,
        level: 0,
        center: 0,
        component: components.get(p.id)!,
      });
    units.get(id)!.members.push(p.id);
  }
  const parentalRole = (id: string) =>
    parentLinks.some((r) => r.from === id && r.type === 'father')
      ? 0
      : parentLinks.some((r) => r.from === id && r.type === 'mother')
        ? 2
        : 1;
  for (const u of units.values()) {
    u.members.sort((a, b) => parentalRole(a) - parentalRole(b) || stable(a, b));
    u.width = u.members.length * CARD_WIDTH + (u.members.length - 1) * PARTNER_GAP;
  }
  const next = new Map<string, Set<string>>(),
    indegree = new Map([...units.keys()].map((id) => [id, 0]));
  for (const r of parentLinks) {
    const a = root(r.from),
      b = root(r.to);
    if (a !== b && !next.get(a)?.has(b)) {
      next.set(a, new Set([...(next.get(a) || []), b]));
      indegree.set(b, indegree.get(b)! + 1);
    }
  }
  const queue = [...units.keys()].filter((id) => !indegree.get(id)).sort();
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of next.get(id) || []) {
      units.get(child)!.level = Math.max(units.get(child)!.level, units.get(id)!.level + 1);
      indegree.set(child, indegree.get(child)! - 1);
      if (!indegree.get(child)) queue.push(child);
    }
  }
  const rows = new Map<number, typeof units extends Map<string, infer U> ? U[] : never>();
  for (const u of units.values()) rows.set(u.level, [...(rows.get(u.level) || []), u]);
  const ordered = [...rows].sort(([a], [b]) => a - b);
  const offset = (id: string) => {
    const u = units.get(root(id))!;
    return -u.width / 2 + u.members.indexOf(id) * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2;
  };
  const center = (id: string) => units.get(root(id))!.center + offset(id);
  function pack(
    row: (typeof units extends Map<string, infer U> ? U : never)[],
    desired: Map<string, number>,
  ) {
    row.sort(
      (a, b) =>
        a.component - b.component ||
        desired.get(a.id)! - desired.get(b.id)! ||
        stable(a.members[0], b.members[0]),
    );
    let right = -Infinity,
      totalShift = 0;
    for (const u of row) {
      const wanted = desired.get(u.id)!;
      u.center = Math.max(wanted, right + FAMILY_GAP + u.width / 2);
      right = u.center + u.width / 2;
      totalShift += u.center - wanted;
    }
    const correction = totalShift / Math.max(1, row.length);
    for (const u of row) u.center -= correction;
  }
  for (const [, row] of ordered) pack(row, new Map(row.map((u) => [u.id, 0])));
  // Align a parent with its own child inside a couple, rather than with an
  // arbitrary UUID or the center of the whole generation.
  for (let pass = 0; pass < 5; pass++)
    for (const downward of [true, false])
      for (const [, row] of downward ? ordered : [...ordered].reverse()) {
        const desired = new Map<string, number>();
        for (const u of row) {
          const targets: number[] = [];
          for (const r of parentLinks) {
            const here = downward ? r.to : r.from,
              other = downward ? r.from : r.to;
            if (root(here) === u.id && root(other) !== u.id)
              targets.push(center(other) - offset(here));
          }
          desired.set(
            u.id,
            targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : u.center,
          );
        }
        pack(row, desired);
      }
  const positions = new Map<string, { x: number; y: number }>(),
    levels = new Map<string, number>();
  for (const p of people) {
    const u = units.get(root(p.id))!;
    positions.set(p.id, { x: center(p.id) - CARD_WIDTH / 2, y: u.level * GENERATION_STEP });
    levels.set(p.id, u.level);
  }
  return { positions, levels, components, generations: ordered.map(([n]) => n) };
}

export type Point = { x: number; y: number };
export type ConnectionDrawing = {
  paths: { path: string; hypothesis: boolean }[];
  junction?: Point;
};
export function drawFamily(
  parents: Point[],
  children: { point: Point; hypothesis: boolean }[],
  couple: boolean,
): ConnectionDrawing {
  if (!parents.length || !children.length) return { paths: [] };
  const middle = parents.reduce((sum, p) => sum + p.x + CARD_WIDTH / 2, 0) / parents.length;
  const top = Math.min(...children.map((c) => c.point.y));
  const joinY = Math.max(...parents.map((p) => p.y + CARD_HEIGHT)) + (parents.length > 1 ? 28 : 0);
  const startY = couple ? parents[0].y + CARD_HEIGHT / 2 : joinY;
  const busY = Math.max(joinY + 22, top - 58);
  const xs = children.map((c) => c.point.x + CARD_WIDTH / 2);
  const allHypothesis = children.every((c) => c.hypothesis);
  const paths: ConnectionDrawing['paths'] = [];
  if (!couple && parents.length > 1) {
    for (const p of parents)
      paths.push({
        path: `M ${p.x + CARD_WIDTH / 2} ${p.y + CARD_HEIGHT} V ${joinY} H ${middle}`,
        hypothesis: allHypothesis,
      });
  }
  paths.push({
    path: `M ${middle} ${startY} V ${busY} M ${Math.min(middle, ...xs)} ${busY} H ${Math.max(middle, ...xs)}`,
    hypothesis: allHypothesis,
  });
  for (const child of children)
    paths.push({
      path: `M ${child.point.x + CARD_WIDTH / 2} ${busY} V ${child.point.y}`,
      hypothesis: child.hypothesis,
    });
  return { paths, junction: parents.length > 1 ? { x: middle, y: startY } : undefined };
}
export function drawPartner(left: Point, right: Point): string {
  const x1 = left.x + CARD_WIDTH,
    y1 = left.y + CARD_HEIGHT / 2,
    x2 = right.x,
    y2 = right.y + CARD_HEIGHT / 2;
  if (left.y === right.y && right.x - left.x <= CARD_WIDTH + PARTNER_GAP + 1)
    return `M ${x1} ${y1} H ${x2}`;
  // A second partnership goes above the cards instead of through a third person.
  const y = Math.min(left.y, right.y) - 30;
  return `M ${left.x + CARD_WIDTH / 2} ${left.y} V ${y} H ${right.x + CARD_WIDTH / 2} V ${right.y}`;
}
