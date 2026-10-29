import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, X, Loader2, Trash2, Pencil } from 'lucide-react';
import { commissionsApi, type CommissionRule, type CommissionRuleInput } from '../../api/commissions.api';
import { employeesApi } from '../../api/employees.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (v: number) => `${(Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

type EmpOpt = { id: string; first_name: string; last_name: string };

/** Commissions commerciales (mig 123) : relevé par période + barèmes par vendeur. */
export default function CommissionsTab() {
  const [view, setView] = useState<'statement' | 'rules'>('statement');
  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={Percent} title="Commissions commerciales">
        Un barème attribue un taux à un vendeur, pour tous les produits ou pour un produit précis (le plus spécifique l'emporte). Le relevé calcule, sur une période, la commission due sur les ventes qui lui sont attribuées.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={view === 'statement' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('statement')}>Relevé</button>
        <button className={view === 'rules' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('rules')}>Barèmes</button>
      </div>
      {view === 'statement' ? <Statement /> : <Rules />}
    </div>
  );
}

function Statement() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const { data, isLoading } = useQuery({ queryKey: ['commission-statement', from, to], queryFn: () => commissionsApi.statement({ from, to }) });
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Du</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Au</span><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Vendeur</th><th style={{ textAlign: 'right' }}>Ventes</th><th style={{ textAlign: 'right' }}>CA attribué</th><th style={{ textAlign: 'right' }}>Base commissionnable</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && (data?.rows.length ?? 0) === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune vente attribuée à un vendeur sur la période.</td></tr>}
            {data?.rows.map(r => (
              <tr key={r.employee_id}>
                <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                <td style={{ textAlign: 'right' }}>{r.sale_count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.sales_base)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{money(r.commissionable_base)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.commission)}</td>
              </tr>
            ))}
          </tbody>
          {(data?.rows.length ?? 0) > 0 && (
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
              <td>Total</td><td /><td style={{ textAlign: 'right' }}>{money(data!.totals.sales_base)}</td><td /><td style={{ textAlign: 'right' }}>{money(data!.totals.commission)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Base : lignes de ventes de biens attribuées au vendeur (hors avances). Brut — les retours ne sont pas déduits.</p>
    </>
  );
}

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
