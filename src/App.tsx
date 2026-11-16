import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  GitFork,
  Link2,
  Leaf,
  LockKeyhole,
  LogOut,
  Plus,
  ShieldCheck,
  Sprout,
  TreeDeciduous,
  UsersRound,
  X,
} from 'lucide-react';
import { auth, db, configured, googleSignIn, call } from './firebase';
import { useRows } from './hooks';
import Tree from './Tree';
import Admin from './Admin';
import PersonForm from './PersonForm';
import RelationshipForm from './RelationshipForm';
import { readDraft } from './draft';
import ModalFrame from './Modal';
import {
  BRANCHES,
  colors,
  date,
  isPerson,
  type Role,
  type Person,
  type PublicPerson,
  type Relationship,
  type TreePerson,
} from './model';
const disclaimer =
  'Este árbol genealógico contiene información familiar recopilada con fines históricos y personales. Los visitantes pueden consultar nombres, apellidos, fechas de nacimiento y fotos aprobadas. Cualquier persona puede proponer familiares o correcciones sin iniciar sesión. Los aportes quedan pendientes y solo el administrador puede revisarlos y aprobar su publicación. Los datos ampliados y la información de colaboradores son privados del administrador.';
type Modal = 'access' | 'privacy' | 'about' | 'add' | 'person' | 'edit' | 'relationship' | null;
function errorText(e: unknown) {
  if (e && typeof e === 'object' && 'issues' in e)
    return (e as any).issues.map((i: any) => i.message).join(' ');
  return e instanceof Error ? e.message : 'No se pudo completar la operación.';
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('visitor');
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/');
  const [modal, setModal] = useState<Modal>(() => (readDraft() ? 'add' : null));
  const [selected, setSelected] = useState<TreePerson | null>(null);
  const [joining, setJoining] = useState<{
    from?: string;
    to?: string;
    type?: Relationship['type'];
  }>({});
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const family = role === 'admin';
  const admin = role === 'admin';
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.slice(1) || '/');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      if (u && u.email !== 'aleobustamante@gmail.com') {
        void signOut(auth!).catch(() => {});
        setRole('visitor');
        setSelected(null);
        setUser(null);
        return;
      }
      setRole('visitor');
      setSelected(null);
      setUser(u);
    });
  }, []);
  useEffect(() => {
    if (!db || !user) {
      setRole('visitor');
      return;
    }
    const stopRole = onSnapshot(
      doc(db, 'members', user.uid),
      (s) => {
        setRole(s.data()?.role || 'visitor');
      },
      () => setRole('visitor'),
    );
    return () => {
      stopRole();
    };
  }, [user]);
  useEffect(() => {
    if (!family) {
      setSelected(null);
      setModal((current) =>
        ['edit', 'person', 'relationship'].includes(current || '') ? null : current,
      );
    }
  }, [family]);
  const publicPeople = useRows('publicPersons');
  const publicLinks = useRows('publicRelationships');
  const privatePeople = useRows('persons', family);
  const privateLinks = useRows('relationships', family);
  const photos = useRows(family ? 'personPhotos' : 'publicPersonPhotos');
  const photoMap = new Map(photos.rows.map((p) => [p.id, p.dataUrl as string]));
  const people = (family ? privatePeople.rows : publicPeople.rows).map((p) => ({
    ...p,
    photoData: photoMap.get(p.id),
  })) as unknown as TreePerson[];
  const relationships = (family
    ? privateLinks.rows
    : publicLinks.rows) as unknown as Relationship[];
  const currentSelected = selected ? people.find((p) => p.id === selected.id) : undefined;
  const onError = useCallback((e: unknown) => setToast({ message: errorText(e), error: true }), []);
  const onSuccess = useCallback((message: string) => setToast({ message, error: false }), []);
  const onSelect = useCallback(
    (p: TreePerson) => {
      setSelected(p);
      setModal(admin ? 'person' : 'edit');
    },
    [admin],
  );
  const onJoin = useCallback(
    (from?: string, to?: string, type?: Relationship['type']) => {
      if (!admin) return;
      setJoining({ from, to, type });
      setModal('relationship');
    },
    [admin],
  );
  const onAccess = useCallback(() => setModal('access'), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 14000 : 7000);
    return () => clearTimeout(t);
  }, [toast]);
  const loadError = [
    publicPeople,
    publicLinks,
    ...(family ? [privatePeople, privateLinks] : []),
  ].find((r) => r.error)?.error;
  const nav = (path: string) => {
    window.location.hash = path;
  };
  async function logout() {
    try {
      if (auth) await signOut(auth);
      setRole('visitor');
      setSelected(null);
      setModal(null);
      nav('/');
    } catch (e) {
      onError(e);
    }
  }
  function done(message: string) {
    setModal(null);
    onSuccess(message);
  }
  return (
    <div className={`app-shell canvas-app ${admin ? 'is-admin' : ''}`}>
      <header className="floating-header">
        <a className="canvas-brand" href="#/">
          <TreeDeciduous size={24} />
          <span>Mi árbol familiar</span>
        </a>
        <nav className="canvas-actions" aria-label="Acciones del árbol">
          {route === '/admin' && (
            <a className="button secondary" href="#/">
              Volver al árbol
            </a>
          )}
          <button className="button primary" onClick={() => setModal('add')}>
            <Plus size={17} />
            <span>Agregar familiar</span>
          </button>
          {admin ? (
            <>
              <button className="button secondary" onClick={() => onJoin()}>
                <Link2 size={16} />
                <span>Unir familiares</span>
              </button>
              <a className="button secondary" href="#/admin">
                <ShieldCheck size={16} />
                <span>Administración</span>
              </a>
              <button
                className="icon-button header-icon"
                aria-label="Cerrar sesión"
                onClick={logout}
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button
              className="icon-button header-icon"
              aria-label="Ingreso del administrador"
              title="Administrar"
              onClick={onAccess}
            >
              <ShieldCheck size={20} />
            </button>
          )}
          <button
            className="icon-button header-icon"
            aria-label="Privacidad y correcciones"
            title="Privacidad"
            onClick={() => setModal('privacy')}
          >
            <CircleHelp size={19} />
          </button>
        </nav>
      </header>
      {route === '/admin' ? (
        <main className="admin-workspace">
          {admin ? (
            <Admin
              people={privatePeople.rows as unknown as Person[]}
              relationships={relationships}
              onError={onError}
              onSuccess={onSuccess}
              onEdit={(p) => {
                setSelected(p);
                setModal('edit');
              }}
            />
          ) : (
            <div className="restricted">
              <ShieldCheck size={35} />
              <h1>Administración del árbol</h1>
              <p>Este ingreso está reservado al administrador.</p>
              <button className="button primary" onClick={onAccess}>
                Ingresar
              </button>
            </div>
          )}
        </main>
      ) : (
        <main className="tree-stage" aria-label="Árbol genealógico a pantalla completa">
          <Tree
            people={people}
            relationships={relationships}
            privateView={admin}
            loading={family ? privatePeople.loading : publicPeople.loading}
            onSelect={onSelect}
            onJoin={onJoin}
            onAccess={() => setModal('add')}
          />
          {loadError && (
            <div className="canvas-status error-banner" role="alert">
              No pudimos cargar el árbol. Comprobá la conexión.
            </div>
          )}
          {import.meta.env.VITE_USE_EMULATORS === 'true' ? (
            <span className="canvas-status preview-status">Modo local · datos en este equipo</span>
          ) : (
            !configured && (
              <span className="canvas-status preview-status">
                Vista previa · Firebase sin conectar
              </span>
            )
          )}
        </main>
      )}
      {modal && (
        <ModalFrame
          title={
            modal === 'access'
              ? 'Ingreso del administrador'
              : modal === 'privacy'
                ? 'Tu información, tu decisión'
                : modal === 'about'
                  ? 'Una historia construida entre todos'
                  : modal === 'add'
                    ? 'Proponer un familiar'
                    : modal === 'relationship'
                      ? 'Unir familiares y asignar parentesco'
                      : modal === 'edit'
                        ? admin
                          ? 'Editar familiar'
                          : 'Proponer editar datos'
                        : currentSelected?.fullName || 'Información de la persona'
          }
          onClose={() => setModal(null)}
        >
          {modal === 'access' && (
            <AdminLogin
              onError={onError}
              onDone={(message) => {
                done(message);
                nav('/admin');
              }}
            />
          )}
          {modal === 'privacy' && <Privacy onDone={done} onError={onError} />}
          {modal === 'about' && (
            <div className="about-content">
              <div className="info-box">
                <Sprout size={22} />
                <p>
                  Ocho ramas, muchas historias. Un espacio para preservar recuerdos y registrar
                  parentescos explícitos, con información revisada y acceso cuidado.
                </p>
              </div>
              <p>{disclaimer}</p>
              <h3>Información confirmada y por investigar</h3>
              <p>
                Las hipótesis se identifican en la vista privada del administrador y no se publican
                en la vista pública. Ningún parentesco se deduce de los apellidos.
              </p>
              {!configured && (
                <>
                  <h3>Preparación del proyecto</h3>
                  <p>
                    La aplicación todavía no está conectada a Firebase y no contiene personas de
                    ejemplo. El archivo README.md del proyecto explica cómo configurar el acceso,
                    los correos, el importador y el despliegue.
                  </p>
                </>
              )}
              <p>
                Los aportes no se publican automáticamente. Compartí únicamente información que
                corresponda revisar y publicar.
              </p>
            </div>
          )}
          {modal === 'relationship' && admin && (
            <RelationshipForm
              people={people}
              relationships={relationships}
              initialFrom={joining.from}
              initialTo={joining.to}
              initialType={joining.type}
              onDone={done}
              onError={onError}
            />
          )}
          {(modal === 'add' || modal === 'edit') && (
            <PersonForm
              key={modal === 'add' ? 'new' : currentSelected?.id}
              person={modal === 'edit' ? currentSelected : undefined}
              people={people}
              relationships={relationships}
              admin={admin}
              onDone={done}
              onError={onError}
            />
          )}
          {modal === 'person' && currentSelected && (
            <div className="person-detail">
              <div className="detail-avatar">
                {currentSelected.photoData ? (
                  <img
                    src={currentSelected.photoData}
                    alt={`Foto de ${currentSelected.fullName}`}
                  />
                ) : (
                  currentSelected.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((x) => x[0])
                    .join('')
                )}
              </div>
              <span className="subtle-pill">
                {family ? 'Perfil del administrador' : 'Perfil público'}
              </span>
              <dl>
                <div>
                  <dt>Nombre del familiar</dt>
                  <dd>{currentSelected.fullName}</dd>
                </div>
                <div>
                  <dt>Fecha de nacimiento</dt>
                  <dd>{date(currentSelected.birthDate)}</dd>
                </div>
                {family && isPerson(currentSelected) && (
                  <>
                    <div>
                      <dt>Lugar de nacimiento</dt>
                      <dd>{currentSelected.birthPlace || 'Desconocido'}</dd>
                    </div>
                    <div>
                      <dt>Fallecimiento</dt>
                      <dd>
                        {currentSelected.deceased
                          ? `${currentSelected.deathDate ? date(currentSelected.deathDate) : 'Fecha desconocida'}`
                          : 'No registrado'}
                      </dd>
                    </div>
                    {currentSelected.deceased && (
                      <div>
                        <dt>Lugar de fallecimiento</dt>
                        <dd>{currentSelected.deathPlace || 'Desconocido'}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Información</dt>
                      <dd>
                        {currentSelected.certainty === 'hypothesis' ? 'Creo que...' : 'Confirmada'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <button className="button primary" onClick={() => setModal('edit')}>
                {admin ? 'Editar datos' : 'Proponer editar datos'}
              </button>
              {admin && (
                <button className="button secondary" onClick={() => onJoin(currentSelected.id)}>
                  <Link2 size={16} />
                  Unir con otro familiar
                </button>
              )}
              {admin && isPerson(currentSelected) && (
                <DeleteControl person={currentSelected} onDone={done} onError={onError} />
              )}
            </div>
          )}
        </ModalFrame>
      )}
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`toast ${toast.error ? 'error' : ''}`}
        >
          <span>{toast.message}</span>
          <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToast(null)}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function AdminLogin({
  onError,
  onDone,
}: {
  onError: (e: unknown) => void;
  onDone: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function login() {
    setBusy(true);
    try {
      await googleSignIn();
      await call('verifyAdmin');
      onDone('Sesión de administrador iniciada.');
    } catch (e) {
      if (auth) await signOut(auth);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="access-content">
      <div className="modal-illustration">
        <ShieldCheck size={38} />
      </div>
      <p>Este ingreso es únicamente para el administrador del árbol.</p>
      <p>
        Para agregar un familiar o proponer una corrección no necesitás cuenta ni iniciar sesión.
      </p>
      <button className="button primary full-width" disabled={busy || !configured} onClick={login}>
        {busy ? 'Ingresando…' : 'Ingresar como administrador con Google'}
      </button>
      {!configured && <p className="muted">El ingreso estará disponible al conectar Firebase.</p>}
    </div>
  );
}
function Privacy({
  onDone,
  onError,
}: {
  onDone: (m: string) => void;
  onError: (e: unknown) => void;
}) {
  const [type, setType] = useState('correction');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('submitPrivacy', {
        requestId,
        type,
        message,
        contributor: { displayName: name, email },
        website,
      });
      onDone('Solicitud de privacidad recibida. El administrador revisará tu pedido.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="privacy-content">
      <p>{disclaimer}</p>
      <h3>Solicitar una corrección o eliminación</h3>
      <p>
        No necesitás iniciar sesión. Podés completar este formulario o escribir a{' '}
        <a href="mailto:aleobustamante@gmail.com">aleobustamante@gmail.com</a>.
      </p>
      <form onSubmit={submit}>
        <label>
          Tu nombre (opcional)
          <input maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Correo para responderte (opcional)
          <input
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="honeypot" aria-hidden="true">
          Sitio web
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
        <label>
          Tipo de solicitud
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="correction">Corrección de información personal</option>
            <option value="deletion">Eliminación de información personal</option>
          </select>
        </label>
        <label>
          ¿Qué información necesitás revisar?
          <textarea
            required
            minLength={10}
            maxLength={3000}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <p className="muted">
          El mensaje y los datos de contacto que decidas indicar se guardarán de forma privada para
          gestionar tu solicitud.
        </p>
        <button className="button primary" disabled={busy || !configured}>
          {busy ? 'Enviando…' : 'Enviar solicitud sin iniciar sesión'}
        </button>
      </form>
    </div>
  );
}
function DeleteControl({
  person,
  onDone,
  onError,
}: {
  person: Person;
  onDone: (m: string) => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await call('deletePerson', { id: person.id, baseRevision: person.revision, reason });
      onDone('Persona y vínculos retirados del árbol publicado.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="delete-control">
      {open ? (
        <>
          <p>
            Se retirarán del árbol los datos de {person.fullName} y sus vínculos. La operación
            quedará auditada.
          </p>
          <label>
            Motivo
            <textarea
              minLength={10}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="button danger"
              disabled={busy || reason.trim().length < 10}
              onClick={remove}
            >
              Confirmar eliminación
            </button>
            <button className="button secondary" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <button className="text-button danger-text" onClick={() => setOpen(true)}>
          Eliminar persona del árbol
        </button>
      )}
    </div>
  );
}
