import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, UserCog, CalendarPlus } from 'lucide-react';
import {
  APP_MODULES, MODULE_LABELS, CAPABILITY_LABELS, CAPABILITIES, APPROVAL_DOCUMENT_TYPES, APPROVAL_DOCUMENT_LABELS, BUSINESS_VERB_LABELS,
  type AppModule, type Capability, type ApprovalDocumentType, type BusinessVerb,
} from '@ofauria/shared';
import {
  governanceApi, rolesApi, usersApi, type SodRuleRow, type ApprovalLimitRow, type DelegationRow, type DocumentSodMode,
} from '../../api/users.api';
import {
  Tabs, DataPanel, TableFooter, SectionHeader, FormField, EmptyState, ErrorState, LoadingState, Modal, Alert, Toolbar,
} from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { currencySymbol } from '../../utils/money';
import { NAV_LABEL_BY_PATH } from '../../config/navigation';
import { HrHeaderActions } from '../employees/ui';
import { errorMessage } from './RolesPanel';
import './users.css';

/**
 * Contrôles internes (refonte Utilisateurs, lot 5) : un seul écran pour la séparation des tâches
 * (cumul de rôles et pièces, même vocabulaire de mode), les plafonds d'approbation reliés aux
 * circuits, les délégations (rôle complet ou approbations seulement, qui peuvent commencer plus
 * tard) et le contrôle des droits.
 */

type Section = 'sod' | 'limits' | 'delegations' | 'rights';
const SECTIONS: Section[] = ['sod', 'limits', 'delegations', 'rights'];

/* ── Choix de mode, même vocabulaire partout ── */
type ModeKey = 'observe' | 'block' | 'block_except_admin' | 'off';
const MODE_LABEL: Record<ModeKey, string> = { observe: 'Observer', block: 'Bloquer', block_except_admin: 'Bloquer sauf administrateur', off: 'Désactivé' };
function ModeSwitch<T extends string>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: { value: T; key: ModeKey }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="prj-views" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? 'active' : ''}
          disabled={disabled} onClick={() => value !== o.value && onChange(o.value)}>
          {MODE_LABEL[o.key]}
        </button>
      ))}
    </div>
  );
}
const ROLE_MODES = [{ value: 'log' as const, key: 'observe' as const }, { value: 'enforce' as const, key: 'block' as const }, { value: 'off' as const, key: 'off' as const }];
const DOC_MODES = [
  { value: 'warn' as const, key: 'observe' as const }, { value: 'block' as const, key: 'block' as const },
  { value: 'block_except_admin' as const, key: 'block_except_admin' as const }, { value: 'off' as const, key: 'off' as const },
];

const MODULE_OPTIONS: string[] = [...new Set([...Object.values(APP_MODULES) as string[], 'stock', 'controle'])].filter(m => m !== 'users').sort();
const moduleLabel = (m: string) => MODULE_LABELS[m as AppModule] ?? m;
const DOC_ACTION: Record<string, string> = { receive: 'Réception · faite par', validate_invoice: 'Facture · validée par', pay: 'Paiement · émis par', release_hold: 'Levée du blocage · faite par' };
const DOC_FORBIDDEN: Record<string, string> = { po_creator: 'Bon de commande · créé par', receiver: 'Réception · faite par', invoice_validator: 'Facture · validée par', payer: 'Paiement · émis par' };
const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const severityTag = (s: string) => <span className={`kl-tag ${s === 'critical' ? 'r' : 'o'}`}>{s === 'critical' ? 'Critique' : 'Avertissement'}</span>;
const statusTag = (on: boolean) => <span className={`kl-tag ${on ? 'g' : 'x'}`}>{on ? 'Active' : 'Inactive'}</span>;
const muted = (t: string) => <span style={{ color: 'var(--ds-muted)' }}>{t}</span>;

export default function ControlsPanel() {
  const [params, setParams] = useSearchParams();
  const section = (SECTIONS.includes(params.get('section') as Section) ? params.get('section') : 'sod') as Section;
  const setSection = (s: Section) => { const n = new URLSearchParams(params); n.set('section', s); setParams(n, { replace: true }); };
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations, retry: false });
  const { data: delegations = [] } = useQuery({ queryKey: ['delegations'], queryFn: governanceApi.delegationsList, retry: false });
  const running = delegations.filter(d => d.status !== 'ended').length;
  return (
    <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
      <Tabs label="Contrôles" value={section} onChange={setSection} tabs={[
        { key: 'sod', label: 'Séparation des tâches', count: violations.length || undefined },
        { key: 'limits', label: "Plafonds d'approbation" },
        { key: 'delegations', label: 'Délégations', count: running || undefined },
        { key: 'rights', label: 'Contrôle des droits' },
      ]} />
      {section === 'sod' && <SodTab />}
      {section === 'limits' && <LimitsTab />}
      {section === 'delegations' && <DelegationsPanel />}
      {section === 'rights' && <RightsTab />}
    </div>
  );
}

/* ═════════ Séparation des tâches ═════════ */
function SodTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: roleMode } = useQuery({ queryKey: ['sod-mode'], queryFn: governanceApi.sodMode });
  const { data: rules = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['sod-rules'], queryFn: governanceApi.sodList });
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations });
  const { data: doc } = useQuery({ queryKey: ['sod-documents'], queryFn: governanceApi.documentSod, retry: false });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const [creating, setCreating] = useState(false);
  const roleLabel = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const invalidate = () => { ['sod-rules', 'sod-violations', 'sod-documents', 'sod-mode'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); };

  const setRoleMode = useMutation({
    mutationFn: (m: 'off' | 'log' | 'enforce') => governanceApi.setSodMode(m),
    onSuccess: () => { invalidate(); notify.success('Mode du cumul de rôles enregistré'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const setDocMode = useMutation({
    mutationFn: (m: DocumentSodMode) => governanceApi.setDocumentSodMode(m),
    onSuccess: () => { invalidate(); notify.success('Mode des pièces enregistré'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const toggleRule = useMutation({
    mutationFn: (r: SodRuleRow) => governanceApi.sodUpdate(r.code, { isActive: !r.is_active }),
    onSuccess: invalidate, onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const toggleDocRule = useMutation({
    mutationFn: (r: { code: string; is_active: boolean }) => governanceApi.setDocumentSodRule(r.code, !r.is_active),
    onSuccess: invalidate, onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: (code: string) => governanceApi.sodRemove(code),
    onSuccess: () => { invalidate(); notify.success('Règle supprimée'); },
    onError: (e) => notify.error(errorMessage(e, 'Suppression refusée')),
  });
  const changeRoleMode = async (m: 'off' | 'log' | 'enforce') => {
    if (m === 'enforce' && violations.length && !(await confirm(`${violations.length} compte(s) cumulent aujourd'hui des capacités incompatibles : toute modification de leurs rôles sera refusée tant que le conflit demeure.`,
      { title: 'Bloquer les cumuls interdits ?', confirmLabel: 'Bloquer', danger: true }))) return;
    setRoleMode.mutate(m);
  };
  const changeDocMode = async (m: DocumentSodMode) => {
    if (m === 'off' && !(await confirm('La même personne pourra commander, réceptionner, valider la facture et payer, sans trace.', { title: 'Désactiver le contrôle des pièces ?', confirmLabel: 'Désactiver', danger: true }))) return;
    setDocMode.mutate(m);
  };
  const ruleCount = rules.length + (doc?.rules.length ?? 0);

  return (
    <>
      <DataPanel label="Mode de contrôle">
        <div className="usr-row">
          <div><b>Cumul de rôles</b><p>Un compte réunit deux capacités incompatibles. Contrôlé à l'attribution des rôles et des délégations ; l'administrateur n'est jamais concerné.</p></div>
          <ModeSwitch label="Mode du cumul de rôles" value={roleMode?.mode ?? 'log'} options={ROLE_MODES} disabled={setRoleMode.isPending} onChange={m => void changeRoleMode(m)} />
        </div>
        <div className="usr-row">
          <div><b>Pièces</b><p>La même personne enchaîne deux étapes d'une pièce d'achat (commande, réception, facture, paiement).</p></div>
          <ModeSwitch label="Mode des pièces" value={doc?.mode ?? 'warn'} options={DOC_MODES} disabled={setDocMode.isPending || !doc} onChange={m => void changeDocMode(m)} />
        </div>
      </DataPanel>

      <SectionHeader title="Comptes en conflit" note={violations.length ? `${violations.length}` : undefined} />
      <DataPanel label="Comptes en conflit">
        {violations.length === 0 ? <EmptyState bare icon={ShieldCheck} title="Aucun compte en conflit" text="Aucun compte actif ne réunit deux capacités incompatibles." /> : (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Compte</th><th>Règle</th><th>Par les rôles</th><th>Sévérité</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
              <tbody>
                {violations.map(v => (
                  <tr key={v.userId}>
                    <td className="ds-strong">{v.name}</td>
                    <td>{v.violations.map(c => c.label).join(' · ')}</td>
                    <td><span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{(v.roles ?? [v.roleCode]).map(c => <span key={c} className={`kl-tag ${c === v.roleCode ? 'b' : 'x'}`}>{roleLabel(c)}</span>)}</span></td>
                    <td>{severityTag(v.violations.some(c => c.severity === 'critical') ? 'critical' : 'warning')}</td>
                    <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate(`/users/${v.userId}?tab=roles`)}>Revoir ses rôles</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <SectionHeader title="Règles" note={`${ruleCount}`}>
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> Nouvelle règle</button>
      </SectionHeader>
      {isLoading ? <LoadingState /> : isError ? <DataPanel><ErrorState bare error={error} onRetry={() => void refetch()} /></DataPanel> : (
        <DataPanel label="Règles" footer={doc ? (
          <TableFooter note={`Dérogations accordées sur des pièces ce mois-ci : ${doc.overridesThisMonth}. Les règles des pièces sont livrées avec Kalum ; on peut les désactiver une à une.`} />
        ) : undefined}>
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Règle</th><th>Porte sur</th><th>Capacité A</th><th>Capacité B</th><th>Sévérité</th><th>Statut</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.code}>
                    <td className="ds-strong">{r.label}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>Cumul de rôles</td>
                    <td>{moduleLabel(r.a_module)} · {CAPABILITY_LABELS[r.a_right as Capability] ?? r.a_right}</td>
                    <td>{moduleLabel(r.b_module)} · {CAPABILITY_LABELS[r.b_right as Capability] ?? r.b_right}</td>
                    <td>{severityTag(r.severity)}</td>
                    <td>{statusTag(r.is_active)}</td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={toggleRule.isPending} onClick={() => toggleRule.mutate(r)}>{r.is_active ? 'Désactiver' : 'Activer'}</button>
                      <RowMenu label={`Autres actions pour la règle ${r.label}`} items={[{
                        label: 'Supprimer', icon: Trash2, danger: true,
                        onSelect: async () => { if (await confirm(`Supprimer la règle « ${r.label} » ?`, { title: 'Supprimer la règle', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(r.code); },
                      }]} />
                    </td>
                  </tr>
                ))}
                {(doc?.rules ?? []).map(r => (
                  <tr key={`doc-${r.code}`}>
                    <td className="ds-strong">{r.label}</td>
                    <td>Pièce</td>
                    <td>{DOC_FORBIDDEN[r.forbidden] ?? r.forbidden}</td>
                    <td>{DOC_ACTION[r.action] ?? r.action}</td>
                    <td>{severityTag('critical')}</td>
                    <td>{statusTag(r.is_active)}</td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={toggleDocRule.isPending} onClick={() => toggleDocRule.mutate(r)}>{r.is_active ? 'Désactiver' : 'Activer'}</button>
                      {/* Pas de menu (règle livrée, non supprimable) : place gardée pour aligner les boutons. */}
                      <span aria-hidden="true" style={{ display: 'inline-block', width: 32 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      )}

      {doc && doc.violations.length > 0 && (
        <>
          <SectionHeader title="Manquements relevés sur des pièces" note="90 derniers jours, en mode Observer ou par un administrateur" />
          <DataPanel label="Manquements relevés sur des pièces">
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Règle</th><th>Par</th><th className="ds-num">Pièces</th><th className="ds-num">Fois</th><th>Dernière fois</th></tr></thead>
                <tbody>
                  {doc.violations.map(v => (
                    <tr key={`${v.rule_code}-${v.actor_id}`}>
                      <td>{doc.rules.find(r => r.code === v.rule_code)?.label ?? v.rule_code}</td>
                      <td className="ds-strong">{v.actor}</td>
                      <td className="ds-num">{v.documents}</td>
                      <td className="ds-num">{v.occurrences}</td>
                      <td>{fmtDate(v.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataPanel>
        </>
      )}
      {creating && <SodRuleModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); invalidate(); }} />}
    </>
  );
}

function SodRuleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ label: '', aModule: 'purchasing', aRight: 'create', bModule: 'purchasing', bRight: 'approve', severity: 'critical' });
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));
  const create = useMutation({
    mutationFn: () => governanceApi.sodCreate(f),
    onSuccess: () => { notify.success('Règle créée'); onDone(); },
    onError: (e) => notify.error(errorMessage(e, 'Création refusée')),
  });
  const moduleSel = (k: 'aModule' | 'bModule') => (
    <select id={`sod-${k}`} className="ds-input" value={f[k]} onChange={e => set(k, e.target.value)}>
      {MODULE_OPTIONS.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}
    </select>
  );
  const rightSel = (k: 'aRight' | 'bRight') => (
    <select id={`sod-${k}`} className="ds-input" value={f[k]} onChange={e => set(k, e.target.value)}>
      {CAPABILITIES.map(c => <option key={c} value={c}>{CAPABILITY_LABELS[c]}</option>)}
    </select>
  );
  return (
    <Modal title="Nouvelle règle de séparation des tâches" subtitle="Deux capacités qu'une même personne ne doit pas réunir." onClose={onClose} width={620} locked={create.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={f.label.trim().length < 2 || create.isPending} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>
          {create.isPending ? 'Création…' : 'Créer la règle'}
        </button>
      </>}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        <FormField label="Libellé" htmlFor="sod-label" required>
          <input id="sod-label" className="ds-input" value={f.label} onChange={e => set('label', e.target.value)} placeholder="Créer des achats et les approuver" maxLength={120} autoFocus />
        </FormField>
        <div className="ds-form-grid">
          <FormField label="Capacité A — module" htmlFor="sod-aModule">{moduleSel('aModule')}</FormField>
          <FormField label="Capacité A — droit" htmlFor="sod-aRight">{rightSel('aRight')}</FormField>
          <FormField label="Capacité B — module" htmlFor="sod-bModule">{moduleSel('bModule')}</FormField>
          <FormField label="Capacité B — droit" htmlFor="sod-bRight">{rightSel('bRight')}</FormField>
          <FormField label="Sévérité" htmlFor="sod-severity">
            <select id="sod-severity" className="ds-input" value={f.severity} onChange={e => set('severity', e.target.value)}>
              <option value="critical">Critique</option><option value="warning">Avertissement</option>
            </select>
          </FormField>
        </div>
        <Alert tone="info">Les règles sur les pièces (bon de commande, réception, facture, paiement) sont livrées avec Kalum : on les active ou les désactive dans la liste.</Alert>
      </div>
    </Modal>
  );
}

/* ═════════ Plafonds d'approbation ═════════ */
function LimitsTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['approval-limits', 'overview'], queryFn: governanceApi.limitsOverview });
  const [editing, setEditing] = useState<ApprovalLimitRow | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => governanceApi.limitsRemove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-limits'] }); notify.success('Plafond retiré'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const docLabel = (d: string) => APPROVAL_DOCUMENT_LABELS[d as ApprovalDocumentType] ?? d;
  const circuitsText = (d: string) => {
    const list = (data.circuits[d] ?? []).filter(c => c.enabled);
    return list.length ? list.map(c => `« ${c.label} »${c.approvers.length ? ` → ${c.approvers.join(', ')}` : ''}`).join(' · ') : null;
  };
  const ineffective = data.rows.filter(r => !r.enforced).length;

  return (
    <>
      <HrHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Définir un plafond
        </button>
      </HrHeaderActions>
      <Alert tone="info">
        Un plafond borne ce qu'un rôle peut engager seul quand aucun circuit d'approbation ne s'applique ; au-delà, l'envoi est refusé.
        Quand un circuit couvre la pièce, c'est lui qui décide. Aujourd'hui, seul le bon de commande applique un plafond (à l'envoi).
      </Alert>
      {ineffective > 0 && <Alert tone="warning" icon={TriangleAlert}>{ineffective} plafond{ineffective > 1 ? 's' : ''} porte{ineffective > 1 ? 'nt' : ''} sur un type de pièce qui ne le lit pas : sans effet. Réglez plutôt le circuit d'approbation de ce type.</Alert>}
      <DataPanel label="Plafonds par rôle" footer={(
        <div className="ds-form-foot">
          <span className="ds-grow" style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Les circuits d'approbation se règlent dans Paramètres.</span>
          <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate('/settings?page=approvals')}>Circuits d'approbation <ExternalLink size={12} aria-hidden="true" /></button>
        </div>
      )}>
        {data.rows.length === 0 ? <EmptyState bare icon={ShieldCheck} title="Aucun plafond défini" text="Aucune limite d'engagement n'est active." /> : (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Rôle</th><th>Type de pièce</th><th className="ds-num">Plafond ({currencySymbol()})</th><th>Circuits du même type</th><th>Effet</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
              <tbody>
                {data.rows.map(l => (
                  <tr key={l.id}>
                    <td className="ds-strong">{l.role_label}</td>
                    <td>{docLabel(l.document_type)}</td>
                    <td className="ds-num">{Number(l.max_amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                    <td>{circuitsText(l.document_type) ?? muted('Aucun circuit actif')}</td>
                    <td>{l.enforced ? <span className="kl-tag g">Appliqué à l'envoi</span> : <span className="kl-tag o">Sans effet</span>}</td>
                    <td className="ds-actions">
                      {l.enforced && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing(l)}>Modifier</button>}
                      <RowMenu label={`Autres actions pour le plafond ${l.role_label}`} items={[{
                        label: 'Retirer', icon: Trash2, danger: true,
                        onSelect: async () => { if (await confirm(`Retirer le plafond « ${docLabel(l.document_type)} » du rôle ${l.role_label} ?`, { danger: true, confirmLabel: 'Retirer' })) remove.mutate(l.id); },
                      }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
      {editing && <LimitModal row={editing === 'new' ? null : editing} enforcedTypes={data.enforcedTypes} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['approval-limits'] }); }} />}
    </>
  );
}

function LimitModal({ row, enforcedTypes, onClose, onDone }: { row: ApprovalLimitRow | null; enforcedTypes: string[]; onClose: () => void; onDone: () => void }) {
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const types = APPROVAL_DOCUMENT_TYPES.filter(t => enforcedTypes.includes(t));
  const [f, setF] = useState({ roleCode: row?.role_code ?? '', documentType: (row?.document_type ?? types[0] ?? 'purchase_order') as string, maxAmount: row ? String(Number(row.max_amount)) : '' });
  const save = useMutation({
    mutationFn: () => governanceApi.limitsSet({ roleCode: f.roleCode, documentType: f.documentType, maxAmount: Number(f.maxAmount) }),
    onSuccess: () => { notify.success('Plafond enregistré'); onDone(); },
    onError: (e) => notify.error(errorMessage(e, 'Enregistrement refusé')),
  });
  const amount = Number(f.maxAmount);
  return (
    <Modal title={row ? 'Modifier le plafond' : 'Définir un plafond'} subtitle="Montant qu'un rôle peut engager seul, sans circuit d'approbation." onClose={onClose} width={560} locked={save.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!f.roleCode || f.maxAmount === '' || !Number.isFinite(amount) || amount < 0 || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </>}>
      <div className="ds-form-grid">
        <FormField label="Rôle" htmlFor="lim-role" required>
          <select id="lim-role" className="ds-input" value={f.roleCode} disabled={!!row} onChange={e => setF(s => ({ ...s, roleCode: e.target.value }))}>
            <option value="">Choisir un rôle…</option>
            {roles.filter(r => r.code !== 'admin' && (r.is_active || r.code === f.roleCode)).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </FormField>
        <FormField label="Type de pièce" htmlFor="lim-doc" required hint="Seuls les types qui appliquent un plafond sont proposés.">
          <select id="lim-doc" className="ds-input" value={f.documentType} disabled={!!row} onChange={e => setF(s => ({ ...s, documentType: e.target.value }))}>
            {types.map(d => <option key={d} value={d}>{APPROVAL_DOCUMENT_LABELS[d]}</option>)}
          </select>
        </FormField>
        <FormField label={`Plafond (${currencySymbol()})`} htmlFor="lim-max" required>
          <input id="lim-max" className="ds-input" type="number" min={0} step="0.01" value={f.maxAmount} onChange={e => setF(s => ({ ...s, maxAmount: e.target.value }))} placeholder="50000" autoFocus={!!row} />
        </FormField>
      </div>
    </Modal>
  );
}

/* ═════════ Délégations ═════════ */
export function DelegationsPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: delegations = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['delegations'], queryFn: governanceApi.delegationsList });
  const [view, setView] = useState<'current' | 'history'>('current');
  const [creating, setCreating] = useState(false);
  const [extending, setExtending] = useState<DelegationRow | null>(null);
  const remove = useMutation({
    mutationFn: (d: DelegationRow) => governanceApi.delegationsRemove(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delegations'] }); notify.success('Délégation retirée'); },
    onError: (e) => notify.error(errorMessage(e, 'Erreur')),
  });
  const rows = delegations.filter(d => (view === 'current' ? d.status !== 'ended' : d.status === 'ended'));
  const current = delegations.filter(d => d.status !== 'ended').length;
  const history = delegations.length - current;

  return (
    <>
      <Toolbar>
        <div className="prj-views" role="group" aria-label="Période">
          <button type="button" className={view === 'current' ? 'active' : ''} aria-pressed={view === 'current'} onClick={() => setView('current')}>En cours et programmées ({current})</button>
          <button type="button" className={view === 'history' ? 'active' : ''} aria-pressed={view === 'history'} onClick={() => setView('history')}>Historique ({history})</button>
        </div>
        <span className="ds-grow" />
        <button type="button" className="odoo-btn-secondary" onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} aria-hidden="true" /> Nouvelle délégation</button>
      </Toolbar>
      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <DataPanel label="Délégations" footer={<TableFooter note="Une délégation « Approbations seulement » peut aussi être créée par la personne elle-même, depuis Approbations." />}>
          {rows.length === 0 ? <EmptyState bare icon={UserCog} title={view === 'current' ? 'Aucune délégation en cours' : 'Aucune délégation terminée'} /> : (
            <div className="ds-scroll">
              <table className="odoo-table">
                <thead><tr><th>De</th><th>Vers</th><th>Ce qui est délégué</th><th>Période</th><th>Motif</th><th>Statut</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
                <tbody>
                  {rows.map(d => (
                    <tr key={`${d.kind}-${d.id}`}>
                      <td className="ds-strong">{d.from_name}</td>
                      <td className="ds-strong">{d.to_name}</td>
                      <td>{d.kind === 'role' ? <>Rôle complet · {d.role_label}</> : 'Approbations seulement'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.starts_at)} → {fmtDate(d.ends_at)}</td>
                      <td>{d.reason ?? muted('—')}</td>
                      <td>
                        <span className={`kl-tag ${d.status === 'active' ? 'b' : d.status === 'scheduled' ? 'o' : 'x'}`}>
                          {d.status === 'active' ? 'En cours' : d.status === 'scheduled' ? 'Programmée' : 'Terminée'}
                        </span>
                      </td>
                      <td className="ds-actions">
                        {d.status !== 'ended' && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setExtending(d)}>{d.status === 'active' ? 'Prolonger' : 'Modifier'}</button>}
                        <RowMenu label={`Autres actions pour la délégation de ${d.from_name}`} items={[{
                          label: d.status === 'ended' ? 'Supprimer de l\'historique' : 'Retirer', icon: Trash2, danger: true,
                          onSelect: async () => { if (await confirm(`Retirer la délégation de ${d.from_name} à ${d.to_name} ?`, { danger: true, confirmLabel: 'Retirer' })) remove.mutate(d); },
                        }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}
      {creating && <DelegationModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['delegations'] }); }} />}
      {extending && <ExtendModal row={extending} onClose={() => setExtending(null)} onDone={() => { setExtending(null); qc.invalidateQueries({ queryKey: ['delegations'] }); }} />}
    </>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function DelegationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const [f, setF] = useState({ kind: 'approvals' as 'role' | 'approvals', fromUserId: '', toUserId: '', roleCode: '', startsAt: today(), endsAt: '', reason: '' });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const active = (users as Record<string, unknown>[]).filter(u => u.isActive);
  const name = (u?: Record<string, unknown>) => (u ? `${u.firstName} ${u.lastName}` : '');
  const from = active.find(u => u.id === f.fromUserId);
  const to = active.find(u => u.id === f.toUserId);
  // Rôle délégué proposé : le rôle principal du délégant.
  const pickFrom = (id: string) => { const u = active.find(x => x.id === id); setF(s => ({ ...s, fromUserId: id, roleCode: s.roleCode || ((u?.role as string) !== 'admin' ? (u?.role as string) ?? '' : '') })); };
  const toRoles: string[] = to ? (Array.isArray(to.roles) && (to.roles as string[]).length ? to.roles as string[] : [to.role as string]) : [];
  const sod = useQuery({
    queryKey: ['delegation-sod', f.toUserId, f.roleCode],
    queryFn: () => usersApi.sodCheck([...new Set([...toRoles, f.roleCode])]),
    enabled: f.kind === 'role' && !!to && !!f.roleCode,
  });
  const create = useMutation({
    mutationFn: () => governanceApi.delegationsCreate({
      kind: f.kind, fromUserId: f.fromUserId, toUserId: f.toUserId, roleCode: f.kind === 'role' ? f.roleCode : undefined,
      startsAt: f.kind === 'role' ? new Date(`${f.startsAt}T00:00:00`).toISOString() : f.startsAt,
      endsAt: f.kind === 'role' ? new Date(`${f.endsAt}T23:59:59`).toISOString() : f.endsAt,
      reason: f.reason.trim(),
    }),
    onSuccess: (r) => {
      notify.success(f.startsAt > today() ? 'Délégation programmée' : 'Délégation créée');
      if (r.warnings?.length) notify.error(`Conflit signalé : ${r.warnings.join(', ')}`);
      onDone();
    },
    onError: (e) => notify.error(errorMessage(e, 'Création refusée')),
  });
  const invalid = !f.fromUserId || !f.toUserId ? 'Choisissez les deux personnes'
    : f.kind === 'role' && !f.roleCode ? 'Choisissez le rôle délégué'
    : !f.endsAt ? 'Date de fin requise'
    : f.endsAt < f.startsAt ? 'La fin doit suivre le début'
    : f.reason.trim().length < 3 ? 'Motif requis' : null;
  const conflicts = sod.data?.violations ?? [];

  return (
    <Modal title="Nouvelle délégation" subtitle="Prend effet et s'arrête toute seule aux dates choisies." onClose={onClose} width={640} locked={create.isPending}
      footer={(
        <div className="ds-form-foot">
          <span className="ds-grow" style={{ color: 'var(--ds-muted)', fontSize: 13 }}>{invalid ?? ''}</span>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!!invalid || create.isPending || (sod.data?.mode === 'enforce' && conflicts.length > 0)} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>
            {create.isPending ? 'Création…' : 'Créer la délégation'}
          </button>
        </div>
      )}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        <div className="ds-form-grid">
          <FormField label="De" required>
            <SearchSelect value={f.fromUserId} onChange={pickFrom} placeholder="Choisir…" size="md" width="100%" ariaLabel="De"
              options={active.map(u => ({ id: u.id as string, label: name(u) }))} />
          </FormField>
          <FormField label="Vers" required>
            <SearchSelect value={f.toUserId} onChange={v => set('toUserId', v)} placeholder="Choisir…" size="md" width="100%" ariaLabel="Vers"
              options={active.filter(u => u.id !== f.fromUserId).map(u => ({ id: u.id as string, label: name(u) }))} />
          </FormField>
        </div>
        <FormField label="Ce qui est délégué">
          <div className="prj-views" role="group" aria-label="Ce qui est délégué" style={{ display: 'inline-flex', width: 'fit-content' }}>
            <button type="button" className={f.kind === 'role' ? 'active' : ''} aria-pressed={f.kind === 'role'} onClick={() => set('kind', 'role')}>Rôle complet</button>
            <button type="button" className={f.kind === 'approvals' ? 'active' : ''} aria-pressed={f.kind === 'approvals'} onClick={() => set('kind', 'approvals')}>Approbations seulement</button>
          </div>
        </FormField>
        {f.kind === 'role' && (
          <FormField label="Rôle délégué" htmlFor="dl-role" required hint="Le délégataire cumule ce rôle sur la période, en plus des siens.">
            <select id="dl-role" className="ds-input" value={f.roleCode} onChange={e => set('roleCode', e.target.value)}>
              <option value="">Choisir un rôle…</option>
              {roles.filter(r => r.code !== 'admin' && r.is_active).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </FormField>
        )}
        {f.kind === 'approvals' && <Alert tone="info">{to ? name(to) : 'Le délégataire'} pourra approuver à la place de {from ? name(from) : 'la personne'} les pièces qui lui reviennent ; ses autres droits ne changent pas.</Alert>}
        <div className="ds-form-grid">
          <FormField label="Du" htmlFor="dl-start" required hint="Peut commencer plus tard.">
            <input id="dl-start" type="date" className="ds-input" min={today()} value={f.startsAt} onChange={e => set('startsAt', e.target.value)} />
          </FormField>
          <FormField label="Au" htmlFor="dl-end" required>
            <input id="dl-end" type="date" className="ds-input" min={f.startsAt} value={f.endsAt} onChange={e => set('endsAt', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Motif" htmlFor="dl-reason" required>
          <input id="dl-reason" className="ds-input" value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Congé, salon professionnel…" maxLength={200} />
        </FormField>
        {f.kind === 'role' && conflicts.length > 0 && (
          <Alert tone={sod.data?.mode === 'enforce' ? 'danger' : 'warning'} icon={ShieldAlert}>
            En « Rôle complet », {to ? name(to) : 'le délégataire'} réunirait des capacités incompatibles : {conflicts.map(c => `« ${c.label} »`).join(', ')}.
            {sod.data?.mode === 'enforce' ? ' Le mode Bloquer refuse cette délégation : choisissez « Approbations seulement » ou une autre personne.' : ' La délégation reste possible ; le conflit sera visible dans Contrôles internes.'}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

function ExtendModal({ row, onClose, onDone }: { row: DelegationRow; onClose: () => void; onDone: () => void }) {
  const [end, setEnd] = useState(row.ends_at.slice(0, 10));
  const start = row.starts_at.slice(0, 10);
  const save = useMutation({
    mutationFn: () => governanceApi.delegationsExtend(row, row.kind === 'role' ? new Date(`${end}T23:59:59`).toISOString() : end),
    onSuccess: () => { notify.success('Délégation modifiée'); onDone(); },
    onError: (e) => notify.error(errorMessage(e, 'Modification refusée')),
  });
  return (
    <Modal title={row.status === 'active' ? 'Prolonger la délégation' : 'Modifier la délégation'} subtitle={`${row.from_name} → ${row.to_name} · depuis le ${fmtDate(row.starts_at)}`} onClose={onClose} width={460} locked={save.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!end || end < start || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
          <CalendarPlus size={13} aria-hidden="true" /> {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </>}>
      <FormField label="Nouvelle date de fin" htmlFor="ext-end" required>
        <input id="ext-end" type="date" className="ds-input" min={start} value={end} onChange={e => setEnd(e.target.value)} autoFocus />
      </FormField>
    </Modal>
  );
}

/* ═════════ Contrôle des droits ═════════ */
function RightsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['security'], queryFn: rolesApi.security });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const save = useMutation({
    mutationFn: (mode: 'off' | 'log' | 'enforce') => rolesApi.setSecurityMode(mode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); notify.success('Mode du contrôle des droits enregistré'); },
    onError: (err) => notify.error(errorMessage(err, 'Erreur')),
  });
  const denials = useMemo(() => data?.denials ?? [], [data]);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const setMode = async (mode: 'off' | 'log' | 'enforce') => {
    if (mode === 'enforce' && !(await confirm(
      denials.length
        ? `${denials.length} écran(s) ou action(s) ont été utilisés sans le droit nécessaire ces 14 derniers jours : ils seront refusés. Ajustez d'abord les rôles concernés si ces accès sont légitimes.`
        : 'Les écrans et actions utilisés sans le droit nécessaire seront refusés.',
      { title: 'Bloquer les accès hors droits ?', confirmLabel: 'Bloquer', danger: denials.length > 0 },
    ))) return;
    save.mutate(mode);
  };
  const roleLabel = (c: string | null) => (c ? roles.find(r => r.code === c)?.label ?? c : '—');
  /** « GET /api/v1/stock/lots » → écran « Stock » ; un refus d'action métier n'a pas de route. */
  const screen = (d: { route: string | null; verb?: string | null; module?: string | null }) => {
    if (!d.route) return d.verb ? `${BUSINESS_VERB_LABELS[d.verb as BusinessVerb] ?? d.verb} · ${moduleLabel(d.module ?? '')}` : 'Action non précisée';
    const path = d.route.replace(/^[A-Z]+\s+/, '').replace(/^\/api(\/v\d+)?/, '');
    return NAV_LABEL_BY_PATH[`/${path.split('/')[1] ?? ''}`] ?? path;
  };
  const missing = (d: { route: string | null; verb?: string | null; module?: string | null; modules: string[] | null }) =>
    (!d.route && d.verb ? `Action métier « ${BUSINESS_VERB_LABELS[d.verb as BusinessVerb] ?? d.verb} »` : (d.modules ?? []).map(m => moduleLabel(m)).join(', '));

  return (
    <>
      <DataPanel label="Mode du contrôle des droits">
        <div className="usr-row">
          <div><b>Appels hors droits</b><p>Un écran ou une action utilisés sans le droit nécessaire. Chaque appel est comparé aux droits du rôle, ou aux droits propres du compte s'il en a.</p></div>
          <ModeSwitch label="Mode du contrôle des droits" value={data.mode} options={ROLE_MODES} disabled={save.isPending} onChange={m => void setMode(m)} />
        </div>
      </DataPanel>
      <DataPanel label="Appels hors droits" footer={<TableFooter note={data.mode === 'log' ? 'À examiner avant de passer en mode Bloquer.' : '14 derniers jours.'} />}>
        {denials.length === 0 ? <EmptyState bare icon={ShieldCheck} title="Aucun appel hors droits" text="Rien n'a été utilisé sans le droit nécessaire ces 14 derniers jours." /> : (
          <div className="ds-scroll">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Écran ou action</th><th>Rôle</th><th>Droit manquant</th><th>Comptes</th><th className="ds-num">Appels (14 j)</th><th>Dernier appel</th></tr></thead>
              <tbody>
                {denials.map(d => (
                  <tr key={`${d.route}|${d.role_code}|${d.verb}|${d.module}`}>
                    <td>
                      <span className="ds-strong">{screen(d)}</span>
                      {d.route ? <span className="usr-sub" style={{ fontFamily: 'var(--ds-mono, monospace)' }}>{d.route}</span> : <span className="usr-sub">Action métier</span>}
                    </td>
                    <td>{roleLabel(d.role_code)}</td>
                    <td>{missing(d) || muted('—')}</td>
                    <td>{d.user_names}</td>
                    <td className="ds-num">{d.hits}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.last_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
    </>
  );
}
