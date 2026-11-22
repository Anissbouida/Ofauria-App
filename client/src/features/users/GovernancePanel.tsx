import { currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { DataPanel, SectionHeader } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldAlert, ShieldCheck, Eye, Trash2, UserCog } from 'lucide-react';
import {
  APP_MODULES, MODULE_LABELS, CAPABILITY_LABELS, CAPABILITIES,
  APPROVAL_DOCUMENT_TYPES, APPROVAL_DOCUMENT_LABELS, type AppModule, type Capability, type ApprovalDocumentType,
} from '@ofauria/shared';
import {
  governanceApi, rolesApi, usersApi,
  type SodRuleRow, type ApprovalLimitRow, type DelegationRow,
} from '../../api/users.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';

/**
 * Gouvernance des droits (mig 336) : séparation des tâches (SoD), plafonds
 * d'approbation par rôle, délégations temporaires. Réservé à l'administrateur.
 */

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

const MODULE_OPTIONS: string[] = [...new Set([...Object.values(APP_MODULES) as string[], 'stock', 'controle'])]
  .filter(m => m !== 'users').sort();
const moduleLabel = (m: string) => MODULE_LABELS[m as AppModule] ?? (m === 'stock' ? 'Stock' : m === 'controle' ? 'Contrôle & Qualité' : m);
const lab: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ds-ink)' };

export default function GovernancePanel() {
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 28 }}>
      <SodSection />
      <ApprovalLimitsSection />
      <DelegationsSection />
    </div>
  );
}

/* ============ SÉPARATION DES TÂCHES ============ */
function SodSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: mode } = useQuery({ queryKey: ['sod-mode'], queryFn: governanceApi.sodMode });
  const { data: rules = [] } = useQuery({ queryKey: ['sod-rules'], queryFn: governanceApi.sodList });
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations });
  const [creating, setCreating] = useState(false);

  const setMode = useMutation({
    mutationFn: (m: 'off' | 'log' | 'enforce') => governanceApi.setSodMode(m),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sod-mode'] }); notify.success('Mode de contrôle enregistré'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const toggleActive = useMutation({
    mutationFn: (r: SodRuleRow) => governanceApi.sodUpdate(r.code, { isActive: !r.is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sod-rules'] }); qc.invalidateQueries({ queryKey: ['sod-violations'] }); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: (code: string) => governanceApi.sodRemove(code),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sod-rules'] }); qc.invalidateQueries({ queryKey: ['sod-violations'] }); notify.success('Règle supprimée'); },
    onError: (e) => notify.error(errorMessage(e, 'Suppression refusée')),
  });

  const m = mode?.mode ?? 'log';
  const changeMode = async (next: 'off' | 'log' | 'enforce') => {
    if (next === 'enforce' && violations.length && !(await confirm(
      `${violations.length} utilisateur(s) sont actuellement en conflit de séparation des tâches : la création ou modification de leurs rôles sera refusée. Ajustez d'abord si ces cumuls sont légitimes.`,
      { title: 'Bloquer les cumuls interdits ?', confirmLabel: 'Bloquer', danger: true }))) return;
    setMode.mutate(next);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title="Séparation des tâches" />
      <StatusBanner
        tone={m === 'enforce' ? 'success' : m === 'log' ? 'info' : 'warning'}
        icon={m === 'enforce' ? ShieldCheck : m === 'log' ? Eye : ShieldAlert}
        title={m === 'enforce' ? 'Appliquée : les cumuls interdits sont refusés à l\'affectation'
          : m === 'log' ? 'Observation : les cumuls interdits sont journalisés, pas bloqués'
          : 'Contrôle de séparation des tâches désactivé'}
        actions={
          <div className="prj-views" role="group" aria-label="Mode de contrôle">
            {(['log', 'enforce', 'off'] as const).map(k => (
              <button key={k} type="button" aria-pressed={m === k} className={m === k ? 'active' : ''} disabled={setMode.isPending} onClick={() => m !== k && changeMode(k)}>
                {k === 'log' ? 'Observer' : k === 'enforce' ? 'Bloquer' : 'Désactiver'}
              </button>
            ))}
          </div>
        }>
        Une règle décrit deux capacités qu'un même utilisateur ne devrait pas cumuler (ex. créer un achat et l'approuver). L'administrateur en est exempté.
      </StatusBanner>

      {violations.length > 0 && (
        <>
        <h3 className="ds-subhead">Utilisateurs en conflit ({violations.length})</h3>
        <DataPanel label="Utilisateurs en conflit">
          <table className="odoo-table">
            <thead><tr><th>Utilisateur</th><th>Rôle principal</th><th>Conflits</th></tr></thead>
            <tbody>
              {violations.map(v => (
                <tr key={v.userId}>
                  <td className="ds-strong">{v.name}</td>
                  <td>{v.roleCode}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {v.violations.map(c => (
                        <StatusTag key={c.code} tone={c.severity === 'critical' ? 'blocked' : 'todo'} label={c.label} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
        </>
      )}

      <div className="ds-section-head">
        <h3 className="ds-subhead">Règles ({rules.length})</h3>
        <span className="ds-grow" />
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCreating(!creating)}>
          <Plus size={13} aria-hidden="true" /> Nouvelle règle
        </button>
      </div>
      {creating && <SodRuleForm onDone={() => setCreating(false)} />}
      <DataPanel>
        <table className="odoo-table">
          <thead><tr><th>Règle</th><th>Capacité A</th><th>Capacité B</th><th>Sévérité</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.code}>
                <td className="ds-strong">{r.label}</td>
                <td>{moduleLabel(r.a_module)} · {CAPABILITY_LABELS[r.a_right as Capability] ?? r.a_right}</td>
                <td>{moduleLabel(r.b_module)} · {CAPABILITY_LABELS[r.b_right as Capability] ?? r.b_right}</td>
                <td><StatusTag tone={r.severity === 'critical' ? 'blocked' : 'todo'} label={r.severity === 'critical' ? 'Critique' : 'Avertissement'} /></td>
                <td><StatusTag tone={r.is_active ? 'done' : 'cancelled'} label={r.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => toggleActive.mutate(r)}>
                    {r.is_active ? 'Désactiver' : 'Activer'}
                  </button>
                  <RowMenu label={`Plus d'actions pour la règle ${r.label}`} items={[{
                    label: 'Supprimer', icon: Trash2, danger: true,
                    onSelect: async () => { if (await confirm(`Supprimer la règle « ${r.label} » ?`, { title: 'Supprimer la règle', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(r.code); },
                  }]} />
                </td>
              </tr>
            ))}
            {!rules.length && <tr><td colSpan={6} style={{ color: 'var(--ds-muted)' }}>Aucune règle de séparation des tâches.</td></tr>}
          </tbody>
        </table>
      </DataPanel>
    </div>
  );
}

function SodRuleForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<{ label: string; aModule: string; aRight: string; bModule: string; bRight: string; severity: string }>(
    { label: '', aModule: 'purchasing', aRight: 'create', bModule: 'purchasing', bRight: 'approve', severity: 'critical' });
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));
  const create = useMutation({
    mutationFn: () => governanceApi.sodCreate(f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sod-rules'] }); qc.invalidateQueries({ queryKey: ['sod-violations'] }); notify.success('Règle créée'); onDone(); },
    onError: (e) => notify.error(errorMessage(e, 'Création refusée')),
  });
  const moduleSel = (k: 'aModule' | 'bModule') => (
    <select className="ds-input" value={f[k]} onChange={e => set(k, e.target.value)}>
      {MODULE_OPTIONS.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}
    </select>
  );
  const rightSel = (k: 'aRight' | 'bRight') => (
    <select className="ds-input" value={f[k]} onChange={e => set(k, e.target.value)}>
      {CAPABILITIES.map(c => <option key={c} value={c}>{CAPABILITY_LABELS[c]}</option>)}
    </select>
  );
  return (
    <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 6, padding: 14, display: 'grid', gap: 10, background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))' }}>
      <label style={lab}>Libellé<input className="ds-input" value={f.label} onChange={e => set('label', e.target.value)} placeholder="Créer des achats et les approuver" maxLength={120} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={lab}>Capacité A — module{moduleSel('aModule')}</label>
        <label style={lab}>Capacité A — droit{rightSel('aRight')}</label>
        <label style={lab}>Capacité B — module{moduleSel('bModule')}</label>
        <label style={lab}>Capacité B — droit{rightSel('bRight')}</label>
      </div>
      <label style={{ ...lab, width: 200 }}>Sévérité
        <select className="ds-input" value={f.severity} onChange={e => set('severity', e.target.value)}>
          <option value="critical">Critique</option><option value="warning">Avertissement</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="odoo-btn-secondary" onClick={onDone}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={f.label.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>Créer la règle</button>
      </div>
    </div>
  );
}

/* ============ PLAFONDS D'APPROBATION ============ */
function ApprovalLimitsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: limits = [] } = useQuery({ queryKey: ['approval-limits'], queryFn: governanceApi.limitsList });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const [f, setF] = useState({ roleCode: '', documentType: 'purchase_order' as ApprovalDocumentType, maxAmount: '' });
  const assignable = roles.filter(r => r.code !== 'admin');

  const save = useMutation({
    mutationFn: () => governanceApi.limitsSet({ roleCode: f.roleCode, documentType: f.documentType, maxAmount: Number(f.maxAmount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-limits'] }); notify.success('Plafond enregistré'); setF(s => ({ ...s, maxAmount: '' })); },
    onError: (e) => notify.error(errorMessage(e, 'Enregistrement refusé')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => governanceApi.limitsRemove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-limits'] }); notify.success('Plafond retiré'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const roleLabel = (code: string) => roles.find(r => r.code === code)?.label ?? code;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title="Plafonds d'approbation" />
      <StatusBanner tone="info" icon={ShieldCheck} title="Plafond d'approbation par rôle et type de document">
        Un utilisateur ne peut approuver un document que dans la limite du plus élevé de ses rôles. Tant qu'aucun plafond n'est défini pour un type de document, aucune limite ne s'applique (bon de commande : contrôlé à l'envoi).
      </StatusBanner>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', borderRadius: 16, padding: '14px 16px', background: 'var(--kl-card, var(--theme-bg-card))', boxShadow: 'var(--kl-shadow)' }}>
        <label style={{ ...lab, width: 200 }}>Rôle
          <select className="ds-input" value={f.roleCode} onChange={e => setF(s => ({ ...s, roleCode: e.target.value }))}>
            <option value="">— choisir —</option>
            {assignable.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
        <label style={{ ...lab, width: 180 }}>Type de document
          <select className="ds-input" value={f.documentType} onChange={e => setF(s => ({ ...s, documentType: e.target.value as ApprovalDocumentType }))}>
            {APPROVAL_DOCUMENT_TYPES.map(d => <option key={d} value={d}>{APPROVAL_DOCUMENT_LABELS[d]}</option>)}
          </select>
        </label>
        <label style={{ ...lab, width: 160 }}>Plafond ({currencySymbol()})
          <input className="ds-input" type="number" min={0} step="0.01" value={f.maxAmount} onChange={e => setF(s => ({ ...s, maxAmount: e.target.value }))} placeholder="50000" />
        </label>
        <button type="button" className="odoo-btn-primary" disabled={!f.roleCode || f.maxAmount === '' || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
      </div>
      <DataPanel>
        <table className="odoo-table">
          <thead><tr><th>Rôle</th><th>Type de document</th><th className="ds-num">Plafond ({currencySymbol()})</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {limits.map((l: ApprovalLimitRow) => (
              <tr key={l.id}>
                <td className="ds-strong">{roleLabel(l.role_code)}</td>
                <td>{APPROVAL_DOCUMENT_LABELS[l.document_type as ApprovalDocumentType] ?? l.document_type}</td>
                <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(l.max_amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {l.currency}</td>
                <td>
                  <button type="button" className="ds-icon-btn" aria-label="Supprimer" title="Supprimer"
                    onClick={async () => { if (await confirm('Retirer ce plafond ?', { danger: true, confirmLabel: 'Retirer' })) remove.mutate(l.id); }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!limits.length && <tr><td colSpan={4} style={{ color: 'var(--ds-muted)' }}>Aucun plafond défini (aucune limite d'approbation active).</td></tr>}
          </tbody>
        </table>
      </DataPanel>
    </div>
  );
}

/* ============ DÉLÉGATIONS ============ */
function DelegationsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: delegations = [] } = useQuery({ queryKey: ['delegations'], queryFn: governanceApi.delegationsList });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const [f, setF] = useState({ fromUserId: '', toUserId: '', roleCode: '', endsAt: '', reason: '' });
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));
  const activeUsers = (users as Record<string, unknown>[]).filter(u => u.isActive);

  const create = useMutation({
    mutationFn: () => governanceApi.delegationsCreate({ fromUserId: f.fromUserId, toUserId: f.toUserId, roleCode: f.roleCode, endsAt: new Date(f.endsAt).toISOString(), reason: f.reason || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delegations'] }); notify.success('Délégation créée'); setF({ fromUserId: '', toUserId: '', roleCode: '', endsAt: '', reason: '' }); },
    onError: (e) => notify.error(errorMessage(e, 'Création refusée')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => governanceApi.delegationsRemove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delegations'] }); notify.success('Délégation retirée'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const userName = (u: Record<string, unknown>) => `${u.firstName} ${u.lastName}`;
  const fmt = (s: string) => new Date(s).toLocaleDateString('fr-FR', { dateStyle: 'short' } as Intl.DateTimeFormatOptions);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title="Délégations temporaires" />
      <StatusBanner tone="info" icon={UserCog} title="Déléguer un rôle à un autre utilisateur sur une période">
        Le délégataire cumule le rôle délégué dans ses droits effectifs tant que la délégation est active (remplacement pendant un congé). L'effet complet est pris en compte à sa prochaine connexion.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', borderRadius: 16, padding: '14px 16px', background: 'var(--kl-card, var(--theme-bg-card))', boxShadow: 'var(--kl-shadow)' }}>
        <label style={{ ...lab, width: 180 }}>Délégant (titulaire)
          <SearchSelect value={f.fromUserId} onChange={v => set('fromUserId', v)}
            placeholder="— choisir —" width={180} size="md" ariaLabel="Délégant"
            options={activeUsers.map(u => ({ id: u.id as string, label: userName(u) }))} />
        </label>
        <label style={{ ...lab, width: 180 }}>Délégataire
          <SearchSelect value={f.toUserId} onChange={v => set('toUserId', v)}
            placeholder="— choisir —" width={180} size="md" ariaLabel="Délégataire"
            options={activeUsers.filter(u => u.id !== f.fromUserId).map(u => ({ id: u.id as string, label: userName(u) }))} />
        </label>
        <label style={{ ...lab, width: 170 }}>Rôle délégué
          <select className="ds-input" value={f.roleCode} onChange={e => set('roleCode', e.target.value)}>
            <option value="">— choisir —</option>
            {roles.filter(r => r.code !== 'admin' && r.is_active).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
        <label style={{ ...lab, width: 160 }}>Jusqu'au
          <input className="ds-input" type="date" value={f.endsAt} onChange={e => set('endsAt', e.target.value)} />
        </label>
        <label style={{ ...lab, flex: '1 1 160px' }}>Motif
          <input className="ds-input" value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Congé de…" maxLength={200} />
        </label>
        <button type="button" className="odoo-btn-primary" disabled={!f.fromUserId || !f.toUserId || !f.roleCode || !f.endsAt || create.isPending} onClick={() => create.mutate()}>Déléguer</button>
      </div>
      <DataPanel>
        <table className="odoo-table">
          <thead><tr><th>De → vers</th><th>Rôle</th><th>Période</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {(delegations as DelegationRow[]).map(d => (
              <tr key={d.id}>
                <td><strong>{d.from_name}</strong> → {d.to_name}</td>
                <td>{d.role_label}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(d.starts_at)} → {fmt(d.ends_at)}</td>
                <td><StatusTag tone={d.active ? 'done' : 'cancelled'} label={d.active ? 'Active' : 'Inactive'} /></td>
                <td>
                  <button type="button" className="ds-icon-btn" aria-label="Supprimer" title="Supprimer"
                    onClick={async () => { if (await confirm('Retirer cette délégation ?', { danger: true, confirmLabel: 'Retirer' })) remove.mutate(d.id); }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!delegations.length && <tr><td colSpan={5} style={{ color: 'var(--ds-muted)' }}>Aucune délégation.</td></tr>}
          </tbody>
        </table>
      </DataPanel>
    </div>
  );
}
