import { useState, type FormEvent } from 'react';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { call } from './firebase';
import { useRows } from './hooks';
import Modal from './Modal';
import type { Row } from './model';

export default function AdminAccess({
  onError,
  onSuccess,
}: {
  onError: (e: unknown) => void;
  onSuccess: (m: string) => void;
}) {
  const invitations = useRows('adminInvitations');
  const members = useRows('members');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<Row | null>(null);
  async function save(address: string, status: 'active' | 'revoked') {
    setBusy(true);
    try {
      await call('manageAdmin', { email: address.trim().toLowerCase(), status });
      setEmail('');
      setRevoking(null);
      onSuccess(
        status === 'active'
          ? 'Acceso habilitado. La persona ya puede ingresar con Google.'
          : 'Acceso administrativo revocado.',
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void save(email, 'active');
  }
  return (
    <section aria-labelledby="access-heading" className="admin-access">
      <div className="access-intro">
        <ShieldCheck size={28} />
        <div>
          <h2 id="access-heading">Administradores del árbol</h2>
          <p>
            Vos controlás los accesos. Los administradores pueden revisar y aprobar aportes, editar
            familiares y consultar la información privada del árbol.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="admin-invite-form">
        <label htmlFor="admin-email">Correo de la cuenta de Google</label>
        <div className="invite-controls">
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="nombre@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="invite-help"
          />
          <button className="button primary" disabled={busy}>
            <UserPlus size={18} />
            {busy ? 'Guardando…' : 'Habilitar administrador'}
          </button>
        </div>
        <p id="invite-help">
          No se envía un correo. Compartí el enlace del árbol y pedile que ingrese desde
          Administración con esa cuenta de Google.
        </p>
      </form>
      <article className="admin-row">
        <ShieldCheck size={22} />
        <div className="row-text">
          <strong>Tu cuenta · Propietario</strong>
          <small>Solo vos podés habilitar y revocar administradores.</small>
        </div>
        <span className="status approved">Acceso protegido</span>
      </article>
      {(invitations.error || members.error) && (
        <p role="alert" className="error-banner">
          No se pudieron cargar los accesos. Volvé a intentar.
        </p>
      )}
      {invitations.loading && <p role="status">Cargando administradores…</p>}
      {!invitations.loading && !invitations.error && !invitations.rows.length && (
        <p className="list-empty">Todavía no agregaste otros administradores.</p>
      )}
      {invitations.rows
        .slice()
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((row) => (
          <article className="admin-row" key={row.id}>
            <div className="row-text">
              <strong>{row.email}</strong>
              <small>
                {row.status === 'revoked'
                  ? 'Ya no puede administrar el árbol.'
                  : members.rows.some((m) => m.email === row.email)
                    ? 'Ya ingresó al panel con Google.'
                    : 'Habilitado · pendiente de su primer ingreso.'}
              </small>
            </div>
            <span className={`status ${row.status === 'active' ? 'approved' : 'revoked'}`}>
              {row.status === 'active' ? 'Habilitado' : 'Revocado'}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                row.status === 'active' ? setRevoking(row) : void save(row.email, 'active')
              }
            >
              {row.status === 'active' ? 'Revocar acceso' : 'Reactivar acceso'}
            </button>
          </article>
        ))}
      {revoking && (
        <Modal
          busy={busy}
          title="Revocar acceso administrativo"
          onClose={() => {
            if (!busy) setRevoking(null);
          }}
        >
          <p>
            <strong>{revoking.email}</strong> dejará de poder consultar datos privados, editar y
            aprobar aportes. Podés reactivar el acceso después.
          </p>
          <div className="invite-controls">
            <button className="button secondary" disabled={busy} onClick={() => setRevoking(null)}>
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void save(revoking.email, 'revoked')}
            >
              {busy ? 'Revocando…' : 'Confirmar revocación'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
