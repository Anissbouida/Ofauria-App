import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2, X, ListChecks } from 'lucide-react';
import { bankReconciliationApi, type BankRule, type BankRuleAction, type BankRuleInput } from '../../api/bank-reconciliation.api';
import { planComptableApi } from '../../api/ledger.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';
import { LoadingState } from '../../components/ds';

/**
 * Règles de rapprochement bancaire (G4-02). Une règle reconnaît des lignes de relevé par
 * leur libellé, leur sens ou leur montant, puis soit les rapproche d'une écriture existante
 * avec des tolérances, soit génère l'écriture (frais bancaires, commissions, agios), soit
 * (mig 601, « commission de carte ») rapproche un flux TPE net des encaissements carte bruts
 * d'un ou plusieurs jours et génère l'écart en commission, s'il reste dans la fourchette en %.
 */

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
    action: (rule?.action ?? draft?.action ?? 'post_entry') as BankRuleAction,
    counterAccountId: rule?.counter_account_id ?? draft?.counterAccountId ?? '',
    entryLabel: rule?.entry_label ?? draft?.entryLabel ?? '',
    amountTolerance: String(rule?.amount_tolerance ?? 0),
    dateToleranceDays: String(rule?.date_tolerance_days ?? 7),
    feePctMin: rule?.fee_pct_min != null ? String(rule.fee_pct_min) : '0',
    feePctMax: rule?.fee_pct_max != null ? String(rule.fee_pct_max) : '3',
    cardOnly: rule ? rule.candidate_source === 'card' : true,
    isActive: rule?.is_active ?? true,
  });
  const generates = f.action === 'post_entry' || f.action === 'match_fee';
  /** Commission de carte : flux reçu, 3 jours, 6147 proposé (compte de la commission carte, mig 356). */
  const chooseFee = () => setF(x => ({
    ...x, action: 'match_fee', direction: 'in', dateToleranceDays: x.action === 'match_fee' ? x.dateToleranceDays : '3',
    amountTolerance: x.action === 'match_fee' ? x.amountTolerance : '0.05',
    counterAccountId: x.counterAccountId || (accounts as { id: string; code: string }[]).find(a => a.code === '6147')?.id || '',
    entryLabel: x.entryLabel || 'Commission carte',
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const options = useMemo(() => (accounts as { id: string; code: string; label: string; is_active?: boolean }[])
    .filter(a => a.is_active !== false && /^\d{4,}$/.test(a.code))
    .map(a => ({ id: a.id, label: `${a.code} — ${a.label}` })), [accounts]);

  const save = useMutation({
    mutationFn: () => bankReconciliationApi.saveRule({
      label: f.label, priority: Number(f.priority) || 100, isActive: f.isActive,
      labelContains: f.labelContains || null, labelRegex: f.labelRegex || null, direction: f.direction || null,
      amountMin: num(f.amountMin), amountMax: num(f.amountMax), action: f.action,
      counterAccountId: generates ? f.counterAccountId || null : null, entryLabel: f.entryLabel || null,
      amountTolerance: num(f.amountTolerance) ?? 0, dateToleranceDays: Number(f.dateToleranceDays) || 0,
      ...(f.action === 'match_fee' ? { feePctMin: num(f.feePctMin) ?? 0, feePctMax: num(f.feePctMax), candidateSource: f.cardOnly ? 'card' as const : null } : {}),
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
          <button type="button" className="odoo-pager-btn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Fermer" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <div><label style={lbl} htmlFor="r-label">Nom</label><input id="r-label" className="ds-input sm" value={f.label} onChange={e => set('label', e.target.value)} placeholder="Frais de tenue de compte" /></div>
          <div><label style={lbl} htmlFor="r-prio">Priorité</label><input id="r-prio" className="ds-input sm" inputMode="numeric" value={f.priority} onChange={e => set('priority', e.target.value)} /></div>
        </div>
        <fieldset style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 10 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0 4px' }}>Condition (au moins une)</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={lbl} htmlFor="r-contains">Le libellé contient</label><input id="r-contains" className="ds-input sm" value={f.labelContains} onChange={e => set('labelContains', e.target.value)} placeholder="FRAIS TENUE" /></div>
            <div><label style={lbl} htmlFor="r-regex">ou expression</label><input id="r-regex" className="ds-input sm" style={{ fontFamily: 'ui-monospace, monospace' }} value={f.labelRegex} onChange={e => set('labelRegex', e.target.value)} placeholder="^COM\s*CB" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div><label style={lbl} htmlFor="r-dir">Sens</label>
              <select id="r-dir" className="ds-input sm" value={f.direction} onChange={e => set('direction', e.target.value as '' | 'in' | 'out')}>
                <option value="">Les deux</option><option value="out">Sortie (débit)</option><option value="in">Entrée (crédit)</option>
              </select></div>
            <div><label style={lbl} htmlFor="r-min">Montant minimum</label><input id="r-min" className="ds-input sm" inputMode="decimal" value={f.amountMin} onChange={e => set('amountMin', e.target.value)} /></div>
            <div><label style={lbl} htmlFor="r-max">Montant maximum</label><input id="r-max" className="ds-input sm" inputMode="decimal" value={f.amountMax} onChange={e => set('amountMax', e.target.value)} /></div>
          </div>
        </fieldset>
        <fieldset style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, display: 'grid', gap: 10 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0 4px' }}>Action</legend>
          <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={f.action === 'post_entry'} onChange={() => set('action', 'post_entry')} /> Générer l'écriture</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={f.action === 'match'} onChange={() => set('action', 'match')} /> Rapprocher d'une écriture existante</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={f.action === 'match_fee'} onChange={chooseFee} /> Commission de carte (net reçu ← ventes brutes)</label>
          </div>
          {f.action === 'match_fee' && (
            <>
              <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>
                Le flux reçu est rapproché des encaissements d'un jour (ou de jours consécutifs) précédant l'opération ; l'écart brut − net,
                s'il reste dans la fourchette, est passé en commission sur le compte choisi. Une seule combinaison doit convenir.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div><label style={lbl} htmlFor="r-fmin">Écart minimal (% du brut)</label><input id="r-fmin" className="ds-input sm" inputMode="decimal" value={f.feePctMin} onChange={e => set('feePctMin', e.target.value)} /></div>
                <div><label style={lbl} htmlFor="r-fmax">Écart maximal (% du brut)</label><input id="r-fmax" className="ds-input sm" inputMode="decimal" value={f.feePctMax} onChange={e => set('feePctMax', e.target.value)} /></div>
                <div><label style={lbl} htmlFor="r-fneg">Versé en trop toléré ({currencySymbol()})</label><input id="r-fneg" className="ds-input sm" inputMode="decimal" value={f.amountTolerance} onChange={e => set('amountTolerance', e.target.value)} /></div>
                <div><label style={lbl} htmlFor="r-fdays">Jours avant l'opération</label><input id="r-fdays" className="ds-input sm" inputMode="numeric" value={f.dateToleranceDays} onChange={e => set('dateToleranceDays', e.target.value)} /></div>
              </div>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={f.cardOnly} onChange={e => set('cardOnly', e.target.checked)} /> Encaissements carte uniquement (ventes carte, saisie du jour, écart carte de fermeture)
              </label>
            </>
          )}
          {generates ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><span style={lbl}>Compte de contrepartie</span>
                <SearchSelect options={options} value={f.counterAccountId} onChange={v => set('counterAccountId', v)} placeholder="6147 — Services bancaires" size="md" width="100%" ariaLabel="Compte de contrepartie" /></div>
              <div><label style={lbl} htmlFor="r-elabel">Libellé de l'écriture</label><input id="r-elabel" className="ds-input sm" value={f.entryLabel} onChange={e => set('entryLabel', e.target.value)} placeholder="Frais bancaires" /></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={lbl} htmlFor="r-tol">Écart de montant toléré ({currencySymbol()})</label><input id="r-tol" className="ds-input sm" inputMode="decimal" value={f.amountTolerance} onChange={e => set('amountTolerance', e.target.value)} /></div>
              <div><label style={lbl} htmlFor="r-days">Écart de date toléré (jours)</label><input id="r-days" className="ds-input sm" inputMode="numeric" value={f.dateToleranceDays} onChange={e => set('dateToleranceDays', e.target.value)} /></div>
            </div>
          )}
        </fieldset>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Règle active
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={save.isPending || f.label.trim().length < 2} onClick={() => save.mutate()}>
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
    <div className="odoo-section ds-panel" style={{ padding: 0, marginTop: 12 }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--ds-hair)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={14} /><strong style={{ fontSize: '0.85rem' }}>Règles de rapprochement</strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>appliquées par priorité croissante, après la recherche par référence</span>
        <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}><Plus size={13} /> Nouvelle règle</button>
      </div>
      {isLoading ? <LoadingState /> : rules.length === 0 ? (
        <div style={{ padding: 12, fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>
          Aucune règle. Exemple : « FRAIS TENUE », sortie → générer l'écriture sur 6147 ; « REMISE TPE », entrée → commission de carte 0 à 3 % sur 6147.
        </div>
      ) : (
        <table className="odoo-table ds-dense" style={{ margin: 0, width: '100%' }}>
          <thead><tr><th className="ds-num" style={{ width: 60 }}>Priorité</th><th style={{ textAlign: 'left' }}>Règle</th><th style={{ textAlign: 'left' }}>Condition</th>
            <th style={{ textAlign: 'left' }}>Action</th><th className="ds-num">Utilisée</th><th /></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                <td className="ds-num">{r.priority}</td>
                <td style={{ fontWeight: 500 }}>{r.label}{!r.is_active && <> <StatusTag tone="draft" label="Inactive" /></>}</td>
                <td style={{ fontSize: '0.8rem' }}>{condition(r)}</td>
                <td style={{ fontSize: '0.8rem' }}>{r.action === 'post_entry' ? `Écriture sur ${r.counter_account_code ?? '—'}`
                  : r.action === 'match_fee' ? `Commission ${r.fee_pct_min ?? 0} à ${r.fee_pct_max ?? 0} % sur ${r.counter_account_code ?? '—'} (${r.date_tolerance_days} j${r.candidate_source === 'card' ? ', cartes' : ''})`
                  : `Rapprocher (± ${r.amount_tolerance} ${currencySymbol()}, ± ${r.date_tolerance_days} j)`}</td>
                <td className="ds-num">{r.uses ?? 0}</td>
                <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(r)}>Modifier</button>{' '}
                  <button type="button" className="odoo-btn-secondary" title="Supprimer la règle" style={{ color: 'var(--ds-danger)' }}
                    onClick={async () => { if (await confirm(`Supprimer la règle « ${r.label} » ? Les rapprochements déjà faits restent.`, { title: 'Supprimer la règle', confirmLabel: 'Supprimer', danger: true })) remove.mutate(r.id); }} aria-label="Supprimer la règle">
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
