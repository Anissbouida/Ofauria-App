import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Loader2, ChevronLeft, ChevronRight, Factory } from 'lucide-react';
import { productionApi, type MrpRow } from '../../api/production.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tomorrow = () => addDays(new Date().toISOString().slice(0, 10), 1);
const nf = (v: number) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };

/**
 * Production › Plan directeur (MRP, lot 1). Besoins nets du jour, pilotés par la
 * demande : prévision de vente + commandes fermes, défalqués du stock fini et des
 * plans déjà ouverts. Lecture seule — la génération du plan viendra au lot 2.
 */
export default function MrpPage() {
  const [date, setDate] = useState(tomorrow());
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mrp', date],
    queryFn: () => productionApi.mrp(date),
  });

  const generate = useMutation({
    mutationFn: () => productionApi.mrpGenerate(date),
    onSuccess: (r) => {
      if (r.nothingToProduce || r.plans.length === 0) { notify.success('Rien à produire : la demande est déjà couverte.'); return; }
      notify.success(`${r.plans.length} plan(s) créé(s) : ${r.plans.map(p => `${p.atelier_label} (${p.item_count})`).join(', ')}`);
      qc.invalidateQueries({ queryKey: ['mrp'] });
      qc.invalidateQueries({ queryKey: ['production-plans'] });
      if (r.plans.length === 1) navigate(`/production/${r.plans[0].plan_id}`);
      else navigate('/production');
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const rows = data?.rows ?? [];
  // Regroupement par catégorie pour la lecture.
  const groups: { category: string; rows: MrpRow[] }[] = [];
  for (const r of rows) {
    const cat = r.category_name || 'Sans catégorie';
    const g = groups.find(x => x.category === cat);
    if (g) g.rows.push(r); else groups.push({ category: cat, rows: [r] });
  }
  const toProduce = rows.filter(r => r.net_to_produce > 0).length;

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={ClipboardList} title="Plan directeur de production">
        Pour la date choisie : combien produire de chaque article, net de ce qui est déjà en stock et déjà planifié.
        <strong> À produire = (prévision + commandes fermes) − stock disponible − déjà planifié.</strong> Une base de décision — rien n'est modifié ici.
      </StatusBanner>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="odoo-btn-secondary" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={14} /></button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        <button type="button" className="odoo-btn-secondary" aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={14} /></button>
        {date !== tomorrow() && <button type="button" className="odoo-btn-secondary" onClick={() => setDate(tomorrow())}>Demain</button>}
        {!isLoading && !isError && <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{toProduce} article(s) à produire</span>}
        <button
          type="button"
          className="odoo-btn-primary"
          disabled={toProduce === 0 || generate.isPending}
          onClick={async () => {
            if (await confirm(`Créer les plans de production du ${date} pour les ${toProduce} article(s) à produire ? Un plan par atelier, chaque article sur son format par défaut.`, { title: 'Générer les plans' }))
              generate.mutate();
          }}>
          {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Factory size={14} />} Générer les plans
        </button>
      </div>

      {isError && <StatusBanner tone="danger" icon={ClipboardList} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Article</th>
              <th style={{ textAlign: 'right' }}>Prévision</th>
              <th style={{ textAlign: 'right' }}>Commandes</th>
              <th style={{ textAlign: 'right' }}>Demande</th>
              <th style={{ textAlign: 'right' }}>En stock</th>
              <th style={{ textAlign: 'right' }}>Déjà planifié</th>
              <th style={{ textAlign: 'right' }}>À produire</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune demande ni plan pour cette date.</td></tr>}
            {!isLoading && groups.map(g => (
              <Fragment key={g.category}>
                <tr style={{ background: 'var(--theme-bg-subtle, #f6f6f6)' }}>
                  <td colSpan={7} style={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--theme-text-muted)' }}>{g.category}</td>
                </tr>
                {g.rows.map(r => (
                  <tr key={r.product_id}>
                    <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(r.forecast_qty)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.order_qty > 0 ? nf(r.order_qty) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{nf(r.demand)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.on_hand > 0 ? nf(r.on_hand) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.planned_qty > 0 ? nf(r.planned_qty) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.net_to_produce > 0 ? 'var(--theme-accent, #1a73e8)' : 'var(--theme-text-muted)' }}>{nf(r.net_to_produce)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
                <td>Total</td>
                <td />
                <td />
                <td style={{ textAlign: 'right' }}>{nf(data!.totals.demand)}</td>
                <td style={{ textAlign: 'right' }}>{nf(data!.totals.on_hand)}</td>
                <td style={{ textAlign: 'right' }}>{nf(data!.totals.planned_qty)}</td>
                <td style={{ textAlign: 'right' }}>{nf(data!.totals.net_to_produce)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Demande = prévision de vente (majorée) + commandes fermes dues ce jour. Stock = arrière-boutique + vitrine (planché à 0). Déjà planifié = plans ouverts du jour, hors lignes produites.
      </p>
    </div>
  );
}
