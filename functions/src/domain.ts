import { z } from 'zod';
export const BRANCHES = [
  'Hecht',
  'Elkin',
  'Berger',
  'Feldman',
  'Bavor',
  'Pennese',
  'Posternak',
  'Bustamante',
] as const;
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const text = (max: number) => z.string().trim().max(max);
// Canonical values preserve precision: YYYY, YYYY-MM or YYYY-MM-DD.
export function normalizeDate(input: string): string {
  let value = input.trim();
  if (!value) return '';
  if (/^\d{8}$/.test(value)) value = `${value.slice(4)}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
  else if (/^\d{6}$/.test(value)) value = `${value.slice(2)}-${value.slice(0, 2)}`;
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [d, m, y] = value.split('/');
    value = `${y}-${m}-${d}`;
  } else if (/^\d{2}\/\d{4}$/.test(value)) {
    const [m, y] = value.split('/');
    value = `${y}-${m}`;
  }
  if (!/^\d{4}(-\d{2})?(-\d{2})?$/.test(value))
    throw new Error('Usá DDMMYYYY, MMYYYY o YYYY, o dejá la fecha vacía.');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || (month !== undefined && (month < 1 || month > 12)))
    throw new Error('La fecha no es válida.');
  if (day !== undefined && (day < 1 || day > daysInMonth(year, month)))
    throw new Error('La fecha no es válida.');
  return value;
}
function daysInMonth(year: number, month: number) {
  return [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
}
export function dateBounds(value: string): [string, string] {
  const d = normalizeDate(value);
  if (!d) return ['0001-01-01', '9999-12-31'];
  const [year, month, day] = d.split('-');
  return [
    `${year}-${month || '01'}-${day || '01'}`,
    `${year}-${month || '12'}-${day || String(daysInMonth(Number(year), Number(month || 12))).padStart(2, '0')}`,
  ];
}
export const dateSchema = z
  .string()
  .max(10)
  .transform((value, ctx) => {
    try {
      return normalizeDate(value);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  });
export const personSchema = z
  .object({
    fullName: text(160).min(2, 'Ingresá el nombre completo.'),
    birthDate: dateSchema.default(''),
    birthPlace: text(200).default(''),
    deathDate: dateSchema.default(''),
    deathPlace: text(200).default(''),
    deceased: z.boolean().default(false),
    observations: text(5000).default(''),
    sources: text(3000).default(''),
    branch: z.enum(BRANCHES).nullable().default(null),
    certainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.birthDate && p.deathDate && dateBounds(p.birthDate)[0] > dateBounds(p.deathDate)[1])
      ctx.addIssue({
        code: 'custom',
        message: 'El fallecimiento no puede ser anterior al nacimiento.',
        path: ['deathDate'],
      });
    if ((p.deathDate || p.deathPlace) && !p.deceased)
      ctx.addIssue({
        code: 'custom',
        message: 'Marcá que la persona falleció.',
        path: ['deceased'],
      });
  });
export type PersonData = z.infer<typeof personSchema>;
export type Person = PersonData & { id: string; revision: number };
export type PublicPerson = { id: string; fullName: string; birthDate: string };
export const relationshipSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,250}$/),
    from: idSchema,
    to: idSchema,
    type: z.enum(['father', 'mother', 'partner']),
    certainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
  })
  .strict();
export type Relationship = z.infer<typeof relationshipSchema>;
export const linksSchema = z
  .object({
    father: idSchema.or(z.literal('')).default(''),
    mother: idSchema.or(z.literal('')).default(''),
    partner: idSchema.or(z.literal('')).default(''),
    fatherCertainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
    motherCertainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
    partnerCertainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
  })
  .strict();
export type Links = z.infer<typeof linksSchema>;
export function publicPerson(id: string, p: PersonData): PublicPerson {
  return { id, fullName: p.fullName, birthDate: p.birthDate };
}
export function normalizeName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export function findDuplicate(
  people: { id: string; fullName: string; birthDate: string }[],
  person: PersonData,
  exceptId = '',
) {
  return people.find(
    (p) =>
      p.id !== exceptId &&
      normalizeName(p.fullName) === normalizeName(person.fullName) &&
      (!p.birthDate ||
        !person.birthDate ||
        (dateBounds(p.birthDate)[0] <= dateBounds(person.birthDate)[1] &&
          dateBounds(person.birthDate)[0] <= dateBounds(p.birthDate)[1])),
  );
}
export function validateGraph(ids: Set<string>, relationships: Relationship[]) {
  const edges = new Map<string, string[]>();
  const unique = new Set<string>();
  const parents = new Set<string>();
  for (const r of relationships) {
    if (!ids.has(r.from) || !ids.has(r.to))
      throw new Error('Un parentesco apunta a una persona inexistente.');
    if (r.from === r.to) throw new Error('Una persona no puede tener un vínculo consigo misma.');
    const key =
      r.type === 'partner'
        ? `partner:${[r.from, r.to].sort().join(':')}`
        : `${r.type}:${r.from}:${r.to}`;
    if (unique.has(key)) throw new Error('El parentesco está duplicado.');
    unique.add(key);
    if (r.type !== 'partner') {
      const slot = `${r.type}:${r.to}`;
      if (parents.has(slot))
        throw new Error('Solo puede registrarse un padre y una madre por persona.');
      parents.add(slot);
      const pair = `parent:${r.from}:${r.to}`;
      if (unique.has(pair))
        throw new Error('La misma persona no puede ocupar ambos lugares parentales.');
      unique.add(pair);
      edges.set(r.from, [...(edges.get(r.from) || []), r.to]);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('El parentesco crearía un ciclo entre generaciones.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of edges.get(id) || []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  ids.forEach(visit);
}
export function replaceLinks(id: string, links: Links, current: Relationship[]): Relationship[] {
  const result = current.filter(
    (r) =>
      !((r.type === 'father' || r.type === 'mother') && r.to === id) &&
      !(r.type === 'partner' && (r.from === id || r.to === id)),
  );
  for (const type of ['father', 'mother', 'partner'] as const)
    if (links[type]) {
      const [from, to] = type === 'partner' ? [id, links[type]].sort() : [links[type], id];
      result.push({
        id: `${type}_${from.length}_${from}_${to}`,
        from,
        to,
        type,
        certainty: links[`${type}Certainty`],
      });
    }
  return result;
}
export const importSchema = z
  .object({
    version: z.literal(1),
    branches: z.array(z.enum(BRANCHES)),
    persons: z.array(z.object({ id: idSchema, data: personSchema }).strict()).max(100),
    relationships: z.array(relationshipSchema).max(100),
  })
  .strict();
export type ImportData = z.infer<typeof importSchema>;
export function validateImport(input: unknown) {
  const data = importSchema.parse(input);
  const ids = new Set(data.persons.map((p) => p.id));
  if (ids.size !== data.persons.length)
    throw new Error('Hay identificadores de personas repetidos.');
  if (new Set(data.relationships.map((r) => r.id)).size !== data.relationships.length)
    throw new Error('Hay identificadores de parentescos repetidos.');
  validateGraph(ids, data.relationships);
  data.persons.forEach((p) => {
    if (
      findDuplicate(
        data.persons.map((x) => ({ ...x.data, id: x.id })),
        p.data,
        p.id,
      )
    )
      throw new Error('Hay posibles personas duplicadas en la importación.');
  });
  return data;
}

export const relationConnectionSchema = z
  .object({
    from: idSchema,
    to: idSchema,
    type: z.enum(['father', 'mother', 'partner']),
    certainty: z.enum(['confirmed', 'hypothesis']).default('confirmed'),
    replaceId: relationshipSchema.shape.id.optional(),
  })
  .strict();
export type RelationConnection = z.infer<typeof relationConnectionSchema>;
export function connectRelationship(
  ids: Set<string>,
  current: Relationship[],
  input: RelationConnection,
): Relationship[] {
  if (input.from === input.to) throw new Error('Elegí dos familiares diferentes.');
  const [from, to] =
    input.type === 'partner' ? [input.from, input.to].sort() : [input.from, input.to];
  const same = current.find(
    (r) =>
      r.type === input.type &&
      (input.type === 'partner'
        ? [r.from, r.to].sort().join(':') === [from, to].join(':')
        : r.from === from && r.to === to),
  );
  const occupied =
    input.type === 'partner'
      ? undefined
      : current.find((r) => r.type === input.type && r.to === to && r.from !== from);
  if (occupied && input.replaceId !== occupied.id)
    throw new Error(
      'Ese familiar ya tiene ese parentesco asignado. Confirmá cuál vínculo querés reemplazar.',
    );
  if (input.replaceId && occupied?.id !== input.replaceId)
    throw new Error('El parentesco cambió. Volvé a revisar los familiares.');
  const relationship: Relationship = {
    id: same?.id || `${input.type}_${from.length}_${from}_${to}`,
    from,
    to,
    type: input.type,
    certainty: input.certainty,
  };
  if (same && same.certainty === relationship.certainty && !occupied) {
    validateGraph(ids, current);
    return current;
  }
  const result = [
    ...current.filter((r) => r.id !== same?.id && r.id !== occupied?.id),
    relationship,
  ];
  validateGraph(ids, result);
  return result;
}
