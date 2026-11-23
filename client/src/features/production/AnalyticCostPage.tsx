/**
 * Analyse des coûts (mig 655) — comptabilité analytique du coût de revient.
 *
 * Onglets : Période (absorption des charges, sous-activité, contrôle d'équilibre),
 * Centres (inducteurs, capacités, cessions), Charges (fixes / variables × directes /
 * indirectes, prévu et réel), Personnel (coût employeur par centre), Clés (% par centre).
 */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus, RefreshCw, Pencil, Power, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Trash2, Lock, Unlock, Printer } from 'lucide-react';
import SalesPageShell from '../sales/SalesPageShell';
import { Alert, DataPanel, EmptyState, ErrorState, FormField, FormFooter, FormSection, KpiCard, KpiGrid, LoadingState, Modal, Tabs, Toolbar } from '../../components/ds';
import SearchSelect from '../../components/ui/SearchSelect';
import { Segmented } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { money } from '../../utils/money';
import { productsApi } from '../../api/products.api';
import { useActionPermissions } from '../../hooks/useActionPermissions';
import {
  analyticCostApi, type AnalyticMeta, type Behavior, type Centre, type CentreModel, type Charge, type ChargeInput,
  type Driver, type EmployeeCost, type Level, type PeriodReport, type Reconciliation, type Profitability, type Equipment, type ToolInput,
} from '../../api/analytic-cost.api';

type TabKey = 'periode' | 'rentabilite' | 'centres' | 'charges' | 'equipements' | 'personnel' | 'cles';

const LEVEL_LABEL: Record<Level, string> = {
  approvisionnement: 'Approvisionnement', production: 'Production', administration: 'Administration', distribution: 'Distribution',
};
const BEHAVIOR_LABEL: Record<Behavior, string> = { fixed: 'Fixe', variable: 'Variable', semi_variable: 'Semi-variable' };
const CAP_SOURCE: Record<string, string> = {
  configured: 'saisie', history: 'moyenne 3 mois', projection: 'projection du mois', none: 'inconnue',
};
const num = (n: number | null | undefined, d = 0) => (n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const sum = (f: { fixed: number; variable: number }) => f.fixed + f.variable;
const rate = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 };

export default function AnalyticCostPage() {
  const [tab, setTab] = useState<TabKey>('periode');
  const [month, setMonth] = useState(thisMonth());
  const { can, isLoading: permLoading } = useActionPermissions();
  const qc = useQueryClient();
  const allowed = can('production.production_cout.analytique');
  const meta = useQuery({ queryKey: ['analytic', 'meta'], queryFn: analyticCostApi.meta, enabled: allowed });

  const recalc = useMutation({
    mutationFn: () => analyticCostApi.recalc(month),
    onSuccess: r => {
      notify.success(`${r.calculated} plan(s) recalculé(s) sur ${r.total}${r.failed ? ` — ${r.failed} en erreur` : ''}`);
      qc.invalidateQueries({ queryKey: ['analytic'] });
      qc.invalidateQueries({ queryKey: ['production-cout'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const periodQ = useQuery({ queryKey: ['analytic', 'period', month], queryFn: () => analyticCostApi.period(month), enabled: allowed });
  const isClosed = !!periodQ.data?.closed;
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const close = useMutation({
    mutationFn: () => analyticCostApi.close(month),
    onSuccess: r => { notify.success(`Mois ${r.month} clôturé : ${r.plans} plan(s) recalculé(s), taux figés`); qc.invalidateQueries({ queryKey: ['analytic'] }); qc.invalidateQueries({ queryKey: ['production-cout'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const reopen = useMutation({
    mutationFn: () => analyticCostApi.reopen(month, reason.trim()),
    onSuccess: () => { notify.success('Mois rouvert'); setReopening(false); setReason(''); qc.invalidateQueries({ queryKey: ['analytic'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setMethod = useMutation({
    mutationFn: (m: 'rate' | 'analytic') => analyticCostApi.setMethod(m),
    onSuccess: () => { notify.success('Mode de calcul enregistré'); qc.invalidateQueries({ queryKey: ['analytic'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (permLoading) return <LoadingState />;
  if (!allowed) {
    return (
      <SalesPageShell icon={Calculator} parent="Production › Rapports" title="Analyse des coûts">
        <EmptyState icon={Calculator} title="Accès réservé au gérant" text="L'analyse des coûts montre les coûts salariaux : elle demande le droit « comptabilité analytique »." />
      </SalesPageShell>
    );
  }

  return (
    <SalesPageShell icon={Calculator} parent="Production › Rapports" title="Analyse des coûts"
      summary="Charges réparties par centre et imputées aux produits sur la capacité normale."
      actions={<>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Mois
          <input type="month" className="ds-input sm" aria-label="Mois analysé" value={month}
            onChange={e => e.target.value && setMonth(e.target.value)} style={{ width: 150 }} />
        </label>
        {!isClosed && (
          <button type="button" className="odoo-btn-secondary" disabled={recalc.isPending || close.isPending || meta.data?.method !== 'analytic'} onClick={() => recalc.mutate()}
            title="Recalcule le coût de revient de tous les plans en cours ou terminés du mois avec le paramétrage actuel.">
            <RefreshCw size={14} className={recalc.isPending ? 'animate-spin' : ''} aria-hidden="true" /> Recalculer les plans du mois
          </button>
        )}
        {periodQ.data?.canClose && (
          <button type="button" className="odoo-btn-primary" disabled={close.isPending || recalc.isPending || meta.data?.method !== 'analytic'}
            onClick={() => close.mutate()} title="Recalcule tous les plans du mois puis fige les taux : le paramétrage n'aura plus d'effet sur ce mois.">
            <Lock size={14} aria-hidden="true" /> {close.isPending ? 'Clôture en cours…' : 'Clôturer le mois'}
          </button>
        )}
        {isClosed && (<>
          <button type="button" className="odoo-btn-secondary" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Imprimer le rapport</button>
          <button type="button" className="odoo-btn-secondary" onClick={() => setReopening(true)}><Unlock size={14} aria-hidden="true" /> Rouvrir</button>
        </>)}
      </>}>
      {isClosed && periodQ.data?.closed && (
        <Alert tone="success" icon={Lock}>
          Mois clôturé le {new Date(periodQ.data.closed.at).toLocaleDateString('fr-FR')}{periodQ.data.closed.byName ? ` par ${periodQ.data.closed.byName}` : ''} :
          les taux et les écarts ci-dessous sont figés ; le paramétrage actuel n'a plus d'effet sur ce mois.
        </Alert>
      )}
      {reopening && (
        <Modal title={`Rouvrir ${month}`} onClose={() => setReopening(false)} width={520} locked={reopen.isPending}
          footer={<FormFooter onCancel={() => setReopening(false)} submitLabel="Rouvrir le mois" busy={reopen.isPending} disabled={reason.trim().length < 3} onSubmit={() => reopen.mutate()} />}>
          <p style={{ marginTop: 0 }}>Les plans du mois seront recalculés avec le paramétrage courant au prochain calcul. La réouverture est tracée au journal.</p>
          <FormField label="Motif" htmlFor="reopen-reason" required>
            <textarea id="reopen-reason" className="ds-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. : facture d'électricité d'octobre reçue en retard" />
          </FormField>
        </Modal>
      )}
      {meta.data && meta.data.method !== 'analytic' && (
        <Alert tone="warning" icon={AlertTriangle}
          action={<button type="button" className="odoo-btn-primary" disabled={setMethod.isPending} onClick={() => setMethod.mutate('analytic')}>Activer le moteur analytique</button>}>
          Le coût de revient utilise encore un taux forfaitaire sur les matières. Le moteur analytique répartit les charges par centre
          et sur la capacité normale de production : une baisse d'activité n'alourdit plus le coût des produits.
        </Alert>
      )}
      <Toolbar>
        <Tabs label="Analyse des coûts" value={tab} onChange={setTab} tabs={[
          { key: 'periode', label: 'Période' }, { key: 'rentabilite', label: 'Rentabilité' }, { key: 'centres', label: 'Centres de coûts' }, { key: 'charges', label: 'Charges' }, { key: 'equipements', label: 'Équipements et outils' },
          { key: 'personnel', label: 'Personnel' }, { key: 'cles', label: 'Clés de répartition' },
        ]} />
      </Toolbar>
      {meta.isLoading ? <LoadingState /> : meta.isError ? <ErrorState error={meta.error} onRetry={() => meta.refetch()} /> : meta.data ? (
        <>
          {tab === 'periode' && <PeriodTab month={month} meta={meta.data} />}
          {tab === 'rentabilite' && <ProfitabilityTab month={month} />}
          {tab === 'centres' && <CentresTab meta={meta.data} />}
          {tab === 'charges' && <ChargesTab month={month} meta={meta.data} closed={isClosed} />}
          {tab === 'equipements' && <EquipmentTab month={month} />}
          {tab === 'personnel' && <PersonnelTab month={month} />}
          {tab === 'cles' && <KeysTab />}
        </>
      ) : null}
    </SalesPageShell>
  );
}

// ═══ Période ═══════════════════════════════════════════════════════════════
function PeriodTab({ month, meta }: { month: string; meta: AnalyticMeta }) {
  const q = useQuery({ queryKey: ['analytic', 'period', month], queryFn: () => analyticCostApi.period(month) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p: PeriodReport = q.data;
  const drv = (d: Driver) => meta.drivers.find(x => x.value === d);
  const principals = p.centres.filter(c => c.kind === 'principal');
  const aux = p.centres.filter(c => c.kind === 'auxiliaire' && (sum(c.primary.actual) !== 0 || sum(c.ceded.actual) !== 0));
  const name = (id: string) => p.centres.find(c => c.id === id)?.name ?? '—';
  const t = p.totals;
  const balanced = Math.abs(t.control) < 0.05;
  return (
    <>
      {p.inProgress && (
        <Alert tone="info">Mois en cours : charges, capacité et activité sont comptées à date ({p.daysElapsed} jours sur {p.daysInMonth}). Les taux, eux, portent sur le mois entier.</Alert>
      )}
      {p.warnings.map((w, i) => <Alert key={i} tone="warning" icon={AlertTriangle}>{w}</Alert>)}
      <KpiGrid label="Absorption des charges">
        <KpiCard label="Charges de la période" value={money(t.charges)} sub={`${p.plansCount} plans · ${num(p.activity.units)} unités produites`} />
        <KpiCard label="Imputées aux produits" value={money(t.imputed)} sub={t.charges > 0 ? `${pct(t.imputed / t.charges)} des charges` : undefined} tone="green" />
        <KpiCard label={t.activityVariance >= 0 ? 'Coût de la sous-activité' : 'Boni de suractivité'} value={money(Math.abs(t.activityVariance))}
          sub="charges fixes non absorbées par l'activité" tone={t.activityVariance > 0.5 ? 'orange' : 'green'} />
        <KpiCard label="Écart sur budget" value={money(t.budgetVariance, { signed: true })} sub="réel − budget flexible" tone={t.budgetVariance > 0.5 ? 'orange' : undefined} />
        <KpiCard label="Contrôle" value={balanced ? 'Équilibré' : money(t.control, { signed: true })}
          sub="imputé + écarts = charges" tone={balanced ? 'green' : 'red'}
          aside={balanced ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />} />
      </KpiGrid>
      <p className="ds-muted" style={{ fontSize: 13, margin: '4px 2px 10px' }}>
        Plans chiffrés : {p.plans.costed} / {p.plans.total}
        {p.plans.costed < p.plans.total && ' — « Recalculer les plans du mois » chiffre les autres avec ces taux.'}
        {p.timedLabour > 0 && ` · MO directe imputée par le temps pointé : ${money(p.timedLabour)}.`}
      </p>

      <DataPanel label="Centres principaux">
        <table className="odoo-table ds-dense">
          <thead><tr>
            <th style={{ width: 24 }} />
            <th>Centre</th><th>Niveau</th><th>Inducteur</th>
            <th className="ds-num">Charges fixes</th><th className="ds-num">Charges variables</th>
            <th className="ds-num">Capacité normale</th><th className="ds-num">Activité</th><th className="ds-num">Taux d'activité</th>
            <th className="ds-num">Coût de l'unité d'œuvre</th><th className="ds-num">Imputé</th><th className="ds-num">Sous-activité</th>
          </tr></thead>
          <tbody>
            {principals.map(c => {
              const d = drv(c.driver);
              const isOpen = open === c.id;
              return (
                <Fragment key={c.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                    <td>{isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}</td>
                    <td className="ds-strong">{c.name} <span className="ds-muted">{c.code}</span></td>
                    <td>{LEVEL_LABEL[c.level]}</td>
                    <td>{d?.label}</td>
                    <td className="ds-num">{money(c.pool.budget.fixed)}</td>
                    <td className="ds-num">{money(c.pool.budget.variable)}</td>
                    <td className="ds-num" title={`Source : ${CAP_SOURCE[c.capacitySource]}`}>{num(c.normalCapacity)}<div className="ds-muted" style={{ fontSize: 11 }}>{d?.unit} · {CAP_SOURCE[c.capacitySource]}</div></td>
                    <td className="ds-num">{num(c.activity)}</td>
                    <td className="ds-num">{pct(c.activityRate)}</td>
                    <td className="ds-num">{rate(c.rateFixed + c.rateVariable)}</td>
                    <td className="ds-num">{money(sum(c.imputed))}</td>
                    <td className="ds-num" style={{ color: c.activityVariance > 0.5 ? 'var(--ds-warning, #b45309)' : undefined }}>{money(c.activityVariance, { signed: true })}</td>
                  </tr>
                  {isOpen && (
                    <tr><td /><td colSpan={11} style={{ background: 'var(--ds-card)' }}>
                      <CentreDetail c={c} name={name} transfers={p.transfers} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td /><td className="ds-strong" colSpan={3}>Total</td>
            <td className="ds-num ds-strong">{money(principals.reduce((s, c) => s + c.pool.budget.fixed, 0))}</td>
            <td className="ds-num ds-strong">{money(principals.reduce((s, c) => s + c.pool.budget.variable, 0))}</td>
            <td colSpan={4} />
            <td className="ds-num ds-strong">{money(principals.reduce((s, c) => s + sum(c.imputed), 0))}</td>
            <td className="ds-num ds-strong">{money(principals.reduce((s, c) => s + c.activityVariance, 0), { signed: true })}</td>
          </tr></tfoot>
        </table>
      </DataPanel>

      <DataPanel label="Main-d'œuvre directe" style={{ marginTop: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong>Main-d'œuvre directe du mois</strong>
          <span className="ds-muted" style={{ fontSize: 13 }}>Taux horaire chargé moyen : {money(p.directLabour.rate)}</span>
        </div>
        <KpiGrid label="Heures de main-d'œuvre directe">
          <KpiCard label="Heures payées" value={`${num(p.directLabour.paidHours)} h`} sub="salariés en MO directe × heures légales, à date" />
          <KpiCard label="Heures pointées" value={`${num(p.directLabour.timedHours, 1)} h`} sub="étapes terminées" />
          <KpiCard label="Heures standard" value={`${num(p.directLabour.standardHours, 1)} h`} sub="gammes, lignes non pointées" />
          <KpiCard label="Heures non productives" value={`${num(p.directLabour.unproductiveHours)} h`}
            sub={p.directLabour.paidHours > 0 ? `${pct(p.directLabour.unproductiveHours / p.directLabour.paidHours)} des heures payées` : undefined}
            tone={p.directLabour.paidHours > 0 && p.directLabour.unproductiveHours / p.directLabour.paidHours > 0.3 ? 'orange' : undefined} />
        </KpiGrid>
        <p className="ds-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          MO imputée aux plans : {money(p.directLabour.imputed)}. Le reste du salaire de la MO directe reste dans son centre et suit l'inducteur du centre.
          {p.directLabour.standardHours === 0 && p.directLabour.timedHours === 0 && ' Aucune gamme ni aucun pointage : créez les gammes dans Production › Postes & gammes.'}
        </p>
      </DataPanel>

      {aux.length > 0 && (
        <DataPanel label="Centres auxiliaires" style={{ marginTop: 14 }}>
          <table className="odoo-table ds-dense">
            <thead><tr><th>Centre auxiliaire</th><th className="ds-num">Charges propres</th><th>Cédé à</th><th className="ds-num">Total cédé</th></tr></thead>
            <tbody>
              {aux.map(c => (
                <tr key={c.id}>
                  <td className="ds-strong">{c.name} <span className="ds-muted">{c.code}</span></td>
                  <td className="ds-num">{money(sum(c.primary.budget))}</td>
                  <td>{p.transfers.filter(x => x.from === c.id).map(x => `${name(x.to)} ${money(x.amount)}`).join(' · ') || '—'}</td>
                  <td className="ds-num">{money(sum(c.ceded.budget))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {p.direct.length > 0 && (
        <DataPanel label="Charges directes" style={{ marginTop: 14 }}>
          <table className="odoo-table ds-dense">
            <thead><tr><th>Charge directe</th><th>Produit</th><th className="ds-num">Charges</th><th className="ds-num">Quantité normale</th>
              <th className="ds-num">Produit ce mois</th><th className="ds-num">Coût unitaire</th><th className="ds-num">Imputé</th><th className="ds-num">Sous-activité</th></tr></thead>
            <tbody>{p.direct.map(d => (
              <tr key={d.id}>
                <td className="ds-strong">{d.label}</td><td>{d.productName}</td><td className="ds-num">{money(sum(d.budget))}</td>
                <td className="ds-num">{num(d.normalQuantity)}</td><td className="ds-num">{num(d.activity)}</td>
                <td className="ds-num">{rate(d.rateFixed + d.rateVariable)}</td>
                <td className="ds-num">{money(sum(d.imputed))}</td><td className="ds-num">{money(d.activityVariance, { signed: true })}</td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

function CentreDetail({ c, name, transfers }: { c: CentreModel; name: (id: string) => string; transfers: PeriodReport['transfers'] }) {
  const received = transfers.filter(x => x.to === c.id);
  return (
    <div style={{ padding: '6px 0' }}>
      <table className="odoo-table ds-dense" style={{ background: 'transparent' }}>
        <thead><tr><th>Composante</th><th className="ds-num">Fixe (prévu)</th><th className="ds-num">Variable (prévu)</th><th className="ds-num">Réel</th></tr></thead>
        <tbody>
          {c.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}{l.source === 'personnel' && <span className="ds-muted"> · personnel</span>}</td>
              <td className="ds-num">{money(l.budget.fixed)}</td><td className="ds-num">{money(l.budget.variable)}</td><td className="ds-num">{money(sum(l.actual))}</td>
            </tr>
          ))}
          {received.map((x, i) => (
            <tr key={`r${i}`}><td>Reçu de {name(x.from)} (centre auxiliaire)</td><td className="ds-num" colSpan={2}>{money(x.amount)}</td><td /></tr>
          ))}
        </tbody>
      </table>
      <p className="ds-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        Coût de l'unité d'œuvre = charges du centre ÷ capacité normale : fixe {rate(c.rateFixed)} + variable {rate(c.rateVariable)}.
        Écart sur budget : {money(c.budgetVariance, { signed: true })}.
      </p>
    </div>
  );
}

// ═══ Centres ═══════════════════════════════════════════════════════════════
function CentresTab({ meta }: { meta: AnalyticMeta }) {
  const q = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres });
  const [edit, setEdit] = useState<Centre | 'new' | null>(null);
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (c: Centre) => analyticCostApi.updateCentre(c.id, { isActive: !c.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytic'] }), onError: e => notify.error(apiErrorMessage(e)),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const centres = q.data ?? [];
  const codeOf = (id: string) => centres.find(c => c.id === id)?.code ?? '?';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="odoo-btn-secondary" onClick={() => setEdit('new')}><Plus size={13} aria-hidden="true" /> Nouveau centre</button>
      </div>
      <DataPanel label="Centres de coûts">
        <table className="odoo-table ds-dense">
          <thead><tr><th>Centre</th><th>Type</th><th>Niveau</th><th>Inducteur (unité d'œuvre)</th>
            <th className="ds-num">Capacité normale / mois</th><th className="ds-num">Capacité max.</th><th>Cession</th><th className="ds-actions" /></tr></thead>
          <tbody>{centres.map(c => (
            <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
              <td className="ds-strong">{c.name} <span className="ds-muted">{c.code}</span>{c.parent_id && <span className="ds-muted"> · sous-centre de {codeOf(c.parent_id)}</span>}</td>
              <td><StatusTag tone={c.kind === 'principal' ? 'progress' : 'draft'} label={c.kind === 'principal' ? 'Principal' : 'Auxiliaire'} /></td>
              <td>{LEVEL_LABEL[c.level]}</td>
              <td>{c.kind === 'principal' ? meta.drivers.find(d => d.value === c.driver)?.label : '—'}</td>
              <td className="ds-num">{c.kind === 'principal' ? (c.normal_capacity != null ? num(c.normal_capacity) : <span className="ds-muted">auto (3 mois)</span>) : '—'}</td>
              <td className="ds-num">{c.max_capacity != null ? num(c.max_capacity) : '—'}</td>
              <td>{c.kind === 'principal' ? '—' : c.transfer_basis === 'headcount' ? 'Prorata de l\'effectif' : c.transfer_basis === 'payroll' ? 'Prorata de la masse salariale'
                : c.transfers.map(t => `${codeOf(t.toId)} ${num(t.percent, 1)} %`).join(' · ') || <span className="ds-muted">aucune règle</span>}</td>
              <td className="ds-actions">
                <RowMenu label={`Actions sur ${c.name}`} items={[
                  { label: 'Modifier', icon: Pencil, onSelect: () => setEdit(c) },
                  { label: c.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate(c) },
                ]} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
      {edit && <CentreModal centre={edit === 'new' ? null : edit} centres={centres} meta={meta} onClose={() => setEdit(null)} />}
    </>
  );
}

function CentreModal({ centre, centres, meta, onClose }: { centre: Centre | null; centres: Centre[]; meta: AnalyticMeta; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    code: centre?.code ?? '', name: centre?.name ?? '', kind: (centre?.kind ?? 'principal') as Centre['kind'], level: (centre?.level ?? 'production') as Level,
    driver: (centre?.driver ?? 'units') as Driver, parentId: centre?.parent_id ?? '', normal: centre?.normal_capacity != null ? String(centre.normal_capacity) : '',
    max: centre?.max_capacity != null ? String(centre.max_capacity) : '', basis: (centre?.transfer_basis ?? 'percent') as Centre['transfer_basis'],
    transfers: (centre?.transfers.map(t => ({ toId: t.toId, percent: String(t.percent) })) ?? []) as { toId: string; percent: string }[],
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const others = centres.filter(c => c.id !== centre?.id && c.is_active);
  const totalT = f.transfers.reduce((s, t) => s + (Number(t.percent) || 0), 0);
  const save = useMutation({
    mutationFn: async () => {
      let id = centre?.id;
      if (!id) id = (await analyticCostApi.createCentre({ code: f.code, name: f.name, kind: f.kind, level: f.level, driver: f.driver, parentId: f.parentId || null })).id as string;
      return analyticCostApi.updateCentre(id, {
        name: f.name, kind: f.kind, level: f.level, driver: f.driver, parentId: f.parentId || null,
        normalCapacity: f.normal ? Number(f.normal) : null, maxCapacity: f.max ? Number(f.max) : null, transferBasis: f.basis,
        transfers: f.kind === 'auxiliaire' && f.basis === 'percent' ? f.transfers.filter(t => t.toId && Number(t.percent) > 0).map(t => ({ toId: t.toId, percent: Number(t.percent) })) : [],
      });
    },
    onSuccess: () => { notify.success('Centre enregistré'); qc.invalidateQueries({ queryKey: ['analytic'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const unit = meta.drivers.find(d => d.value === f.driver)?.unit;
  const invalid = !f.name.trim() || (!centre && !f.code.trim()) || (f.kind === 'auxiliaire' && f.basis === 'percent' && f.transfers.length > 0 && Math.abs(totalT - 100) > 0.01);
  return (
    <Modal title={centre ? `Centre ${centre.code}` : 'Nouveau centre de coûts'} onClose={onClose} width={720} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={invalid} onSubmit={() => save.mutate()} />}>
      <FormSection title="Identité">
        <div style={grid}>
          <FormField label="Code" htmlFor="cc-code" required><input id="cc-code" className="ds-input" value={f.code} disabled={!!centre} onChange={e => set('code', e.target.value.toUpperCase())} maxLength={20} /></FormField>
          <FormField label="Nom" htmlFor="cc-name" required><input id="cc-name" className="ds-input" value={f.name} onChange={e => set('name', e.target.value)} /></FormField>
          <FormField label="Type" htmlFor="cc-kind" hint="Principal : impute ses coûts aux produits. Auxiliaire : les cède aux autres centres.">
            <select id="cc-kind" className="ds-input" value={f.kind} onChange={e => set('kind', e.target.value as Centre['kind'])}>
              <option value="principal">Principal</option><option value="auxiliaire">Auxiliaire</option>
            </select>
          </FormField>
          <FormField label="Niveau de coût" htmlFor="cc-level" hint="Approvisionnement → coût d'achat ; Production → coût de production ; Administration, Distribution → coût de revient complet.">
            <select id="cc-level" className="ds-input" value={f.level} onChange={e => set('level', e.target.value as Level)}>
              {meta.levels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </FormField>
          <FormField label="Centre parent" htmlFor="cc-parent" hint="Sous-centre : atelier, ligne, machine…">
            <select id="cc-parent" className="ds-input" value={f.parentId} onChange={e => set('parentId', e.target.value)}>
              <option value="">Aucun</option>{others.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </FormField>
        </div>
      </FormSection>
      {f.kind === 'principal' ? (
        <FormSection title="Imputation aux produits">
          <div style={grid}>
            <FormField label="Inducteur (unité d'œuvre)" htmlFor="cc-driver">
              <select id="cc-driver" className="ds-input" value={f.driver} onChange={e => set('driver', e.target.value as Driver)}>
                {meta.drivers.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </FormField>
            <FormField label={`Capacité normale par mois (${unit})`} htmlFor="cc-normal" hint="Vide : moyenne des 3 derniers mois. Base de l'imputation rationnelle des charges fixes.">
              <input id="cc-normal" type="number" min="0" step="any" className="ds-input" value={f.normal} onChange={e => set('normal', e.target.value)} placeholder="auto" />
            </FormField>
            <FormField label={`Capacité maximale par mois (${unit})`} htmlFor="cc-max" hint="Facultatif : taux d'utilisation.">
              <input id="cc-max" type="number" min="0" step="any" className="ds-input" value={f.max} onChange={e => set('max', e.target.value)} />
            </FormField>
          </div>
        </FormSection>
      ) : (
        <FormSection title="Cession aux autres centres">
          <FormField label="Base de cession" htmlFor="cc-basis">
            <select id="cc-basis" className="ds-input" value={f.basis} onChange={e => set('basis', e.target.value as Centre['transfer_basis'])}>
              <option value="percent">Pourcentages saisis</option>
              <option value="headcount">Prorata de l'effectif des centres principaux</option>
              <option value="payroll">Prorata de la masse salariale des centres principaux</option>
            </select>
          </FormField>
          {f.basis === 'percent' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {f.transfers.map((t, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 34px', gap: 8 }}>
                  <select className="ds-input" aria-label={`Centre destinataire ${i + 1}`} value={t.toId} onChange={e => set('transfers', f.transfers.map((x, j) => j === i ? { ...x, toId: e.target.value } : x))}>
                    <option value="">Choisir un centre</option>{others.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                  <input type="number" min="0" max="100" step="any" className="ds-input" aria-label={`Pourcentage ${i + 1}`} value={t.percent} onChange={e => set('transfers', f.transfers.map((x, j) => j === i ? { ...x, percent: e.target.value } : x))} />
                  <button type="button" className="ds-icon-btn" aria-label="Retirer" onClick={() => set('transfers', f.transfers.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="button" className="odoo-btn-secondary" onClick={() => set('transfers', [...f.transfers, { toId: '', percent: '' }])}><Plus size={13} aria-hidden="true" /> Ajouter un destinataire</button>
                <span style={{ fontSize: 13, color: Math.abs(totalT - 100) > 0.01 && f.transfers.length ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>Total : {num(totalT, 2)} %</span>
              </div>
            </div>
          )}
        </FormSection>
      )}
    </Modal>
  );
}

// ═══ Charges ═══════════════════════════════════════════════════════════════
function ChargesTab({ month, meta, closed }: { month: string; meta: AnalyticMeta; closed: boolean }) {
  const q = useQuery({ queryKey: ['analytic', 'charges', month], queryFn: () => analyticCostApi.charges(month) });
  const centres = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres });
  const keys = useQuery({ queryKey: ['analytic', 'keys'], queryFn: analyticCostApi.keys });
  const [edit, setEdit] = useState<Charge | 'new' | null>(null);
  const qc = useQueryClient();
  const actual = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number | null }) => analyticCostApi.setActual(id, month, amount),
    onSuccess: () => { notify.success('Montant réel enregistré'); qc.invalidateQueries({ queryKey: ['analytic'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (c: Charge) => analyticCostApi.setChargeActive(c.id, !c.is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytic'] }), onError: e => notify.error(apiErrorMessage(e)),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  const active = rows.filter(r => r.is_active);
  return (
    <>
      <Alert tone="info">
        Les salaires de la paie sont repris automatiquement (onglet Personnel) : ne les saisissez pas ici. L'énergie déjà comptée par les usages
        d'équipement d'un plan ne doit pas non plus y figurer deux fois.
      </Alert>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
        <span className="ds-muted" style={{ fontSize: 13 }}>
          {active.length} charge(s) active(s) · prévu {money(active.reduce((s, r) => s + r.monthly_amount, 0))} / mois
          · réel du mois {money(active.reduce((s, r) => s + (r.actual_amount ?? r.monthly_amount), 0))}
        </span>
        <button type="button" className="odoo-btn-secondary" onClick={() => setEdit('new')}><Plus size={13} aria-hidden="true" /> Nouvelle charge</button>
      </div>
      {rows.length === 0 ? <EmptyState icon={Calculator} title="Aucune charge" text="Ajoutez loyer, assurances, énergie, amortissements… avec leur centre et leur comportement." /> : (
        <DataPanel label="Charges">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Charge</th><th>Comportement</th><th>Affectation</th><th className="ds-num">Prévu / mois</th>
              <th className="ds-num" title="Solde du grand livre des comptes rattachés">Réel comptable</th>
              <th className="ds-num" title="Laissez vide pour reprendre le réel comptable (mois terminé) ou le prévu">Réel saisi {month}</th><th className="ds-actions" /></tr></thead>
            <tbody>{rows.map(c => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                <td className="ds-strong">{c.label} <span className="ds-muted">· {meta.natures.find(n => n.value === c.nature)?.label ?? c.nature}</span></td>
                <td>{BEHAVIOR_LABEL[c.behavior]}{c.behavior === 'semi_variable' && ` (${num(c.fixed_pct)} % fixe)`}</td>
                <td>{c.assignment === 'direct' ? <>Directe → {c.product_name}</> : c.key_name ? <>Clé « {c.key_name} »</> : <>{c.center_name}</>}</td>
                <td className="ds-num">{money(c.monthly_amount)}</td>
                <td className="ds-num" title={c.accounts.map(a => `${a.code} ${a.label}`).join('\n') || 'Aucun compte rattaché'}>
                  {c.ledger_amount != null ? money(c.ledger_amount) : <span className="ds-muted">—</span>}
                  {c.accounts.length > 0 && <div className="ds-muted" style={{ fontSize: 11 }}>{c.accounts.map(a => a.code).join(', ')}</div>}
                </td>
                <td className="ds-num">
                  <input type="number" min="0" step="any" className="ds-input sm" style={{ width: 120, textAlign: 'right' }}
                    aria-label={`Montant réel de ${c.label} pour ${month}`} placeholder={String(c.monthly_amount)}
                    defaultValue={c.actual_amount ?? ''} key={`${c.id}-${month}-${c.actual_amount}`} disabled={!c.is_active || closed}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      const next = v === '' ? null : Number(v);
                      if (next === c.actual_amount || (next != null && !Number.isFinite(next))) return;
                      actual.mutate({ id: c.id, amount: next });
                    }} />
                </td>
                <td className="ds-actions">
                  <RowMenu label={`Actions sur ${c.label}`} items={[
                    { label: 'Modifier', icon: Pencil, onSelect: () => setEdit(c) },
                    { label: c.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate(c) },
                  ]} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      <ReconciliationPanel month={month} />
      {edit && <ChargeModal charge={edit === 'new' ? null : edit} meta={meta} centres={centres.data ?? []} keys={keys.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

const COVERAGE: Record<Reconciliation['coverage'], string> = {
  charge: 'Charge analytique', paie: 'Personnel (paie)', matieres: 'Matières (consommations des plans)', amortissements: 'Registre des immobilisations',
  hors_exploitation: 'Hors exploitation (financier, exceptionnel, impôt)', non_rattache: 'Non rattaché',
};

/** Lot D : chaque compte de classe 6 du mois et ce qui le couvre dans le coût de revient. */
function ReconciliationPanel({ month }: { month: string }) {
  const q = useQuery({ queryKey: ['analytic', 'reconciliation', month], queryFn: () => analyticCostApi.reconciliation(month) });
  const rows = q.data ?? [];
  const missing = rows.filter(r => r.coverage === 'non_rattache');
  return (
    <DataPanel label="Rapprochement avec la comptabilité" style={{ marginTop: 14 }}>
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong>Rapprochement avec la comptabilité — {month}</strong>
        <span className="ds-muted" style={{ fontSize: 13 }}>
          {missing.length ? `${missing.length} compte(s) mouvementé(s) sans charge analytique : ${money(missing.reduce((t, r) => t + r.amount, 0))}` : 'Tous les comptes mouvementés sont couverts.'}
        </span>
      </div>
      {q.isLoading ? <LoadingState bare /> : rows.length === 0 ? <EmptyState bare icon={Calculator} title="Aucune écriture de charge validée ce mois-ci" /> : (
        <table className="odoo-table ds-dense">
          <thead><tr><th>Compte</th><th className="ds-num">Solde du mois</th><th>Couvert par</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className="ds-strong">{r.code} <span className="ds-muted">{r.label}</span></td>
              <td className="ds-num">{money(r.amount)}</td>
              <td>{r.coverage === 'non_rattache' ? <StatusTag tone="late" label="Non rattaché" /> : r.coverage === 'charge' ? r.charges : COVERAGE[r.coverage]}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </DataPanel>
  );
}

function ChargeModal({ charge, meta, centres, keys, onClose }: { charge: Charge | null; meta: AnalyticMeta; centres: Centre[]; keys: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: prodResp } = useQuery({ queryKey: ['products', 'all-analytic'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((prodResp as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name) })), [products]);
  const [f, setF] = useState(() => ({
    label: charge?.label ?? '', nature: charge?.nature ?? 'autre', behavior: (charge?.behavior ?? 'fixed') as Behavior,
    fixedPct: String(charge?.fixed_pct ?? 100), assignment: (charge?.assignment ?? 'indirect') as Charge['assignment'],
    target: charge?.allocation_key_id ? 'key' : 'centre', centreId: charge?.cost_center_id ?? '', keyId: charge?.allocation_key_id ?? '',
    productId: charge?.product_id ?? '', normalQty: charge?.normal_quantity != null ? String(charge.normal_quantity) : '',
    amount: charge ? String(charge.monthly_amount) : '', notes: charge?.notes ?? '',
    accountIds: (charge?.accounts ?? []).map(a => a.id),
  }));
  const accountsQ = useQuery({ queryKey: ['analytic', 'accounts'], queryFn: analyticCostApi.accounts });
  const accountOptions = (accountsQ.data ?? []).filter(a => !f.accountIds.includes(a.id)).map(a => ({ id: a.id, label: `${a.code} — ${a.label}` }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const suggestion = meta.natures.find(n => n.value === f.nature);
  const applyNature = (nature: string) => {
    const s = meta.natures.find(n => n.value === nature);
    setF(prev => {
      const next = { ...prev, nature };
      // Suggestion à la création : comportement, part fixe et centre selon la nature (modifiables).
      if (!charge && s) {
        next.behavior = s.behavior; next.fixedPct = String(s.fixedPct);
        const c = centres.find(x => x.code === s.center && x.is_active);
        if (c) { next.centreId = c.id; next.target = 'centre'; }
        if (!prev.label.trim()) next.label = s.label;
      }
      return next;
    });
  };
  const save = useMutation({
    mutationFn: () => {
      const body: ChargeInput = {
        label: f.label, nature: f.nature, behavior: f.behavior, fixedPct: Number(f.fixedPct) || 0, assignment: f.assignment,
        costCenterId: f.assignment === 'indirect' && f.target === 'centre' ? f.centreId || null : null,
        allocationKeyId: f.assignment === 'indirect' && f.target === 'key' ? f.keyId || null : null,
        productId: f.assignment === 'direct' ? f.productId || null : null,
        normalQuantity: f.assignment === 'direct' && f.normalQty ? Number(f.normalQty) : null,
        monthlyAmount: Number(f.amount) || 0, notes: f.notes || null, accountIds: f.accountIds,
      };
      return analyticCostApi.saveCharge(charge?.id ?? null, body);
    },
    onSuccess: () => { notify.success('Charge enregistrée'); qc.invalidateQueries({ queryKey: ['analytic'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const invalid = !f.label.trim() || f.amount === '' || !(Number(f.amount) >= 0)
    || (f.assignment === 'direct' ? !f.productId : f.target === 'centre' ? !f.centreId : !f.keyId);
  return (
    <Modal title={charge ? 'Modifier la charge' : 'Nouvelle charge'} onClose={onClose} width={720} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={invalid} onSubmit={() => save.mutate()} />}>
      <FormSection title="Charge">
        <div style={grid}>
          <FormField label="Nature" htmlFor="ch-nature" hint={suggestion?.hint || undefined}>
            <select id="ch-nature" className="ds-input" value={f.nature} onChange={e => applyNature(e.target.value)}>
              {meta.natures.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </FormField>
          <FormField label="Libellé" htmlFor="ch-label" required><input id="ch-label" className="ds-input" value={f.label} onChange={e => set('label', e.target.value)} /></FormField>
          <FormField label="Montant prévu par mois" htmlFor="ch-amount" required>
            <input id="ch-amount" type="number" min="0" step="any" className="ds-input" value={f.amount} onChange={e => set('amount', e.target.value)} />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Comportement (selon le volume)">
        <div style={grid}>
          <FormField label="Comportement" htmlFor="ch-beh" hint="Fixe : ne varie pas avec la production. Variable : la suit. Semi-variable : les deux.">
            <select id="ch-beh" className="ds-input" value={f.behavior} onChange={e => set('behavior', e.target.value as Behavior)}>
              <option value="fixed">Fixe</option><option value="variable">Variable</option><option value="semi_variable">Semi-variable</option>
            </select>
          </FormField>
          {f.behavior === 'semi_variable' && (
            <FormField label="Part fixe (%)" htmlFor="ch-fpct"><input id="ch-fpct" type="number" min="0" max="100" className="ds-input" value={f.fixedPct} onChange={e => set('fixedPct', e.target.value)} /></FormField>
          )}
        </div>
      </FormSection>
      <FormSection title="Affectation (à qui elle profite)">
        <div style={grid}>
          <FormField label="Affectation" htmlFor="ch-assign" hint="Directe : un seul produit (machine dédiée…). Indirecte : partagée, via un centre de coûts.">
            <select id="ch-assign" className="ds-input" value={f.assignment} onChange={e => set('assignment', e.target.value as Charge['assignment'])}>
              <option value="indirect">Indirecte</option><option value="direct">Directe (un produit)</option>
            </select>
          </FormField>
          {f.assignment === 'direct' ? (<>
            <FormField label="Produit" required>
              <SearchSelect options={productOptions} value={f.productId} onChange={v => set('productId', v)} placeholder="Choisir le produit" width="100%" ariaLabel="Produit" />
            </FormField>
            <FormField label="Quantité normale par mois" htmlFor="ch-nq" hint="Vide : moyenne des 3 derniers mois.">
              <input id="ch-nq" type="number" min="0" step="any" className="ds-input" value={f.normalQty} onChange={e => set('normalQty', e.target.value)} placeholder="auto" />
            </FormField>
          </>) : (<>
            <FormField label="Répartie sur" htmlFor="ch-target">
              <select id="ch-target" className="ds-input" value={f.target} onChange={e => set('target', e.target.value)}>
                <option value="centre">Un centre de coûts</option><option value="key">Une clé de répartition (%)</option>
              </select>
            </FormField>
            {f.target === 'centre' ? (
              <FormField label="Centre" htmlFor="ch-centre" required>
                <select id="ch-centre" className="ds-input" value={f.centreId} onChange={e => set('centreId', e.target.value)}>
                  <option value="">Choisir</option>{centres.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </FormField>
            ) : (
              <FormField label="Clé" htmlFor="ch-key" required hint={keys.length ? undefined : 'Créez une clé dans l\'onglet Clés de répartition.'}>
                <select id="ch-key" className="ds-input" value={f.keyId} onChange={e => set('keyId', e.target.value)}>
                  <option value="">Choisir</option>{keys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </FormField>
            )}
          </>)}
        </div>
      </FormSection>
      <FormSection title="Montant réel (comptabilité)">
        <FormField label="Comptes de charges rattachés" hint="Le réel d'un mois terminé est le solde de ces comptes au grand livre, sauf montant saisi à la main pour ce mois.">
          <SearchSelect options={accountOptions} value="" onChange={v => v && set('accountIds', [...f.accountIds, v])} placeholder="Ajouter un compte (classe 6)" width="100%" ariaLabel="Ajouter un compte de charges" />
        </FormField>
        {f.accountIds.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {f.accountIds.map(id => {
              const a = accountsQ.data?.find(x => x.id === id) ?? charge?.accounts.find(x => x.id === id);
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--ds-sep)', borderRadius: 999, padding: '2px 4px 2px 10px', fontSize: 13 }}>
                  {a ? `${a.code} ${a.label}` : id}
                  <button type="button" className="ds-icon-btn" aria-label={`Retirer le compte ${a?.code ?? ''}`} onClick={() => set('accountIds', f.accountIds.filter(x => x !== id))}><Trash2 size={12} aria-hidden="true" /></button>
                </span>
              );
            })}
          </div>
        )}
      </FormSection>
      <FormField label="Notes" htmlFor="ch-notes"><textarea id="ch-notes" className="ds-input" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField>
    </Modal>
  );
}

// ═══ Personnel ═════════════════════════════════════════════════════════════
const SOURCE_LABEL: Record<EmployeeCost['source'], string> = { payroll: 'paie du mois', last_payroll: 'dernière paie', estimate: 'estimé (salaire + charges)' };

function PersonnelTab({ month }: { month: string }) {
  const q = useQuery({ queryKey: ['analytic', 'personnel', month], queryFn: () => analyticCostApi.personnel(month) });
  const centres = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres });
  const [edit, setEdit] = useState<EmployeeCost | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  const code = (id: string) => centres.data?.find(c => c.id === id)?.code ?? '?';
  const total = rows.reduce((s, e) => s + e.actual, 0);
  return (
    <>
      <p className="ds-muted" style={{ fontSize: 13, margin: '0 2px 10px' }}>
        Coût employeur (brut + charges patronales) de la paie, réparti entre centres. « MO directe » : le temps pointé sur les étapes est imputé
        au plan ; le reste du salaire reste dans le centre et suit son inducteur. Masse salariale chargée du mois : {money(total)}.
      </p>
      <DataPanel label="Personnel">
        <table className="odoo-table ds-dense">
          <thead><tr><th>Salarié</th><th>Rôle</th><th className="ds-num">Coût employeur</th><th>Source</th><th className="ds-num">Taux horaire chargé</th><th>Affectation</th><th className="ds-actions" /></tr></thead>
          <tbody>{rows.map(e => (
            <tr key={e.id}>
              <td className="ds-strong">{e.name}</td><td>{e.role ?? '—'}</td>
              <td className="ds-num">{money(e.actual)}</td><td className="ds-muted">{SOURCE_LABEL[e.source]}</td>
              <td className="ds-num">{money(e.hourlyRate)}</td>
              <td>{e.unallocated ? <StatusTag tone="late" label="Non affecté" /> : e.allocations.map(a => `${code(a.centerId)} ${num(a.percent)} %${a.laborType === 'direct' ? ' (MO directe)' : ''}`).join(' · ')}</td>
              <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label={`Modifier l'affectation de ${e.name}`} onClick={() => setEdit(e)}><Pencil size={14} aria-hidden="true" /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
      {edit && <AllocationModal emp={edit} centres={centres.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function AllocationModal({ emp, centres, onClose }: { emp: EmployeeCost; centres: Centre[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(() => emp.allocations.length
    ? emp.allocations.map(a => ({ centerId: a.centerId, percent: String(a.percent), laborType: a.laborType }))
    : [{ centerId: '', percent: '100', laborType: 'indirect' as 'direct' | 'indirect' }]);
  const total = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const save = useMutation({
    mutationFn: () => analyticCostApi.setAllocations(emp.id, rows.filter(r => r.centerId).map(r => ({ centerId: r.centerId, percent: Number(r.percent), laborType: r.laborType }))),
    onSuccess: () => { notify.success('Affectation enregistrée'); qc.invalidateQueries({ queryKey: ['analytic'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const invalid = rows.some(r => !r.centerId || !(Number(r.percent) > 0)) || Math.abs(total - 100) > 0.01;
  return (
    <Modal title={`Affectation — ${emp.name}`} subtitle={`Coût employeur : ${money(emp.actual)} / mois`} onClose={onClose} width={640} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={invalid} onSubmit={() => save.mutate()} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 170px 34px', gap: 8 }}>
            <select className="ds-input" aria-label={`Centre ${i + 1}`} value={r.centerId} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, centerId: e.target.value } : x))}>
              <option value="">Choisir un centre</option>{centres.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <input type="number" min="0" max="100" step="any" className="ds-input" aria-label={`Pourcentage ${i + 1}`} value={r.percent} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, percent: e.target.value } : x))} />
            <select className="ds-input" aria-label={`Type de main-d'œuvre ${i + 1}`} value={r.laborType} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, laborType: e.target.value as 'direct' | 'indirect' } : x))}>
              <option value="direct">MO directe</option><option value="indirect">Indirecte</option>
            </select>
            <button type="button" className="ds-icon-btn" aria-label="Retirer" disabled={rows.length <= 1} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="odoo-btn-secondary" onClick={() => setRows(rs => [...rs, { centerId: '', percent: '', laborType: 'indirect' }])}><Plus size={13} aria-hidden="true" /> Ajouter un centre</button>
          <span style={{ fontSize: 13, color: Math.abs(total - 100) > 0.01 ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>Total : {num(total, 2)} %</span>
        </div>
      </div>
    </Modal>
  );
}

// ═══ Clés de répartition ═══════════════════════════════════════════════════
function KeysTab() {
  const q = useQuery({ queryKey: ['analytic', 'keys'], queryFn: analyticCostApi.keys });
  const centres = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres });
  const [edit, setEdit] = useState<{ id: string | null; name: string; lines: { centerId: string; percent: string }[] } | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => analyticCostApi.saveKey(edit!.id, { name: edit!.name, lines: edit!.lines.filter(l => l.centerId).map(l => ({ centerId: l.centerId, percent: Number(l.percent) })) }),
    onSuccess: () => { notify.success('Clé enregistrée'); qc.invalidateQueries({ queryKey: ['analytic'] }); setEdit(null); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const code = (id: string) => centres.data?.find(c => c.id === id)?.code ?? '?';
  const total = edit ? edit.lines.reduce((s, l) => s + (Number(l.percent) || 0), 0) : 0;
  return (
    <>
      <p className="ds-muted" style={{ fontSize: 13, margin: '0 2px 10px' }}>
        Une clé éclate une charge entre plusieurs centres : surfaces occupées pour le loyer, puissance installée pour l'électricité, effectif…
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="odoo-btn-secondary" onClick={() => setEdit({ id: null, name: '', lines: [{ centerId: '', percent: '' }] })}><Plus size={13} aria-hidden="true" /> Nouvelle clé</button>
      </div>
      {(q.data ?? []).length === 0 ? <EmptyState icon={Calculator} title="Aucune clé" /> : (
        <DataPanel label="Clés de répartition">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Clé</th><th>Répartition</th><th className="ds-actions" /></tr></thead>
            <tbody>{(q.data ?? []).map(k => (
              <tr key={k.id}>
                <td className="ds-strong">{k.name}</td>
                <td>{k.lines.map(l => `${code(l.centerId)} ${num(l.percent, 2)} %`).join(' · ')}</td>
                <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label={`Modifier ${k.name}`}
                  onClick={() => setEdit({ id: k.id, name: k.name, lines: k.lines.map(l => ({ centerId: l.centerId, percent: String(l.percent) })) })}><Pencil size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      {edit && (
        <Modal title={edit.id ? 'Modifier la clé' : 'Nouvelle clé de répartition'} onClose={() => setEdit(null)} width={600} locked={save.isPending}
          footer={<FormFooter onCancel={() => setEdit(null)} busy={save.isPending} disabled={!edit.name.trim() || Math.abs(total - 100) > 0.01 || edit.lines.some(l => !l.centerId)} onSubmit={() => save.mutate()} />}>
          <FormField label="Nom" htmlFor="key-name" required><input id="key-name" className="ds-input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Ex. : Surfaces occupées" /></FormField>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {edit.lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 34px', gap: 8 }}>
                <select className="ds-input" aria-label={`Centre ${i + 1}`} value={l.centerId} onChange={e => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, centerId: e.target.value } : x) })}>
                  <option value="">Choisir un centre</option>{(centres.data ?? []).filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
                <input type="number" min="0" max="100" step="any" className="ds-input" aria-label={`Pourcentage ${i + 1}`} value={l.percent} onChange={e => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, percent: e.target.value } : x) })} />
                <button type="button" className="ds-icon-btn" aria-label="Retirer" disabled={edit.lines.length <= 1} onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="odoo-btn-secondary" onClick={() => setEdit({ ...edit, lines: [...edit.lines, { centerId: '', percent: '' }] })}><Plus size={13} aria-hidden="true" /> Ajouter un centre</button>
              <span style={{ fontSize: 13, color: Math.abs(total - 100) > 0.01 ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>Total : {num(total, 2)} %</span>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══ Rentabilité (lot F) ═══════════════════════════════════════════════════
const addMonths = (m: string, k: number) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + mo - 1 + k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

function ProfitabilityTab({ month }: { month: string }) {
  const [span, setSpan] = useState<'1' | '3' | '6' | '12'>('3');
  const from = addMonths(month, -(Number(span) - 1));
  const q = useQuery({ queryKey: ['analytic', 'profitability', from, month], queryFn: () => analyticCostApi.profitability(from, month) });
  const [vol, setVol] = useState(0);
  const [price, setPrice] = useState(0);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r: Profitability = q.data;
  const be = r.breakEven;
  const vr = be.variableRate ?? 0;
  const resultNow = be.caMensuel * (1 - vr) - be.fixedMonthly;
  const caSim = be.caMensuel * (1 + vol / 100) * (1 + price / 100);
  const resultSim = caSim - be.caMensuel * (1 + vol / 100) * vr - be.fixedMonthly;
  const maxVar = Math.max(1, ...r.history.map(h => Math.abs(h.activityVariance)));
  return (
    <>
      <Toolbar>
        <Segmented label="Période analysée" value={span} onChange={setSpan}
          options={[{ key: '1', label: '1 mois' }, { key: '3', label: '3 mois' }, { key: '6', label: '6 mois' }, { key: '12', label: '12 mois' }]} />
        <span className="ds-muted" style={{ fontSize: 13 }}>{from} → {month}</span>
      </Toolbar>
      {r.totals.produits_sans_cout > 0 && (
        <Alert tone="info">{r.totals.produits_sans_cout} produit(s) vendu(s) sans coût de revient sur la période (plans non chiffrés, ou produits achetés-revendus) :
          leur marge n'est pas comptée. Chiffrez les plans des mois concernés (onglet Période › Recalculer).</Alert>
      )}
      <KpiGrid label="Rentabilité de la période">
        <KpiCard label="Ventes HT" value={money(r.totals.ca_ht)} sub={`${r.months} mois · dont ${money(r.totals.ca_costed)} chiffrées`} />
        <KpiCard label="Coût de revient des ventes" value={money(r.totals.cout_ventes)} sub="quantités vendues × coût de revient unitaire" />
        <KpiCard label="Marge" value={money(r.totals.marge, { signed: true })} tone={r.totals.marge >= 0 ? 'green' : 'red'}
          sub={r.totals.ca_costed > 0 ? `taux de marque ${pct(r.totals.marge / r.totals.ca_costed)}` : undefined} />
        <KpiCard label="Seuil de rentabilité mensuel" value={be.seuilMensuel != null ? money(be.seuilMensuel) : '—'}
          sub={be.mscvRate != null ? `charges fixes ${money(be.fixedMonthly)} ÷ marge sur coûts variables ${pct(be.mscvRate)}` : 'aucun plan chiffré'} />
        <KpiCard label="Marge de sécurité" value={be.margeSecurite != null ? money(be.margeSecurite, { signed: true }) : '—'}
          tone={be.margeSecurite != null ? (be.margeSecurite >= 0 ? 'green' : 'red') : undefined} sub={`ventes mensuelles moyennes ${money(be.caMensuel)}`} />
      </KpiGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginTop: 14 }}>
        <DataPanel label="Marge par famille">
          <div style={{ padding: '12px 16px 0' }}><strong>Marge par famille</strong></div>
          <table className="odoo-table ds-dense">
            <thead><tr><th>Famille</th><th className="ds-num">Ventes HT</th><th className="ds-num">Coût des ventes</th><th className="ds-num">Marge</th><th className="ds-num">Taux de marque</th></tr></thead>
            <tbody>{r.families.map(f => (
              <tr key={f.family}>
                <td className="ds-strong">{f.family}{f.uncosted > 0 && <span className="ds-muted"> · {f.uncosted} sans coût</span>}</td>
                <td className="ds-num">{money(f.ca_ht)}</td><td className="ds-num">{f.ca_costed > 0 ? money(f.cout_ventes) : '—'}</td>
                <td className="ds-num">{f.ca_costed > 0 ? money(f.marge, { signed: true }) : '—'}</td><td className="ds-num">{f.taux_marque != null ? `${f.taux_marque.toLocaleString('fr-FR')} %` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>

        <DataPanel label="Simulation" style={{ padding: 16 }}>
          <strong>Simulation sur un mois moyen</strong>
          <p className="ds-muted" style={{ fontSize: 12, margin: '4px 0 12px' }}>
            Coûts variables {pct(vr)} des ventes ; charges fixes {money(be.fixedMonthly)} par mois (personnel et main-d'œuvre compris).
          </p>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Volume vendu : {vol > 0 ? '+' : ''}{vol} %
            <input type="range" min={-30} max={30} step={1} value={vol} onChange={e => setVol(Number(e.target.value))} aria-label="Variation du volume vendu en %" />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, marginTop: 8 }}>
            Prix de vente : {price > 0 ? '+' : ''}{price} %
            <input type="range" min={-20} max={20} step={1} value={price} onChange={e => setPrice(Number(e.target.value))} aria-label="Variation du prix de vente en %" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
            <div className="ds-kpi"><span className="ds-kpi-label">Résultat mensuel actuel</span><span className="ds-kpi-value">{money(resultNow, { signed: true })}</span></div>
            <div className="ds-kpi"><span className="ds-kpi-label">Résultat simulé</span><span className="ds-kpi-value" style={{ color: resultSim >= resultNow ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{money(resultSim, { signed: true })}</span>
              <span className="ds-kpi-sub">ventes {money(caSim)}</span></div>
          </div>
        </DataPanel>
      </div>

      <DataPanel label="Sous-activité par mois" style={{ marginTop: 14, padding: 16 }}>
        <strong>Sous-activité et coût unitaire, 12 derniers mois</strong>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ds-muted)', margin: '8px 0', flexWrap: 'wrap' }}>
          <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#1D4ED8', marginRight: 6 }} />Suractivité (charges absorbées en plus)</span>
          <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#C2410C', marginRight: 6 }} />Sous-activité (charges non absorbées)</span>
        </div>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Mois</th><th className="ds-num">Charges</th><th className="ds-num">Taux d'activité</th><th style={{ width: '34%' }}>Sous / suractivité</th><th className="ds-num">Montant</th><th className="ds-num">Coût de revient / unité</th></tr></thead>
          <tbody>{r.history.map(h => {
            const w = Math.round(Math.abs(h.activityVariance) / maxVar * 50);
            const under = h.activityVariance > 0;
            return (
              <tr key={h.month}>
                <td className="ds-strong">{h.month}</td><td className="ds-num">{money(h.charges)}</td><td className="ds-num">{pct(h.activityRate)}</td>
                <td>
                  <div style={{ display: 'flex', height: 14 }} aria-hidden="true">
                    <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>{!under && <div style={{ width: `${w * 2}%`, background: '#1D4ED8', borderRadius: '3px 0 0 3px' }} />}</div>
                    <div style={{ width: '50%' }}>{under && <div style={{ width: `${w * 2}%`, height: '100%', background: '#C2410C', borderRadius: '0 3px 3px 0' }} />}</div>
                  </div>
                </td>
                <td className="ds-num">{money(h.activityVariance, { signed: true })}</td>
                <td className="ds-num">{h.coutUnitaire != null ? money(h.coutUnitaire, { decimals: 4 }) : <span className="ds-muted">plans non tous chiffrés</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </DataPanel>

      <DataPanel label="Marge par produit" style={{ marginTop: 14 }}>
        <div style={{ padding: '12px 16px 0' }}><strong>Marge par produit</strong></div>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Produit</th><th>Famille</th><th className="ds-num">Vendu</th><th className="ds-num">Ventes HT</th><th className="ds-num">Coût de revient / u</th><th className="ds-num">Coût des ventes</th><th className="ds-num">Marge</th><th className="ds-num">Taux de marque</th></tr></thead>
          <tbody>{r.products.map(p => (
            <tr key={p.product_id}>
              <td className="ds-strong">{p.name}</td><td>{p.family}</td><td className="ds-num">{num(p.qty_sold)}</td><td className="ds-num">{money(p.ca_ht)}</td>
              <td className="ds-num">{p.cout_revient_u != null ? money(p.cout_revient_u, { decimals: 4 }) : '—'}</td>
              <td className="ds-num">{p.cout_ventes != null ? money(p.cout_ventes) : '—'}</td>
              <td className="ds-num" style={{ color: p.marge != null && p.marge < 0 ? 'var(--ds-danger)' : undefined }}>{p.marge != null ? money(p.marge, { signed: true }) : '—'}</td>
              <td className="ds-num">{p.taux_marque != null ? `${p.taux_marque.toLocaleString('fr-FR')} %` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
    </>
  );
}

// ═══ Équipements et outils (mig 660) ═══════════════════════════════════════
const TOOL_CATEGORIES: Record<string, string> = { moule: 'Moules', plaque: 'Plaques et grilles', ustensile: 'Ustensiles', petit_materiel: 'Petit matériel', textile: 'Textiles (toiles, couches)', autre: 'Autre' };

function EquipmentTab({ month }: { month: string }) {
  const q = useQuery({ queryKey: ['analytic', 'equipment', month], queryFn: () => analyticCostApi.equipment(month) });
  const centres = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres });
  const [asset, setAsset] = useState<Equipment['assets'][number] | null>(null);
  const [tool, setTool] = useState<Equipment['tools'][number] | 'new' | null>(null);
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (t: Equipment['tools'][number]) => analyticCostApi.setToolActive(t.id, !t.is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytic'] }), onError: e => notify.error(apiErrorMessage(e)),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const target = (x: { analytic_excluded?: boolean; product_name: string | null; center_name: string | null }, def: string) =>
    x.analytic_excluded ? <span className="ds-muted">Hors coût de revient</span> : x.product_name ? <>Directe → {x.product_name}</> : x.center_name ?? <span className="ds-muted">{def}</span>;
  return (
    <>
      <KpiGrid label="Usure des équipements et de l'outillage">
        <KpiCard label={`Amortissements ${month}`} value={money(d.totals.amortissements)} sub={`${d.assets.length} immobilisation(s) au registre`} />
        <KpiCard label={`Outillage ${month}`} value={money(d.totals.outillage)} sub={`${d.tools.filter(t => t.is_active && t.in_use).length} outil(s) en cours d'usage`} />
        <KpiCard label="Total par mois" value={money(d.totals.amortissements + d.totals.outillage)} sub="intégré aux charges des centres ou des produits" />
      </KpiGrid>

      <DataPanel label="Équipements (immobilisations)" style={{ marginTop: 14 }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <strong>Équipements immobilisés</strong>
          <span className="ds-muted" style={{ fontSize: 13 }}>Dotation du mois : écriture de dotation, sinon linéaire. Nouveaux biens : Comptabilité › Immobilisations.</span>
        </div>
        {d.assets.length === 0 ? (
          <EmptyState bare icon={Calculator} title="Aucune immobilisation au registre"
            text="Enregistrez le four, le pétrin, la chambre de pousse… dans Comptabilité › Immobilisations (coût, date, durée) : leur amortissement entrera dans le coût de revient." />
        ) : (
          <table className="odoo-table ds-dense">
            <thead><tr><th>Bien</th><th>Acquis le</th><th className="ds-num">Coût</th><th className="ds-num">Durée</th><th className="ds-num">Dotation du mois</th><th>Affectation</th><th className="ds-actions" /></tr></thead>
            <tbody>{d.assets.map(a => (
              <tr key={a.id} style={{ opacity: a.analytic_excluded ? 0.6 : 1 }}>
                <td className="ds-strong">{a.label}{a.equipment_names && <span className="ds-muted"> · {a.equipment_names}</span>}</td>
                <td>{new Date(a.acquisition_date).toLocaleDateString('fr-FR')}</td>
                <td className="ds-num">{money(a.acquisition_cost)}</td><td className="ds-num">{a.duration_years} ans</td>
                <td className="ds-num">{money(a.month_amount)}</td>
                <td>{target(a, a.equipment_names ? 'Production (équipement)' : 'Administration')}</td>
                <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label={`Modifier l'affectation de ${a.label}`} onClick={() => setAsset(a)}><Pencil size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </DataPanel>

      <DataPanel label="Outillage et petit matériel" style={{ marginTop: 14 }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>Outillage et petit matériel</strong>
          <button type="button" className="odoo-btn-secondary" onClick={() => setTool('new')}><Plus size={13} aria-hidden="true" /> Nouvel outil</button>
        </div>
        {d.tools.length === 0 ? (
          <EmptyState bare icon={Calculator} title="Aucun outil" text="Moules, plaques, cercles, poches, couteaux, toiles… : coût d'achat réparti sur leur durée d'usage." />
        ) : (
          <table className="odoo-table ds-dense">
            <thead><tr><th>Outil</th><th>Catégorie</th><th className="ds-num">Coût</th><th className="ds-num">Durée d'usage</th><th className="ds-num">Coût par mois</th><th>Fin d'usage</th><th>Affectation</th><th className="ds-actions" /></tr></thead>
            <tbody>{d.tools.map(t => (
              <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                <td className="ds-strong">{t.label}</td><td>{TOOL_CATEGORIES[t.category] ?? t.category}</td>
                <td className="ds-num">{money(t.unit_cost * t.quantity)}{t.quantity !== 1 && <div className="ds-muted" style={{ fontSize: 11 }}>{num(t.quantity, 2)} × {money(t.unit_cost)}</div>}</td>
                <td className="ds-num">{t.life_months} mois</td>
                <td className="ds-num">{t.in_use ? money(t.monthly_cost) : <span className="ds-muted">hors période</span>}</td>
                <td>{new Date(t.end_date).toLocaleDateString('fr-FR')}</td>
                <td>{target(t, 'Production')}</td>
                <td className="ds-actions">
                  <RowMenu label={`Actions sur ${t.label}`} items={[
                    { label: 'Modifier', icon: Pencil, onSelect: () => setTool(t) },
                    { label: t.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate(t) },
                  ]} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </DataPanel>
      {asset && <AssetModal asset={asset} centres={centres.data ?? []} onClose={() => setAsset(null)} />}
      {tool && <ToolModal tool={tool === 'new' ? null : tool} centres={centres.data ?? []} onClose={() => setTool(null)} />}
    </>
  );
}

function useProductOptions() {
  const { data } = useQuery({ queryKey: ['products', 'all-analytic'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((data as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  return useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name) })), [products]);
}

function AssetModal({ asset, centres, onClose }: { asset: Equipment['assets'][number]; centres: Centre[]; onClose: () => void }) {
  const qc = useQueryClient();
  const productOptions = useProductOptions();
  const [mode, setMode] = useState<'centre' | 'product' | 'excluded'>(asset.analytic_excluded ? 'excluded' : asset.product_id ? 'product' : 'centre');
  const [centreId, setCentreId] = useState(asset.cost_center_id ?? '');
  const [productId, setProductId] = useState(asset.product_id ?? '');
  const save = useMutation({
    mutationFn: () => analyticCostApi.updateAsset(asset.id, {
      costCenterId: mode === 'centre' ? centreId || null : null, productId: mode === 'product' ? productId || null : null, excluded: mode === 'excluded' }),
    onSuccess: () => { notify.success('Affectation enregistrée'); qc.invalidateQueries({ queryKey: ['analytic'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title={`Affectation — ${asset.label}`} subtitle={`Dotation du mois : ${money(asset.month_amount)}`} onClose={onClose} width={560} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={mode === 'product' && !productId} onSubmit={() => save.mutate()} />}>
      <FormField label="La dotation va à" htmlFor="as-mode">
        <select id="as-mode" className="ds-input" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="centre">Un centre de coûts</option><option value="product">Un produit (équipement dédié)</option><option value="excluded">Hors coût de revient</option>
        </select>
      </FormField>
      {mode === 'centre' && (
        <FormField label="Centre" htmlFor="as-centre" hint="Vide : Production si le bien est un équipement de production, sinon Administration.">
          <select id="as-centre" className="ds-input" value={centreId} onChange={e => setCentreId(e.target.value)}>
            <option value="">Automatique</option>{centres.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </FormField>
      )}
      {mode === 'product' && (
        <FormField label="Produit" required>
          <SearchSelect options={productOptions} value={productId} onChange={setProductId} placeholder="Choisir le produit" width="100%" ariaLabel="Produit" />
        </FormField>
      )}
    </Modal>
  );
}

function ToolModal({ tool, centres, onClose }: { tool: Equipment['tools'][number] | null; centres: Centre[]; onClose: () => void }) {
  const qc = useQueryClient();
  const productOptions = useProductOptions();
  const [f, setF] = useState(() => ({
    label: tool?.label ?? '', category: tool?.category ?? 'ustensile', unitCost: tool ? String(tool.unit_cost) : '', quantity: tool ? String(tool.quantity) : '1',
    purchaseDate: tool?.purchase_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), lifeMonths: tool ? String(tool.life_months) : '12',
    target: tool?.product_id ? 'product' : 'centre', centreId: tool?.cost_center_id ?? '', productId: tool?.product_id ?? '', notes: tool?.notes ?? '',
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const monthly = (Number(f.unitCost) || 0) * (Number(f.quantity) || 0) / Math.max(1, Number(f.lifeMonths) || 1);
  const save = useMutation({
    mutationFn: () => {
      const body: ToolInput = { label: f.label, category: f.category, unitCost: Number(f.unitCost) || 0, quantity: Number(f.quantity) || 1,
        purchaseDate: f.purchaseDate, lifeMonths: Math.round(Number(f.lifeMonths) || 1),
        costCenterId: f.target === 'centre' ? f.centreId || null : null, productId: f.target === 'product' ? f.productId || null : null, notes: f.notes || null };
      return analyticCostApi.saveTool(tool?.id ?? null, body);
    },
    onSuccess: () => { notify.success('Outil enregistré'); qc.invalidateQueries({ queryKey: ['analytic'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const invalid = !f.label.trim() || f.unitCost === '' || !(Number(f.quantity) > 0) || !(Number(f.lifeMonths) >= 1) || (f.target === 'product' && !f.productId);
  return (
    <Modal title={tool ? 'Modifier l\'outil' : 'Nouvel outil'} onClose={onClose} width={680} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={invalid} onSubmit={() => save.mutate()} />}>
      <div style={grid}>
        <FormField label="Libellé" htmlFor="tl-label" required><input id="tl-label" className="ds-input" value={f.label} onChange={e => set('label', e.target.value)} placeholder="Ex. : moules à cake inox" /></FormField>
        <FormField label="Catégorie" htmlFor="tl-cat">
          <select id="tl-cat" className="ds-input" value={f.category} onChange={e => set('category', e.target.value)}>
            {Object.entries(TOOL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Coût unitaire HT" htmlFor="tl-cost" required><input id="tl-cost" type="number" min="0" step="any" className="ds-input" value={f.unitCost} onChange={e => set('unitCost', e.target.value)} /></FormField>
        <FormField label="Quantité" htmlFor="tl-qty"><input id="tl-qty" type="number" min="0" step="any" className="ds-input" value={f.quantity} onChange={e => set('quantity', e.target.value)} /></FormField>
        <FormField label="Date d'achat" htmlFor="tl-date"><input id="tl-date" type="date" className="ds-input" value={f.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} /></FormField>
        <FormField label="Durée d'usage (mois)" htmlFor="tl-life" hint="Durée après laquelle l'outil est à remplacer."><input id="tl-life" type="number" min="1" max="240" className="ds-input" value={f.lifeMonths} onChange={e => set('lifeMonths', e.target.value)} /></FormField>
        <FormField label="Affectation" htmlFor="tl-target">
          <select id="tl-target" className="ds-input" value={f.target} onChange={e => set('target', e.target.value)}>
            <option value="centre">Un centre de coûts</option><option value="product">Un produit (outil dédié)</option>
          </select>
        </FormField>
        {f.target === 'centre' ? (
          <FormField label="Centre" htmlFor="tl-centre" hint="Vide : Production.">
            <select id="tl-centre" className="ds-input" value={f.centreId} onChange={e => set('centreId', e.target.value)}>
              <option value="">Production (automatique)</option>{centres.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </FormField>
        ) : (
          <FormField label="Produit" required>
            <SearchSelect options={productOptions} value={f.productId} onChange={v => set('productId', v)} placeholder="Choisir le produit" width="100%" ariaLabel="Produit" />
          </FormField>
        )}
      </div>
      <p style={{ margin: '12px 0 0' }}>Coût mensuel : <strong>{money(monthly)}</strong> pendant {Math.max(1, Number(f.lifeMonths) || 1)} mois.</p>
      <FormField label="Notes" htmlFor="tl-notes"><textarea id="tl-notes" className="ds-input" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField>
    </Modal>
  );
}
