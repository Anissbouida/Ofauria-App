import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, X, Tag } from 'lucide-react';
import { ingredientsApi, type PriceSuspect } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatusBanner tone={suspects.length > 0 ? 'warning' : 'info'} icon={Tag} title="Prix à revoir">
        Ingrédients sans prix, ou dont le prix est plus de cinq fois au-dessus ou au-dessous de la médiane de leur catégorie.
        La correction proposée est le prix moyen des trois dernières réceptions ; elle est enregistrée avec son motif.
      </StatusBanner>

      {isLoading && <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}
      {!isLoading && suspects.length === 0 && <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}>Aucun prix à revoir.</div>}

      {suspects.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflowX: 'auto' }}>
          <table className="odoo-table" style={{ margin: 0, width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Ingrédient</th>
              <th style={{ textAlign: 'left' }}>Constat</th>
              <th style={{ textAlign: 'right' }}>Prix actuel</th>
              <th style={{ textAlign: 'right' }}>Médiane de la catégorie</th>
              <th style={{ textAlign: 'left' }}>Dernières réceptions</th>
              <th style={{ textAlign: 'right' }}>Proposition</th>
              <th />
            </tr></thead>
            <tbody>
              {suspects.map(s => {
                const isEditing = editing?.id === s.ingredientId;
                return (
                  <tr key={s.ingredientId} style={{ verticalAlign: 'top' }}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>
                        {s.category ?? 'Sans catégorie'}{s.usedInRecipes > 0 ? ` · ${s.usedInRecipes} fiche${s.usedInRecipes > 1 ? 's' : ''} technique${s.usedInRecipes > 1 ? 's' : ''}` : ''}
                      </div>
                    </td>
                    <td><StatusTag tone={s.reason === 'sans_prix' ? 'todo' : 'late'} label={s.reason === 'sans_prix' ? 'Sans prix' : 'Prix aberrant'} /></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{price(s.unitCost)} DH / {s.unit}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{s.median !== null ? `${price(Math.round(s.median * 100) / 100)} DH / ${s.unit}` : '—'}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {s.receptions.length === 0 && <span style={{ color: 'var(--theme-text-muted)' }}>Aucune réception</span>}
                      {s.receptions.map((r, n) => (
                        <div key={n} style={{ fontVariantNumeric: 'tabular-nums' }}>{shortDate(r.date)} · {price(r.quantity)} {s.unit} à {price(r.unitPrice)} DH</div>
                      ))}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {isEditing ? (
                        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                            <input className="odoo-input" type="number" step="any" min="0" aria-label="Nouveau coût" style={{ width: 110, textAlign: 'right' }}
                              value={editing!.cost} onChange={e => setEditing(ed => ed && { ...ed, cost: e.target.value })} />
                            <span style={{ color: 'var(--theme-text-muted)' }}>DH / {s.unit}</span>
                          </label>
                          <input className="odoo-input" type="text" aria-label="Motif de la correction" placeholder="Motif de la correction" style={{ width: 240, fontWeight: 400 }}
                            value={editing!.reason} onChange={e => setEditing(ed => ed && { ...ed, reason: e.target.value })} />
                        </div>
                      ) : s.proposal !== null ? `${price(s.proposal)} DH / ${s.unit}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="odoo-btn-primary" disabled={save.isPending || !editing!.cost || editing!.reason.trim().length < 5} onClick={() => save.mutate()}>
                            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
                          </button>
                          <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(null)}><X size={13} /> Annuler</button>
                        </span>
                      ) : (
                        <button type="button" className="odoo-btn-secondary" onClick={() => start(s)}>Corriger</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-muted)', margin: '4px 0' }}>Dernières corrections</h4>
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflowX: 'auto' }}>
            <table className="odoo-table" style={{ margin: 0, width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Date</th><th style={{ textAlign: 'left' }}>Ingrédient</th><th style={{ textAlign: 'right' }}>Avant</th><th style={{ textAlign: 'right' }}>Après</th><th style={{ textAlign: 'left' }}>Motif</th><th style={{ textAlign: 'left' }}>Par</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.id}>
                    <td>{new Date(h.corrected_at).toLocaleDateString('fr-FR')}</td>
                    <td>{h.ingredient_name}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{price(h.old_cost)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{price(h.new_cost)} DH / {h.unit}</td>
                    <td>{h.reason}</td>
                    <td>{h.corrected_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
