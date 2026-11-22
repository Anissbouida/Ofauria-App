import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, X, Tag } from 'lucide-react';
import { ingredientsApi, type PriceSuspect } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';
import '../sales/ListTemplate';
import { SectionTitle } from './StockUi';
import { DataPanel, EmptyState, LoadingState, TableFooter } from '../../components/ds';

/**
 * Prix à revoir (G2-04) : ingrédients sans prix, ou dont le prix s'écarte fortement de la
 * médiane de leur catégorie. Chaque ligne montre les trois dernières réceptions et propose
 * leur prix moyen. La correction demande un motif : coût avant, coût après, motif et
 * réceptions à l'appui sont gardés. Le coût catalogue sert au coût des fiches techniques ;
 * la valeur du stock vient des lots et n'est pas touchée.
 */

const price = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

export default function PriceCorrectionsCard() {
  const qc = useQueryClient();
  const { data: suspects = [], isLoading } = useQuery({ queryKey: ['cost-suspects'], queryFn: ingredientsApi.costSuspects });
  const { data: history = [] } = useQuery({ queryKey: ['cost-corrections'], queryFn: ingredientsApi.costCorrections });
  const [editing, setEditing] = useState<{ id: string; cost: string; reason: string } | null>(null);

  const save = useMutation({
    mutationFn: () => ingredientsApi.correctCost(editing!.id, Number(editing!.cost.replace(',', '.')), editing!.reason),
    onSuccess: () => {
      notify.success('Coût corrigé');
      setEditing(null);
      for (const key of ['cost-suspects', 'cost-corrections', 'price-health', 'data-quality', 'ingredients']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const start = (s: PriceSuspect) => setEditing({
    id: s.ingredientId,
    cost: s.proposal !== null ? String(s.proposal) : '',
    reason: s.proposal !== null ? `Aligné sur les ${s.receptions.length} dernière${s.receptions.length > 1 ? 's' : ''} réception${s.receptions.length > 1 ? 's' : ''}` : '',
  });

  return (
    <div className="stk-stack">
      <StatusBanner tone={suspects.length > 0 ? 'warning' : 'info'} icon={Tag} title="Prix à revoir">
        Ingrédients sans prix, ou dont le prix est plus de cinq fois au-dessus ou au-dessous de la médiane de leur catégorie.
        La correction proposée est le prix moyen des trois dernières réceptions ; elle est enregistrée avec son motif.
      </StatusBanner>

      {isLoading && <LoadingState label="Recherche des prix à revoir…" />}
      {!isLoading && suspects.length === 0 && <EmptyState icon={Tag} title="Aucun prix à revoir" text="Chaque ingrédient a un prix cohérent avec sa catégorie." />}

      {suspects.length > 0 && (
        <DataPanel label="Prix à revoir" footer={<TableFooter note={`${suspects.length} prix à revoir`} />}>
          <table className="odoo-table">
            <thead><tr>
              <th>Ingrédient</th>
              <th>Constat</th>
              <th className="ds-num">Prix actuel</th>
              <th className="ds-num">Médiane de la catégorie</th>
              <th>Dernières réceptions</th>
              <th className="ds-num">Proposition</th>
              <th className="ds-actions">Action</th>
            </tr></thead>
            <tbody>
              {suspects.map(s => {
                const isEditing = editing?.id === s.ingredientId;
                return (
                  <tr key={s.ingredientId} style={{ verticalAlign: 'top' }}>
                    <td>
                      <div className="ds-strong">{s.name}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>
                        {s.category ?? 'Sans catégorie'}{s.usedInRecipes > 0 ? ` · ${s.usedInRecipes} fiche${s.usedInRecipes > 1 ? 's' : ''} technique${s.usedInRecipes > 1 ? 's' : ''}` : ''}
                      </div>
                    </td>
                    <td><StatusTag tone={s.reason === 'sans_prix' ? 'todo' : 'late'} label={s.reason === 'sans_prix' ? 'Sans prix' : 'Prix aberrant'} /></td>
                    <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{price(s.unitCost)} {currencySymbol()} / {s.unit}</td>
                    <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{s.median !== null ? `${price(Math.round(s.median * 100) / 100)} ${currencySymbol()} / ${s.unit}` : '—'}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {s.receptions.length === 0 && <span style={{ color: 'var(--theme-text-muted)' }}>Aucune réception</span>}
                      {s.receptions.map((r, n) => (
                        <div key={n} style={{ fontVariantNumeric: 'tabular-nums' }}>{shortDate(r.date)} · {price(r.quantity)} {s.unit} à {price(r.unitPrice)} {currencySymbol()}</div>
                      ))}
                    </td>
                    <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {isEditing ? (
                        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                            <input className="ds-input sm ds-num" type="number" step="any" min="0" aria-label="Nouveau coût" style={{ width: 110 }}
                              value={editing!.cost} onChange={e => setEditing(ed => ed && { ...ed, cost: e.target.value })} />
                            <span style={{ color: 'var(--theme-text-muted)' }}>{currencySymbol()} / {s.unit}</span>
                          </label>
                          <input className="ds-input sm" type="text" aria-label="Motif de la correction" placeholder="Motif de la correction (5 caractères au moins)" style={{ width: 260, fontWeight: 400 }}
                            value={editing!.reason} onChange={e => setEditing(ed => ed && { ...ed, reason: e.target.value })} />
                        </div>
                      ) : s.proposal !== null ? `${price(s.proposal)} ${currencySymbol()} / ${s.unit}` : '—'}
                    </td>
                    <td className="ds-actions">
                      {isEditing ? (
                        <>
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={save.isPending} onClick={() => setEditing(null)}><X size={13} aria-hidden="true" /> Annuler</button>
                          <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={save.isPending || !editing!.cost || editing!.reason.trim().length < 5} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
                            {save.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />} Enregistrer
                          </button>
                        </>
                      ) : (
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => start(s)}>Corriger</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {history.length > 0 && (
        <div className="stk-stack">
          <SectionTitle>Dernières corrections</SectionTitle>
          <DataPanel label="Dernières corrections" footer={<TableFooter note={`${Math.min(history.length, 10)} dernière${Math.min(history.length, 10) > 1 ? 's' : ''} correction${Math.min(history.length, 10) > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>Date</th><th>Ingrédient</th><th className="ds-num">Avant</th><th className="ds-num">Après</th><th>Motif</th><th>Par</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.id}>
                    <td>{new Date(h.corrected_at).toLocaleDateString('fr-FR')}</td>
                    <td className="ds-strong">{h.ingredient_name}</td>
                    <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{price(h.old_cost)}</td>
                    <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{price(h.new_cost)} {currencySymbol()} / {h.unit}</td>
                    <td>{h.reason}</td>
                    <td>{h.corrected_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </div>
      )}
    </div>
  );
}
