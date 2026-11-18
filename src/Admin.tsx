import { useState } from 'react';
import {
  Download,
  ShieldCheck,
  Check,
  X,
  Clock,
  UserRoundCheck,
  FilePenLine,
  History,
  Trash2,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db, call } from './firebase';
import { useRows, usePhoto } from './hooks';
import Modal from './Modal';
import AdminAccess from './AdminAccess';
import { type Row, type Person, type Relationship, date } from './model';
const tabs = [
  ['submissions', 'Aportes', FilePenLine],
  ['privacy', 'Privacidad', Trash2],
  ['history', 'Historial', History],
] as const;
function time(value: any) {
  return value?.toDate ? value.toDate().toLocaleString('es-AR') : 'Sin fecha';
}
function statusLabel(s: string) {
  return (
    (
      {
        pending: 'Pendiente',
        approved: 'Aprobado',
        rejected: 'Rechazado',
        revoked: 'Revocado',
        resolved: 'Resuelto',
        sent: 'Enviado',
        failed: 'Error · reintentando',
        emulated: 'Simulado',
        admin: 'Administrador',
        visitor: 'Visitante',
      } as Record<string, string>
    )[s] || s
  );
}
export default function Admin({
  owner = false,
  people,
  relationships,
  onError,
  onSuccess,
  onEdit,
}: {
  owner?: boolean;
  people: Person[];
  relationships: Relationship[];
  onError: (e: unknown) => void;
  onSuccess: (m: string) => void;
  onEdit: (p: Person) => void;
}) {
  const [tab, setTab] = useState('submissions');
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const selectedPhoto = usePhoto('submissionPhotos', selected?.id);
  const submissions = useRows('submissions');
  const privacy = useRows('privacyRequests');
  const history = useRows('auditLogs', tab === 'history');
  const rows =
    tab === 'submissions' ? submissions.rows : tab === 'privacy' ? privacy.rows : history.rows;
  const readError = [submissions, privacy, history].find((r) => r.error)?.error;
  async function action(name: string, data: unknown, key: string) {
    setBusy(key);
    try {
      await call(name, data);
      onSuccess('Operación registrada.');
      setSelected(null);
      setReason('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  }
  async function exportJson() {
    setBusy('export');
    try {
      const collections = [
        'persons',
        'relationships',
        'personPhotos',
        'submissionPhotos',
        'accessRequests',
        ...(owner ? ['members', 'adminInvitations'] : []),
        'submissions',
        'privacyRequests',
        'auditLogs',
      ];
      const snapshots = await Promise.all(
        collections.map((name) => getDocs(collection(db!, name))),
      );
      const data = Object.fromEntries(
        collections.map((name, i) => [
          name,
          snapshots[i].docs.map((d) => ({ ...d.data(), id: d.id })),
        ]),
      );
      const blob = new Blob(
        [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mi-arbol-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onSuccess('Respaldo privado exportado. Guardalo en un lugar seguro.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  }
  function view(row: Row) {
    setSelected(row);
    setReason('');
  }
  return (
    <section className="admin-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ESPACIO DE ADMINISTRACIÓN</span>
          <h1>Cuidar nuestra historia</h1>
          <p>Revisá cada aporte antes de que forme parte del árbol.</p>
        </div>
        <button className="button secondary" disabled={!!busy} onClick={exportJson}>
          <Download size={17} />
          Exportar JSON
        </button>
      </div>
      <div className="admin-summary" aria-label="Resumen del árbol">
        <div>
          <strong>{submissions.rows.filter((r) => r.status === 'pending').length}</strong>
          <span>Aportes pendientes</span>
        </div>
        <div>
          <strong>{privacy.rows.filter((r) => r.status === 'pending').length}</strong>
          <span>Pedidos de privacidad</span>
        </div>
        <div>
          <strong>{people.length}</strong>
          <span>Familiares registrados</span>
        </div>
      </div>
      <nav className="admin-tabs" aria-label="Secciones administrativas">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-current={tab === key ? 'page' : undefined}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              setSelected(null);
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        {owner && (
          <button
            className={tab === 'admins' ? 'active' : ''}
            aria-current={tab === 'admins' ? 'page' : undefined}
            onClick={() => {
              setTab('admins');
              setSelected(null);
            }}
          >
            <ShieldCheck size={16} />
            Administradores
          </button>
        )}
      </nav>
      {tab === 'admins' && owner && <AdminAccess onError={onError} onSuccess={onSuccess} />}
      {readError && (
        <div className="error-banner" role="alert">
          No se pudo consultar la información: {readError}
        </div>
      )}
      <div className="admin-list" hidden={tab === 'admins'}>
        {!rows.length ? (
          <div className="list-empty">
            <Check size={28} />
            <h3>No hay registros en esta sección</h3>
            <p>Las nuevas solicitudes aparecerán acá automáticamente.</p>
          </div>
        ) : (
          rows
            .slice()
            .sort(
              (a, b) =>
                (b.submittedAt?.seconds ||
                  b.requestedAt?.seconds ||
                  b.timestamp?.seconds ||
                  b.createdAt?.seconds ||
                  0) -
                (a.submittedAt?.seconds ||
                  a.requestedAt?.seconds ||
                  a.timestamp?.seconds ||
                  a.createdAt?.seconds ||
                  0),
            )
            .map((row) => (
              <article className="admin-row" key={row.id}>
                <div className="row-symbol">
                  {tab === 'history' ? (
                    <History size={18} />
                  ) : tab === 'submissions' ? (
                    <FilePenLine size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </div>
                <div className="row-text">
                  <strong>
                    {row.person?.fullName ||
                      row.displayName ||
                      row.submittedBy?.displayName ||
                      row.event ||
                      row.action ||
                      row.id}
                  </strong>
                  <small>
                    {row.submittedBy?.displayName ||
                      row.email ||
                      row.submittedBy?.email ||
                      row.actor?.email ||
                      row.entityId ||
                      row.type}{' '}
                    ·{' '}
                    {time(
                      row.requestedAt ||
                        row.submittedAt ||
                        row.timestamp ||
                        row.createdAt ||
                        row.updatedAt,
                    )}
                  </small>
                  {row.kind && (
                    <small>
                      {row.kind === 'new' ? 'Nuevo familiar' : 'Corrección de familiar'}
                    </small>
                  )}
                </div>
                <span className={`status ${row.status || row.role || ''}`}>
                  {statusLabel(row.status || row.role || 'Registro')}
                </span>
                <div className="row-actions">
                  {['submissions', 'privacy', 'history'].includes(tab) && (
                    <button className="button small secondary" onClick={() => view(row)}>
                      Revisar
                    </button>
                  )}
                </div>
              </article>
            ))
        )}
      </div>
      {tab === 'submissions' && (
        <div className="admin-persons">
          <h3>Personas publicadas y vínculos</h3>
          <p>La edición permite corregir datos, padre, madre y pareja.</p>
          {people.map((p) => (
            <button key={p.id} className="person-edit-row" onClick={() => onEdit(p)}>
              <span>{p.fullName}</span>
              <FilePenLine size={16} />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <Modal
          title={
            tab === 'submissions'
              ? selected.kind === 'new'
                ? 'Revisar nuevo familiar'
                : 'Revisar cambios propuestos'
              : tab === 'privacy'
                ? 'Solicitud de privacidad'
                : 'Detalle del registro'
          }
          onClose={() => setSelected(null)}
          busy={Boolean(busy)}
          wide
        >
          <div className="review-panel modal-review-panel">
            {tab === 'submissions' ? (
              <>
                <p className="muted">
                  Aportado por{' '}
                  <strong>{selected.submittedBy?.displayName || 'Nombre no informado'}</strong> ·{' '}
                  {time(selected.submittedAt)}
                </p>
                {selectedPhoto && (
                  <img
                    className="review-photo"
                    src={selectedPhoto}
                    alt="Foto propuesta para el familiar"
                  />
                )}
                {selected.kind === 'correction' && (
                  <div className="info-box">
                    Revisión de origen: {selected.baseRevision}. Revisión actual:{' '}
                    {people.find((p) => p.id === selected.personId)?.revision ||
                      'Persona eliminada'}
                    . Las ediciones desactualizadas no se pueden aprobar.
                  </div>
                )}
                <div className="review-columns">
                  {selected.kind === 'correction' && (
                    <div>
                      <h3>Datos actuales</h3>
                      <PersonSummary data={people.find((p) => p.id === selected.personId)} />
                    </div>
                  )}
                  <div>
                    <h3>Datos propuestos</h3>
                    <PersonSummary data={selected.person} />
                  </div>
                </div>
                <h3>Parentescos propuestos</h3>
                <p className="muted">
                  En las correcciones, los parentescos vacíos conservan los vínculos actuales.
                </p>
                <dl>
                  {Object.entries(selected.links || {})
                    .filter(([k]) => ['father', 'mother', 'partner'].includes(k))
                    .map(([k, id]) => (
                      <div key={k}>
                        <dt>
                          {
                            (
                              { father: 'Padre', mother: 'Madre', partner: 'Pareja' } as Record<
                                string,
                                string
                              >
                            )[k]
                          }
                        </dt>
                        <dd>{people.find((p) => p.id === id)?.fullName || 'Sin registrar'}</dd>
                      </div>
                    ))}
                </dl>
                {selected.kind === 'correction' && (
                  <>
                    <h3>Parentescos actuales</h3>
                    <p>
                      {relationships
                        .filter(
                          (r) =>
                            r.to === selected.personId ||
                            (r.type === 'partner' && r.from === selected.personId),
                        )
                        .map(
                          (r) =>
                            `${r.type}: ${people.find((p) => p.id === (r.from === selected.personId ? r.to : r.from))?.fullName || 'Desconocido'}`,
                        )
                        .join(' · ') || 'Sin registrar'}
                    </p>
                  </>
                )}
                {selected.status === 'pending' && (
                  <>
                    <label>
                      Motivo / nota de revisión
                      <textarea
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="button-row review-actions">
                      <button
                        disabled={
                          !!busy ||
                          (selected.kind === 'correction' &&
                            people.find((p) => p.id === selected.personId)?.revision !==
                              selected.baseRevision)
                        }
                        className="button primary"
                        onClick={() =>
                          action(
                            'moderate',
                            { id: selected.id, decision: 'approved', reason },
                            selected.id,
                          )
                        }
                      >
                        {busy === selected.id ? 'Publicando…' : 'Aprobar y publicar en el árbol'}
                      </button>
                      <button
                        disabled={!!busy}
                        className="button danger"
                        onClick={() =>
                          action(
                            'moderate',
                            { id: selected.id, decision: 'rejected', reason },
                            selected.id,
                          )
                        }
                      >
                        Rechazar
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : tab === 'privacy' ? (
              <>
                <p>
                  {selected.type === 'deletion'
                    ? 'Solicitud de eliminación'
                    : 'Solicitud de corrección'}
                </p>
                <p className="preserve">{selected.message}</p>
                <p className="muted">
                  Realizá la corrección o eliminación desde el perfil de la persona antes de
                  registrar la resolución.
                </p>
                {selected.status === 'pending' ? (
                  <>
                    <label>
                      Resolución aplicada
                      <textarea
                        minLength={10}
                        maxLength={3000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={!!busy || reason.trim().length < 10}
                      onClick={() =>
                        action(
                          'resolvePrivacy',
                          { id: selected.id, resolution: reason },
                          selected.id,
                        )
                      }
                    >
                      Registrar resolución
                    </button>
                  </>
                ) : (
                  <p>{selected.resolution}</p>
                )}
              </>
            ) : (
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
function PersonSummary({ data }: { data?: any }) {
  if (!data) return <p>Persona no disponible.</p>;
  return (
    <dl>
      {[
        ['Nombre', data.fullName],
        ['Nacimiento', date(data.birthDate || '')],
        ['Lugar de nacimiento', data.birthPlace],
        [
          'Fallecimiento',
          data.deceased
            ? `${data.deathDate ? date(data.deathDate) : 'Sin fecha'}`
            : 'No registrado',
        ],
        ['Lugar de fallecimiento', data.deathPlace],
        ['Información', data.certainty === 'hypothesis' ? 'Creo que...' : 'Confirmada'],
      ].map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="preserve">{v || 'Desconocido'}</dd>
        </div>
      ))}
    </dl>
  );
}
