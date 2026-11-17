import type { TreePerson, Relationship } from './model';
import type { ElkNode, ElkPort, ElkExtendedEdge } from 'elkjs/lib/elk-api';
export const CARD_WIDTH = 248;
export const CARD_HEIGHT = 152;
const PARTNER_GAP = 56;
export type Point = { x: number; y: number };
export type ConnectionDrawing = {
  paths: { path: string; hypothesis: boolean }[];
  junction?: Point;
};
export type FamilyConnection = {
  id: string;
  source: string;
  target: string;
  partner: boolean;
  color: string;
  description: string;
  drawing: ConnectionDrawing;
};
type Unit = { id: string; members: string[]; width: number; level: number };
export type FamilyTreeLayout = {
  positions: Map<string, Point>;
  levels: Map<string, number>;
  components: Map<string, number>;
  personColors: Map<string, string>;
  generations: number[];
  connections: FamilyConnection[];
  roots: { id: string; label: string; people: string[] }[];
};

const branchColors = [
  '#739068',
  '#668da8',
  '#9a7dad',
  '#aa8c5d',
  '#ad7b70',
  '#6d9992',
  '#8e8b64',
  '#8b80a7',
];
function branchColor(ids: string[]) {
  let hash = 0;
  for (const char of [...ids].sort().join(':'))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return branchColors[(hash >>> 0) % branchColors.length];
}

function familyModel(people: TreePerson[], relationships: Relationship[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const links = relationships
    .filter((r) => byId.has(r.from) && byId.has(r.to))
    .sort((a, b) => a.id.localeCompare(b.id));
  const stable = (a: string, b: string) => {
    const x = byId.get(a)!,
      y = byId.get(b)!;
    return (
      (x.birthDate || '9999').localeCompare(y.birthDate || '9999') ||
      x.fullName.localeCompare(y.fullName, 'es') ||
      a.localeCompare(b)
    );
  };
  const parents = links.filter((r) => r.type !== 'partner');
  const roots = new Map(people.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    const p = roots.get(id)!;
    if (p === id) return id;
    const result = root(p);
    roots.set(id, result);
    return result;
  };
  function reaches(from: string, to: string) {
    const stack = [from],
      seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of parents) if (root(r.from) === id && root(r.to) !== id) stack.push(root(r.to));
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
  for (const r of links.filter((r) => r.type === 'partner')) align(r.from, r.to);
  for (const child of [...people].sort((a, b) => stable(a.id, b.id))) {
    const p = parents
      .filter((r) => r.to === child.id)
      .map((r) => r.from)
      .sort(stable);
    if (p.length === 2) align(p[0], p[1]);
  }
  const units = new Map<string, Unit>();
  for (const p of people) {
    const id = root(p.id);
    if (!units.has(id)) units.set(id, { id, members: [], width: 0, level: 0 });
    units.get(id)!.members.push(p.id);
  }
  const role = (id: string) =>
    parents.some((r) => r.from === id && r.type === 'father')
      ? 0
      : parents.some((r) => r.from === id && r.type === 'mother')
        ? 2
        : 1;
  for (const u of units.values()) {
    u.members.sort((a, b) => role(a) - role(b) || stable(a, b));
    u.width = u.members.length * CARD_WIDTH + (u.members.length - 1) * PARTNER_GAP;
  }
  const next = new Map<string, Set<string>>(),
    degree = new Map([...units.keys()].map((id) => [id, 0]));
  for (const r of parents) {
    const a = root(r.from),
      b = root(r.to);
    if (a !== b && !next.get(a)?.has(b)) {
      next.set(a, new Set([...(next.get(a) || []), b]));
      degree.set(b, degree.get(b)! + 1);
    }
  }
  const queue = [...units.keys()].filter((id) => !degree.get(id)).sort(stable);
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of next.get(id) || []) {
      units.get(child)!.level = Math.max(units.get(child)!.level, units.get(id)!.level + 1);
      degree.set(child, degree.get(child)! - 1);
      if (!degree.get(child)) queue.push(child);
    }
  }
  const components = new Map<string, number>();
  for (const p of [...people].sort((a, b) => stable(a.id, b.id))) {
    if (components.has(p.id)) continue;
    const component = new Set(components.values()).size,
      stack = [p.id];
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
  return { byId, links, parents, root, units, components, stable };
}

export async function familyLayout(
  people: TreePerson[],
  relationships: Relationship[],
): Promise<FamilyTreeLayout> {
  if (!people.length)
    return {
      positions: new Map(),
      levels: new Map(),
      components: new Map(),
      personColors: new Map(),
      generations: [],
      connections: [],
      roots: [],
    };
  const model = familyModel(people, relationships);
  const { root, units, links, parents, components, byId, stable } = model;
  const ordered = [...units.values()].sort((a, b) => stable(a.members[0], b.members[0]));
  const inputNodes: ElkNode[] = ordered.map((u) => {
    const ports: ElkPort[] = u.members.flatMap((id, index) => [
      {
        id: `${id}:in`,
        x: index * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2,
        y: 0,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': 'NORTH' },
      },
      {
        id: `${id}:out`,
        x: index * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2,
        y: CARD_HEIGHT,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': 'SOUTH' },
      },
    ]);
    ports.push({
      id: `${u.id}:couple`,
      x: u.width / 2,
      y: CARD_HEIGHT,
      width: 0,
      height: 0,
      layoutOptions: { 'elk.port.side': 'SOUTH' },
    });
    return {
      id: u.id,
      width: u.width,
      height: CARD_HEIGHT,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        'elk.partitioning.partition': String(u.level * 2),
      },
    };
  });
  const families = new Map<
    string,
    { parents: string[]; children: { id: string; hypothesis: boolean }[]; couple: boolean }
  >();
  for (const child of [...people].sort((a, b) => stable(a.id, b.id))) {
    const incoming = parents.filter((r) => r.to === child.id);
    if (!incoming.length) continue;
    const ids = [...new Set(incoming.map((r) => r.from))].sort(stable),
      key = JSON.stringify(ids);
    if (!families.has(key)) {
      const u = units.get(root(ids[0]))!;
      const couple =
        ids.length === 2 &&
        root(ids[0]) === root(ids[1]) &&
        u.members.length === 2 &&
        links.some(
          (r) =>
            r.type === 'partner' &&
            r.certainty !== 'hypothesis' &&
            ids.includes(r.from) &&
            ids.includes(r.to),
        );
      families.set(key, { parents: ids, children: [], couple });
    }
    families.get(key)!.children.push({
      id: child.id,
      hypothesis: incoming.some((r) => r.certainty === 'hypothesis'),
    });
  }
  const inputEdges: ElkExtendedEdge[] = [],
    edgeMeta = new Map<string, { family: string; hypothesis: boolean }>();
  for (const [key, family] of families) {
    const junction = `family:${key}`;
    inputNodes.push({
      id: junction,
      width: 2,
      height: 2,
      ports: [
        {
          id: `${junction}:in`,
          x: 1,
          y: 0,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'NORTH' },
        },
        {
          id: `${junction}:out`,
          x: 1,
          y: 2,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'SOUTH' },
        },
      ],
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        'elk.partitioning.partition': String(
          Math.max(...family.parents.map((p) => units.get(root(p))!.level)) * 2 + 1,
        ),
      },
    });
    const sources = family.couple
      ? [`${root(family.parents[0])}:couple`]
      : family.parents.map((id) => `${id}:out`);
    for (const [index, source] of sources.entries()) {
      const id = `${junction}:parent:${index}`;
      inputEdges.push({ id, sources: [source], targets: [`${junction}:in`] });
      edgeMeta.set(id, { family: key, hypothesis: family.children.every((c) => c.hypothesis) });
    }
    for (const child of family.children) {
      const id = `${junction}:child:${child.id}`;
      inputEdges.push({ id, sources: [`${junction}:out`], targets: [`${child.id}:in`] });
      edgeMeta.set(id, { family: key, hypothesis: child.hypothesis });
    }
  }
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const engine = new ELK();
  const result = await engine.layout({
    id: 'tree',
    children: inputNodes,
    edges: inputEdges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '100',
      'elk.spacing.edgeEdge': '22',
      'elk.spacing.edgeNode': '32',
      'elk.spacing.componentComponent': '180',
      'elk.layered.spacing.nodeNodeBetweenLayers': '76',
      'elk.layered.spacing.edgeNodeBetweenLayers': '32',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.mergeEdges': 'true',
      'elk.partitioning.activate': 'true',
      'elk.separateConnectedComponents': 'true',
      'elk.aspectRatio': '1.7',
      'elk.randomSeed': '42',
      'elk.padding': '[top=36,left=40,bottom=36,right=40]',
    },
  });
  const laidOut = new Map(result.children!.map((n) => [n.id, n]));
  const positions = new Map<string, Point>(),
    levels = new Map<string, number>();
  for (const p of people) {
    const u = units.get(root(p.id))!,
      n = laidOut.get(u.id)!;
    positions.set(p.id, {
      x: n.x! + u.members.indexOf(p.id) * (CARD_WIDTH + PARTNER_GAP),
      y: n.y!,
    });
    levels.set(p.id, u.level);
  }
  const connections: FamilyConnection[] = [];
  const personColors = new Map(
    people.map((p) => [p.id, branchColor(units.get(root(p.id))!.members)]),
  );
  for (const r of links.filter((r) => r.type === 'partner')) {
    const [left, right] = [r.from, r.to].sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    connections.push({
      id: r.id,
      source: left,
      target: right,
      partner: true,
      color: '#b2916d',
      description: 'Pareja registrada',
      drawing: {
        paths: [
          {
            path: drawPartner(positions.get(left)!, positions.get(right)!),
            hypothesis: r.certainty === 'hypothesis',
          },
        ],
      },
    });
  }
  for (const [key, family] of families) {
    const color = branchColor(family.parents);
    for (const child of family.children) personColors.set(child.id, color);
    const junction = laidOut.get(`family:${key}`)!;
    const paths: ConnectionDrawing['paths'] = [];
    if (family.couple) {
      const u = laidOut.get(root(family.parents[0]))!;
      paths.push({
        path: `M ${u.x! + u.width! / 2} ${u.y! + CARD_HEIGHT / 2} V ${u.y! + CARD_HEIGHT}`,
        hypothesis: family.children.every((c) => c.hypothesis),
      });
    }
    for (const edge of result.edges || []) {
      const meta = edgeMeta.get(edge.id);
      if (meta?.family !== key) continue;
      for (const section of edge.sections || []) {
        const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
        paths.push({
          path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
          hypothesis: meta.hypothesis,
        });
      }
    }
    connections.push({
      id: `family:${key}`,
      source: family.parents[0],
      target: family.children[0].id,
      partner: false,
      color,
      description: `${family.parents.map((id) => byId.get(id)!.fullName).join(' y ')}: ${family.children.length === 1 ? '1 hijo/a' : `${family.children.length} hijos/as`}`,
      drawing: { paths, junction: { x: junction.x! + 1, y: junction.y! + 1 } },
    });
  }
  const branchRoots = ordered
    .filter((u) => parents.some((r) => u.members.includes(r.from)))
    .sort((a, b) => a.level - b.level || stable(a.members[0], b.members[0]))
    .map((u) => ({
      id: u.id,
      label: u.members.map((id) => byId.get(id)!.fullName).join(' y '),
      people: u.members,
    }));
  return {
    positions,
    levels,
    components,
    personColors,
    generations: [...new Set(levels.values())].sort((a, b) => a - b),
    connections,
    roots: branchRoots,
  };
}
export function drawPartner(left: Point, right: Point): string {
  const x1 = left.x + CARD_WIDTH,
    y = left.y + CARD_HEIGHT / 2,
    x2 = right.x;
  if (left.y === right.y && right.x - left.x <= CARD_WIDTH + PARTNER_GAP + 1)
    return `M ${x1} ${y} H ${x2}`;
  const top = Math.min(left.y, right.y) - 28;
  return `M ${left.x + CARD_WIDTH / 2} ${left.y} V ${top} H ${right.x + CARD_WIDTH / 2} V ${right.y}`;
}
export function branchPeople(
  people: TreePerson[],
  relationships: Relationship[],
  seeds: string[],
): Set<string> {
  const visible = new Set(seeds),
    queue = [...seeds];
  // Only descendants propagate the branch. Spouses are shown for context, but
  // their unrelated ancestry and other siblings do not get pulled into this tree.
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of relationships)
      if (r.type !== 'partner' && r.from === id && !visible.has(r.to)) {
        visible.add(r.to);
        queue.push(r.to);
      }
  }
  const descendants = new Set(visible);
  for (const r of relationships)
    if (r.type !== 'partner' && descendants.has(r.to) && !seeds.includes(r.to)) visible.add(r.from);
  for (const r of relationships)
    if (r.type === 'partner' && (descendants.has(r.from) || descendants.has(r.to))) {
      visible.add(r.from);
      visible.add(r.to);
    }
  return new Set(people.filter((p) => visible.has(p.id)).map((p) => p.id));
}
