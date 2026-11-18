import { describe, it, expect } from 'vitest';
import {
  personSchema,
  publicPerson,
  findDuplicate,
  validateGraph,
  validateImport,
  replaceLinks,
  linksSchema,
  BRANCHES,
  normalizeDate,
  connectRelationship,
  dateBounds,
} from '../functions/src/domain';
import type { Relationship } from '../functions/src/domain';
const person = personSchema.parse({
  fullName: 'Persona de prueba',
  birthPlace: 'Dato privado',
  deceased: true,
  deathDate: '2000-01-01',
  observations: 'No público',
  sources: 'Fuente privada',
});
const rel = (
  from: string,
  to: string,
  type: Relationship['type'] = 'father',
  id = `${from}-${to}-${type}`,
): Relationship => ({ id, from, to, type, certainty: 'confirmed' });
describe('privacidad y validación de personas', () => {
  it('proyecta exactamente tres campos públicos', () => {
    expect(publicPerson('one', person)).toEqual({
      id: 'one',
      fullName: 'PERSONA DE PRUEBA',
      birthDate: '',
    });
    expect(Object.keys(publicPerson('one', person)).sort()).toEqual([
      'birthDate',
      'fullName',
      'id',
    ]);
  });
  it('rechaza atributos inesperados y nombres vacíos', () => {
    expect(() => personSchema.parse({ ...person, role: 'admin' })).toThrow();
    expect(() => personSchema.parse({ fullName: ' ' })).toThrow();
  });
  it('admite datos desconocidos', () =>
    expect(personSchema.parse({ fullName: 'Nombre de prueba' }).birthDate).toBe(''));
  it.each(['2020-02-30', '1900-02-29', '2020-13-01', '0000-01-01', '20-1-1'])(
    'rechaza la fecha imposible %s',
    (birthDate) => expect(() => personSchema.parse({ ...person, birthDate })).toThrow(),
  );
  it('acepta años bisiestos reales', () =>
    expect(
      personSchema.parse({ fullName: 'Nombre de prueba', birthDate: '2000-02-29' }).birthDate,
    ).toBe('2000-02-29'));
  it('valida cronología y estado de fallecimiento', () => {
    expect(() => personSchema.parse({ ...person, birthDate: '2020-01-01' })).toThrow();
    expect(() => personSchema.parse({ ...person, deceased: false })).toThrow();
  });
  it('detecta homónimos normalizados con fecha compatible o desconocida', () => {
    const people = [{ id: 'one', fullName: '  María   Pérez ', birthDate: '1900-01-01' }];
    expect(findDuplicate(people, personSchema.parse({ fullName: 'Maria Perez' }))?.id).toBe('one');
    expect(
      findDuplicate(
        people,
        personSchema.parse({ fullName: 'Maria Perez', birthDate: '1901-01-01' }),
      ),
    ).toBeUndefined();
    expect(
      findDuplicate(people, personSchema.parse({ fullName: 'Maria Perez' }), 'one'),
    ).toBeUndefined();
  });
});
describe('parentescos explícitos', () => {
  it('admite parejas y familias sin inferir apellidos', () =>
    expect(() =>
      validateGraph(new Set(['a', 'b', 'c']), [
        rel('a', 'b', 'partner'),
        rel('a', 'c'),
        rel('b', 'c', 'mother'),
      ]),
    ).not.toThrow());
  it('rechaza ciclos incluso de varios ancestros', () =>
    expect(() =>
      validateGraph(new Set(['a', 'b', 'c']), [rel('a', 'b'), rel('b', 'c'), rel('c', 'a')]),
    ).toThrow(/ciclo/));
  it('rechaza vínculos consigo mismo y referencias ausentes', () => {
    expect(() => validateGraph(new Set(['a']), [rel('a', 'a')])).toThrow(/consigo/);
    expect(() => validateGraph(new Set(['a']), [rel('a', 'b')])).toThrow(/inexistente/);
  });
  it('rechaza dos padres y ambos roles para la misma persona', () => {
    expect(() => validateGraph(new Set(['a', 'b', 'c']), [rel('a', 'c'), rel('b', 'c')])).toThrow();
    expect(() =>
      validateGraph(new Set(['a', 'c']), [rel('a', 'c'), rel('a', 'c', 'mother')]),
    ).toThrow();
  });
  it('rechaza parejas inversas duplicadas', () =>
    expect(() =>
      validateGraph(new Set(['a', 'b']), [rel('a', 'b', 'partner'), rel('b', 'a', 'partner')]),
    ).toThrow(/duplicado/));
  it('corrige vínculos sin eliminar hijos y preserva las hipótesis', () => {
    const result = replaceLinks(
      'b',
      linksSchema.parse({ father: 'd', fatherCertainty: 'hypothesis' }),
      [rel('a', 'b'), rel('b', 'c')],
    );
    expect(result.some((r) => r.from === 'b' && r.to === 'c')).toBe(true);
    expect(result.find((r) => r.from === 'd')?.certainty).toBe('hypothesis');
    expect(result.some((r) => r.from === 'a')).toBe(false);
  });
  it('los identificadores de parentescos no colisionan por guiones bajos', () => {
    const a = replaceLinks('c', linksSchema.parse({ father: 'a_b' }), []);
    const b = replaceLinks('b_c', linksSchema.parse({ father: 'a' }), []);
    expect(a[0].id).not.toBe(b[0].id);
  });
});
describe('importador', () => {
  it('la plantilla incluye ocho ramas sin personas inventadas', () =>
    expect(
      validateImport({ version: 1, branches: [...BRANCHES], persons: [], relationships: [] })
        .persons,
    ).toHaveLength(0));
  it('preserva confirmaciones e hipótesis', () =>
    expect(
      validateImport({
        version: 1,
        branches: [],
        persons: [{ id: 'a', data: { fullName: 'Persona de prueba', certainty: 'hypothesis' } }],
        relationships: [],
      }).persons[0].data.certainty,
    ).toBe('hypothesis'));
  it('rechaza IDs repetidos, duplicados y relaciones inexistentes', () => {
    const p = { id: 'a', data: { fullName: 'Persona de prueba' } };
    expect(() =>
      validateImport({ version: 1, branches: [], persons: [p, p], relationships: [] }),
    ).toThrow(/repetidos/);
    expect(() =>
      validateImport({
        version: 1,
        branches: [],
        persons: [p, { ...p, id: 'b' }],
        relationships: [],
      }),
    ).toThrow(/duplicadas/);
    expect(() =>
      validateImport({ version: 1, branches: [], persons: [p], relationships: [rel('a', 'x')] }),
    ).toThrow(/inexistente/);
  });
});

describe('fechas con precisión conocida', () => {
  it.each([
    ['25061940', '1940-06-25'],
    ['061940', '1940-06'],
    ['1940', '1940'],
    ['25/06/1940', '1940-06-25'],
    ['06/1940', '1940-06'],
    ['1940-06', '1940-06'],
    ['', ''],
  ])('normaliza %s sin inventar precisión', (input, result) =>
    expect(normalizeDate(input)).toBe(result),
  );
  it.each(['31021940', '131940', '0000', '00000000', '29021900', '19', '2020-01-99'])(
    'rechaza la fecha inválida %s',
    (value) => expect(() => normalizeDate(value)).toThrow(),
  );
  it('la cronología usa intervalos para fechas parciales', () => {
    expect(() =>
      personSchema.parse({
        fullName: 'Test Partial',
        birthDate: '1940-12-31',
        deceased: true,
        deathDate: '1940',
      }),
    ).not.toThrow();
    expect(() =>
      personSchema.parse({
        fullName: 'Test Invalid',
        birthDate: '1941',
        deceased: true,
        deathDate: '1940',
      }),
    ).toThrow();
    expect(dateBounds('2000-02')).toEqual(['2000-02-01', '2000-02-29']);
  });
  it('detecta duplicados entre fechas completas y parciales compatibles', () => {
    expect(
      findDuplicate(
        [{ id: 'a', fullName: 'Test Name', birthDate: '1940' }],
        personSchema.parse({ fullName: 'Test Name', birthDate: '25061940' }),
      )?.id,
    ).toBe('a');
    expect(
      findDuplicate(
        [{ id: 'a', fullName: 'Test Name', birthDate: '1940-07' }],
        personSchema.parse({ fullName: 'Test Name', birthDate: '061940' }),
      ),
    ).toBeUndefined();
  });
});

describe('conexión explícita de nodos', () => {
  it('agrega una relación sin borrar padres, parejas o hijos ajenos', () => {
    const before = [rel('a', 'c'), rel('a', 'b', 'partner')];
    const result = connectRelationship(new Set(['a', 'b', 'c', 'm']), before, {
      from: 'm',
      to: 'c',
      type: 'mother',
      certainty: 'confirmed',
    });
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(before[0]);
    expect(result).toContainEqual(before[1]);
  });
  it('requiere el vínculo actual para reemplazar un padre, evitando conflictos', () => {
    const before = [rel('a', 'c')];
    const input = { from: 'b', to: 'c', type: 'father', certainty: 'confirmed' } as const;
    expect(() => connectRelationship(new Set(['a', 'b', 'c']), before, input)).toThrow(/Confirmá/);
    expect(
      connectRelationship(new Set(['a', 'b', 'c']), before, {
        ...input,
        replaceId: before[0].id,
      })[0].from,
    ).toBe('b');
  });
  it('normaliza parejas y no duplica un parentesco ya existente', () => {
    const before = [rel('a', 'b', 'partner')];
    expect(
      connectRelationship(new Set(['a', 'b']), before, {
        from: 'b',
        to: 'a',
        type: 'partner',
        certainty: 'confirmed',
      }),
    ).toBe(before);
  });
  it('rechaza ciclos y personas inexistentes', () => {
    expect(() =>
      connectRelationship(new Set(['a', 'b']), [rel('a', 'b')], {
        from: 'b',
        to: 'a',
        type: 'mother',
        certainty: 'confirmed',
      }),
    ).toThrow(/ciclo/);
    expect(() =>
      connectRelationship(new Set(['a']), [], {
        from: 'a',
        to: 'missing',
        type: 'father',
        certainty: 'confirmed',
      }),
    ).toThrow(/inexistente/);
  });
});

it('guarda nombres en mayúsculas conservando tildes y eñes', () => {
  expect(personSchema.parse({ fullName: '  José Muñoz Pérez  ' }).fullName).toBe(
    'JOSÉ MUÑOZ PÉREZ',
  );
});
