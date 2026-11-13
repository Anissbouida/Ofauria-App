import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, History, Layers, RotateCcw, Users } from 'lucide-react';
import {
  CORE_MODULES, MODULE_DESCRIPTIONS, MODULE_GROUPS, MODULE_LABELS, dependentModules, effectiveModules,
  missingDependencies, requiredModules, type AppModule,
} from '@ofauria/shared';
import { settingsApi, type ModuleActivation } from '../../api/settings.api';
import { OdooToggle, SettingItem, SettingsSection } from './SettingsPrimitives';
import { useDirtyForm } from './DirtyForms';
import RolloutDialog from './RolloutDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Secteur et modules (mig 468 + 507).
 *
 * Le secteur est un PRÉRÉGLAGE : il fixe les modules et options de départ. Chaque
 * module, puis chaque option, s'ajuste ensuite ici. Les changements restent en
 * brouillon jusqu'à « Enregistrer » (barre commune des Paramètres, DirtyForms) ;
 * les dépendances sont proposées avant l'envoi.
 * Désactiver ne supprime aucune donnée : le module est masqué et son API fermée.
 */

type Draft = { modules: Record<string, boolean | null>; features: Record<string, boolean | null> };
const EMPTY: Draft = { modules: {}, features: {} };

// Options déjà appliquées par le code. Les autres sont réglables dès maintenant mais
// n'agiront qu'au lot P5 (plan Production générique) : l'écran le dit.
const WIRED_FEATURES: ReadonlySet<string> = new Set(['haccp']);

/** Écarts au préréglage une fois le brouillon appliqué (null = retour au préréglage). */
function mergeOverrides(base: Record<string, boolean>, changes: Record<string, boolean | null>, pack: readonly string[]) {
  const out: Record<string, boolean> = { ...base };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === pack.includes(k)) delete out[k];
    else out[k] = v;
  }
  return out;
}

export default function SectorTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { reload } = usePermissions();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keepAdjustments, setKeepAdjustments] = useState(true);
  const [rolloutFor, setRolloutFor] = useState<AppModule | null>(null);

  const { data: sector, isLoading: loadingSector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const { data: act, isLoading: loadingAct } = useQuery({ queryKey: ['module-activation'], queryFn: settingsApi.modules });

  const { data: versions = [] } = useQuery({ queryKey: ['module-versions'], queryFn: settingsApi.moduleVersions });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sector'] });
    qc.invalidateQueries({ queryKey: ['module-activation'] });
    qc.invalidateQueries({ queryKey: ['module-versions'] });
    reload();
  };

  const sectorMut = useMutation({
    mutationFn: ({ code, keep }: { code: string; keep: boolean }) => settingsApi.setSector(code, keep),
    onSuccess: () => { refresh(); notify.success('Secteur mis à jour'); },
    onError: () => notify.error('Changement de secteur impossible'),
  });
  const resetMut = useMutation({
    mutationFn: settingsApi.resetModules,
    onSuccess: (data: ModuleActivation) => {
      qc.setQueryData(['module-activation'], data);
      setDraft(EMPTY);
      refresh();
      notify.success('Préréglage du secteur rétabli');
    },
    onError: () => notify.error('Retour au préréglage impossible'),
  });
  const restoreMut = useMutation({
    mutationFn: settingsApi.restoreModuleVersion,
    onSuccess: (data: ModuleActivation) => {
      qc.setQueryData(['module-activation'], data);
      setDraft(EMPTY);
      refresh();
      notify.success('Configuration restaurée');
    },
    onError: (e: unknown) => notify.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Restauration impossible'),
  });

  // État affiché = enregistré + brouillon.
  const view = useMemo(() => {
    if (!act) return null;
    const moduleOverrides = mergeOverrides(act.moduleOverrides, draft.modules, act.packModules);
    const featureOverrides = mergeOverrides(act.featureOverrides, draft.features, act.packFeatures);
    const active = effectiveModules(act.packModules, moduleOverrides);
    const featureOn = (k: string) => featureOverrides[k] ?? act.packFeatures.includes(k);
    return { moduleOverrides, featureOverrides, active, featureOn, missing: missingDependencies(active) };
  }, [act, draft]);

  const dirtyCount = Object.keys(draft.modules).length + Object.keys(draft.features).length;
  const savedAdjustments = act ? Object.keys(act.moduleOverrides).length + Object.keys(act.featureOverrides).length : 0;
  const rolloutMut = useMutation({
    mutationFn: ({ key, change }: { key: string; change: { pilot: { roles: string[]; users: string[] } | null; disabledStores: string[] } }) =>
      settingsApi.saveModuleRollout(key, change),
    onSuccess: (data: ModuleActivation) => {
      qc.setQueryData(['module-activation'], data);
      setRolloutFor(null);
      refresh();
      notify.success('Diffusion enregistrée');
    },
    onError: (e: unknown) => notify.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Enregistrement impossible'),
  });

  const busy = resetMut.isPending || sectorMut.isPending || restoreMut.isPending || rolloutMut.isPending;

  // Aperçu d'impact du brouillon (P0b) : calculé par le serveur, rien n'est écrit.
  const { data: impact } = useQuery({
    queryKey: ['module-preview', draft],
    queryFn: () => settingsApi.previewModules(draft),
    enabled: dirtyCount > 0 && !!view && view.missing.length === 0,
    staleTime: 10_000,
  });

  // Barre « N modifications non enregistrées · Annuler · Enregistrer » commune aux
  // Paramètres : fixe en bas de l'écran, et alerte avant de quitter avec un brouillon.
  useDirtyForm('sector-modules', {
    dirty: dirtyCount > 0,
    changes: dirtyCount,
    invalid: view?.missing.length
      ? `« ${MODULE_LABELS[view.missing[0].module]} » a besoin de « ${MODULE_LABELS[view.missing[0].missing[0]]} »`
      : null,
    save: async () => {
      const data: ModuleActivation = await settingsApi.saveModules(draft);
      qc.setQueryData(['module-activation'], data);
      setDraft(EMPTY);
      refresh();
    },
    reset: () => setDraft(EMPTY),
  });

  const setModules = (changes: Record<string, boolean | null>) =>
    setDraft(d => ({ ...d, modules: { ...d.modules, ...changes } }));

  const toggleModule = async (m: AppModule, on: boolean) => {
    if (!view) return;
    if (on) {
      const needed = requiredModules(m).filter(d => !view.active.has(d));
      setModules(Object.fromEntries([m, ...needed].map(k => [k, true])));
      if (needed.length) notify.success(`Activé aussi : ${needed.map(d => MODULE_LABELS[d]).join(', ')}`);
      return;
    }
    const dependents = dependentModules(m).filter(d => view.active.has(d));
    if (dependents.length) {
      const ok = await confirm(
        `${dependents.map(d => `« ${MODULE_LABELS[d]} »`).join(', ')} ne fonctionne${dependents.length > 1 ? 'nt' : ''} pas sans « ${MODULE_LABELS[m]} » et sera${dependents.length > 1 ? 'ont' : ''} désactivé${dependents.length > 1 ? 's' : ''} aussi. Les données sont conservées.`,
        { title: `Désactiver « ${MODULE_LABELS[m]} » ?`, confirmLabel: 'Désactiver' });
      if (!ok) return;
    }
    setModules(Object.fromEntries([m, ...dependents].map(k => [k, false])));
  };

  const chooseSector = async (code: string, label: string) => {
    if (code === sector?.current.code) return;
    if (dirtyCount) { notify.warning('Enregistrez ou annulez vos changements de modules avant de changer de secteur'); return; }
    const adjustNote = savedAdjustments
      ? (keepAdjustments
        ? ` Vos ${savedAdjustments} ajustement(s) de modules et d'options sont conservés.`
        : ` Vos ${savedAdjustments} ajustement(s) seront effacés : vous repartez du préréglage.`)
      : '';
    const ok = await confirm(
      `Les modules et menus seront adaptés à ce secteur. Aucune donnée n'est supprimée.${adjustNote}`,
      { title: `Basculer sur « ${label} » ?`, confirmLabel: 'Changer de secteur' });
    if (ok) sectorMut.mutate({ code, keep: keepAdjustments });
  };

  const restore = async (id: number, when: string) => {
    if (dirtyCount) { notify.warning('Enregistrez ou annulez vos changements avant de restaurer une version'); return; }
    const ok = await confirm(
      `La configuration du ${when} (secteur, modules et options) redevient la configuration courante. Aucune donnée n'est supprimée, et cette restauration pourra elle-même être annulée.`,
      { title: 'Restaurer cette version ?', confirmLabel: 'Restaurer' });
    if (ok) restoreMut.mutate(id);
  };

  const resetAll = async () => {
    const ok = await confirm(
      `Les ${savedAdjustments} ajustement(s) sont effacés et chaque module reprend le réglage du secteur « ${act?.sector.label} ». Aucune donnée n'est supprimée.`,
      { title: 'Revenir au préréglage du secteur ?', confirmLabel: 'Revenir au préréglage' });
    if (ok) resetMut.mutate();
  };

  if (loadingSector || loadingAct || !act || !view) {
    return <div className="odoo-setting-help">Chargement…</div>;
  }

  const featuresOf = (m: AppModule) => act.catalog.filter(f => f.module_key === m);
  const featureLabel = (k: string) => act.catalog.find(f => f.key === k)?.label ?? k;
  const moduleLabel = (k: string) => MODULE_LABELS[k as AppModule] ?? k;
  const fmtDate = (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const closedStoresOf = (m: string) => Object.entries(act.rollout.storeDisabled).filter(([, mods]) => mods.includes(m)).map(([st]) => st);
  const rolloutSummary = (m: string) => {
    const pilot = act.rollout.pilots[m];
    const closed = closedStoresOf(m).length;
    const parts = [pilot ? `Pilote : ${pilot.roles.length} rôle(s), ${pilot.users.length} utilisateur(s)` : 'Pour tous'];
    if (closed) parts.push(`fermé dans ${closed} établissement(s)`);
    return { text: parts.join(' · '), special: !!pilot || closed > 0 };
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SettingsSection
        title="Secteur d'activité"
        description="Le secteur est un préréglage : il choisit les modules et options de départ. Vous ajustez ensuite chaque module ci-dessous. Changer de secteur ne supprime aucune donnée."
        columns={1}
      >
        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          {sector?.available.map(s => {
            const on = s.code === sector.current.code;
            return (
              <button key={s.code} type="button" onClick={() => chooseSector(s.code, s.label)} disabled={busy}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0.9rem',
                  borderRadius: 6, textAlign: 'left', cursor: on ? 'default' : 'pointer',
                  border: `1px solid ${on ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
                  background: on ? 'var(--odoo-purple-light)' : 'var(--odoo-bg)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: on ? 600 : 400 }}>
                  <Layers size={15} /> {s.label}
                </span>
                {on && <span className="odoo-tag odoo-tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Actuel</span>}
              </button>
            );
          })}
          {savedAdjustments > 0 && (
            <label className="odoo-setting-help" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={keepAdjustments} onChange={e => setKeepAdjustments(e.target.checked)} />
              Garder mes {savedAdjustments} ajustement(s) en changeant de secteur
            </label>
          )}
        </div>
      </SettingsSection>

      {view.missing.length > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Configuration incomplète">
          {view.missing.map(x => `« ${MODULE_LABELS[x.module]} » a besoin de ${x.missing.map(d => `« ${MODULE_LABELS[d]} »`).join(', ')}`).join(' ; ')}.
        </StatusBanner>
      )}

      {savedAdjustments > 0 && dirtyCount === 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-secondary" onClick={resetAll} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Revenir au préréglage du secteur ({savedAdjustments})
          </button>
        </div>
      )}

      {MODULE_GROUPS.map(g => (
        <SettingsSection key={g.key} title={g.label}>
          {g.modules.map(m => {
            const core = CORE_MODULES.has(m);
            const on = view.active.has(m);
            const adjusted = view.moduleOverrides[m] !== undefined;
            const pending = draft.modules[m] !== undefined;
            const features = featuresOf(m);
            return (
              <SettingItem key={m} title={MODULE_LABELS[m]} description={MODULE_DESCRIPTIONS[m]}
                toggle={{ checked: on, disabled: core || busy, onChange: v => toggleModule(m, v) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {core
                    ? <span className="odoo-tag odoo-tag-grey">Socle</span>
                    : adjusted
                      ? <span className="odoo-tag odoo-tag-orange">Ajusté</span>
                      : <span className="odoo-tag odoo-tag-grey">Préréglage</span>}
                  {pending && <span className="odoo-tag odoo-tag-blue">Non enregistré</span>}
                  {adjusted && !core && (
                    <button type="button" className="odoo-btn-link" disabled={busy}
                      onClick={() => setModules({ [m]: null })}>Revenir au préréglage</button>
                  )}
                </div>
                {/* Diffusion (P0c) : seulement pour un module actif et enregistré comme tel. */}
                {!core && on && act.modules.includes(m) && (() => {
                  const r = rolloutSummary(m);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span className={`odoo-tag ${r.special ? 'odoo-tag-purple' : 'odoo-tag-grey'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Users size={11} /> {r.text}
                      </span>
                      <button type="button" className="odoo-btn-link" disabled={busy || dirtyCount > 0}
                        title={dirtyCount > 0 ? "Enregistrez d'abord vos changements" : undefined}
                        onClick={() => setRolloutFor(m)}>Diffusion…</button>
                    </div>
                  );
                })()}
                {features.length > 0 && (
                  <div style={{ display: 'grid', gap: 6, marginTop: 10, paddingLeft: 10, borderLeft: '2px solid var(--odoo-border)' }}>
                    {features.map(f => {
                      const fOn = view.featureOn(f.key);
                      const fAdjusted = view.featureOverrides[f.key] !== undefined;
                      return (
                        <div key={f.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, opacity: on ? 1 : 0.5 }}>
                          <OdooToggle checked={fOn && on} disabled={!on || busy}
                            onChange={v => setDraft(d => ({ ...d, features: { ...d.features, [f.key]: v } }))} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                              {f.label}{' '}
                              {fAdjusted && <span className="odoo-tag odoo-tag-orange">Ajusté</span>}
                              {fAdjusted && on && (
                                <button type="button" className="odoo-btn-link" disabled={busy}
                                  onClick={() => setDraft(d => ({ ...d, features: { ...d.features, [f.key]: null } }))}>Préréglage</button>
                              )}
                            </div>
                            {f.description && <p className="odoo-setting-help">{f.description}</p>}
                            {!WIRED_FEATURES.has(f.key) && (
                              <p className="odoo-setting-help" style={{ fontStyle: 'italic' }}>Réglage enregistré ; son effet arrivera dans une prochaine version.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SettingItem>
            );
          })}
        </SettingsSection>
      ))}

      <SettingsSection
        title="Historique des configurations"
        description="Chaque enregistrement crée une version. Restaurer une version la rend de nouveau courante, sans rien supprimer ; la restauration elle-même peut être annulée."
        columns={1}
      >
        {versions.length === 0 ? (
          <p className="odoo-setting-help">Aucune version pour l'instant : la première sera créée au prochain enregistrement.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th style={{ width: 130 }}>Date</th><th style={{ width: 160 }}>Par</th><th>Changement</th><th style={{ width: 110 }}></th></tr></thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.created_at)}</td>
                    <td>{v.created_by_name ?? '—'}</td>
                    <td>{v.label} {i === 0 && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>Actuelle</span>}</td>
                    <td>
                      {i > 0 && (
                        <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          disabled={busy} onClick={() => restore(v.id, fmtDate(v.created_at))}>
                          <History size={13} /> Restaurer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {rolloutFor && (
        <RolloutDialog
          module={rolloutFor}
          pilot={act.rollout.pilots[rolloutFor] ?? null}
          disabledStores={closedStoresOf(rolloutFor)}
          busy={rolloutMut.isPending}
          onClose={() => setRolloutFor(null)}
          onSave={change => rolloutMut.mutate({ key: rolloutFor, change })}
        />
      )}

      {/* Aperçu d'impact : fixé juste au-dessus de la barre d'enregistrement commune,
          visible au moment de valider (le conteneur neutralise position: sticky). */}
      {dirtyCount > 0 && impact && (
        <div role="region" aria-label="Impact de vos changements"
          style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '4.75rem', zIndex: 59,
            width: 'min(760px, calc(100vw - 2rem))', maxHeight: '40vh', overflowY: 'auto',
            padding: '0.6rem 0.75rem', border: '1px solid var(--odoo-border)', borderRadius: 6,
            background: 'var(--odoo-bg)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', fontSize: '0.8125rem', display: 'grid', gap: 4 }}>
          <div className="odoo-setting-label">Impact de vos changements</div>
          {(impact.modulesOn.length > 0 || impact.featuresOn.length > 0) && (
            <div><strong style={{ color: '#1e7e34' }}>Apparaît :</strong> {[...impact.modulesOn.map(moduleLabel), ...impact.featuresOn.map(featureLabel)].join(', ')}</div>
          )}
          {(impact.modulesOff.length > 0 || impact.featuresOff.length > 0) && (
            <div><strong style={{ color: '#c0392b' }}>Disparaît :</strong> {[...impact.modulesOff.map(moduleLabel), ...impact.featuresOff.map(featureLabel)].join(', ')}</div>
          )}
          {impact.roles.length > 0 && (
            <div><strong>Rôles touchés :</strong> {impact.roles.map(r => {
              const bits = [r.gained.length ? `gagne ${r.gained.map(moduleLabel).join(', ')}` : '', r.lost.length ? `perd ${r.lost.map(moduleLabel).join(', ')}` : ''].filter(Boolean);
              return `${r.label} (${bits.join(' ; ')})`;
            }).join(' · ')}</div>
          )}
          {impact.hidden.length > 0 && (
            <div><strong>Données masquées, pas supprimées :</strong> {impact.hidden.map(h => `${h.count.toLocaleString('fr-FR')} ${h.label}`).join(', ')}</div>
          )}
          {!impact.modulesOn.length && !impact.modulesOff.length && !impact.featuresOn.length && !impact.featuresOff.length && (
            <div className="odoo-setting-help">Aucun changement visible : la configuration reste identique.</div>
          )}
        </div>
      )}
    </div>
  );
}
