import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Loader2, ChevronLeft, ChevronRight, Factory, Layers, Package, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { productionApi, type MrpRow } from '../../api/production.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tomorrow = () => addDays(new Date().toISOString().slice(0, 10), 1);
const nf = (v: number) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dayLabel = (d: string) => format(new Date(`${d}T00:00:00`), 'EEE dd/MM', { locale: fr });
const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };

/**
 * Production › Plan directeur (MRP). Besoins nets pilotés par la demande.
 *   Jour : prévision + commandes − stock − déjà planifié, génération de plans,
 *          et besoins semi-finis (bases) nets du jour.
 *   Semaine : besoins nets par jour sur un horizon (lecture seule).
 */
export default function MrpPage() {
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(tomorrow());

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={ClipboardList} title="Plan directeur de production">
        Combien produire de chaque article, net de ce qui est déjà en stock et déjà planifié.
        <strong> À produire = (prévision + commandes fermes) − stock disponible − déjà planifié.</strong>
      </StatusBanner>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className={mode === 'day' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode('day')}>Jour</button>
        <button className={mode === 'week' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode('week')}>Semaine</button>
      </div>

      {mode === 'day' ? <DayView date={date} setDate={setDate} /> : <WeekView from={date} setFrom={setDate} />}
    </div>
  );
}

/* ─── Vue Jour : besoins nets + génération + semi-finis ────────────────── */
function DayView({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['mrp', date], queryFn: () => productionApi.mrp(date) });
  const { data: sf } = useQuery({ queryKey: ['mrp-sf', date], queryFn: () => productionApi.mrpSemiFinished(date) });
  const { data: matReq } = useQuery({ queryKey: ['mrp-mat', date], queryFn: () => productionApi.mrpMaterialRequirements(date) });
  const genPR = useMutation({
    mutationFn: () => productionApi.mrpGeneratePurchaseRequests(date),
    onSuccess: (d) => {
      notify.success(d.created > 0
        ? `${d.created} demande(s) d'achat créée(s)${d.skipped_existing ? ` · ${d.skipped_existing} déjà en attente` : ''}`
        : 'Aucune nouvelle demande (déjà couvert ou déjà en attente)');
      qc.invalidateQueries({ queryKey: ['mrp-mat'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const generate = useMutation({
    mutationFn: () => productionApi.mrpGenerate(date),
    onSuccess: (r) => {
      if (r.nothingToProduce || r.plans.length === 0) { notify.success('Rien à produire : la demande est déjà couverte.'); return; }
      notify.success(`${r.plans.length} plan(s) créé(s) : ${r.plans.map(p => `${p.atelier_label} (${p.item_count})`).join(', ')}`);
      qc.invalidateQueries({ queryKey: ['mrp'] });
      qc.invalidateQueries({ queryKey: ['production-plans'] });
      if (r.plans.length === 1) navigate(`/production/${r.plans[0].plan_id}`); else navigate('/production');
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const rows = data?.rows ?? [];
  const groups: { category: string; rows: MrpRow[] }[] = [];
  for (const r of rows) {
    const cat = r.category_name || 'Sans catégorie';
    const g = groups.find(x => x.category === cat);
    if (g) g.rows.push(r); else groups.push({ category: cat, rows: [r] });
  }
  const toProduce = rows.filter(r => r.net_to_produce > 0).length;
  const sfRows = sf?.rows ?? [];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="odoo-btn-secondary" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={14} /></button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        <button type="button" className="odoo-btn-secondary" aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={14} /></button>
        {date !== tomorrow() && <button type="button" className="odoo-btn-secondary" onClick={() => setDate(tomorrow())}>Demain</button>}
        {!isLoading && !isError && <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{toProduce} article(s) à produire</span>}
        <button type="button" className="odoo-btn-primary" disabled={toProduce === 0 || generate.isPending}
          onClick={async () => { if (await confirm(`Créer les plans de production du ${date} pour les ${toProduce} article(s) à produire ? Un plan par atelier, chaque article sur son format par défaut.`, { title: 'Générer les plans' })) generate.mutate(); }}>
          {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Factory size={14} />} Générer les plans
        </button>
      </div>

      {isError && <StatusBanner tone="danger" icon={ClipboardList} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr>
            <th>Article</th><th style={{ textAlign: 'right' }}>Prévision</th><th style={{ textAlign: 'right' }}>Commandes</th>
            <th style={{ textAlign: 'right' }}>Demande</th><th style={{ textAlign: 'right' }}>En stock</th>
            <th style={{ textAlign: 'right' }}>Déjà planifié</th><th style={{ textAlign: 'right' }}>À produire</th>
          </tr></thead>
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
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
              <td>Total</td><td /><td /><td style={{ textAlign: 'right' }}>{nf(data!.totals.demand)}</td>
              <td style={{ textAlign: 'right' }}>{nf(data!.totals.on_hand)}</td><td style={{ textAlign: 'right' }}>{nf(data!.totals.planned_qty)}</td>
              <td style={{ textAlign: 'right' }}>{nf(data!.totals.net_to_produce)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>

      {sfRows.length > 0 && (
        <div>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-strong)', margin: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} /> Bases / semi-finis à produire
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Base</th><th style={{ textAlign: 'right' }}>Besoin</th><th style={{ textAlign: 'right' }}>En stock</th><th style={{ textAlign: 'right' }}>À produire</th></tr></thead>
              <tbody>
                {sfRows.map(r => (
                  <tr key={r.recipe_id}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(r.needed)} {r.unit}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.from_stock > 0 ? `${nf(r.from_stock)} ${r.unit}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.to_produce > 0 ? 'var(--theme-accent, #1a73e8)' : 'var(--theme-text-muted)' }}>{r.to_produce > 0 ? `${nf(r.to_produce)} ${r.unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Besoins en bases pour produire le net ci-dessus, défalqués du stock de semi-finis non périmé. Analyse — les plans de bases sont créés à la confirmation du plan fini.</p>
        </div>
      )}

      {matReq && matReq.totals.to_order > 0 && (() => {
        const short = matReq.rows.filter(r => r.shortage > 0);
        const covered = matReq.totals.ingredients - matReq.totals.to_order;
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0' }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-strong)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Package size={14} /> Besoins matière (achats)
              </h4>
              <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>
                {matReq.totals.to_order} à commander · ~{nf(matReq.totals.estimated_cost)} DH
              </span>
              <button type="button" className="odoo-btn-primary" style={{ marginLeft: 'auto' }} disabled={genPR.isPending}
                onClick={async () => { if (await confirm(`Créer ${matReq.totals.to_order} demande(s) d'achat pour les matières manquantes du ${date} ?`, { title: "Demandes d'achat" })) genPR.mutate(); }}>
                {genPR.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />} Générer les demandes d'achat
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr><th>Ingrédient</th><th style={{ textAlign: 'right' }}>Besoin</th><th style={{ textAlign: 'right' }}>En stock</th><th style={{ textAlign: 'right' }}>Seuil</th><th style={{ textAlign: 'right' }}>À commander</th><th style={{ textAlign: 'right' }}>Coût est.</th></tr></thead>
                <tbody>
                  {short.map(r => (
                    <tr key={r.ingredient_id}>
                      <td style={{ fontWeight: 500 }}>{r.ingredient_name}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(r.needed)} {r.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{nf(r.on_hand)} {r.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.seuil > 0 ? `${nf(r.seuil)} ${r.unit}` : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#c62828' }}>{nf(r.shortage)} {r.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(r.estimated_cost)} DH</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              Matières nécessaires pour produire le net ci-dessus (explosion des recettes sur tous les niveaux), défalquées du stock.
              Manquant = besoin + seuil de sécurité − stock. {covered > 0 ? `${covered} ingrédient(s) couvert(s) par le stock.` : ''} La quantité commandée est arrondie au contenant.
            </p>
          </div>
        );
      })()}

      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Demande = prévision de vente (majorée) + commandes fermes dues ce jour. Stock = arrière-boutique + vitrine (planché à 0). Déjà planifié = plans ouverts du jour, hors lignes produites.
      </p>
    </>
  );
}

/* ─── Vue Semaine : besoins nets par jour sur un horizon ───────────────── */
function WeekView({ from, setFrom }: { from: string; setFrom: (d: string) => void }) {
  const to = addDays(from, 6);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['mrp-horizon', from, to], queryFn: () => productionApi.mrpHorizon(from, to) });
  const dates = data?.dates ?? [];
  const rows = data?.rows ?? [];
  const groups: { category: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const cat = r.category_name || 'Sans catégorie';
    const g = groups.find(x => x.category === cat);
    if (g) g.rows.push(r); else groups.push({ category: cat, rows: [r] });
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="odoo-btn-secondary" aria-label="Semaine précédente" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={14} /></button>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        <button type="button" className="odoo-btn-secondary" aria-label="Semaine suivante" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={14} /></button>
        <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Du {dayLabel(from)} au {dayLabel(to)}</span>
      </div>

      {isError && <StatusBanner tone="danger" icon={ClipboardList} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr>
            <th>Article</th>
            {dates.map(d => <th key={d} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dayLabel(d)}</th>)}
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={dates.length + 1} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune demande ni plan sur la semaine.</td></tr>}
            {!isLoading && groups.map(g => (
              <Fragment key={g.category}>
                <tr style={{ background: 'var(--theme-bg-subtle, #f6f6f6)' }}>
                  <td colSpan={dates.length + 1} style={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--theme-text-muted)' }}>{g.category}</td>
                </tr>
                {g.rows.map(r => (
                  <tr key={r.product_id}>
                    <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                    {dates.map(d => {
                      const net = r.days[d]?.net ?? 0;
                      return <td key={d} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: net > 0 ? 700 : 400, color: net > 0 ? 'var(--theme-accent, #1a73e8)' : 'var(--theme-text-muted)' }}>{net > 0 ? nf(net) : '·'}</td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
              <td>Total à produire</td>
              {dates.map(d => <td key={d} style={{ textAlign: 'right' }}>{nf(data!.totals_by_date[d] ?? 0)}</td>)}
            </tr></tfoot>
          )}
        </table>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Net à produire par jour = demande du jour − déjà planifié. Le stock fini actuel est reporté de jour en jour (il couvre les premiers jours) ; la production n'est jamais reportée.
      </p>
    </>
  );
}
