import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2, X, ListChecks } from 'lucide-react';
import { bankReconciliationApi, type BankRule, type BankRuleInput } from '../../api/bank-reconciliation.api';
import { planComptableApi } from '../../api/ledger.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';

/**
 * Règles de rapprochement bancaire (G4-02). Une règle reconnaît des lignes de relevé par
 * leur libellé, leur sens ou leur montant, puis soit les rapproche d'une écriture existante
 * avec des tolérances, soit génère l'écriture (frais bancaires, commissions, agios).
 */

const field: React.CSSProperties = { width: '100%', fontSize: '0.85rem', padding: '7px 9px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export type RuleDraft = Partial<BankRuleInput>;

export function RuleFormModal({ rule, draft, onClose, onSaved }: { rule?: BankRule | null; draft?: RuleDraft; onClose: () => void; onSaved: () => void }) {
  const { data: accounts = [] } = useQuery({ queryKey: ['plan-comptable'], queryFn: () => planComptableApi.list() });
  const [f, setF] = useState({
    label: rule?.label ?? draft?.label ?? '',
    priority: String(rule?.priority ?? draft?.priority ?? 100),
    labelContains: rule?.label_contains ?? draft?.labelContains ?? '',
    labelRegex: rule?.label_regex ?? draft?.labelRegex ?? '',
    direction: (rule?.direction ?? draft?.direction ?? '') as '' | 'in' | 'out',
    amountMin: rule?.amount_min != null ? String(rule.amount_min) : draft?.amountMin != null ? String(draft.amountMin) : '',
    amountMax: rule?.amount_max != null ? String(rule.amount_max) : draft?.amountMax != null ? String(draft.amountMax) : '',
    action: (rule?.action ?? draft?.action ?? 'post_entry') as 'match' | 'post_entry',
    counterAccountId: rule?.counter_account_id ?? draft?.counterAccountId ?? '',
    entryLabel: rule?.entry_label ?? draft?.entryLabel ?? '',
    amountTolerance: String(rule?.amount_tolerance ?? 0),
    dateToleranceDays: String(rule?.date_tolerance_days ?? 7),
    isActive: rule?.is_active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const options = useMemo(() => (accounts as { id: string; code: string; label: string; is_active?: boolean }[])
    .filter(a => a.is_active !== false && /^\d{4,}$/.test(a.code))
    .map(a => ({ id: a.id, label: `${a.code} — ${a.label}` })), [accounts]);

  const save = useMutation({
    mutationFn: () => bankReconciliationApi.saveRule({
      label: f.label, priority: Number(f.priority) || 100, isActive: f.isActive,
      labelContains: f.labelContains || null, labelRegex: f.labelRegex || null, direction: f.direction || null,
      amountMin: num(f.amountMin), amountMax: num(f.amountMax), action: f.action,
      counterAccountId: f.action === 'post_entry' ? f.counterAccountId || null : null, entryLabel: f.entryLabel || null,
      amountTolerance: num(f.amountTolerance) ?? 0, dateToleranceDays: Number(f.dateToleranceDays) || 0,
    }, rule?.id),
    onSuccess: () => { notify.success('Règle enregistrée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" onClick={e => e.stopPropagation()} role="dialog" aria-label="Règle de rapprochement"
        style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', background: 'var(--odoo-bg)', borderRadius: 6, padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <strong style={{ fontSize: '1rem' }}>{rule ? 'Modifier la règle' : 'Nouvelle règle de rapprochement'}</strong>
          <button type="button" className="odoo-pager-btn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Fermer"><X size={14} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <div><label style={lbl} htmlFor="r-label">Nom</label><input id="r-label" style={field} value={f.label} onChange={e => set('label', e.target.value)} placeholder="Frais de tenue de compte" /></div>
          <div><label style={lbl} htmlFor="r-prio">Priorité</label><input id="r-prio" style={field} inputMode="numeric" value={f.priority} onChange={e => set('priority', e.target.value)} /></div>
        </div>
        <fieldset style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 10 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0 4px' }}>Condition (au moins une)</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={lbl} htmlFor="r-contains">Le libellé contient</label><input id="r-contains" style={field} value={f.labelContains} onChange={e => set('labelContains', e.target.value)} placeholder="FRAIS TENUE" /></div>
            <div><label style={lbl} htmlFor="r-regex">ou expression</label><input id="r-regex" style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={f.labelRegex} onChange={e => set('labelRegex', e.target.value)} placeholder="^COM\s*CB" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div><label style={lbl} htmlFor="r-dir">Sens</label>
              <select id="r-dir" style={field} value={f.direction} onChange={e => set('direction', e.target.value as '' | 'in' | 'out')}>
                <option value="">Les deux</option><option value="out">Sortie (débit)</option><option value="in">Entrée (crédit)</option>
              </select></div>
            <div><label style={lbl} htmlFor="r-min">Montant minimum</label><input id="r-min" style={field} inputMode="decimal" value={f.amountMin} onChange={e => set('amountMin', e.target.value)} /></div>
            <div><label style={lbl} htmlFor="r-max">Montant maximum</label><input id="r-max" style={field} inputMode="decimal" value={f.amountMax} onChange={e => set('amountMax', e.target.value)} /></div>
          </div>
        </fieldset>
        <fieldset style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 10 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0 4px' }}>Action</legend>
          <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={f.action === 'post_entry'} onChange={() => set('action', 'post_entry')} /> Générer l'écriture</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={f.action === 'match'} onChange={() => set('action', 'match')} /> Rapprocher d'une écriture existante</label>
          </div>
          {f.action === 'post_entry' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><span style={lbl}>Compte de contrepartie</span>
                <SearchSelect options={options} value={f.counterAccountId} onChange={v => set('counterAccountId', v)} placeholder="6147 — Services bancaires" size="md" width="100%" ariaLabel="Compte de contrepartie" /></div>
              <div><label style={lbl} htmlFor="r-elabel">Libellé de l'écriture</label><input id="r-elabel" style={field} value={f.entryLabel} onChange={e => set('entryLabel', e.target.value)} placeholder="Frais bancaires" /></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={lbl} htmlFor="r-tol">Écart de montant toléré ({currencySymbol()})</label><input id="r-tol" style={field} inputMode="decimal" value={f.amountTolerance} onChange={e => set('amountTolerance', e.target.value)} /></div>
              <div><label style={lbl} htmlFor="r-days">Écart de date toléré (jours)</label><input id="r-days" style={field} inputMode="numeric" value={f.dateToleranceDays} onChange={e => set('dateToleranceDays', e.target.value)} /></div>
            </div>
          )}
        </fieldset>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Règle active
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={save.isPending || f.label.trim().length < 2} onClick={() => save.mutate()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export default function BankRulesPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<BankRule | null | 'new'>(null);
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['bank-rules'], queryFn: bankReconciliationApi.rules });
  const remove = useMutation({
    mutationFn: (id: string) => bankReconciliationApi.deleteRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-rules'] }); notify.success('Règle supprimée'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const condition = (r: BankRule) => [
    r.label_contains ? `libellé contient « ${r.label_contains} »` : '', r.label_regex ? `expression ${r.label_regex}` : '',
    r.direction ? (r.direction === 'out' ? 'sortie' : 'entrée') : '',
    r.amount_min != null || r.amount_max != null ? `montant ${r.amount_min ?? 0} à ${r.amount_max ?? '∞'} ${currencySymbol()}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="odoo-section" style={{ padding: 0, marginTop: 12 }}>
      <div style={{ padding: '10px 14px', background: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={14} /><strong style={{ fontSize: '0.85rem' }}>Règles de rapprochement</strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>appliquées par priorité croissante, après la recherche par référence</span>
        <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setEditing('new')}><Plus size={13} /> Nouvelle règle</button>
      </div>
      {isLoading ? <div style={{ padding: 12 }}><Loader2 size={14} className="animate-spin" /></div> : rules.length === 0 ? (
        <div style={{ padding: 12, fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>
          Aucune règle. Exemple : « FRAIS TENUE », sortie → générer l'écriture sur 6147 ; « COM CB », sortie → commissions de carte.
        </div>
      ) : (
        <table className="odoo-table" style={{ margin: 0, width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'right', width: 60 }}>Priorité</th><th style={{ textAlign: 'left' }}>Règle</th><th style={{ textAlign: 'left' }}>Condition</th>
            <th style={{ textAlign: 'left' }}>Action</th><th style={{ textAlign: 'right' }}>Utilisée</th><th /></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                <td style={{ textAlign: 'right' }}>{r.priority}</td>
                <td style={{ fontWeight: 500 }}>{r.label}{!r.is_active && <> <StatusTag tone="draft" label="Inactive" /></>}</td>
                <td style={{ fontSize: '0.8rem' }}>{condition(r)}</td>
                <td style={{ fontSize: '0.8rem' }}>{r.action === 'post_entry' ? `Écriture sur ${r.counter_account_code ?? '—'}` : `Rapprocher (± ${r.amount_tolerance} ${currencySymbol()}, ± ${r.date_tolerance_days} j)`}</td>
                <td style={{ textAlign: 'right' }}>{r.uses ?? 0}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(r)}>Modifier</button>{' '}
                  <button type="button" className="odoo-btn-secondary" title="Supprimer la règle" style={{ color: '#c62828' }}
                    onClick={async () => { if (await confirm(`Supprimer la règle « ${r.label} » ? Les rapprochements déjà faits restent.`, { title: 'Supprimer la règle', confirmLabel: 'Supprimer', danger: true })) remove.mutate(r.id); }}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <RuleFormModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['bank-rules'] }); }} />}
    </div>
  );
}
