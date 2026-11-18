import { date, type Person, type Row } from './model';
const actions: Record<string, string> = {
  'person.edit': 'Datos de un familiar actualizados',
  'person.publish': 'Familiar publicado',
  'person.create': 'Familiar agregado por un administrador',
  'person.delete': 'Familiar eliminado',
  'person.names.uppercase': 'Nombres convertidos a mayúsculas',
  'submission.approved': 'Aporte aprobado',
  'submission.rejected': 'Aporte rechazado',
  'submission.create': 'Nuevo aporte recibido',
  'relationship.connect': 'Parentesco agregado o actualizado',
  'relationship.remove': 'Parentesco quitado',
  'privacy.resolve': 'Solicitud de privacidad resuelta',
  'privacy.request': 'Solicitud de privacidad recibida',
  'admin.grant': 'Acceso administrativo habilitado',
  'admin.revoke': 'Acceso administrativo revocado',
  'admin.bootstrap': 'Cuenta propietaria habilitada',
  'tree.import': 'Árbol importado',
};
export const historyTitle = (row: Row) => actions[row.action] || 'Actividad del árbol';
export function historySubject(row: Row, people: Person[], submissions: Row[]) {
  if (row.action?.startsWith('admin.') && row.entityId?.includes('@')) return row.entityId;
  if (row.action === 'person.names.uppercase') return 'Todos los nombres del árbol';
  const submission = submissions.find(
    (s) => s.id === row.entityId || s.id === row.changes?.submissionId,
  );
  return (
    row.changes?.after?.fullName ||
    row.changes?.before?.fullName ||
    people.find((p) => p.id === row.entityId)?.fullName ||
    submission?.person?.fullName ||
    (row.action?.startsWith('relationship.') ? 'Vínculos familiares' : 'Árbol familiar')
  );
}
export function historyDate(value: any) {
  const parsed =
    value?.toDate?.() ||
    (typeof value?.seconds === 'number'
      ? new Date(value.seconds * 1000)
      : typeof value?._seconds === 'number'
        ? new Date(value._seconds * 1000)
        : typeof value === 'string'
          ? new Date(value)
          : null);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleString('es-AR', { hour12: false })
    : 'Fecha no disponible';
}
const fields = [
  ['fullName', 'Nombre'],
  ['birthDate', 'Fecha de nacimiento'],
  ['birthPlace', 'Lugar de nacimiento'],
  ['deathDate', 'Fecha de fallecimiento'],
  ['deathPlace', 'Lugar de fallecimiento'],
  ['deceased', 'Persona fallecida'],
  ['certainty', 'Estado de la información'],
  ['branch', 'Rama familiar'],
  ['observations', 'Observaciones'],
  ['sources', 'Fuentes'],
] as const;
function valueLabel(key: string, value: any) {
  if (value === undefined || value === null || value === '') return 'Sin registrar';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (key === 'birthDate' || key === 'deathDate') return date(value);
  if (key === 'certainty') return value === 'confirmed' ? 'Confirmada' : 'Creo que…';
  return String(value);
}
export default function HistoryDetails({
  row,
  people,
  submissions,
}: {
  row: Row;
  people: Person[];
  submissions: Row[];
}) {
  const changes = row.changes || {};
  const before = changes.before && !Array.isArray(changes.before) ? changes.before : {};
  const after = changes.after && !Array.isArray(changes.after) ? changes.after : {};
  const modified = fields.filter(
    ([key]) => (key in before || key in after) && (before[key] ?? '') !== (after[key] ?? ''),
  );
  const beforeLinks: Row[] = Array.isArray(changes.before)
    ? changes.before
    : Array.isArray(changes.relationshipsBefore)
      ? changes.relationshipsBefore
      : [];
  const afterLinks: Row[] = Array.isArray(changes.after)
    ? changes.after
    : Array.isArray(changes.relationshipsAfter)
      ? changes.relationshipsAfter
      : [];
  const different = (a: Row, b: Row) =>
    ['id', 'from', 'to', 'type', 'certainty'].some((key) => a[key] !== b[key]);
  const removed = beforeLinks.filter((r) => !afterLinks.some((a) => !different(r, a)));
  const added = afterLinks.filter((r) => !beforeLinks.some((a) => !different(r, a)));
  const personName = (id: string) =>
    people.find((p) => p.id === id)?.fullName || 'Familiar que ya no está en el árbol';
  const linkLabel = (r: Row) =>
    `${personName(r.from)} ${r.type === 'father' ? 'es padre de' : r.type === 'mother' ? 'es madre de' : 'es pareja de'} ${personName(r.to)}${r.certainty === 'hypothesis' ? ' (Creo que…)' : ''}`;
  return (
    <section className="history-detail" aria-label="Detalle de la actividad">
      <h3>{historyTitle(row)}</h3>
      <dl>
        <div>
          <dt>Relacionado con</dt>
          <dd>{historySubject(row, people, submissions)}</dd>
        </div>
        <div>
          <dt>Fecha y hora</dt>
          <dd>{historyDate(row.timestamp || row.createdAt)}</dd>
        </div>
        <div>
          <dt>Registrado por</dt>
          <dd>
            {row.actor?.displayName ||
              row.actor?.email ||
              (row.actorUid === 'owner-maintenance'
                ? 'Mantenimiento del árbol'
                : 'Administrador del árbol')}
          </dd>
        </div>
      </dl>
      {modified.map(([key, label]) => (
        <div className="history-change" key={key}>
          <h3>{label}</h3>
          <p>
            <strong>Antes:</strong> {valueLabel(key, before[key])}
          </p>
          <p>
            <strong>Después:</strong> {valueLabel(key, after[key])}
          </p>
        </div>
      ))}
      {[
        ...removed.map((r) => ({ r, label: 'Vínculo anterior' })),
        ...added.map((r) => ({ r, label: 'Vínculo registrado' })),
      ].map(({ r, label }, i) => (
        <p key={`${label}-${r.id}-${i}`}>
          <strong>{label}:</strong> {linkLabel(r)}
        </p>
      ))}
      {changes.reason && (
        <p>
          <strong>Motivo:</strong> {changes.reason}
        </p>
      )}
      {changes.resolution && (
        <p>
          <strong>Resolución:</strong> {changes.resolution}
        </p>
      )}
      {row.action === 'person.names.uppercase' && (
        <p>
          Se actualizaron los nombres a mayúsculas
          {typeof changes.documents === 'number' ? ` en ${changes.documents} registros` : ''},
          conservando los vínculos y los demás datos.
        </p>
      )}
      {!modified.length &&
        !removed.length &&
        !added.length &&
        !changes.reason &&
        !changes.resolution &&
        row.action !== 'person.names.uppercase' && (
          <p>
            La actividad quedó registrada correctamente. Este registro no incluye una comparación de
            campos.
          </p>
        )}
    </section>
  );
}
