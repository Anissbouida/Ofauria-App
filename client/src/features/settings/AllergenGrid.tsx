import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert, Check } from 'lucide-react';
import { ingredientsApi, type AllergenGridRow } from '../../api/inventory.api';
import { ALLERGENS } from '../../constants/allergens';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Allergènes des ingrédients, en grille (G2-06) : une ligne par ingrédient, une colonne par
 * allergène à déclaration obligatoire. Un clic sur une case la fait passer de « absent » à
 * « contient », puis « traces », puis « absent ». Une fiche non renseignée arrive avec une
 * proposition tirée de sa catégorie et de son nom : elle n'est enregistrée que lorsque la
 * ligne est validée. Valider une ligne sans aucune case cochée déclare « aucun allergène ».
 */

type CellState = 'absent' | 'contains' | 'traces';
type Draft = Record<string, CellState>;
const NEXT: Record<CellState, CellState> = { absent: 'contains', contains: 'traces', traces: 'absent' };
const CELL: Record<CellState, { text: string; title: string; style: React.CSSProperties }> = {
  absent: { text: '', title: 'Absent', style: { background: 'transparent', color: 'var(--theme-text-muted)' } },
  contains: { text: 'C', title: 'Contient', style: { background: '#c62828', color: '#fff', fontWeight: 700 } },
  traces: { text: 'T', title: 'Traces', style: { background: '#fde68a', color: '#78350f', fontWeight: 700 } },
};
const PAGE = 40;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** État de départ d'une ligne : ce qui est enregistré, sinon la proposition. */
const initial = (r: AllergenGridRow): Draft => {
  const d: Draft = {};
  for (const c of r.contains) d[c] = 'contains';
  for (const c of r.traces) d[c] = 'traces';
  if (!r.reviewed) for (const c of r.proposal) d[c] = 'contains';
  return d;
};

export default function AllergenGrid() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['allergen-grid'], queryFn: () => ingredientsApi.allergenGrid() });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());

  const save = useMutation({
    mutationFn: (v: { id: string; draft: Draft }) => ingredientsApi.saveAllergens(v.id, {
      contains: Object.entries(v.draft).filter(([, s]) => s === 'contains').map(([c]) => c),
      traces: Object.entries(v.draft).filter(([, s]) => s === 'traces').map(([c]) => c),
    }),
    onSuccess: (row, v) => {
      qc.setQueryData<AllergenGridRow[]>(['allergen-grid'], old => (old ?? []).map(r => (r.id === v.id ? row : r)));
      setDrafts(d => { const { [v.id]: _done, ...rest } = d; return rest; });
      setJustSaved(s => new Set(s).add(v.id));
      qc.invalidateQueries({ queryKey: ['data-quality'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const missing = rows.filter(r => !r.reviewed).length;
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return rows.filter(r => (!onlyMissing || !r.reviewed || justSaved.has(r.id) || drafts[r.id])
      && (!q || norm(r.name).includes(q) || norm(r.category ?? '').includes(q)));
  }, [rows, onlyMissing, search, justSaved, drafts]);
  const shown = filtered.slice(0, limit);

  const draftOf = (r: AllergenGridRow) => drafts[r.id] ?? initial(r);
  const toggle = (r: AllergenGridRow, code: string) => {
    const d = draftOf(r);
    setDrafts(x => ({ ...x, [r.id]: { ...d, [code]: NEXT[d[code] ?? 'absent'] } }));
    setJustSaved(s => { const n = new Set(s); n.delete(r.id); return n; });
  };

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone={missing === 0 ? 'success' : 'info'} icon={ShieldAlert} title="Allergènes des ingrédients">
        {missing === 0
          ? `Les ${rows.length} ingrédients sont renseignés.`
          : `${missing} ingrédient${missing > 1 ? 's' : ''} sur ${rows.length} ${missing > 1 ? 'ne sont pas renseignés' : 'n\'est pas renseigné'}. Cliquez sur une case : C = contient, T = traces, vide = absent. Les cases déjà cochées d'une fiche non renseignée sont une proposition ; rien n'est enregistré avant « Valider ».`}
      </StatusBanner>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={onlyMissing} onChange={e => { setOnlyMissing(e.target.checked); setLimit(PAGE); }} />
          N'afficher que les fiches non renseignées
        </label>
        <input className="odoo-input" type="search" placeholder="Filtrer par nom ou catégorie" aria-label="Filtrer les ingrédients"
          style={{ width: 260 }} value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE); }} />
        <span style={{ color: 'var(--theme-text-muted)' }}>{filtered.length} fiche{filtered.length > 1 ? 's' : ''}</span>
      </div>

      {shown.length === 0 && <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}>Aucune fiche à afficher.</div>}

      {shown.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', overflowX: 'auto' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left', minWidth: 200, position: 'sticky', left: 0, background: 'var(--odoo-bg)', zIndex: 1 }}>Ingrédient</th>
              {ALLERGENS.map(a => (
                <th key={a.code} title={a.label} style={{ textAlign: 'center', fontSize: '0.68rem', padding: '6px 2px', minWidth: 46, whiteSpace: 'normal', lineHeight: 1.1 }}>{a.short}</th>
              ))}
              <th style={{ textAlign: 'left' }}>État</th>
              <th />
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const d = draftOf(r);
                const dirty = Boolean(drafts[r.id]);
                const proposed = !r.reviewed && !dirty && r.proposal.length > 0;
                return (
                  <tr key={r.id}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--odoo-bg)', zIndex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)' }}>
                        {r.category ?? 'Sans catégorie'}{r.usedInRecipes > 0 ? ` · ${r.usedInRecipes} fiche${r.usedInRecipes > 1 ? 's' : ''}` : ''}
                      </div>
                    </td>
                    {ALLERGENS.map(a => {
                      const state = d[a.code] ?? 'absent';
                      const cell = CELL[state];
                      return (
                        <td key={a.code} style={{ textAlign: 'center', padding: 2 }}>
                          <button type="button" onClick={() => toggle(r, a.code)} aria-label={`${r.name}, ${a.short} : ${cell.title}`} title={`${a.short} : ${cell.title}`}
                            style={{ width: 28, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem',
                              border: `1px ${proposed && state !== 'absent' ? 'dashed' : 'solid'} var(--odoo-border)`, ...cell.style }}>
                            {cell.text}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {save.isPending && save.variables?.id === r.id ? <Loader2 size={14} className="animate-spin" />
                        : justSaved.has(r.id) ? <StatusTag tone="done" label="Enregistré" icon={Check} />
                        : dirty ? <StatusTag tone="progress" label="À valider" />
                        : !r.reviewed ? <StatusTag tone="todo" label={proposed ? 'Proposition' : 'Non renseigné'} />
                        : <StatusTag tone="done" label={r.contains.length + r.traces.length === 0 ? 'Aucun allergène' : 'Renseigné'}
                            title={r.reviewedAt ? `Vérifié le ${new Date(r.reviewedAt).toLocaleDateString('fr-FR')}${r.reviewedByName ? ` par ${r.reviewedByName}` : ''}` : undefined} />}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {(dirty || !r.reviewed) && (
                        <button type="button" className={dirty || proposed ? 'odoo-btn-primary' : 'odoo-btn-secondary'} disabled={save.isPending}
                          title={Object.values(d).every(s => s === 'absent') ? 'Déclare que cet ingrédient ne contient aucun allergène' : 'Enregistre cette ligne'}
                          onClick={() => save.mutate({ id: r.id, draft: d })}>
                          {Object.values(d).every(s => s === 'absent') ? 'Aucun allergène' : 'Valider'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > shown.length && (
        <div>
          <button type="button" className="odoo-btn-secondary" onClick={() => setLimit(l => l + PAGE)}>
            Afficher {Math.min(PAGE, filtered.length - shown.length)} fiches de plus
          </button>
        </div>
      )}
    </div>
  );
}
