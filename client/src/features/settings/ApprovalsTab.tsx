import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, Plus, Trash2, ArrowRight, Clock } from 'lucide-react';
import {
  ROLE_LABELS, APPROVAL_DOC_TYPES, APPROVAL_OPS, describeApprovalCondition,
  type ApprovalDocType, type ApprovalDocTypeDef, type ApprovalCondition, type ApprovalOp,
} from '@ofauria/shared';
import { approvalsApi, apiErrorMessage, type ApprovalRule, type ApprovalRuleInput } from '../../api/approvals.api';
import { rolesApi } from '../../api/users.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Paramètres › Circuits d'approbation (lot 8, mig 350). Une règle = type de
 * pièce + condition + approbateurs successifs. Les demandes en cours gardent
 * leur circuit : modifier une règle ne vaut que pour les prochaines pièces.
 */

const DOC_TYPES = APPROVAL_DOC_TYPES as Record<string, ApprovalDocTypeDef>;

const inputStyle: React.CSSProperties = {
  fontSize: '0.8125rem', padding: '3px 6px', border: '1px solid var(--odoo-border)', borderRadius: 4,
  background: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};

function ConditionEditor({ docType, value, disabled, onChange }: {
  docType: string; value: ApprovalCondition; disabled: boolean; onChange: (c: ApprovalCondition | null) => void;
}) {
  const fields = DOC_TYPES[docType]?.fields ?? {};
  const field = value.field ? fields[value.field] : undefined;
  const [draft, setDraft] = useState<string>(value.value === undefined ? '' : String(value.value));
  const commit = (next: Partial<ApprovalCondition>) => {
    const merged = { ...value, ...next };
    if (!merged.field) { onChange(null); return; }
    const def = fields[merged.field];
    const op: ApprovalOp = merged.op && (def?.kind !== 'enum' || ['eq', 'neq'].includes(merged.op)) ? merged.op : (def?.kind === 'enum' ? 'eq' : 'gte');
    let v: number | string | undefined = merged.value;
    if (def?.kind === 'enum') v = def.options?.some(o => o.value === String(v)) ? String(v) : def.options?.[0]?.value;
    else v = Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : 0;
    onChange({ field: merged.field, op, value: v });
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <select aria-label="Champ de la condition" value={value.field ?? ''} disabled={disabled} style={inputStyle}
        onChange={e => commit({ field: e.target.value || undefined })}>
        <option value="">Toujours</option>
        {Object.entries(fields).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
      </select>
      {field && (
        <>
          <select aria-label="Opérateur" value={value.op ?? 'gte'} disabled={disabled} style={inputStyle}
            onChange={e => commit({ op: e.target.value as ApprovalOp })}>
            {(Object.keys(APPROVAL_OPS) as ApprovalOp[])
              .filter(op => field.kind !== 'enum' || op === 'eq' || op === 'neq')
              .map(op => <option key={op} value={op}>{APPROVAL_OPS[op]}</option>)}
          </select>
          {field.kind === 'enum' ? (
            <select aria-label="Valeur" value={String(value.value ?? '')} disabled={disabled} style={inputStyle}
              onChange={e => commit({ value: e.target.value })}>
              {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <input aria-label="Valeur" type="number" min={0} step="any" value={draft} disabled={disabled}
                style={{ ...inputStyle, width: 90, textAlign: 'right' }}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => { if (draft !== '' && Number(draft) !== Number(value.value)) commit({ value: Number(draft) }); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              {field.unit && <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{field.unit}</span>}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export default function ApprovalsTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { canEdit, canCreate, canDelete } = usePermissions();
  const editable = canEdit('settings');
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['approval-rules'], queryFn: approvalsApi.rules });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const roleOptions = roles.length
    ? roles.filter(r => r.is_active).map(r => [r.code, r.label] as [string, string])
    : (Object.entries(ROLE_LABELS) as [string, string][]);
  const roleLabel = (c: string | null) => (c ? roleOptions.find(r => r[0] === c)?.[1] ?? c : '');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['approval-rules'] });
  const save = useMutation({
    mutationFn: ({ code, data }: { code: string; data: ApprovalRuleInput }) => approvalsApi.updateRule(code, data),
    onSuccess: invalidate,
    onError: (err) => notify.error(apiErrorMessage(err, 'Enregistrement refusé')),
  });
  const remove = useMutation({
    mutationFn: (code: string) => approvalsApi.deleteRule(code),
    onSuccess: () => { invalidate(); notify.success('Règle supprimée'); },
    onError: (err) => notify.error(apiErrorMessage(err, 'Suppression refusée')),
  });
  const create = useMutation({
    mutationFn: (data: ApprovalRuleInput) => approvalsApi.createRule(data),
    onSuccess: () => { invalidate(); setDraft(null); notify.success('Règle créée'); },
    onError: (err) => notify.error(apiErrorMessage(err, 'Création refusée')),
  });

  const [draft, setDraft] = useState<{ label: string; docType: ApprovalDocType; condition: ApprovalCondition | null; roles: string[]; mode: 'serial' | 'parallel' } | null>(null);
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40) || 'regle';

  const stepsOf = (r: ApprovalRule) => r.steps.map(s => ({ approverRole: s.approver_role, approverUserId: s.approver_user_id }));

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone="neutral" icon={ClipboardCheck} title="Qui approuve quoi, et à partir de quand"
        actions={editable && canCreate('settings') && !draft ? (
          <button type="button" className="odoo-btn-secondary" onClick={() => setDraft({ label: '', docType: 'purchase_order', condition: null, roles: ['manager'], mode: 'serial' })}>
            <Plus size={14} /> Nouvelle règle
          </button>
        ) : undefined}>
        Une pièce qui remplit la condition attend l'accord des approbateurs, dans l'ordre (série) ou tous en même temps (parallèle).
        Le demandeur ne peut jamais approuver sa propre pièce. Les décisions se prennent depuis la boîte « À approuver » de la cloche.
      </StatusBanner>
      {!rules.length && <StatusBanner tone="warning" icon={ClipboardCheck} title="Circuits indisponibles">La migration 350 n'est pas appliquée sur cette base.</StatusBanner>}

      {draft && (
        <section style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 10, background: 'var(--odoo-bg-card, var(--odoo-bg))' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem' }}>Nouvelle règle</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Libellé
              <input id="approval-new-label" value={draft.label} style={inputStyle} placeholder="Ex. BC fournisseur farine" onChange={e => setDraft({ ...draft, label: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Type de pièce
              <select id="approval-new-doctype" value={draft.docType} style={inputStyle} onChange={e => setDraft({ ...draft, docType: e.target.value as ApprovalDocType, condition: null })}>
                {Object.entries(DOC_TYPES).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
            </label>
            <div style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Condition
              <ConditionEditor docType={draft.docType} value={draft.condition ?? {}} disabled={false} onChange={c => setDraft({ ...draft, condition: c })} />
            </div>
            <div style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Approbateurs (dans l'ordre)
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {draft.roles.map((c, i) => (
                  <span key={`${c}-${i}`} className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i + 1}. {roleLabel(c)}
                    <button type="button" aria-label={`Retirer ${roleLabel(c)}`} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
                      onClick={() => setDraft({ ...draft, roles: draft.roles.filter((_, j) => j !== i) })}>×</button>
                  </span>
                ))}
                <select aria-label="Ajouter un approbateur" value="" style={inputStyle} onChange={e => e.target.value && setDraft({ ...draft, roles: [...draft.roles, e.target.value] })}>
                  <option value="">+ Ajouter</option>
                  {roleOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={create.isPending || !draft.label.trim() || !draft.roles.length}
              onClick={() => create.mutate({ code: slug(draft.label), label: draft.label.trim(), docType: draft.docType, condition: draft.condition, mode: draft.mode, steps: draft.roles.map(r => ({ approverRole: r })) })}>
              Créer la règle
            </button>
          </div>
        </section>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Active</th><th>Règle</th><th>Condition</th><th>Circuit</th><th style={{ width: 110 }}>Escalade</th><th style={{ textAlign: 'right' }}>30 jours</th>{editable && <th />}
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.code} style={{ opacity: r.enabled ? 1 : 0.6, verticalAlign: 'top' }}>
                <td>
                  <input id={`approval-rule-${r.code}`} type="checkbox" checked={r.enabled} disabled={!editable || save.isPending}
                    aria-label={`Activer « ${r.label} »`} onChange={e => save.mutate({ code: r.code, data: { enabled: e.target.checked } })} />
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{DOC_TYPES[r.doc_type]?.label ?? r.doc_type} · <code>{r.code}</code></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', marginTop: 2 }}>{DOC_TYPES[r.doc_type]?.effect}</div>
                </td>
                <td>
                  {editable
                    ? <ConditionEditor key={`${r.code}-${JSON.stringify(r.condition)}`} docType={r.doc_type} value={r.condition ?? {}} disabled={save.isPending}
                        onChange={c => save.mutate({ code: r.code, data: { condition: c } })} />
                    : describeApprovalCondition(r.doc_type, r.condition)}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {r.steps.map((s, i) => (
                      <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {i > 0 && (r.mode === 'serial' ? <ArrowRight size={12} style={{ color: 'var(--odoo-text-muted)' }} /> : <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>+</span>)}
                        <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {s.approver_name ?? roleLabel(s.approver_role)}
                          {editable && r.steps.length > 1 && (
                            <button type="button" aria-label={`Retirer l'étape ${i + 1}`} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
                              onClick={() => save.mutate({ code: r.code, data: { steps: stepsOf(r).filter((_, j) => j !== i) } })}>×</button>
                          )}
                        </span>
                      </span>
                    ))}
                    {editable && (
                      <select aria-label={`Ajouter une étape à « ${r.label} »`} value="" style={inputStyle}
                        onChange={e => e.target.value && save.mutate({ code: r.code, data: { steps: [...stepsOf(r), { approverRole: e.target.value }] } })}>
                        <option value="">+ Étape</option>
                        {roleOptions.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                      </select>
                    )}
                  </div>
                  {r.steps.length > 1 && (
                    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.75rem', color: 'var(--odoo-text-muted)', marginTop: 6 }}>
                      <select aria-label="Mode du circuit" value={r.mode} disabled={!editable} style={inputStyle}
                        onChange={e => save.mutate({ code: r.code, data: { mode: e.target.value as 'serial' | 'parallel' } })}>
                        <option value="serial">L'un après l'autre</option>
                        <option value="parallel">Tous en parallèle</option>
                      </select>
                    </label>
                  )}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} style={{ color: 'var(--odoo-text-muted)' }} />
                    <input aria-label="Alerte après (heures)" type="number" min={1} max={720} defaultValue={r.escalate_after_hours ?? ''} disabled={!editable}
                      key={`${r.code}-${r.escalate_after_hours}`} placeholder="—" style={{ ...inputStyle, width: 56, textAlign: 'right' }}
                      onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== r.escalate_after_hours) save.mutate({ code: r.code, data: { escalateAfterHours: v } }); }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>h</span>
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                  <div>{r.requests_30d} demande{r.requests_30d > 1 ? 's' : ''}</div>
                  {r.rejected_30d > 0 && <div style={{ color: '#dc3545' }}>{r.rejected_30d} refus</div>}
                  {r.pending_count > 0 && <div><span className="odoo-tag odoo-tag-orange">{r.pending_count} en attente</span></div>}
                </td>
                {editable && (
                  <td style={{ textAlign: 'right' }}>
                    {canDelete('settings') && (
                      <button type="button" className="odoo-pager-btn" title="Supprimer la règle" aria-label={`Supprimer « ${r.label} »`} style={{ color: '#dc3545' }}
                        onClick={async () => { if (await confirm(`Supprimer la règle « ${r.label} » ? Les pièces de ce type ne demanderont plus d'approbation.`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(r.code); }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
