import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
export const spanishOrder = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
type Option = { value: string; label: string };
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');

export default function SearchSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel = 'Seleccionar',
  required = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  emptyLabel?: string;
  required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const sorted = options.slice().sort((a, b) => spanishOrder.compare(a.label, b.label));
  const results = sorted.filter((o) => normalize(o.label).includes(normalize(query.trim())));
  const visible = [{ value: '', label: emptyLabel }, ...results];
  const selected = options.find((o) => o.value === value);
  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? 'Seleccioná una opción de la lista.' : '',
    );
  }, [required, value]);
  useEffect(() => {
    if (open && active >= 0)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);
  function close() {
    setOpen(false);
    setQuery('');
    setActive(-1);
  }
  function choose(option: Option) {
    onChange(option.value);
    close();
    input.current?.focus();
  }
  function keydown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) =>
        e.key === 'ArrowDown'
          ? Math.min(i + 1, visible.length - 1)
          : i < 0
            ? visible.length - 1
            : Math.max(i - 1, 0),
      );
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active >= 0 && visible[active]) choose(visible[active]);
    }
  }
  return (
    <div
      className="search-select"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="search-select-control">
        <Search size={17} aria-hidden="true" />
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
          aria-required={required}
          autoComplete="off"
          placeholder={open ? 'Escribí para buscar…' : emptyLabel}
          value={open ? query : selected?.label || ''}
          onClick={() => {
            setOpen(true);
            setActive(-1);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={keydown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Mostrar opciones de ${label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              setOpen(true);
              setActive(-1);
              input.current?.focus();
            }
          }}
        >
          <ChevronDown size={18} />
        </button>
      </div>
      {open && (
        <div className="search-select-popup">
          <ul role="listbox" id={`${id}-list`} aria-label={label}>
            {visible.map((o, i) => (
              <li
                key={o.value}
                role="option"
                id={`${id}-option-${i}`}
                aria-selected={value === o.value}
                className={i === active ? 'is-highlighted' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {o.label}
                {value === o.value && <span aria-hidden="true"> ✓</span>}
              </li>
            ))}
          </ul>
          {!results.length && <p role="status">No encontramos coincidencias.</p>}
        </div>
      )}
    </div>
  );
}
