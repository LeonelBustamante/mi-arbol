import { useState, type FormEvent } from 'react';
import { Camera, Send, X } from 'lucide-react';
import { personSchema, type PersonData } from '../functions/src/domain';
import { linksFor, isPerson, date, type TreePerson, type Relationship } from './model';
import { configured, call, auth } from './firebase';
import { preparePhoto } from './photo';
import { readDraft, trackDraft, clearDraft } from './draft';
export default function PersonForm({
  person,
  people,
  relationships,
  admin,
  onDone,
  onError,
}: {
  person?: TreePerson;
  people: TreePerson[];
  relationships: Relationship[];
  admin: boolean;
  onDone: (message: string) => void;
  onError: (e: unknown) => void;
}) {
  const draft=readDraft(person?.id||'new');
  const [form, setForm] = useState<PersonData>(() =>draft?.form||
    personSchema.parse(
      person
        ? Object.fromEntries(
            Object.entries(person).filter(([k]) =>
              [
                'fullName',
                'birthDate',
                'birthPlace',
                'deathDate',
                'deathPlace',
                'deceased',
                'observations',
                'sources',
                'branch',
                'certainty',
              ].includes(k),
            ),
          )
        : { fullName: 'Persona nueva' },
    ),
  );
  const [name, setName] = useState(draft?.name??person?.fullName??'');
  const [birthDate, setBirthDate] = useState(draft?.birthDate??(person?.birthDate ? date(person.birthDate) : ''));
  const [deathDate, setDeathDate] = useState(draft?.deathDate??(form.deathDate ? date(form.deathDate) : ''));
  const [links, setLinks] = useState(() =>draft?.links||linksFor(person?.id || '', relationships));
  const [contributorName, setContributorName] = useState(
    draft?.contributorName??(admin ? auth?.currentUser?.displayName || '' : ''),
  );
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photo, setPhoto] = useState(draft?.photo||'');
  const [requestId] = useState(() =>draft?.requestId||crypto.randomUUID());
  trackDraft({key:person?.id||'new',form,name,birthDate,deathDate,links,contributorName,photo,requestId});
  const field = (key: keyof PersonData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  async function choosePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPhoto(await preparePhoto(file));
    } catch (e) {
      onError(e);
    } finally {
      setPhotoBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = personSchema.parse({
        ...form,
        fullName: name,
        birthDate,
        deathDate: form.deceased ? deathDate : '',
      });
      if (admin && person && isPerson(person))
        await call('editPerson', {
          id: person.id,
          baseRevision: person.revision,
          person: data,
          links,
          ...(photo ? { photo } : {}),
        });
      else
        await call('submitContribution', {
          requestId,
          kind: person ? 'correction' : 'new',
          ...(person ? { personId: person.id } : {}),
          contributor: { displayName: contributorName.trim() },
          website,
          person: data,
          links,
          ...(photo ? { photo } : {}),
        });
      clearDraft();
      onDone(
        admin && person
          ? 'Cambios publicados.'
          : 'Gracias, tu aporte quedó pendiente de aprobación.',
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="person-form simplified-form">
      {!(admin && person) && (
        <label>
          Nombre de quien lo carga <span className="required">*</span>
          <input
            required
            minLength={2}
            maxLength={160}
            autoComplete="name"
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
            placeholder="Tu nombre y apellido"
          />
        </label>
      )}
      <label>
        Nombre del familiar <span className="required">*</span>
        <input
          required
          minLength={2}
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre y apellido del familiar"
        />
      </label>
      <div className="photo-picker">
        <div className="photo-preview">
          {photo || person?.photoData ? (
            <img src={photo || person?.photoData} alt="Vista previa de la foto del familiar" />
          ) : (
            <Camera size={25} />
          )}
        </div>
        <div>
          <label className="button secondary upload-button">
            <Camera size={16} />
            {photoBusy ? 'Preparando foto…' : photo ? 'Cambiar foto' : 'Subir una foto'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={photoBusy}
              onChange={(e) => {
                void choosePhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <small>No es obligatorio subir una foto. JPG, PNG o WebP · hasta 10 MB</small>
        </div>
        {photo && (
          <button
            type="button"
            className="icon-button"
            aria-label="Quitar foto seleccionada"
            onClick={() => setPhoto('')}
          >
            <X size={17} />
          </button>
        )}
      </div>
      <div className="form-grid">
        <label>
          Fecha de nacimiento
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            placeholder="DDMMYYYY, MMYYYY o YYYY"
          />
          <small className="field-help">
            Ej.: 25061940, 061940 o 1940. También podés dejarla vacía.
          </small>
        </label>
        <label>
          Lugar de nacimiento
          <input
            maxLength={200}
            value={form.birthPlace}
            onChange={(e) => field('birthPlace', e.target.value)}
            placeholder="Ciudad, provincia o país"
          />
        </label>
      </div>
      <div className="form-grid relation-inputs">
        {(['father', 'mother', 'partner'] as const).map((type) => (
          <label key={type}>
            {{ father: 'Padre', mother: 'Madre', partner: 'Pareja' }[type]}
            <select
              value={links[type]}
              onChange={(e) => setLinks({ ...links, [type]: e.target.value })}
            >
              <option value="">No sé / sin registrar</option>
              {people
                .filter((p) => p.id !== person?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <label className="check-label deceased-checkbox">
        <input
          type="checkbox"
          checked={form.deceased}
          onChange={(e) => {
            field('deceased', e.target.checked);
            if (!e.target.checked) {
              setDeathDate('');
              field('deathPlace', '');
            }
          }}
        />
        Persona fallecida
      </label>
      {form.deceased && (
        <div className="form-grid">
          <label>
            Fecha de fallecimiento
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={deathDate}
              onChange={(e) => setDeathDate(e.target.value)}
              placeholder="DDMMYYYY, MMYYYY o YYYY"
            />
            <small className="field-help">Fecha completa, mes y año, o solo el año.</small>
          </label>
          <label>
            Lugar de fallecimiento
            <input
              maxLength={200}
              value={form.deathPlace}
              onChange={(e) => field('deathPlace', e.target.value)}
            />
          </label>
        </div>
      )}
      <label>
        Estado de la información
        <select value={form.certainty} onChange={(e) => field('certainty', e.target.value)}>
          <option value="confirmed">Confirmada</option>
          <option value="hypothesis">Creo que...</option>
        </select>
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
      <p className="form-review-note">
        {admin && person
          ? 'Los cambios se publican al guardar.'
          : 'El aporte y la foto se publican únicamente después de la revisión del administrador.'}
      </p>
      {!configured&&<p className="error-banner" role="status">La foto es opcional. El envío necesita una conexión al servidor; estamos preparando el modo local.</p>}
      <button className="button primary full-width" disabled={busy || photoBusy || !configured}>
        <Send size={16} />
        {busy ? 'Guardando…' : admin && person ? 'Guardar cambios' : 'Enviar para revisión'}
      </button>
    </form>
  );
}
