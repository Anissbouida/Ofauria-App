import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Layers, RotateCcw } from 'lucide-react';
import {
  CORE_MODULES, MODULE_DESCRIPTIONS, MODULE_GROUPS, MODULE_LABELS, dependentModules, effectiveModules,
  missingDependencies, requiredModules, type AppModule,
} from '@ofauria/shared';
import { settingsApi, type ModuleActivation } from '../../api/settings.api';
import { OdooToggle, SettingItem, SettingsSection } from './SettingsPrimitives';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Secteur et modules (mig 468 + 507).
 *
 * Le secteur est un PRÉRÉGLAGE : il fixe les modules et options de départ. Chaque
 * module, puis chaque option, s'ajuste ensuite ici. Les changements restent en
 * brouillon jusqu'à « Enregistrer » ; les dépendances sont proposées avant l'envoi.
 * Désactiver ne supprime aucune donnée : le module est masqué et son API fermée.
 */

type Draft = { modules: Record<string, boolean | null>; features: Record<string, boolean | null> };
const EMPTY: Draft = { modules: {}, features: {} };

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

  const { data: sector, isLoading: loadingSector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const { data: act, isLoading: loadingAct } = useQuery({ queryKey: ['module-activation'], queryFn: settingsApi.modules });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sector'] });
    qc.invalidateQueries({ queryKey: ['module-activation'] });
    reload();
  };

  const sectorMut = useMutation({
    mutationFn: ({ code, keep }: { code: string; keep: boolean }) => settingsApi.setSector(code, keep),
    onSuccess: () => { refresh(); notify.success('Secteur mis à jour'); },
    onError: () => notify.error('Changement de secteur impossible'),
  });
  const saveMut = useMutation({
    mutationFn: settingsApi.saveModules,
    onSuccess: (data: ModuleActivation) => {
      qc.setQueryData(['module-activation'], data);
      setDraft(EMPTY);
      refresh();
      notify.success('Modules mis à jour');
    },
    onError: (e: unknown) => notify.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Enregistrement impossible'),
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
  const busy = saveMut.isPending || resetMut.isPending || sectorMut.isPending;

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

      {(dirtyCount > 0 || savedAdjustments > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {dirtyCount > 0 ? (
            <>
              <span className="odoo-setting-help" style={{ marginRight: 'auto' }}>{dirtyCount} changement(s) non enregistré(s)</span>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(EMPTY)} disabled={busy}>Annuler</button>
              <button type="button" className="odoo-btn-primary" disabled={busy || view.missing.length > 0}
                onClick={() => saveMut.mutate(draft)}>Enregistrer</button>
            </>
          ) : (
            <button type="button" className="odoo-btn-secondary" onClick={resetAll} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={14} /> Revenir au préréglage du secteur ({savedAdjustments})
            </button>
          )}
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
    </div>
  );
}
