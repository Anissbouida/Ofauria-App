import { usePermissions } from '../../context/PermissionsContext';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListChecks } from 'lucide-react';
import { bankReconciliationApi, type BankRule, type BankRuleAction, type BankRuleInput } from '../../api/bank-reconciliation.api';
import { planComptableApi } from '../../api/ledger.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';
import { LoadingState, ErrorState, EmptyState, DataPanel, SectionHeader, Modal, FormSection, FormField, FormFooter } from '../../components/ds';

/**
 * Règles de rapprochement bancaire (G4-02). Une règle reconnaît des lignes de relevé par
 * leur libellé, leur sens ou leur montant, puis soit les rapproche d'une écriture existante
 * avec des tolérances, soit génère l'écriture (frais bancaires, commissions, agios), soit
 * (mig 601, « commission de carte ») rapproche un flux TPE net des encaissements carte bruts
 * d'un ou plusieurs jours et génère l'écart en commission, s'il reste dans la fourchette en %.
 */

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
  // Audit des profils (R1) : encaissements carte de la caisse seulement avec le Point de vente.
  const posOn = usePermissions().moduleActive('pos');
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
    <Modal title={rule ? 'Modifier la règle' : 'Nouvelle règle de rapprochement'} onClose={onClose} width={640} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={f.label.trim().length < 2} />}>
      <FormSection title="Règle">
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 110px' }}>
          <FormField label="Nom" htmlFor="r-label" required><input id="r-label" className="ds-input" value={f.label} onChange={e => set('label', e.target.value)} placeholder="Frais de tenue de compte" /></FormField>
          <FormField label="Priorité" htmlFor="r-prio"><input id="r-prio" className="ds-input" inputMode="numeric" value={f.priority} onChange={e => set('priority', e.target.value)} /></FormField>
        </div>
      </FormSection>
      <FormSection title="Condition (au moins une)">
        <div className="ds-form-grid">
          <FormField label="Le libellé contient" htmlFor="r-contains"><input id="r-contains" className="ds-input" value={f.labelContains} onChange={e => set('labelContains', e.target.value)} placeholder="FRAIS TENUE" /></FormField>
          <FormField label="ou expression" htmlFor="r-regex"><input id="r-regex" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={f.labelRegex} onChange={e => set('labelRegex', e.target.value)} placeholder="^COM\s*CB" /></FormField>
        </div>
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <FormField label="Sens" htmlFor="r-dir">
            <select id="r-dir" className="ds-input" value={f.direction} onChange={e => set('direction', e.target.value as '' | 'in' | 'out')}>
              <option value="">Les deux</option><option value="out">Sortie (débit)</option><option value="in">Entrée (crédit)</option>
            </select>
          </FormField>
          <FormField label="Montant minimum" htmlFor="r-min"><input id="r-min" className="ds-input" inputMode="decimal" value={f.amountMin} onChange={e => set('amountMin', e.target.value)} /></FormField>
          <FormField label="Montant maximum" htmlFor="r-max"><input id="r-max" className="ds-input" inputMode="decimal" value={f.amountMax} onChange={e => set('amountMax', e.target.value)} /></FormField>
        </div>
      </FormSection>
      <FormSection title="Action">
        <div role="radiogroup" aria-label="Action" style={{ display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap' }}>
          <label htmlFor="r-act-post" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input id="r-act-post" type="radio" checked={f.action === 'post_entry'} onChange={() => set('action', 'post_entry')} /> Générer l'écriture</label>
          <label htmlFor="r-act-match" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input id="r-act-match" type="radio" checked={f.action === 'match'} onChange={() => set('action', 'match')} /> Rapprocher d'une écriture existante</label>
          <label htmlFor="r-act-fee" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input id="r-act-fee" type="radio" checked={f.action === 'match_fee'} onChange={chooseFee} /> Commission de carte (net reçu ← ventes brutes)</label>
        </div>
        {f.action === 'match_fee' && (
          <>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
              Le flux reçu est rapproché des encaissements d'un jour (ou de jours consécutifs) précédant l'opération ; l'écart brut − net,
              s'il reste dans la fourchette, est passé en commission sur le compte choisi. Une seule combinaison doit convenir.
            </p>
            <div className="ds-form-grid cols-4">
              <FormField label="Écart minimal (% du brut)" htmlFor="r-fmin"><input id="r-fmin" className="ds-input" inputMode="decimal" value={f.feePctMin} onChange={e => set('feePctMin', e.target.value)} /></FormField>
              <FormField label="Écart maximal (% du brut)" htmlFor="r-fmax"><input id="r-fmax" className="ds-input" inputMode="decimal" value={f.feePctMax} onChange={e => set('feePctMax', e.target.value)} /></FormField>
              <FormField label={`Versé en trop toléré (${currencySymbol()})`} htmlFor="r-fneg"><input id="r-fneg" className="ds-input" inputMode="decimal" value={f.amountTolerance} onChange={e => set('amountTolerance', e.target.value)} /></FormField>
              <FormField label="Jours avant l'opération" htmlFor="r-fdays"><input id="r-fdays" className="ds-input" inputMode="numeric" value={f.dateToleranceDays} onChange={e => set('dateToleranceDays', e.target.value)} /></FormField>
            </div>
            {posOn && <label htmlFor="r-card" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              <input id="r-card" type="checkbox" checked={f.cardOnly} onChange={e => set('cardOnly', e.target.checked)} /> Encaissements carte uniquement (ventes carte, saisie du jour, écart carte de fermeture)
            </label>}
          </>
        )}
        {generates ? (
          <div className="ds-form-grid">
            <FormField label="Compte de contrepartie">
              <SearchSelect options={options} value={f.counterAccountId} onChange={v => set('counterAccountId', v)} placeholder="6147 — Services bancaires" size="md" width="100%" ariaLabel="Compte de contrepartie" />
            </FormField>
            <FormField label="Libellé de l'écriture" htmlFor="r-elabel"><input id="r-elabel" className="ds-input" value={f.entryLabel} onChange={e => set('entryLabel', e.target.value)} placeholder="Frais bancaires" /></FormField>
          </div>
        ) : (
          <div className="ds-form-grid">
            <FormField label={`Écart de montant toléré (${currencySymbol()})`} htmlFor="r-tol"><input id="r-tol" className="ds-input" inputMode="decimal" value={f.amountTolerance} onChange={e => set('amountTolerance', e.target.value)} /></FormField>
            <FormField label="Écart de date toléré (jours)" htmlFor="r-days"><input id="r-days" className="ds-input" inputMode="numeric" value={f.dateToleranceDays} onChange={e => set('dateToleranceDays', e.target.value)} /></FormField>
          </div>
        )}
      </FormSection>
      <label htmlFor="r-active" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
        <input id="r-active" type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Règle active
      </label>
    </Modal>
  );
}

export default function BankRulesPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<BankRule | null | 'new'>(null);
  const { data: rules = [], isLoading, isError, error } = useQuery({ queryKey: ['bank-rules'], queryFn: bankReconciliationApi.rules });
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
    <div style={{ marginTop: 12 }}>
      <SectionHeader title={<><ListChecks size={14} aria-hidden="true" /> Règles de rapprochement</>} note="appliquées par priorité croissante, après la recherche par référence">
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing('new')}><Plus size={13} /> Nouvelle règle</button>
      </SectionHeader>
      <DataPanel label="Règles de rapprochement">
        {isLoading ? <LoadingState bare /> : isError ? <ErrorState bare error={error} /> : rules.length === 0 ? (
          <EmptyState bare icon={ListChecks} title="Aucune règle"
            text="Exemple : « FRAIS TENUE », sortie → générer l'écriture sur 6147 ; « REMISE TPE », entrée → commission de carte 0 à 3 % sur 6147." />
        ) : (
          <table className="odoo-table ds-dense">
            <thead><tr><th className="ds-num" style={{ width: 60 }}>Priorité</th><th>Règle</th><th>Condition</th>
              <th>Action</th><th className="ds-num">Utilisée</th><th className="ds-actions" /></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                  <td className="ds-num">{r.priority}</td>
                  <td className="ds-strong">{r.label}{!r.is_active && <> <StatusTag tone="draft" label="Inactive" /></>}</td>
                  <td>{condition(r)}</td>
                  <td>{r.action === 'post_entry' ? `Écriture sur ${r.counter_account_code ?? '—'}`
                    : r.action === 'match_fee' ? `Commission ${r.fee_pct_min ?? 0} à ${r.fee_pct_max ?? 0} % sur ${r.counter_account_code ?? '—'} (${r.date_tolerance_days} j${r.candidate_source === 'card' ? ', cartes' : ''})`
                    : `Rapprocher (± ${r.amount_tolerance} ${currencySymbol()}, ± ${r.date_tolerance_days} j)`}</td>
                  <td className="ds-num">{r.uses ?? 0}</td>
                  <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing(r)}>Modifier</button>{' '}
                    <button type="button" className="ds-icon-btn" title="Supprimer la règle" style={{ color: 'var(--ds-danger)' }}
                      onClick={async () => { if (await confirm(`Supprimer la règle « ${r.label} » ? Les rapprochements déjà faits restent.`, { title: 'Supprimer la règle', confirmLabel: 'Supprimer', danger: true })) remove.mutate(r.id); }} aria-label="Supprimer la règle">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataPanel>
      {editing && <RuleFormModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['bank-rules'] }); }} />}
    </div>
  );
}
