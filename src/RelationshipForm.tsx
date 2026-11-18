import { useState, type FormEvent } from 'react';
import { GitFork, ArrowDown, Trash2 } from 'lucide-react';
import { call } from './firebase';
import SearchSelect, { spanishOrder } from './SearchSelect';
import type { Relationship, TreePerson } from './model';
const kinds = [
  ['father', 'es padre de'],
  ['mother', 'es madre de'],
  ['partner', 'es pareja de'],
  ['child-father', 'es hijo/a de (padre)'],
  ['child-mother', 'es hijo/a de (madre)'],
] as const;
export default function RelationshipForm({
  people,
  relationships,
  initialFrom,
  initialTo,
  initialType,
  onDone,
  onError,
}: {
  people: TreePerson[];
  relationships: Relationship[];
  initialFrom?: string;
  initialTo?: string;
  initialType?: Relationship['type'];
  onDone: (message: string) => void;
  onError: (e: unknown) => void;
}) {
  const [from, setFrom] = useState(initialFrom || '');
  const [to, setTo] = useState(initialTo || '');
  const [kind, setKind] = useState(initialType || '');
  const [certainty, setCertainty] = useState<'confirmed' | 'hypothesis'>('confirmed');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const reversed = kind.startsWith('child-');
  const type = (reversed ? kind.slice(6) : kind) as Relationship['type'];
  const source = reversed ? to : from;
  const target = reversed ? from : to;
  const occupied =
    type === 'partner'
      ? undefined
      : relationships.find((r) => r.type === type && r.to === target && r.from !== source);
  const name = (id: string) => people.find((p) => p.id === id)?.fullName || 'Familiar';
  const related = relationships.filter((r) => r.from === from || r.to === from);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('manageRelationship', {
        requestId,
        action: 'connect',
        from: source,
        to: target,
        type,
        certainty,
        ...(occupied && replace ? { replaceId: occupied.id } : {}),
      });
      onDone('Parentesco guardado. El árbol se actualizó.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(relationship: Relationship) {
    setBusy(true);
    try {
      await call('manageRelationship', {
        requestId: crypto.randomUUID(),
        action: 'remove',
        relationship,
      });
      onDone('Vínculo quitado. Las dos personas siguen en el árbol.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="relationship-form" onSubmit={submit}>
      <p className="muted">
        Elegí dos familiares y el vínculo entre ellos. Solo el administrador puede publicar estos
        cambios.
      </p>
      <SearchSelect
        label="Primer familiar"
        required
        value={from}
        options={people.map((p) => ({ value: p.id, label: p.fullName }))}
        emptyLabel="Seleccionar familiar"
        onChange={(value) => {
          setFrom(value);
          if (value === to) setTo('');
          setReplace(false);
        }}
      />
      <label>
        Parentesco
        <select
          required
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setReplace(false);
          }}
        >
          <option value="">Elegir parentesco</option>
          {kinds
            .slice()
            .sort((a, b) => spanishOrder.compare(a[1], b[1]))
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
      </label>
      <SearchSelect
        label="Segundo familiar"
        required
        value={to}
        options={people
          .filter((p) => p.id !== from)
          .map((p) => ({ value: p.id, label: p.fullName }))}
        emptyLabel="Seleccionar familiar"
        onChange={(value) => {
          setTo(value);
          setReplace(false);
        }}
      />
      {from && to && kind && from !== to && (
        <div className="relationship-preview">
          <strong>{name(from)}</strong>
          <span>
            <ArrowDown size={14} />
            {kinds.find(([key]) => key === kind)?.[1]}
          </span>
          <strong>{name(to)}</strong>
        </div>
      )}
      <label>
        Estado de la información
        <select
          value={certainty}
          onChange={(e) => setCertainty(e.target.value as 'confirmed' | 'hypothesis')}
        >
          <option value="confirmed">Confirmada</option>
          <option value="hypothesis">Creo que...</option>
        </select>
      </label>
      {occupied && (
        <div className="replacement-notice">
          <p>
            {name(occupied.from)} ya figura como {type === 'father' ? 'padre' : 'madre'} de{' '}
            {name(target)}.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Reemplazar ese vínculo por el parentesco que seleccioné.
          </label>
        </div>
      )}
      <button
        className="button primary full-width"
        disabled={busy || !from || !to || !kind || from === to || Boolean(occupied && !replace)}
      >
        <GitFork size={17} />
        {busy ? 'Guardando…' : 'Guardar parentesco'}
      </button>
      {related.length > 0 && (
        <section className="existing-relations">
          <h3>Vínculos actuales de {name(from)}</h3>
          {related.map((r) => (
            <div className="relationship-row" key={r.id}>
              <span>
                <strong>{name(r.from)}</strong>{' '}
                {r.type === 'father'
                  ? 'es padre de'
                  : r.type === 'mother'
                    ? 'es madre de'
                    : 'es pareja de'}{' '}
                <strong>{name(r.to)}</strong>
                {r.certainty === 'hypothesis' ? ' · Creo que...' : ''}
              </span>
              <button
                type="button"
                className="icon-button danger-text"
                disabled={busy}
                title="Quitar este vínculo"
                aria-label={`Quitar vínculo entre ${name(r.from)} y ${name(r.to)}`}
                onClick={() => void remove(r)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>
      )}
    </form>
  );
}
