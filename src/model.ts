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
export { familyLayout as layout } from './tree-layout';

// Normalize current and historical names for every view without changing audit records.
export function uppercaseNames<T>(value: T): T {
  if (Array.isArray(value)) return value.map(uppercaseNames) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['fullName', 'displayName'].includes(key) && typeof item === 'string'
          ? item.toLocaleUpperCase('es')
          : uppercaseNames(item),
      ]),
    ) as T;
  return value;
}
