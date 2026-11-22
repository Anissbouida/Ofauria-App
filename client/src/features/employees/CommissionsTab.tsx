import { currencySymbol } from '../../utils/money';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Trash2, Pencil, Layers, Banknote, Link2 } from 'lucide-react';
import {
  commissionsApi, type CommissionRule, type CommissionRuleInput,
  type CommissionScheme, type CommissionSchemeInput,
} from '../../api/commissions.api';
import { employeesApi } from '../../api/employees.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Segmented, HrModal, Field, SubmitButton, HrHeaderActions, inputCls } from './ui';
import { amount } from './shared';
import { Toolbar, DataPanel, TableFooter, SectionHeader, EmptyState, LoadingState, ErrorState } from '../../components/ds';

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
/** Date ISO → « 21/11/2026 ». */
const frDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const validity = (from: string, to?: string | null) => (to ? `du ${frDate(from)} au ${frDate(to)}` : `depuis le ${frDate(from)}`);

type EmpOpt = { id: string; first_name: string; last_name: string };

/** Commissions commerciales : relevé + barèmes fixes (mig 123) + contrats-cadres à paliers et versement sur paie (mig 393). */
export default function CommissionsTab() {
  const [view, setView] = useState<'statement' | 'rules' | 'schemes'>('statement');
  // Trois vues : bascule segmentée, posée à droite de la barre d'outils de chaque vue.
  const switcher = <Segmented label="Vue des commissions" value={view} onChange={setView}
    options={[{ key: 'statement', label: 'Relevé' }, { key: 'rules', label: 'Barèmes fixes' }, { key: 'schemes', label: 'Contrats-cadres' }]} />;
  return (
    <>
      <StatusBanner tone="info" icon={Percent} title="Commissions commerciales">
        Un vendeur est commissionné soit à un <strong>taux fixe</strong> (par produit ou tous produits), soit via un <strong>contrat-cadre à paliers</strong> (taux progressif selon le volume) — le contrat-cadre l'emporte. Le relevé calcule la commission due sur une période, puis se verse sur le bulletin de paie.
      </StatusBanner>
      {view === 'statement' ? <Statement switcher={switcher} /> : view === 'rules' ? <Rules switcher={switcher} /> : <Schemes switcher={switcher} />}
    </>
  );
}

/* ─── Relevé + versement sur paie ──────────────────────────────────────── */
function Statement({ switcher }: { switcher: ReactNode }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [payout, setPayout] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['commission-statement', from, to], queryFn: () => commissionsApi.statement({ from, to }) });
  const rows = data?.rows ?? [];
  const hasDue = rows.some(r => r.commission > 0 && !r.already_paid);
  const cur = currencySymbol();
  return (
    <>
      <HrHeaderActions>
        <button type="button" className="odoo-btn-primary" disabled={!hasDue} onClick={() => setPayout(true)} title={hasDue ? undefined : 'Rien à verser sur cette période'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Banknote size={13} aria-hidden="true" /> Verser sur la paie</button>
      </HrHeaderActions>
      <Toolbar>
        <label className="hr-tools"><span className="hr-tools-label">Du</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="odoo-filter-dropdown" /></label>
        <label className="hr-tools"><span className="hr-tools-label">Au</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className="odoo-filter-dropdown" /></label>
        {switcher}
      </Toolbar>
      {isLoading ? <LoadingState />
        : isError ? <ErrorState error={error} onRetry={() => void refetch()} />
        : rows.length === 0 ? <EmptyState icon={Percent} title="Aucune commission sur la période" text="Aucune vente n'est attribuée à un vendeur entre ces deux dates." />
        : (
          <DataPanel label="Relevé des commissions" footer={<TableFooter note={<>
            {rows.length} vendeur{rows.length > 1 ? 's' : ''} · Base : lignes de ventes de biens attribuées au vendeur (hors avances). Brut — les retours ne sont pas déduits. « Versé » = déjà porté sur un bulletin de paie.
          </>} />}>
            <table className="odoo-table">
              <thead><tr><th>Vendeur</th><th>Mode</th><th className="ds-num">Ventes</th><th className="ds-num">CA attribué ({cur})</th><th className="ds-num">Base commissionnable ({cur})</th><th className="ds-num">Commission ({cur})</th><th>Statut</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.employee_id}>
                    <td className="ds-strong">{r.employee_name}</td>
                    <td>{r.mode === 'scheme'
                      ? <span className="odoo-tag odoo-tag-purple" title={r.scheme_name || ''}>Paliers{r.scheme_name ? ` · ${r.scheme_name}` : ''}</span>
                      : <span className="odoo-tag odoo-tag-blue">Taux fixe</span>}</td>
                    <td className="ds-num">{r.sale_count}</td>
                    <td className="ds-num">{amount(r.sales_base)}</td>
                    <td className="ds-num">{r.mode === 'scheme' ? '—' : amount(r.commissionable_base)}</td>
                    <td className="ds-num ds-strong">{amount(r.commission)}</td>
                    <td>{r.already_paid ? <StatusTag tone="done" label="Versé" /> : r.commission > 0 ? <StatusTag tone="todo" label="À verser" /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={3}>Total</td><td className="ds-num">{amount(data!.totals.sales_base)}</td><td /><td className="ds-num">{amount(data!.totals.commission)}</td><td />
              </tr></tfoot>
            </table>
          </DataPanel>
        )}
      {payout && <PayoutModal from={from} to={to} onClose={() => setPayout(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['commission-statement'] }); setPayout(false); }} />}
    </>
  );
}

function PayoutModal({ from, to, onClose, onDone }: { from: string; to: string; onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const [payMonth, setPayMonth] = useState(now.getMonth() + 1);
  const [payYear, setPayYear] = useState(now.getFullYear());
  const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const run = useMutation({
    mutationFn: () => commissionsApi.payout({ from, to, payMonth, payYear }),
    onSuccess: (r) => {
      const v = r.versed.length, s = r.skipped.length;
      notify.success(`${v} commission(s) versée(s) sur la paie ${MONTHS[payMonth - 1]} ${payYear}${s ? ` · ${s} déjà versée(s), ignorée(s)` : ''}`);
      onDone();
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <HrModal icon={Banknote} crumb="Commissions" title="Verser les commissions sur la paie" width={480} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={run.isPending}>Annuler</button>
        <SubmitButton pending={run.isPending} onClick={() => run.mutate()}>Verser</SubmitButton>
      </>}>
      <p style={{ fontSize: 14, color: 'var(--ds-muted)', margin: 0 }}>
        Les commissions dues du <strong>{frDate(from)}</strong> au <strong>{frDate(to)}</strong> seront ajoutées au bulletin de paie du mois choisi (rubrique « Commissions commerciales », gain imposable). Une période déjà versée est ignorée.
      </p>
      <div className="ds-form-grid">
        <Field label="Mois de paie" required>
          <select className={inputCls} value={payMonth} onChange={e => setPayMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        </Field>
        <Field label="Année" required>
          <input className={inputCls} type="number" value={payYear} onChange={e => setPayYear(Number(e.target.value))} />
        </Field>
      </div>
    </HrModal>
  );
}

/* ─── Barèmes à taux fixe (mig 123) ────────────────────────────────────── */
function Rules({ switcher }: { switcher: ReactNode }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rules = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['commission-rules'], queryFn: () => commissionsApi.listRules() });
  const [modal, setModal] = useState<null | { rule?: CommissionRule }>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['commission-rules'] });
  const del = useMutation({ mutationFn: (id: string) => commissionsApi.deleteRule(id), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <>
      <HrHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setModal({})} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} aria-hidden="true" /> Nouveau barème</button>
      </HrHeaderActions>
      <Toolbar>
        <span className="hr-tools-label">Taux fixes par vendeur, tous produits ou par produit</span>
        {switcher}
      </Toolbar>
      {isLoading ? <LoadingState />
        : isError ? <ErrorState error={error} onRetry={() => void refetch()} />
        : rules.length === 0 ? <EmptyState icon={Percent} title="Aucun barème" text="Un barème fixe le taux de commission d'un vendeur."
            action={<button type="button" className="odoo-btn-primary" onClick={() => setModal({})}>Nouveau barème</button>} />
        : (
          <DataPanel label="Barèmes à taux fixe" footer={<TableFooter note={`${rules.length} barème${rules.length > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>Vendeur</th><th>Portée</th><th className="ds-num">Taux (%)</th><th>Validité</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td className="ds-strong">{r.employee_name}</td>
                    <td>{r.applies_to === 'product' ? <span>Produit : {r.product_name || '—'}</span> : 'Tous les produits'}</td>
                    <td className="ds-num ds-strong">{Number(r.rate_percent)}</td>
                    <td>{validity(r.valid_from, r.valid_to)}</td>
                    <td><StatusTag tone={r.is_current ? 'done' : 'cancelled'} label={r.is_current ? 'En vigueur' : 'Hors période'} /></td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setModal({ rule: r })}><Pencil size={13} aria-hidden="true" /> Modifier</button>
                      <RowMenu label={`Plus d'actions pour le barème de ${r.employee_name}`} items={[{
                        label: 'Supprimer', icon: Trash2, danger: true,
                        onSelect: async () => { if (await confirm('Supprimer ce barème ?', { title: 'Supprimer le barème', confirmLabel: 'Supprimer', danger: true })) del.mutate(r.id); },
                      }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      {modal && <RuleModal rule={modal.rule} onClose={() => setModal(null)} onSaved={() => { invalidate(); setModal(null); }} />}
    </>
  );
}

function RuleModal({ rule, onClose, onSaved }: { rule?: CommissionRule; onClose: () => void; onSaved: () => void }) {
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() as Promise<EmpOpt[]> });
  const { data: prodResp } = useQuery({ queryKey: ['products', 'all-commission'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((prodResp as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const empOptions = useMemo(() => employees.map(e => ({ id: e.id, label: `${e.first_name} ${e.last_name}` })), [employees]);
  const prodOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name) })), [products]);

  const [employeeId, setEmployeeId] = useState(rule?.employee_id || '');
  const [rate, setRate] = useState(rule ? String(Number(rule.rate_percent)) : '');
  const [appliesTo, setAppliesTo] = useState<'all' | 'product'>(rule?.applies_to === 'product' ? 'product' : 'all');
  const [appliesId, setAppliesId] = useState(rule?.applies_to === 'product' ? (rule.applies_id || '') : '');
  const [validFrom, setValidFrom] = useState(rule?.valid_from || today());
  const [validTo, setValidTo] = useState(rule?.valid_to || '');

  const save = useMutation({
    mutationFn: () => {
      const payload: CommissionRuleInput = {
        employeeId, ratePercent: Number(rate) || 0, appliesTo,
        appliesId: appliesTo === 'product' ? appliesId : null, validFrom, validTo: validTo || null,
      };
      return rule ? commissionsApi.updateRule(rule.id, payload) : commissionsApi.createRule(payload);
    },
    onSuccess: () => { notify.success(rule ? 'Barème enregistré' : 'Barème créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const rateOk = Number(rate) >= 0 && Number(rate) <= 100;
  const valid = employeeId && rateOk && validFrom && (appliesTo === 'all' || appliesId);

  return (
    <HrModal icon={Percent} crumb="Commissions" title={rule ? 'Modifier le barème' : 'Nouveau barème'} width={520} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={save.isPending}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{rule ? 'Enregistrer' : 'Créer'}</SubmitButton>
      </>}>
      <Field label="Vendeur" required>
        <SearchSelect options={empOptions} value={employeeId} onChange={setEmployeeId} placeholder="Choisir un vendeur…" width="100%" size="md" ariaLabel="Vendeur" />
      </Field>
      <div className="ds-form-grid">
        <Field label="Taux (%)" required error={rate !== '' && !rateOk ? 'Le taux doit être compris entre 0 et 100.' : undefined}>
          <input className={inputCls} type="number" step="0.01" min="0" max="100" value={rate} onChange={e => setRate(e.target.value)} />
        </Field>
        <Field label="Portée" required>
          <select className={inputCls} value={appliesTo} onChange={e => setAppliesTo(e.target.value as 'all' | 'product')}>
            <option value="all">Tous les produits</option>
            <option value="product">Un produit</option>
          </select>
        </Field>
      </div>
      {appliesTo === 'product' && (
        <Field label="Produit" required>
          <SearchSelect options={prodOptions} value={appliesId} onChange={setAppliesId} placeholder="Choisir un produit…" width="100%" size="md" ariaLabel="Produit" />
        </Field>
      )}
      <div className="ds-form-grid">
        <Field label="Valable du" required><input className={inputCls} type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} /></Field>
        <Field label="Au (optionnel)"><input className={inputCls} type="date" value={validTo} onChange={e => setValidTo(e.target.value)} /></Field>
      </div>
    </HrModal>
  );
}

/* ─── Contrats-cadres à paliers + affectations (mig 393) ───────────────── */
function Schemes({ switcher }: { switcher: ReactNode }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: schemes = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['commission-schemes'], queryFn: () => commissionsApi.listSchemes() });
  const { data: assignments = [] } = useQuery({ queryKey: ['commission-assignments'], queryFn: () => commissionsApi.listAssignments() });
  const [modal, setModal] = useState<null | { scheme?: CommissionScheme }>(null);
  const [assign, setAssign] = useState(false);
  const invSchemes = () => qc.invalidateQueries({ queryKey: ['commission-schemes'] });
  const invAssign = () => qc.invalidateQueries({ queryKey: ['commission-assignments'] });
  const delScheme = useMutation({ mutationFn: (id: string) => commissionsApi.deleteScheme(id), onSuccess: invSchemes, onError: e => notify.error(apiErrorMessage(e)) });
  const delAssign = useMutation({ mutationFn: (id: string) => commissionsApi.unassign(id), onSuccess: invAssign, onError: e => notify.error(apiErrorMessage(e)) });

  const tiersLabel = (s: CommissionScheme) => s.tiers.map(t => `≥ ${amount(t.from_amount)} → ${Number(t.rate_percent)} %`).join(' · ');

  return (
    <>
      <HrHeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={() => setAssign(true)} disabled={schemes.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Link2 size={13} aria-hidden="true" /> Affecter un vendeur</button>
        <button type="button" className="odoo-btn-primary" onClick={() => setModal({})} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} aria-hidden="true" /> Nouveau contrat-cadre</button>
      </HrHeaderActions>
      <Toolbar>
        <span className="hr-tools-label">Taux progressifs selon le chiffre d'affaires de la période</span>
        {switcher}
      </Toolbar>

      {isLoading ? <LoadingState />
        : isError ? <ErrorState error={error} onRetry={() => void refetch()} />
        : schemes.length === 0 ? <EmptyState icon={Layers} title="Aucun contrat-cadre" text="Un contrat-cadre définit des paliers de taux selon le volume vendu."
            action={<button type="button" className="odoo-btn-primary" onClick={() => setModal({})}>Nouveau contrat-cadre</button>} />
        : (
          <DataPanel label="Contrats-cadres" footer={<TableFooter note={`${schemes.length} contrat${schemes.length > 1 ? 's' : ''}-cadre${schemes.length > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>Contrat-cadre</th><th>Paliers progressifs ({currencySymbol()} de CA)</th><th className="ds-num">Vendeurs</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {schemes.map(s => (
                  <tr key={s.id}>
                    <td className="ds-strong">{s.name}</td>
                    <td>{tiersLabel(s)}</td>
                    <td className="ds-num">{s.assigned_count}</td>
                    <td><StatusTag tone={s.is_active ? 'done' : 'cancelled'} label={s.is_active ? 'Actif' : 'Inactif'} /></td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setModal({ scheme: s })}><Pencil size={13} aria-hidden="true" /> Modifier</button>
                      <RowMenu label={`Plus d'actions pour ${s.name}`} items={[{
                        label: 'Supprimer', icon: Trash2, danger: true,
                        onSelect: async () => { if (await confirm(`Supprimer le contrat-cadre « ${s.name} » ?`, { title: 'Supprimer le contrat-cadre', confirmLabel: 'Supprimer', danger: true })) delScheme.mutate(s.id); },
                      }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}

      <SectionHeader title="Vendeurs affectés" />
      {assignments.length === 0 ? <EmptyState icon={Link2} title="Aucune affectation" text="Affectez un vendeur à un contrat-cadre pour lui appliquer ses paliers." /> : (
        <DataPanel label="Vendeurs affectés" footer={<TableFooter note={`${assignments.length} affectation${assignments.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Vendeur</th><th>Contrat-cadre</th><th>Validité</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {assignments.map(a => (
                <tr key={a.id}>
                  <td className="ds-strong">{a.employee_name}</td>
                  <td>{a.scheme_name}</td>
                  <td>{validity(a.valid_from, a.valid_to)}</td>
                  <td><StatusTag tone={a.is_current ? 'done' : 'cancelled'} label={a.is_current ? 'En vigueur' : 'Hors période'} /></td>
                  <td className="ds-actions">
                    <RowMenu label={`Plus d'actions pour l'affectation de ${a.employee_name}`} items={[{
                      label: 'Retirer', icon: Trash2, danger: true,
                      onSelect: async () => { if (await confirm('Retirer cette affectation ?', { title: 'Retirer l\'affectation', confirmLabel: 'Retirer', danger: true })) delAssign.mutate(a.id); },
                    }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {modal && <SchemeModal scheme={modal.scheme} onClose={() => setModal(null)} onSaved={() => { invSchemes(); setModal(null); }} />}
      {assign && <AssignModal schemes={schemes} onClose={() => setAssign(false)} onSaved={() => { invAssign(); setAssign(false); }} />}
    </>
  );
}

type TierRow = { fromAmount: string; ratePercent: string };

function SchemeModal({ scheme, onClose, onSaved }: { scheme?: CommissionScheme; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(scheme?.name || '');
  const [isActive, setIsActive] = useState(scheme?.is_active ?? true);
  const [tiers, setTiers] = useState<TierRow[]>(
    scheme?.tiers.length
      ? scheme.tiers.map(t => ({ fromAmount: String(Number(t.from_amount)), ratePercent: String(Number(t.rate_percent)) }))
      : [{ fromAmount: '0', ratePercent: '' }]
  );
  const setTier = (i: number, patch: Partial<TierRow>) => setTiers(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const save = useMutation({
    mutationFn: () => {
      const payload: CommissionSchemeInput = {
        name: name.trim(), isActive,
        tiers: tiers.filter(t => t.ratePercent !== '').map(t => ({ fromAmount: Number(t.fromAmount) || 0, ratePercent: Number(t.ratePercent) || 0 })),
      };
      return scheme ? commissionsApi.updateScheme(scheme.id, payload) : commissionsApi.createScheme(payload);
    },
    onSuccess: () => { notify.success(scheme ? 'Contrat-cadre enregistré' : 'Contrat-cadre créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const filled = tiers.filter(t => t.ratePercent !== '');
  const valid = name.trim() && filled.length > 0 && filled.every(t => Number(t.ratePercent) >= 0 && Number(t.ratePercent) <= 100);

  return (
    <HrModal icon={Layers} crumb="Commissions" title={scheme ? 'Modifier le contrat-cadre' : 'Nouveau contrat-cadre'} width={560} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={save.isPending}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{scheme ? 'Enregistrer' : 'Créer'}</SubmitButton>
      </>}>
      <Field label="Nom" required>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="ex : Commission vendeurs 2026" />
      </Field>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Actif
      </label>
      <Field label="Paliers progressifs" required hint="La tranche de chiffre d'affaires au-delà du seuil est commissionnée au taux indiqué.">
        <DataPanel label="Paliers progressifs">
        <table className="odoo-table ds-dense">
          <thead><tr><th>À partir de ({currencySymbol()} de CA)</th><th style={{ width: 120 }}>Taux (%)</th><th className="ds-actions" style={{ width: 48 }}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i}>
                <td><input className={`${inputCls} sm`} aria-label={`Seuil du palier ${i + 1}`} type="number" step="0.01" min="0" value={t.fromAmount} onChange={e => setTier(i, { fromAmount: e.target.value })} placeholder="0" /></td>
                <td><input className={`${inputCls} sm`} aria-label={`Taux du palier ${i + 1}`} type="number" step="0.01" min="0" max="100" value={t.ratePercent} onChange={e => setTier(i, { ratePercent: e.target.value })} placeholder="ex 3" /></td>
                <td className="ds-actions">{tiers.length > 1 && <button type="button" className="ds-icon-btn" aria-label={`Retirer le palier ${i + 1}`} title="Retirer" onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
        <div><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setTiers(ts => [...ts, { fromAmount: '', ratePercent: '' }])}><Plus size={13} aria-hidden="true" /> Ajouter un palier</button></div>
      </Field>
    </HrModal>
  );
}

function AssignModal({ schemes, onClose, onSaved }: { schemes: CommissionScheme[]; onClose: () => void; onSaved: () => void }) {
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() as Promise<EmpOpt[]> });
  const empOptions = useMemo(() => employees.map(e => ({ id: e.id, label: `${e.first_name} ${e.last_name}` })), [employees]);
  const [employeeId, setEmployeeId] = useState('');
  const [schemeId, setSchemeId] = useState(schemes[0]?.id || '');
  const [validFrom, setValidFrom] = useState(firstOfMonth());
  const [validTo, setValidTo] = useState('');
  const save = useMutation({
    mutationFn: () => commissionsApi.assign({ employeeId, schemeId, validFrom, validTo: validTo || null }),
    onSuccess: () => { notify.success('Vendeur affecté'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <HrModal icon={Link2} crumb="Commissions" title="Affecter un vendeur à un contrat-cadre" width={480} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={save.isPending}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={!employeeId || !schemeId || !validFrom} onClick={() => save.mutate()}>Affecter</SubmitButton>
      </>}>
      <Field label="Vendeur" required>
        <SearchSelect options={empOptions} value={employeeId} onChange={setEmployeeId} placeholder="Choisir un vendeur…" width="100%" size="md" ariaLabel="Vendeur" />
      </Field>
      <Field label="Contrat-cadre" required>
        <select className={inputCls} value={schemeId} onChange={e => setSchemeId(e.target.value)}>{schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <div className="ds-form-grid">
        <Field label="Valable du" required><input className={inputCls} type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} /></Field>
        <Field label="Au (optionnel)"><input className={inputCls} type="date" value={validTo} onChange={e => setValidTo(e.target.value)} /></Field>
      </div>
    </HrModal>
  );
}
