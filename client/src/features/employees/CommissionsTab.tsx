import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, X, Loader2, Trash2, Pencil, Layers, Banknote, Link2 } from 'lucide-react';
import {
  commissionsApi, type CommissionRule, type CommissionRuleInput,
  type CommissionScheme, type CommissionSchemeInput,
} from '../../api/commissions.api';
import { employeesApi } from '../../api/employees.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (v: number | string) => `${(Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

type EmpOpt = { id: string; first_name: string; last_name: string };

/** Commissions commerciales : relevé + barèmes fixes (mig 123) + contrats-cadres à paliers et versement sur paie (mig 393). */
export default function CommissionsTab() {
  const [view, setView] = useState<'statement' | 'rules' | 'schemes'>('statement');
  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={Percent} title="Commissions commerciales">
        Un vendeur est commissionné soit à un <strong>taux fixe</strong> (par produit ou tous produits), soit via un <strong>contrat-cadre à paliers</strong> (taux progressif selon le volume) — le contrat-cadre l'emporte. Le relevé calcule la commission due sur une période, puis se verse sur le bulletin de paie.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={view === 'statement' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('statement')}>Relevé</button>
        <button className={view === 'rules' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('rules')}>Barèmes fixes</button>
        <button className={view === 'schemes' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('schemes')}>Contrats-cadres</button>
      </div>
      {view === 'statement' ? <Statement /> : view === 'rules' ? <Rules /> : <Schemes />}
    </div>
  );
}

/* ─── Relevé + versement sur paie ──────────────────────────────────────── */
function Statement() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [payout, setPayout] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['commission-statement', from, to], queryFn: () => commissionsApi.statement({ from, to }) });
  const hasDue = (data?.rows ?? []).some(r => r.commission > 0 && !r.already_paid);
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Du</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Au</span><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></label>
        <button className="odoo-btn-primary" disabled={!hasDue} onClick={() => setPayout(true)} title={hasDue ? '' : 'Rien à verser sur cette période'}><Banknote size={14} /> Verser sur la paie</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Vendeur</th><th>Mode</th><th style={{ textAlign: 'right' }}>Ventes</th><th style={{ textAlign: 'right' }}>CA attribué</th><th style={{ textAlign: 'right' }}>Base commissionnable</th><th style={{ textAlign: 'right' }}>Commission</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && (data?.rows.length ?? 0) === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune vente attribuée à un vendeur sur la période.</td></tr>}
            {data?.rows.map(r => (
              <tr key={r.employee_id}>
                <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                <td>{r.mode === 'scheme'
                  ? <span className="odoo-tag odoo-tag-purple" title={r.scheme_name || ''}>Paliers{r.scheme_name ? ` · ${r.scheme_name}` : ''}</span>
                  : <span className="odoo-tag odoo-tag-blue">Taux fixe</span>}</td>
                <td style={{ textAlign: 'right' }}>{r.sale_count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.sales_base)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.mode === 'scheme' ? '—' : money(r.commissionable_base)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.commission)}</td>
                <td>{r.already_paid && <span className="odoo-tag odoo-tag-green">Versé</span>}</td>
              </tr>
            ))}
          </tbody>
          {(data?.rows.length ?? 0) > 0 && (
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
              <td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}>{money(data!.totals.sales_base)}</td><td /><td style={{ textAlign: 'right' }}>{money(data!.totals.commission)}</td><td />
            </tr></tfoot>
          )}
        </table>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Base : lignes de ventes de biens attribuées au vendeur (hors avances). Brut — les retours ne sont pas déduits. « Versé » = déjà porté sur un bulletin de paie.</p>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(480px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Banknote size={16} /> Verser les commissions sur la paie</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)', margin: 0 }}>
            Les commissions dues du <strong>{from}</strong> au <strong>{to}</strong> seront ajoutées au bulletin de paie du mois choisi (rubrique « Commissions commerciales », gain imposable). Une période déjà versée est ignorée.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1 }}><span style={{ color: 'var(--theme-text-muted)' }}>Mois de paie</span>
              <select value={payMonth} onChange={e => setPayMonth(Number(e.target.value))} style={{ ...inp, width: '100%' }}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', width: 120 }}><span style={{ color: 'var(--theme-text-muted)' }}>Année</span>
              <input type="number" value={payYear} onChange={e => setPayYear(Number(e.target.value))} style={inp} /></label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} Verser</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Barèmes à taux fixe (mig 123) ────────────────────────────────────── */
function Rules() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['commission-rules'], queryFn: () => commissionsApi.listRules() });
  const [modal, setModal] = useState<null | { rule?: CommissionRule }>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['commission-rules'] });
  const del = useMutation({ mutationFn: (id: string) => commissionsApi.deleteRule(id), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setModal({})}><Plus size={14} /> Nouveau barème</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Vendeur</th><th>Portée</th><th style={{ textAlign: 'right' }}>Taux</th><th>Validité</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rules.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun barème.</td></tr>}
            {rules.map(r => (
              <tr key={r.id} style={{ opacity: r.is_current ? 1 : 0.55 }}>
                <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                <td>{r.applies_to === 'product' ? <span>Produit : {r.product_name || '—'}</span> : <span className="odoo-tag odoo-tag-blue">Tous les produits</span>}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{Number(r.rate_percent)} %</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{r.valid_from}{r.valid_to ? ` → ${r.valid_to}` : ' →'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem' }} onClick={() => setModal({ rule: r })}><Pencil size={12} /></button>
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem', marginLeft: 6 }} onClick={async () => { if (await confirm('Supprimer ce barème ?', { danger: true })) del.mutate(r.id); }}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const valid = employeeId && Number(rate) >= 0 && Number(rate) <= 100 && validFrom && (appliesTo === 'all' || appliesId);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(520px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Percent size={16} /> {rule ? 'Modifier le barème' : 'Nouveau barème'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Vendeur</span>
            <SearchSelect options={empOptions} value={employeeId} onChange={setEmployeeId} placeholder="Choisir un vendeur…" width="100%" />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', width: 120 }}><span style={{ color: 'var(--theme-text-muted)' }}>Taux (%)</span><input type="number" step="0.01" min="0" max="100" value={rate} onChange={e => setRate(e.target.value)} style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 160 }}><span style={{ color: 'var(--theme-text-muted)' }}>Portée</span>
              <select value={appliesTo} onChange={e => setAppliesTo(e.target.value as 'all' | 'product')} style={{ ...inp, width: '100%' }}>
                <option value="all">Tous les produits</option>
                <option value="product">Un produit</option>
              </select>
            </label>
          </div>
          {appliesTo === 'product' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Produit</span>
              <SearchSelect options={prodOptions} value={appliesId} onChange={setAppliesId} placeholder="Choisir un produit…" width="100%" />
            </label>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Valable du</span><input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>au (optionnel)</span><input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} style={inp} /></label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {rule ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Contrats-cadres à paliers + affectations (mig 393) ───────────────── */
function Schemes() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: schemes = [], isLoading } = useQuery({ queryKey: ['commission-schemes'], queryFn: () => commissionsApi.listSchemes() });
  const { data: assignments = [] } = useQuery({ queryKey: ['commission-assignments'], queryFn: () => commissionsApi.listAssignments() });
  const [modal, setModal] = useState<null | { scheme?: CommissionScheme }>(null);
  const [assign, setAssign] = useState(false);
  const invSchemes = () => qc.invalidateQueries({ queryKey: ['commission-schemes'] });
  const invAssign = () => qc.invalidateQueries({ queryKey: ['commission-assignments'] });
  const delScheme = useMutation({ mutationFn: (id: string) => commissionsApi.deleteScheme(id), onSuccess: invSchemes, onError: e => notify.error(apiErrorMessage(e)) });
  const delAssign = useMutation({ mutationFn: (id: string) => commissionsApi.unassign(id), onSuccess: invAssign, onError: e => notify.error(apiErrorMessage(e)) });

  const tiersLabel = (s: CommissionScheme) => s.tiers.map(t => `≥${money(t.from_amount).replace(' DH', '')} → ${Number(t.rate_percent)}%`).join(' · ');

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="odoo-btn-primary" onClick={() => setModal({})}><Plus size={14} /> Nouveau contrat-cadre</button>
        <button className="odoo-btn-secondary" onClick={() => setAssign(true)} disabled={schemes.length === 0}><Link2 size={14} /> Affecter un vendeur</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Contrat-cadre</th><th>Paliers progressifs</th><th style={{ textAlign: 'right' }}>Vendeurs</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && schemes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun contrat-cadre.</td></tr>}
            {schemes.map(s => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                <td style={{ fontWeight: 500 }}>{s.name}{!s.is_active && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Inactif</span>}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{tiersLabel(s)}</td>
                <td style={{ textAlign: 'right' }}>{s.assigned_count}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem' }} onClick={() => setModal({ scheme: s })}><Pencil size={12} /></button>
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem', marginLeft: 6 }} onClick={async () => { if (await confirm(`Supprimer le contrat-cadre « ${s.name} » ?`, { danger: true })) delScheme.mutate(s.id); }}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-strong)', margin: '4px 0' }}>Vendeurs affectés</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Vendeur</th><th>Contrat-cadre</th><th>Validité</th><th /></tr></thead>
            <tbody>
              {assignments.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 18, color: 'var(--theme-text-muted)' }}>Aucune affectation.</td></tr>}
              {assignments.map(a => (
                <tr key={a.id} style={{ opacity: a.is_current ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 500 }}>{a.employee_name}</td>
                  <td>{a.scheme_name}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{a.valid_from}{a.valid_to ? ` → ${a.valid_to}` : ' →'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem' }} onClick={async () => { if (await confirm('Retirer cette affectation ?', { danger: true })) delAssign.mutate(a.id); }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(560px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Layers size={16} /> {scheme ? 'Modifier le contrat-cadre' : 'Nouveau contrat-cadre'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ex : Commission vendeurs 2026" style={inp} /></label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Actif
          </label>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Paliers progressifs (la tranche de CA au-delà du seuil est au taux indiqué)</span>
            <table className="odoo-table" style={{ marginTop: 6 }}>
              <thead><tr><th>À partir de (DH de CA)</th><th style={{ width: 120 }}>Taux (%)</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={i}>
                    <td><input type="number" step="0.01" min="0" value={t.fromAmount} onChange={e => setTier(i, { fromAmount: e.target.value })} style={{ ...inp, width: '100%' }} placeholder="0" /></td>
                    <td><input type="number" step="0.01" min="0" max="100" value={t.ratePercent} onChange={e => setTier(i, { ratePercent: e.target.value })} style={{ ...inp, width: '100%', textAlign: 'right' }} placeholder="ex 3" /></td>
                    <td>{tiers.length > 1 && <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.4rem' }} onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))}><Trash2 size={11} /></button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}><button type="button" className="odoo-btn-secondary" onClick={() => setTiers(ts => [...ts, { fromAmount: '', ratePercent: '' }])}><Plus size={12} /> Palier</button></td></tr></tfoot>
            </table>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {scheme ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(480px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Link2 size={16} /> Affecter un vendeur à un contrat-cadre</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Vendeur</span>
            <SearchSelect options={empOptions} value={employeeId} onChange={setEmployeeId} placeholder="Choisir un vendeur…" width="100%" /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Contrat-cadre</span>
            <select value={schemeId} onChange={e => setSchemeId(e.target.value)} style={{ ...inp, width: '100%' }}>{schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Valable du</span><input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>au (optionnel)</span><input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} style={inp} /></label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!employeeId || !schemeId || !validFrom || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Affecter</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
