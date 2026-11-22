import { useState, Fragment } from 'react';
import { usePermissions } from '../../context/PermissionsContext';
import { money } from '../../utils/money';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Loader2, ChevronLeft, ChevronRight, Factory, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { productionApi, type MrpRow } from '../../api/production.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import SalesPageShell from '../sales/SalesPageShell';
import { DataPanel, EmptyState, ErrorState, HeaderActions, HeaderSlotContext, LoadingState, SectionHeader, Segmented, TableFooter, Toolbar } from '../../components/ds';
import MrpPhasedView from './MrpPhasedView';
import MasterScheduleView from './MasterScheduleView';
import { useAuth } from '../../context/AuthContext';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tomorrow = () => addDays(new Date().toISOString().slice(0, 10), 1);
const nf = (v: number) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dayLabel = (d: string) => format(new Date(`${d}T00:00:00`), 'EEE dd/MM', { locale: fr });
const dateInp: React.CSSProperties = { width: 170 };
const note: React.CSSProperties = { fontSize: 13, color: 'var(--ds-muted)', margin: 0 };

/**
 * Production › Plan directeur (MRP). Besoins nets pilotés par la demande.
 *   Jour : prévision + commandes − stock − déjà planifié, génération de plans,
 *          et besoins semi-finis (bases) nets du jour.
 *   Semaine : besoins nets par jour sur un horizon (lecture seule).
 */
export default function MrpPage() {
  const [mode, setMode] = useState<'day' | 'week' | 'phased' | 'mps'>('day');
  const { user } = useAuth();
  const canPlan = !!user && ['admin', 'manager'].includes(user.role);
  const [date, setDate] = useState(tomorrow());
  // Emplacement des actions de la vue (Générer les plans, Valider) à droite du fil d'Ariane.
  const [headerSlot, setHeaderSlot] = useState<HTMLSpanElement | null>(null);

  return (
    <SalesPageShell icon={ClipboardList} parent="Production › Opérations" title="Plan directeur"
      summary="Combien produire de chaque article : prévision et commandes fermes, moins le stock disponible et le déjà planifié."
      actions={<>
        <Segmented label="Vue" value={mode} onChange={setMode}
          options={[{ key: 'day', label: 'Jour' }, { key: 'week', label: 'Semaine' }, { key: 'phased', label: 'Besoins phasés' }, { key: 'mps', label: 'Plan par semaine' }]} />
        <span ref={setHeaderSlot} style={{ display: 'contents' }} />
      </>}>
      <HeaderSlotContext.Provider value={headerSlot}>

      {mode === 'day' ? <DayView date={date} setDate={setDate} /> : mode === 'week' ? <WeekView from={date} setFrom={setDate} />
        : mode === 'phased' ? <MrpPhasedView from={new Date().toLocaleDateString('sv-SE')} /> : <MasterScheduleView canEdit={canPlan} />}
      </HeaderSlotContext.Provider>
    </SalesPageShell>
  );
}

/* ─── Vue Jour : besoins nets + génération + semi-finis ────────────────── */
function DayView({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  // M8-06 : « vitrine » réservé à l'option du même nom (boulangerie).
  const showcase = usePermissions().hasFeature('vitrine');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['mrp', date], queryFn: () => productionApi.mrp(date) });
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
      <Toolbar>
        <button type="button" className="ds-icon-btn" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <input type="date" className="ds-input" aria-label="Jour à planifier" value={date} onChange={e => setDate(e.target.value)} style={dateInp} />
        <button type="button" className="ds-icon-btn" aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
        {date !== tomorrow() && <button type="button" className="odoo-btn-secondary" onClick={() => setDate(tomorrow())}>Demain</button>}
      </Toolbar>
      <HeaderActions>
        <button type="button" className="odoo-btn-primary" disabled={toProduce === 0 || generate.isPending} aria-busy={generate.isPending || undefined}
          onClick={async () => { if (await confirm(`Créer les plans de production du ${date} pour les ${toProduce} article(s) à produire ? Un plan par atelier, chaque article sur son format par défaut.`, { title: 'Générer les plans' })) generate.mutate(); }}>
          {generate.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Factory size={14} aria-hidden="true" />} Générer les plans
        </button>
      </HeaderActions>

      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} text={apiErrorMessage(error)} onRetry={() => refetch()} />
        : rows.length === 0 ? <EmptyState icon={ClipboardList} title="Rien à planifier" text="Aucune demande ni plan pour cette date." /> : (
      <DataPanel label="Besoins nets du jour" footer={<TableFooter note={`${rows.length} article(s) · ${toProduce} à produire`} />}>
        <table className="odoo-table">
          <thead><tr>
            <th>Article</th><th className="ds-num">Prévision</th><th className="ds-num">Commandes</th>
            <th className="ds-num">Demande</th><th className="ds-num">En stock</th>
            <th className="ds-num">Déjà planifié</th><th className="ds-num">À produire</th>
          </tr></thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.category}>
                <tr className="ds-group">
                  <td colSpan={7}>{g.category}<small>{g.rows.length} article(s)</small></td>
                </tr>
                {g.rows.map(r => (
                  <tr key={r.product_id}>
                    <td className="ds-strong">{r.product_name}</td>
                    <td className="ds-num">{nf(r.forecast_qty)}</td>
                    <td className="ds-num">{r.order_qty > 0 ? nf(r.order_qty) : '—'}</td>
                    <td className="ds-num ds-strong">{nf(r.demand)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{r.on_hand > 0 ? nf(r.on_hand) : '—'}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{r.planned_qty > 0 ? nf(r.planned_qty) : '—'}</td>
                    <td className="ds-num" style={{ fontWeight: 700, color: r.net_to_produce > 0 ? 'var(--ds-accent-ink)' : 'var(--ds-muted)' }}>{nf(r.net_to_produce)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr>
            <td>Total</td><td /><td /><td className="ds-num">{nf(data!.totals.demand)}</td>
            <td className="ds-num">{nf(data!.totals.on_hand)}</td><td className="ds-num">{nf(data!.totals.planned_qty)}</td>
            <td className="ds-num">{nf(data!.totals.net_to_produce)}</td>
          </tr></tfoot>
        </table>
      </DataPanel>
      )}

      {sfRows.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          <SectionHeader title="Bases et semi-finis à produire" />
          <DataPanel label="Bases et semi-finis à produire" footer={<TableFooter note={`${sfRows.length} base(s)`} />}>
            <table className="odoo-table">
              <thead><tr><th>Base</th><th className="ds-num">Besoin</th><th className="ds-num">En stock</th><th className="ds-num">À produire</th></tr></thead>
              <tbody>
                {sfRows.map(r => (
                  <tr key={r.recipe_id}>
                    <td className="ds-strong">{r.name}</td>
                    <td className="ds-num">{nf(r.needed)} {r.unit}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{r.from_stock > 0 ? `${nf(r.from_stock)} ${r.unit}` : '—'}</td>
                    <td className="ds-num" style={{ fontWeight: 700, color: r.to_produce > 0 ? 'var(--ds-accent-ink)' : 'var(--ds-muted)' }}>{r.to_produce > 0 ? `${nf(r.to_produce)} ${r.unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
          <p style={note}>Besoins en bases pour produire le net ci-dessus, défalqués du stock de semi-finis non périmé. Analyse — les plans de bases sont créés à la confirmation du plan fini.</p>
        </div>
      )}

      {matReq && matReq.totals.to_order > 0 && (() => {
        const short = matReq.rows.filter(r => r.shortage > 0);
        const covered = matReq.totals.ingredients - matReq.totals.to_order;
        return (
          <div style={{ display: 'grid', gap: 12 }}>
            <SectionHeader title="Besoins en matières à acheter" note={`${matReq.totals.to_order} à commander · environ ${money(matReq.totals.estimated_cost)}`}>
              <button type="button" className="odoo-btn-secondary" disabled={genPR.isPending} aria-busy={genPR.isPending || undefined}
                onClick={async () => { if (await confirm(`Créer ${matReq.totals.to_order} demande(s) d'achat pour les matières manquantes du ${date} ?`, { title: "Demandes d'achat" })) genPR.mutate(); }}>
                {genPR.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShoppingCart size={14} aria-hidden="true" />} Générer les demandes d'achat
              </button>
            </SectionHeader>
            <DataPanel label="Besoins en matières à acheter" footer={<TableFooter note={`${short.length} ingrédient(s) manquant(s)`} />}>
              <table className="odoo-table">
                <thead><tr><th>Ingrédient</th><th className="ds-num">Besoin</th><th className="ds-num">En stock</th><th className="ds-num">Seuil</th><th className="ds-num">À commander</th><th className="ds-num">Coût estimé</th></tr></thead>
                <tbody>
                  {short.map(r => (
                    <tr key={r.ingredient_id}>
                      <td className="ds-strong">{r.ingredient_name}</td>
                      <td className="ds-num">{nf(r.needed)} {r.unit}</td>
                      <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{nf(r.on_hand)} {r.unit}</td>
                      <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{r.seuil > 0 ? `${nf(r.seuil)} ${r.unit}` : '—'}</td>
                      <td className="ds-num" style={{ fontWeight: 700, color: 'var(--ds-danger)' }}>{nf(r.shortage)} {r.unit}</td>
                      <td className="ds-num">{money(r.estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
            <p style={note}>
              Matières nécessaires pour produire le net ci-dessus (explosion des recettes sur tous les niveaux), défalquées du stock.
              Manquant = besoin + seuil de sécurité − stock. {covered > 0 ? `${covered} ingrédient(s) couvert(s) par le stock.` : ''} La quantité commandée est arrondie au contenant.
            </p>
          </div>
        );
      })()}

      <p style={note}>
        Demande = prévision de vente (majorée) + commandes fermes dues ce jour. Stock = {showcase ? 'arrière-boutique + vitrine' : 'stock disponible'} (planché à 0). Déjà planifié = plans ouverts du jour, hors lignes produites.
      </p>
    </>
  );
}

/* ─── Vue Semaine : besoins nets par jour sur un horizon ───────────────── */
function WeekView({ from, setFrom }: { from: string; setFrom: (d: string) => void }) {
  const to = addDays(from, 6);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['mrp-horizon', from, to], queryFn: () => productionApi.mrpHorizon(from, to) });
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
      <Toolbar>
        <button type="button" className="ds-icon-btn" aria-label="Semaine précédente" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <input type="date" className="ds-input" aria-label="Premier jour de la semaine" value={from} onChange={e => setFrom(e.target.value)} style={dateInp} />
        <button type="button" className="ds-icon-btn" aria-label="Semaine suivante" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} aria-hidden="true" /></button>
        <span style={note}>Du {dayLabel(from)} au {dayLabel(to)}</span>
      </Toolbar>

      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} text={apiErrorMessage(error)} onRetry={() => refetch()} />
        : rows.length === 0 ? <EmptyState icon={ClipboardList} title="Rien à planifier" text="Aucune demande ni plan sur la semaine." /> : (
      <DataPanel label="Besoins nets de la semaine" footer={<TableFooter note={`${rows.length} article(s)`} />}>
        <table className="odoo-table">
          <thead><tr>
            <th>Article</th>
            {dates.map(d => <th key={d} className="ds-num">{dayLabel(d)}</th>)}
          </tr></thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.category}>
                <tr className="ds-group">
                  <td colSpan={dates.length + 1}>{g.category}<small>{g.rows.length} article(s)</small></td>
                </tr>
                {g.rows.map(r => (
                  <tr key={r.product_id}>
                    <td className="ds-strong">{r.product_name}</td>
                    {dates.map(d => {
                      const net = r.days[d]?.net ?? 0;
                      return <td key={d} className="ds-num" style={{ fontWeight: net > 0 ? 700 : 400, color: net > 0 ? 'var(--ds-accent-ink)' : 'var(--ds-muted)' }}>{net > 0 ? nf(net) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr>
            <td>Total à produire</td>
            {dates.map(d => <td key={d} className="ds-num">{nf(data!.totals_by_date[d] ?? 0)}</td>)}
          </tr></tfoot>
        </table>
      </DataPanel>
      )}

      <p style={note}>
        Net à produire par jour = demande du jour − déjà planifié. Le stock fini actuel est reporté de jour en jour (il couvre les premiers jours) ; la production n'est jamais reportée.
      </p>
    </>
  );
}
