import { useEffect, useMemo, useRef, useState } from 'react';
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
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function SearchSelect({ options, value, onChange, placeholder, width = 220 }: SearchSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
      <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--odoo-text-muted)', pointerEvents: 'none' }} />
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected?.label || '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '0.25rem 1.625rem 0.25rem 1.625rem',
          borderRadius: 3,
          border: '1px solid var(--odoo-border)',
          backgroundColor: 'var(--odoo-bg)',
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: selected && !open ? 'var(--odoo-text)' : 'var(--odoo-text-muted)',
          outline: 'none',
        }}
      />
      {selected && !open && (
        <button
          onClick={() => { onChange(''); setQuery(''); }}
          title="Effacer"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--odoo-text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 2 }}>
          <X size={12} />
        </button>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30,
          minWidth: '100%', width: 'max-content', maxWidth: 340,
          backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
          borderRadius: 4, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          {filtered.length === 0 && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', padding: '0.5rem 0.75rem', margin: 0 }}>Aucun résultat</p>
          )}
          {filtered.map((o, i) => (
            <button
              key={o.id}
              onMouseDown={e => { e.preventDefault(); pick(o.id); }}
              onMouseEnter={() => setHighlighted(i)}
              className="w-full text-left text-sm flex items-center justify-between gap-3"
              style={{
                padding: '0.5rem 0.75rem',
                backgroundColor: i === highlighted ? 'var(--odoo-bg-hover)' : (o.id === value ? 'var(--odoo-bg-alt)' : 'transparent'),
                cursor: 'pointer', border: 'none',
              }}>
              <span style={{ minWidth: 0 }}>
                <span className="font-medium" style={{ color: 'var(--odoo-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </span>
                {o.sublabel && (
                  <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{o.sublabel}</span>
                )}
              </span>
              {o.detail && (
                <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', flexShrink: 0 }}>{o.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
