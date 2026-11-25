import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Plus, ShieldCheck } from 'lucide-react';
import {
  APP_MODULES, BUSINESS_VERB_LABELS, DATA_SCOPES, DATA_SCOPE_LABELS, LEGACY_MODULE_KEYS, MODULE_LABELS, MODULE_VERBS,
  PERMISSIONS, SETTINGS_SECTION_LABELS, type AppModule, type BusinessVerb, type DataScope,
} from '@ofauria/shared';
import {
  usersApi, type ActionExceptionRow, type ExceptionEffect, type ModuleExceptionRow, type ModuleRights, type UserExceptions,
} from '../../api/users.api';
import { Alert, DataPanel, EmptyState, ErrorState, FormField, LoadingState, Modal, SectionHeader } from '../../components/ds';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { errorMessage } from './RolesPanel';
import { fmtDate } from './UsersOverview';
import { keyLabel } from './roleAccess';

/**
 * Exceptions individuelles d'un compte (refonte Utilisateurs, lot 6, mig 706). Elles s'ajoutent
 * aux rôles : une exception de module remplace les droits des rôles pour ce module seulement, une
 * exception d'action accorde ou retire une permission précise. Motif obligatoire, date de fin
 * facultative ; passé ce jour, l'exception ne compte plus et reste affichée comme expirée.
 */

const MODULES = (Object.values(APP_MODULES) as AppModule[])
  .filter(m => m !== 'users' && !(LEGACY_MODULE_KEYS as ReadonlySet<string>).has(m))
  .sort((a, b) => (MODULE_LABELS[a] ?? a).localeCompare(MODULE_LABELS[b] ?? b, 'fr'));
const moduleLabel = (m: string) => MODULE_LABELS[m as AppModule] ?? m;
const FLAGS = [['canView', 'Voir'], ['canCreate', 'Créer'], ['canEdit', 'Modifier'], ['canDelete', 'Supprimer']] as const;
const SECTION_KEYS = Object.keys(SETTINGS_SECTION_LABELS);
const SCOPE_RANK: Record<string, number> = { own: 0, store: 1, all: 2 };
const DEFS = PERMISSIONS as Record<string, { module: string; label: string }>;
const today = () => new Date().toLocaleDateString('sv-SE');

const EFFECT: Record<ExceptionEffect, { label: string; tag: string }> = {
  grant: { label: 'Accordé', tag: 'g' },
  revoke: { label: 'Retiré', tag: 'r' },
  change: { label: 'Modifié', tag: 'o' },
  none: { label: 'Sans effet', tag: 'x' },
};

const NO_RIGHTS: ModuleRights = { canView: false, canCreate: false, canEdit: false, canDelete: false, verbs: [], scope: 'store', sections: [] };

/** Même règle que le serveur (services/user-exceptions.ts) : effet par rapport aux rôles. */
function effectOf(role: ModuleRights | null, ex: ModuleRights): ExceptionEffect {
  const r = role ?? NO_RIGHTS;
  const view = ex.canView || ex.canCreate || ex.canEdit || ex.canDelete;
  if (!view) return r.canView ? 'revoke' : 'none';
  if (!r.canView) return 'grant';
  let more = false; let less = false;
  for (const [f] of FLAGS) { if (ex[f] && !r[f]) more = true; if (!ex[f] && r[f]) less = true; }
  if (ex.verbs.some(v => !r.verbs.includes(v))) more = true;
  if (r.verbs.some(v => !ex.verbs.includes(v))) less = true;
  const es = SCOPE_RANK[ex.scope] ?? 1; const rs = SCOPE_RANK[r.scope] ?? 1;
  if (es > rs) more = true; if (es < rs) less = true;
  if (ex.sections.length || r.sections.length) {
    if (!ex.sections.length) more = true;
    else if (!r.sections.length) less = true;
    else {
      if (ex.sections.some(s => !r.sections.includes(s))) more = true;
      if (r.sections.some(s => !ex.sections.includes(s))) less = true;
    }
  }
  return more && less ? 'change' : more ? 'grant' : less ? 'revoke' : 'none';
}

/** « Voir, Créer · Approuver · Tous les établissements » ; « aucun accès ». */
function describeRights(r: ModuleRights): string {
  if (!(r.canView || r.canCreate || r.canEdit || r.canDelete)) return 'aucun accès';
  const parts = [FLAGS.filter(([f]) => r[f]).map(([, l]) => l).join(', ')];
  if (r.verbs.length) parts.push(r.verbs.map(v => BUSINESS_VERB_LABELS[v as BusinessVerb] ?? v).join(', '));
  parts.push(DATA_SCOPE_LABELS[r.scope as DataScope] ?? r.scope);
  if (r.sections.length) parts.push(`sections : ${r.sections.map(s => (SETTINGS_SECTION_LABELS as Record<string, string>)[s] ?? s).join(', ')}`);
  return parts.join(' · ');
}

type Editing = { kind: 'module'; row?: ModuleExceptionRow } | { kind: 'action'; row?: ActionExceptionRow };

export function ExceptionsPanel({ userId, userName }: { userId: string; userName: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['user-exceptions', userId], queryFn: () => usersApi.exceptions(userId) });
  const [editing, setEditing] = useState<Editing | null>(null);

  const refresh = () => ['user-exceptions', 'access-review', 'access-overview', 'users', 'sod-violations']
    .forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const remove = useMutation({
    mutationFn: (v: { kind: 'modules' | 'actions'; ref: string }) => usersApi.removeException(userId, v.kind, v.ref),
    onSuccess: () => { notify.success('Exception retirée'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Retrait refusé')),
  });
  const askRemove = async (kind: 'modules' | 'actions', ref: string, what: string) => {
    const ok = await confirm(
      `${what} : ${userName} suivra à nouveau les droits de ses rôles. Ses sessions ouvertes seront fermées.`,
      { title: "Retirer l'exception ?", confirmLabel: "Retirer l'exception" });
    if (ok) remove.mutate({ kind, ref });
  };

  if (isError) return <ErrorState bare error={error} title="Les exceptions n'ont pas pu être chargées" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingState bare />;

  const count = data.modules.length + data.actions.length;
  return (
    <section style={{ display: 'grid', gap: 'var(--ds-s3)' }} aria-label="Exceptions individuelles">
      <SectionHeader title="Exceptions individuelles" note="S'ajoutent aux rôles ou retirent un droit précis, avec un motif et une date de fin">
        {!data.isAdmin && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing({ kind: 'module' })}>
            <Plus size={13} aria-hidden="true" /> Ajouter une exception
          </button>
        )}
      </SectionHeader>
      {data.isAdmin ? (
        <Alert tone="info" icon={Lock}>L'administrateur a déjà tous les droits : aucune exception à poser.</Alert>
      ) : (
        <DataPanel label="Exceptions individuelles">
          {count ? (
            <table className="odoo-table ds-dense">
              <thead><tr><th>Droit</th><th>Effet</th><th>Motif</th><th>Jusqu'au</th><th>Par</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.modules.map(m => (
                  <tr key={`m-${m.module}`} style={m.active ? undefined : { opacity: 0.6 }}>
                    <td><span className="ds-strong">{moduleLabel(m.module)}</span> · {describeRights(m)}</td>
                    <td><EffectTags effect={m.effect} active={m.active} /></td>
                    <td>{m.reason || '—'}</td>
                    <td>{m.endsOn ? fmtDate(m.endsOn) : 'sans fin'}</td>
                    <td>{m.updatedBy ?? '—'}</td>
                    <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => setEditing({ kind: 'module', row: m })}>Modifier</button>
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={remove.isPending}
                        onClick={() => void askRemove('modules', m.module, moduleLabel(m.module))}>Retirer</button>
                    </td>
                  </tr>
                ))}
                {data.actions.map(a => (
                  <tr key={`a-${a.key}`} style={a.active ? undefined : { opacity: 0.6 }}>
                    <td><span className="ds-strong">{a.module ? moduleLabel(a.module) : 'Action'}</span> · {keyLabel(a.key)}</td>
                    <td><EffectTags effect={a.effect} active={a.active} /></td>
                    <td>{a.reason || '—'}</td>
                    <td>{a.endsOn ? fmtDate(a.endsOn) : 'sans fin'}</td>
                    <td>{a.updatedBy ?? '—'}</td>
                    <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="ds-btn-ghost ds-btn-sm" disabled={!a.known} onClick={() => setEditing({ kind: 'action', row: a })}>Modifier</button>
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={remove.isPending}
                        onClick={() => void askRemove('actions', a.key, keyLabel(a.key))}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={ShieldCheck} bare title="Aucune exception" text="Ce compte suit exactement les droits de ses rôles." />
          )}
        </DataPanel>
      )}
      {editing && <ExceptionModal userId={userId} userName={userName} data={data} editing={editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </section>
  );
}

function EffectTags({ effect, active }: { effect: ExceptionEffect; active: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      <span className={`kl-tag ${EFFECT[effect].tag}`}>{EFFECT[effect].label}</span>
      {!active && <span className="kl-tag x">Expirée</span>}
    </span>
  );
}

function ExceptionModal({ userId, userName, data, editing, onClose, onSaved }: {
  userId: string; userName: string; data: UserExceptions; editing: Editing; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!editing.row;
  const [kind, setKind] = useState<'module' | 'action'>(editing.kind);
  const [module, setModule] = useState<string>(editing.kind === 'module' ? editing.row?.module ?? '' : '');
  const [key, setKey] = useState<string>(editing.kind === 'action' ? editing.row?.key ?? '' : '');
  const roleOf = (m: string) => data.roleModules.find(r => r.module === m) ?? null;
  const startRights = (m: string): ModuleRights => {
    const ex = data.modules.find(x => x.module === m);
    if (ex) return { canView: ex.canView, canCreate: ex.canCreate, canEdit: ex.canEdit, canDelete: ex.canDelete, verbs: ex.verbs, scope: ex.scope, sections: ex.sections };
    const r = roleOf(m);
    return r ? { canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete, verbs: r.verbs, scope: r.scope, sections: r.sections } : { ...NO_RIGHTS };
  };
  const [rights, setRights] = useState<ModuleRights>(() => (module ? startRights(module) : { ...NO_RIGHTS }));
  const existing = kind === 'module' ? data.modules.find(x => x.module === module) : data.actions.find(x => x.key === key);
  const [reason, setReason] = useState(editing.row?.reason ?? '');
  const [endsOn, setEndsOn] = useState(editing.row?.endsOn && editing.row.endsOn >= today() ? editing.row.endsOn : '');

  const role = module ? roleOf(module) : null;
  const effect = kind === 'module' && module ? effectOf(role, rights) : null;
  const roleHolds = !!key && data.roleKeys.includes(key);
  const actionOptions = useMemo(() => Object.keys(DEFS).map(k => ({
    id: k, label: keyLabel(k), sublabel: moduleLabel(DEFS[k].module), detail: data.roleKeys.includes(k) ? 'donnée par ses rôles' : undefined,
  })), [data.roleKeys]);

  const pickModule = (m: string) => { setModule(m); setRights(m ? startRights(m) : { ...NO_RIGHTS }); };
  const toggleFlag = (f: typeof FLAGS[number][0]) => setRights(r => {
    const next = { ...r, [f]: !r[f] };
    if (f === 'canView' && !next.canView) return { ...next, canCreate: false, canEdit: false, canDelete: false, verbs: [], sections: [] };
    if (f !== 'canView' && next[f]) next.canView = true;
    return next;
  });
  const toggleIn = (field: 'verbs' | 'sections', v: string) =>
    setRights(r => ({ ...r, [field]: r[field].includes(v) ? r[field].filter(x => x !== v) : [...r[field], v] }));

  const save = useMutation({
    mutationFn: () => kind === 'module'
      ? usersApi.setModuleException(userId, module, { ...rights, reason: reason.trim(), endsOn: endsOn || null })
      : usersApi.setActionException(userId, key, { granted: !roleHolds, reason: reason.trim(), endsOn: endsOn || null }),
    onSuccess: out => {
      notify.success(isEdit ? 'Exception modifiée' : 'Exception enregistrée');
      const warn = (out as { sodWarnings?: { label: string }[] }).sodWarnings ?? [];
      if (warn.length) notify.warning(`Conflit de séparation des tâches créé : ${warn.map(w => w.label).join(' ; ')}`);
      onSaved();
    },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const target = kind === 'module' ? !!module : !!key;
  const noEffect = kind === 'module' && effect === 'none';
  const canSave = target && !noEffect && reason.trim().length >= 3 && (!endsOn || endsOn >= today()) && !save.isPending;
  const verbs = (module ? (MODULE_VERBS as Record<string, readonly string[]>)[module] ?? [] : []) as BusinessVerb[];
  const chip = (on: boolean) => ({
    background: on ? 'var(--ds-tint)' : 'var(--ds-card)', color: 'var(--ds-ink)', fontWeight: on ? 600 : undefined,
    borderColor: on ? 'var(--ds-accent)' : 'var(--ds-line)', padding: '0.25rem 0.625rem', fontSize: 12,
  });

  return (
    <Modal subtitle={userName} title={isEdit ? "Modifier l'exception" : 'Ajouter une exception'} width={680} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : "Ajouter l'exception"}
        </button>
      </>}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        {!isEdit && (
          <FormField label="Porte sur">
            <div className="prj-views" role="group" aria-label="Porte sur" style={{ display: 'inline-flex', width: 'fit-content' }}>
              <button type="button" className={kind === 'module' ? 'active' : ''} aria-pressed={kind === 'module'} onClick={() => setKind('module')}>Accès à un module</button>
              <button type="button" className={kind === 'action' ? 'active' : ''} aria-pressed={kind === 'action'} onClick={() => setKind('action')}>Action précise</button>
            </div>
          </FormField>
        )}

        {kind === 'module' ? (
          <>
            <FormField label="Module" required htmlFor="exc-module"
              hint={module ? `Ses rôles donnent : ${role ? describeRights(role) : 'aucun accès'}.` : 'Les droits saisis remplacent ceux de ses rôles pour ce module seulement.'}>
              <SearchSelect id="exc-module" value={module} onChange={pickModule} placeholder="Choisir un module…" size="md" width="100%" clearable={false}
                disabled={isEdit} ariaLabel="Module"
                options={MODULES.map(m => ({ id: m, label: moduleLabel(m), detail: data.modules.some(x => x.module === m) ? 'exception existante' : roleOf(m) ? 'donné par ses rôles' : undefined }))} />
            </FormField>
            {module && (
              <fieldset className="ds-fieldset"><legend>Droits sur {moduleLabel(module)}</legend>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {FLAGS.map(([f, l]) => (
                      <label key={f} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                        <input type="checkbox" checked={rights[f]} onChange={() => toggleFlag(f)} /> {l}
                      </label>
                    ))}
                  </div>
                  {rights.canView && (
                    <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                      Portée des données
                      <select className="ds-input sm" style={{ width: 'auto' }} value={rights.scope} onChange={e => setRights(r => ({ ...r, scope: e.target.value }))}>
                        {DATA_SCOPES.map(s => <option key={s} value={s}>{DATA_SCOPE_LABELS[s]}</option>)}
                      </select>
                    </label>
                  )}
                  {rights.canView && verbs.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Actions métier</span>
                      {verbs.map(v => (
                        <button key={v} type="button" className="odoo-filter-chip" style={chip(rights.verbs.includes(v))} aria-pressed={rights.verbs.includes(v)} onClick={() => toggleIn('verbs', v)}>
                          {rights.verbs.includes(v) && <Check size={11} aria-hidden="true" />} {BUSINESS_VERB_LABELS[v]}
                        </button>
                      ))}
                    </div>
                  )}
                  {rights.canView && module === 'settings' && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Sections autorisées {!rights.sections.length && <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>— toutes</span>}</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {SECTION_KEYS.map(s => (
                          <button key={s} type="button" className="odoo-filter-chip" style={chip(rights.sections.includes(s))} aria-pressed={rights.sections.includes(s)} onClick={() => toggleIn('sections', s)}>
                            {rights.sections.includes(s) && <Check size={11} aria-hidden="true" />} {(SETTINGS_SECTION_LABELS as Record<string, string>)[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {effect && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                      Effet <span className={`kl-tag ${EFFECT[effect].tag}`}>{EFFECT[effect].label}</span>
                      {effect === 'none' && <span style={{ color: 'var(--ds-muted)' }}>Identique à ses rôles : rien à enregistrer.</span>}
                    </div>
                  )}
                </div>
              </fieldset>
            )}
          </>
        ) : (
          <FormField label="Permission" required htmlFor="exc-key"
            hint={key ? (roleHolds ? "Ses rôles donnent cette permission : l'exception la retire." : "Ses rôles ne la donnent pas : l'exception l'accorde.") : 'Une action précise, par exemple « Achats : supprimer ».'}>
            <SearchSelect id="exc-key" value={key} onChange={setKey} placeholder="Rechercher une permission…" size="md" width="100%" clearable={false}
              disabled={isEdit} ariaLabel="Permission" options={actionOptions} />
          </FormField>
        )}
        {kind === 'action' && key && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            Effet <span className={`kl-tag ${roleHolds ? 'r' : 'g'}`}>{roleHolds ? 'Retiré' : 'Accordé'}</span>
          </div>
        )}

        <div className="ds-form-grid">
          <FormField label="Motif" required htmlFor="exc-reason" hint="Visible dans la fiche, l'historique et la revue des accès.">
            <input id="exc-reason" className="ds-input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)}
              placeholder="Ex. rapprochement des factures fournisseurs" />
          </FormField>
          <FormField label="Jusqu'au" htmlFor="exc-ends" hint="Inclus. Vide : sans fin.">
            <input id="exc-ends" type="date" className="ds-input" min={today()} value={endsOn} onChange={e => setEndsOn(e.target.value)} />
          </FormField>
        </div>
        {existing && !isEdit && <Alert tone="info">Une exception existe déjà sur ce point : elle sera remplacée.</Alert>}
        <Alert tone="info">Ses sessions ouvertes seront fermées pour appliquer le changement.</Alert>
      </div>
    </Modal>
  );
}
