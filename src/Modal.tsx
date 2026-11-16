import { useEffect, useRef, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({
  title,
  onClose,
  children,
  busy = false,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = () => {
    if (!busy) onClose();
  };
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">MI ÁRBOL FAMILIAR</span>
            <h2 id={headingId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Cerrar ventana"
            disabled={busy}
            onClick={() => close.current()}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
