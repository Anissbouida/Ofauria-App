import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';

/*
 * SearchSelect — champ de saisie intelligent remplaçant un <select> long.
 * Même ergonomie que la recherche d'articles du bon de commande : on tape,
 * la liste se filtre (insensible aux accents), on clique ou Entrée pour choisir.
 * Navigation clavier : ↑/↓ pour surligner, Entrée pour sélectionner, Échap pour fermer.
 */

export interface SearchSelectOption {
  id: string;
  label: string;      // ligne principale (ex. nom du fournisseur)
  sublabel?: string;  // ligne secondaire grisée (optionnelle)
  detail?: string;    // info alignée à droite (ex. « 5 factures »)
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;                  // id sélectionné ('' = aucun)
  onChange: (id: string) => void;
  placeholder: string;            // ex. « Tous les fournisseurs »
  width?: number | string;
  /** 'md' : même hauteur que les champs de formulaire (filtres compacts par défaut). */
  size?: 'sm' | 'md';
  /** Libellé accessible quand aucun <label> visible n'est associé. */
  ariaLabel?: string;
  /** Identifiant du champ de saisie, pour le relier à son libellé (FormField htmlFor). */
  id?: string;
  /** Désactive la saisie (champ de formulaire grisé, non ouvrable). */
  disabled?: boolean;
  /** Masque la croix d'effacement (utile quand une valeur est obligatoire). */
  clearable?: boolean;
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function SearchSelect({ options, value, onChange, placeholder, width = 220, size = 'sm', ariaLabel, id, disabled = false, clearable = true }: SearchSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Liste posée hors du flux (portail, position fixe) : une carte à débordement masqué
  // (ds-panel, fenêtre défilante) ne la coupe plus. Elle s'ouvre vers le haut s'il manque
  // de place en dessous, et suit le champ au défilement.
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const update = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 260 && r.top > below;
      setPlace({
        position: 'fixed', left: r.left, minWidth: r.width,
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        maxHeight: Math.max(120, Math.min(240, (up ? r.top : below) - 12)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [open]);

  const selected = options.find(o => o.id === value) || null;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = normalize(query);
    return options.filter(o => normalize(o.label).includes(q) || (o.sublabel && normalize(o.sublabel).includes(q)));
  }, [options, query]);

  // Fermeture au clic hors du composant
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => { setHighlighted(0); }, [query, open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) pick(filtered[highlighted].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--ds-muted)', pointerEvents: 'none' }} />
      <input
        id={id}
        ref={inputRef}
        type="text"
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        readOnly={disabled}
        value={open ? query : (selected?.label || '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onChange={e => { if (disabled) return; setQuery(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={handleKeyDown}
        style={{
          // Hauteurs du Design System : 40 px (champ de formulaire), 36 px (barre d'outils, filtre).
          width: '100%', height: size === 'md' ? 40 : 36,
          padding: size === 'md' ? '0 1.75rem' : '0 1.625rem',
          borderRadius: size === 'md' ? 'var(--ds-r-field)' : 6,
          border: '1px solid var(--ds-line)',
          backgroundColor: disabled ? 'var(--ds-hair)' : 'var(--ds-card)',
          fontSize: size === 'md' ? 14 : 13,
          fontWeight: 400,
          color: selected && !open ? 'var(--ds-ink)' : 'var(--ds-muted)',
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
      {selected && !open && !disabled && clearable && (
        <button
          type="button"
          onClick={() => { onChange(''); setQuery(''); }}
          title="Effacer"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--ds-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 2 }}>
          <X size={12} />
        </button>
      )}
      {open && place && createPortal(
        <div ref={listRef} role="listbox" aria-label={ariaLabel ?? placeholder} style={{
          ...place, zIndex: 1000,
          width: 'max-content', maxWidth: 340,
          backgroundColor: 'var(--ds-card)', border: '1px solid var(--ds-line)',
          borderRadius: 8, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
        }}>
          {filtered.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--ds-muted)', padding: '0.5rem 0.75rem', margin: 0 }}>Aucun résultat</p>
          )}
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.id}
              onMouseDown={e => { e.preventDefault(); pick(o.id); }}
              role="option"
              aria-selected={o.id === value}
              onMouseEnter={() => setHighlighted(i)}
              className="w-full text-left text-sm flex items-center justify-between gap-3"
              style={{
                padding: '0.5rem 0.75rem',
                backgroundColor: i === highlighted ? 'var(--ds-hair)' : (o.id === value ? 'var(--ds-bg)' : 'transparent'),
                cursor: 'pointer', border: 'none',
              }}>
              <span style={{ minWidth: 0 }}>
                <span className="font-medium" style={{ color: 'var(--ds-ink)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </span>
                {o.sublabel && (
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--ds-muted)' }}>{o.sublabel}</span>
                )}
              </span>
              {o.detail && (
                <span style={{ fontSize: '12px', color: 'var(--ds-muted)', flexShrink: 0 }}>{o.detail}</span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
