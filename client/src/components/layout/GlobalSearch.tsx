import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Package, ShoppingBag, Users, Truck, X } from 'lucide-react';
import { searchApi, type SearchResult } from '../../api/search.api';

/**
 * Recherche globale de l'en-tête : interroge l'endpoint unifié et affiche les
 * résultats typés dans un menu. Clic (ou Entrée) ouvre la fiche / la liste.
 */

const ICONS: Record<SearchResult['type'], typeof Package> = {
  ingredient: Package, product: ShoppingBag, customer: Users, supplier: Truck,
};

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchApi.global(debounced),
    enabled: debounced.length >= 2,
  });

  useEffect(() => { setActive(0); }, [results]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const go = (r: SearchResult) => {
    navigate(r.href);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) go(r); }
  };

  const showMenu = open && debounced.length >= 2;

  return (
    <div ref={boxRef} className="relative hidden sm:block" style={{ width: 'min(420px, 38vw)' }}>
      <div className="flex items-center gap-2 px-2.5 h-8 rounded-md"
        style={{ background: 'rgba(255,255,255,0.18)', color: 'var(--theme-cta-text)' }}>
        <Search size={15} className="opacity-80 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher un article, produit, client…"
          className="bg-transparent outline-none border-none flex-1 text-sm min-w-0"
          style={{ color: 'inherit' }}
          aria-label="Recherche globale"
        />
        {q && <button type="button" onClick={() => { setQ(''); inputRef.current?.focus(); }} className="opacity-70 hover:opacity-100 shrink-0"><X size={14} /></button>}
      </div>

      {showMenu && (
        <div className="absolute left-0 top-full mt-1 w-full bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-gray-800 z-50 max-h-[70vh] overflow-y-auto">
          {isFetching && results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Recherche…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">Aucun résultat pour « {debounced} ».</div>
          ) : (
            results.map((r, i) => {
              const Icon = ICONS[r.type] || Search;
              return (
                <button
                  key={r.type + r.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 ${i === active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <span className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-gray-500 shrink-0"><Icon size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{r.label}</span>
                    {r.sublabel && <span className="block text-xs text-gray-400 truncate">{r.sublabel}</span>}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{r.typeLabel}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
