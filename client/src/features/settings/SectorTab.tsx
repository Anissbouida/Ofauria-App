import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, Circle, Download, FileDown, FileUp, History, Layers, Lightbulb, RotateCcw, Save, Sparkles, Trash2, Users } from 'lucide-react';
import {
  CORE_MODULES, MODULE_DESCRIPTIONS, MODULE_GROUPS, MODULE_LABELS, dependentModules, effectiveModules,
  missingDependencies, requiredModules, type AppModule,
} from '@ofauria/shared';
import { settingsApi, type HealthRecommendation, type HealthReport, type ConfigModelPreview, type ConfigSuggestion, type ModuleActivation, type OnboardingReport } from '../../api/settings.api';
import { OdooToggle, SettingItem, SettingsSection, SettingsTabs } from './SettingsPrimitives';
import { useDirtyForm } from './DirtyForms';
import RolloutDialog from './RolloutDialog';
import VocabularyPanel from './VocabularyPanel';
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
  const { reload, canEdit } = usePermissions();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keepAdjustments, setKeepAdjustments] = useState(true);
  const [rolloutFor, setRolloutFor] = useState<AppModule | null>(null);
  const [tab, setTab] = useState('sector');

  const { data: sector, isLoading: loadingSector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const { data: act, isLoading: loadingAct } = useQuery({ queryKey: ['module-activation'], queryFn: settingsApi.modules });

  const { data: versions = [] } = useQuery({ queryKey: ['module-versions'], queryFn: settingsApi.moduleVersions });
  const { data: starter } = useQuery({ queryKey: ['sector-starter'], queryFn: () => settingsApi.sectorStarter() });
  const { data: health } = useQuery({ queryKey: ['module-health'], queryFn: settingsApi.moduleHealth });
  const { data: onboarding } = useQuery({ queryKey: ['module-onboarding'], queryFn: settingsApi.moduleOnboarding });
  const navigate = useNavigate();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sector'] });
    qc.invalidateQueries({ queryKey: ['module-activation'] });
    qc.invalidateQueries({ queryKey: ['module-versions'] });
    qc.invalidateQueries({ queryKey: ['sector-starter'] });
    qc.invalidateQueries({ queryKey: ['module-health'] });
    qc.invalidateQueries({ queryKey: ['module-onboarding'] });
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
  // Données de départ (P7) : idempotent, ne crée que ce qui manque.
  const starterMut = useMutation({
    mutationFn: settingsApi.loadSectorStarter,
    onSuccess: (r: Record<string, number>) => {
      const created = Object.values(r).reduce((a, b) => a + b, 0);
      qc.invalidateQueries();
      notify.success(created ? `${created} élément(s) créé(s)` : 'Tout était déjà en place : rien de nouveau');
    },
    onError: () => notify.error('Chargement des données de départ impossible'),
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

  // Bilan de santé (P8) : une proposition ne s'applique jamais directement, elle
  // remplit le brouillon (aperçu d'impact, puis « Enregistrer », puis version).
  const healthMut = useMutation({
    mutationFn: ({ key, restore }: { key?: string; restore?: boolean }) =>
      restore ? settingsApi.restoreHealth() : settingsApi.dismissHealth(key!),
    onSuccess: (data: HealthReport) => qc.setQueryData(['module-health'], data),
    onError: () => notify.error('Action impossible'),
  });
  // Mise en route (P9) : masquer la liste d'un module, ou tout réafficher.
  const onboardingMut = useMutation({
    mutationFn: ({ module }: { module?: string }) =>
      module ? settingsApi.hideOnboarding(module) : settingsApi.showOnboarding(),
    onSuccess: (data: OnboardingReport) => qc.setQueryData(['module-onboarding'], data),
    onError: () => notify.error('Action impossible'),
  });
  // Modèles de configuration (P10) : exporter, enregistrer comme secteur, importer.
  const [saveName, setSaveName] = useState<string | null>(null);
  const [imported, setImported] = useState<{ model: unknown; preview: ConfigModelPreview } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errMsg = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback;
  const exportConfig = async () => {
    try {
      const model = await settingsApi.exportConfig();
      const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kalum-configuration-${model.base_sector}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { notify.error(errMsg(e, 'Export impossible')); }
  };
  const sectorCreateMut = useMutation({
    mutationFn: settingsApi.createSector,
    onSuccess: (r: { label: string; warnings: string[] }) => {
      setSaveName(null);
      setImported(null);
      setSuggestion(null);
      setDescribe(null);
      refresh();
      notify.success(`Secteur « ${r.label} » ajouté à la liste${r.warnings.length ? ` (${r.warnings.length} remarque(s))` : ''}`);
    },
    onError: (e: unknown) => notify.error(errMsg(e, 'Enregistrement impossible')),
  });
  const sectorDeleteMut = useMutation({
    mutationFn: settingsApi.deleteSector,
    onSuccess: () => { refresh(); notify.success('Secteur supprimé'); },
    onError: (e: unknown) => notify.error(errMsg(e, 'Suppression impossible')),
  });
  const onImportFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const model = JSON.parse(await file.text());
      setImported({ model, preview: await settingsApi.previewConfigModel(model) });
    } catch (e) {
      notify.error(e instanceof SyntaxError ? "Ce fichier n'est pas un JSON valide" : errMsg(e, 'Modèle illisible'));
    }
  };
  // Configuration en langage naturel (P11) : l'IA propose, l'administrateur valide.
  const { data: assistant } = useQuery({ queryKey: ['config-assistant'], queryFn: settingsApi.assistantStatus });
  const [describe, setDescribe] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ConfigSuggestion | null>(null);
  const suggestMut = useMutation({
    mutationFn: settingsApi.suggestConfig,
    onSuccess: (r: ConfigSuggestion) => setSuggestion(r),
    onError: (e: unknown) => notify.error(errMsg(e, 'Proposition impossible')),
  });
  const suggestionToDraft = (r: ConfigSuggestion) => {
    setDraft(d => ({ modules: { ...d.modules, ...r.changes.modules }, features: { ...d.features, ...r.changes.features } }));
    setSuggestion(null);
    setDescribe(null);
    setTab('modules');
    notify.success("Ajouté au brouillon : vérifiez l'impact, puis enregistrez");
  };
  const deleteSector = async (code: string, label: string) => {
    const ok = await confirm(`Le secteur « ${label} » disparaîtra de la liste. Aucune donnée n'est supprimée.`,
      { title: 'Supprimer ce secteur personnalisé ?', confirmLabel: 'Supprimer' });
    if (ok) sectorDeleteMut.mutate(code);
  };

  const inDraft = (r: HealthRecommendation) => r.action.kind === 'adjust' && [
    ...Object.entries(r.action.changes.modules ?? {}).map(([k, v]) => draft.modules[k] === v),
    ...Object.entries(r.action.changes.features ?? {}).map(([k, v]) => draft.features[k] === v),
  ].every(Boolean);
  const applyRecommendation = (r: HealthRecommendation) => {
    if (r.action.kind === 'link') { navigate(r.action.to); return; }
    const { modules = {}, features = {} } = r.action.changes;
    setDraft(d => ({ modules: { ...d.modules, ...modules }, features: { ...d.features, ...features } }));
    notify.success("Ajouté au brouillon : vérifiez l'impact, puis enregistrez");
  };

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
    // C-03 : ce que le profil apporte (types d'ordre, politiques, impressions…), chargé ensuite
    // par « Données de départ » sans rien écraser.
    const brings = await settingsApi.sectorStarter(code).then(r => r.preview.items).catch(() => [] as string[]);
    const bringsNote = brings.length ? ` Données de départ proposées ensuite : ${brings.join(' · ')}.` : '';
    const ok = await confirm(
      `Les modules et menus seront adaptés à ce secteur. Aucune donnée n'est supprimée.${adjustNote}${bringsNote}`,
      { title: `Basculer sur « ${label} » ?`, confirmLabel: 'Changer de secteur' });
    if (ok) sectorMut.mutate({ code, keep: keepAdjustments });
  };

  const loadStarter = async () => {
    const ok = await confirm(
      `Seuls les éléments absents sont créés ; rien d'existant n'est modifié. L'article de démonstration peut ensuite être modifié ou supprimé.`,
      { title: 'Charger les données de départ ?', confirmLabel: 'Charger' });
    if (ok) starterMut.mutate();
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
      {/* Lot S3 : trois onglets (secteur, modules, modèles) ; tous restent montés, le
          brouillon des modules reste donc dans la barre d'enregistrement. */}
      <SettingsTabs label="Secteur et modules" value={tab} onChange={setTab} tabs={[
        { key: 'sector', label: 'Secteur', content: (
          <>
      <SettingsSection
        title="Secteur d'activité"
        description="Le secteur est un préréglage : il choisit les modules et options de départ. Vous ajustez ensuite chaque module dans l'onglet « Modules et options ». Changer de secteur ne supprime aucune donnée."
        columns={1}
      >
        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          {sector?.available.map(s => {
            const on = s.code === sector.current.code;
            return (
              <div key={s.code} style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
              <button type="button" onClick={() => chooseSector(s.code, s.label)} disabled={busy}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0.9rem',
                  borderRadius: 6, textAlign: 'left', cursor: on ? 'default' : 'pointer',
                  border: `1px solid ${on ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
                  background: on ? 'var(--odoo-purple-light)' : 'var(--odoo-bg)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: on ? 600 : 400 }}>
                  <Layers size={15} /> {s.label}
                  {s.isCustom && <span className="odoo-tag" style={{ fontWeight: 400 }}>Personnalisé</span>}
                </span>
                {on && <span className="odoo-tag odoo-tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Actuel</span>}
              </button>
              {s.isCustom && !on && (
                <button type="button" className="odoo-btn-secondary" title="Supprimer ce secteur personnalisé" aria-label={`Supprimer ${s.label}`}
                  disabled={busy || sectorDeleteMut.isPending} onClick={() => deleteSector(s.code, s.label)} style={{ padding: '0 10px' }}>
                  <Trash2 size={14} />
                </button>
              )}
              </div>
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
      {!!starter?.preview.items.length && (
        <SettingsSection
          title="Données de départ"
          description={`De quoi démarrer en « ${sector?.current.label ?? starter.sector} » sans tout saisir. Vous pouvez relancer le chargement : ce qui existe déjà est conservé.`}
          columns={1}
        >
          <div style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: 4 }}>
              {starter.preview.items.map(it => <li key={it} className="odoo-setting-help" style={{ margin: 0 }}>{it}</li>)}
            </ul>
            <div>
              <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                disabled={busy || starterMut.isPending} onClick={loadStarter}>
                <Download size={14} /> {starterMut.isPending ? 'Chargement…' : 'Charger les données de départ'}
              </button>
            </div>
          </div>
        </SettingsSection>
      )}
      {onboarding && (onboarding.modules.length > 0 || onboarding.hidden > 0) && (
        <SettingsSection
          title="Mise en route"
          description="Les premières étapes de chaque module actif. Elles se cochent toutes seules dès que la donnée existe ; une liste terminée disparaît."
          columns={1}
        >
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {onboarding.modules.map(m => (
              <div key={m.module} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '0.7rem 0.9rem', background: 'var(--odoo-bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  <span className="odoo-setting-help" style={{ margin: 0 }}>{m.done} / {m.total}</span>
                </div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={m.total} aria-valuenow={m.done}
                  style={{ height: 4, borderRadius: 2, background: 'var(--odoo-border)', margin: '6px 0 8px', overflow: 'hidden' }}>
                  <div style={{ width: `${(m.done / m.total) * 100}%`, height: '100%', background: 'var(--odoo-purple)' }} />
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {m.tasks.map(t => (
                    <li key={t.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {t.done
                        ? <CheckCircle2 size={15} style={{ color: 'var(--odoo-success, #28a745)', flexShrink: 0, marginTop: 2 }} />
                        : <Circle size={15} style={{ color: 'var(--odoo-text-muted, #999)', flexShrink: 0, marginTop: 2 }} />}
                      <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1 }}>{t.label}</span>
                      {!t.done && (t.to === 'starter'
                        ? <button type="button" className="odoo-btn-link" disabled={busy || starterMut.isPending} onClick={loadStarter}>Charger</button>
                        : <button type="button" className="odoo-btn-link" onClick={() => navigate(t.to)}>Ouvrir</button>)}
                    </li>
                  ))}
                </ul>
                <div style={{ textAlign: 'right', marginTop: 6 }}>
                  <button type="button" className="odoo-btn-link" disabled={onboardingMut.isPending}
                    onClick={() => onboardingMut.mutate({ module: m.module })}>Masquer</button>
                </div>
              </div>
            ))}
          </div>
          {onboarding.hidden > 0 && (
            <div>
              <button type="button" className="odoo-btn-link" disabled={onboardingMut.isPending} onClick={() => onboardingMut.mutate({})}>
                Réafficher {onboarding.hidden} liste(s) masquée(s)
              </button>
            </div>
          )}
        </SettingsSection>
      )}
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
          </>
        ) },
        { key: 'modules', label: 'Modules et options',
          badge: dirtyCount > 0 ? <span className="odoo-tag odoo-tag-blue" title="Changements non enregistrés">{dirtyCount}</span> : undefined,
          content: (
          <>
      {health && (health.recommendations.length > 0 || health.dismissed > 0) && (
        <SettingsSection
          title="Bilan de santé"
          description="Propositions tirées de l'utilisation réelle de l'application. Rien n'est appliqué sans vous : une proposition remplit le brouillon, que vous vérifiez puis enregistrez."
          columns={1}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            {health.recommendations.map(r => (
              <div key={r.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, padding: '0.7rem 0.9rem', borderRadius: 6,
                border: `1px solid ${r.tone === 'warning' ? 'var(--odoo-warning, #f0ad4e)' : 'var(--odoo-border)'}`, background: 'var(--odoo-bg)' }}>
                {r.tone === 'warning'
                  ? <AlertTriangle size={16} style={{ color: 'var(--odoo-warning, #f0ad4e)', flexShrink: 0, marginTop: 2 }} />
                  : <Lightbulb size={16} style={{ color: 'var(--odoo-purple)', flexShrink: 0, marginTop: 2 }} />}
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <p className="odoo-setting-help" style={{ margin: '2px 0 0' }}>{r.detail}</p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {inDraft(r)
                    ? <span className="odoo-tag odoo-tag-green" style={{ alignSelf: 'center' }}>Dans le brouillon</span>
                    : <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 10px' }} disabled={busy}
                        onClick={() => applyRecommendation(r)}>{r.action.label}</button>}
                  <button type="button" className="odoo-btn-link" disabled={healthMut.isPending}
                    title="Ne plus proposer pendant 90 jours" onClick={() => healthMut.mutate({ key: r.key })}>Ignorer</button>
                </div>
              </div>
            ))}
            {health.recommendations.length === 0 && (
              <p className="odoo-setting-help" style={{ margin: 0 }}>Aucune proposition en cours.</p>
            )}
            {health.dismissed > 0 && (
              <div>
                <button type="button" className="odoo-btn-link" disabled={healthMut.isPending}
                  onClick={() => healthMut.mutate({ restore: true })}>
                  Réafficher {health.dismissed} proposition(s) ignorée(s)
                </button>
              </div>
            )}
          </div>
        </SettingsSection>
      )}
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
          </>
        ) },
        { key: 'vocabulary', label: 'Vocabulaire', content: <VocabularyPanel canEdit={canEdit('settings')} /> },
        { key: 'templates', label: 'Modèles et assistant', content: (
          <>
      <SettingsSection
        title="Modèles de configuration"
        description="Enregistrer la configuration actuelle comme secteur réutilisable, l'exporter ou importer celle d'une autre société, ou la faire proposer par l'assistant à partir d'une description de votre activité."
        columns={1}
      >
        <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={busy} onClick={() => setSaveName(saveName === null ? `${sector?.current.label ?? ''} (personnalisé)` : null)}>
              <Save size={14} /> Enregistrer comme secteur
            </button>
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={busy} onClick={exportConfig}>
              <FileDown size={14} /> Exporter la configuration
            </button>
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp size={14} /> Importer un modèle
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => onImportFile(e.target.files?.[0])} />
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={busy} onClick={() => { setDescribe(describe === null ? '' : null); setSuggestion(null); }}>
              <Sparkles size={14} /> Décrire mon activité
            </button>
          </div>
          {saveName !== null && (
            <div style={{ display: 'grid', gap: 6 }}>
              <p className="odoo-setting-help" style={{ margin: 0 }}>
                Modules, options, vocabulaire et données de départ actuels deviennent un secteur proposé dans la liste. Les pilotes et établissements ne sont pas repris.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={saveName} maxLength={120} aria-label="Nom du nouveau secteur"
                  onChange={e => setSaveName(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="odoo-btn-primary" disabled={!saveName.trim() || sectorCreateMut.isPending}
                  onClick={() => sectorCreateMut.mutate({ name: saveName.trim() })}>Enregistrer</button>
                <button type="button" className="odoo-btn-secondary" onClick={() => setSaveName(null)}>Annuler</button>
              </div>
            </div>
          )}
          {describe !== null && !suggestion && (
            <div style={{ display: 'grid', gap: 6 }}>
              {assistant && !assistant.available ? (
                <StatusBanner tone="warning" icon={AlertTriangle} title="Assistant indisponible">
                  La clé ANTHROPIC_API_KEY n'est pas configurée sur le serveur.
                </StatusBanner>
              ) : (
                <>
                  <p className="odoo-setting-help" style={{ margin: 0 }}>
                    Décrivez votre activité en quelques phrases : ce que vous vendez, fabriquez ou achetez, et comment. L'assistant propose secteur, modules, options et vocabulaire ; rien n'est appliqué sans vous.
                  </p>
                  <textarea className="input" rows={3} maxLength={2000} value={describe} aria-label="Description de l'activité"
                    placeholder="Ex. : Je fabrique des meubles sur commande et je vends en showroom, avec livraison et pose."
                    onChange={e => setDescribe(e.target.value)} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="odoo-btn-primary" disabled={describe.trim().length < 10 || suggestMut.isPending}
                      onClick={() => suggestMut.mutate(describe.trim())}>{suggestMut.isPending ? 'Analyse en cours…' : 'Proposer une configuration'}</button>
                    <button type="button" className="odoo-btn-secondary" onClick={() => setDescribe(null)}>Annuler</button>
                  </div>
                </>
              )}
            </div>
          )}
          {suggestion && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '0.7rem 0.9rem', display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} /> Proposition « {suggestion.preview.name} »</div>
              {suggestion.rationale && <p style={{ margin: 0 }}>{suggestion.rationale}</p>}
              {suggestion.preview.addedModules.length > 0 && <p className="odoo-setting-help" style={{ margin: 0 }}>Modules en plus : {suggestion.preview.addedModules.join(', ')}</p>}
              {suggestion.preview.removedModules.length > 0 && <p className="odoo-setting-help" style={{ margin: 0 }}>Modules en moins : {suggestion.preview.removedModules.join(', ')}</p>}
              {Object.keys(suggestion.model.labels).length > 0 && (
                <p className="odoo-setting-help" style={{ margin: 0 }}>
                  Vocabulaire : {Object.values(suggestion.model.labels).join(', ')}
                </p>
              )}
              {suggestion.model.starter.stepTypes.length + suggestion.model.starter.equipmentTypes.length > 0 && (
                <p className="odoo-setting-help" style={{ margin: 0 }}>
                  Étapes : {suggestion.model.starter.stepTypes.map(s => s.label).join(', ') || '—'} · Équipements : {suggestion.model.starter.equipmentTypes.map(s => s.label).join(', ') || '—'}
                </p>
              )}
              {suggestion.preview.warnings.map(w => (
                <p key={w} className="odoo-setting-help" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {w}
                </p>
              ))}
              {suggestion.questions.length > 0 && (
                <div className="odoo-setting-help">
                  À préciser pour affiner :
                  <ul style={{ margin: '2px 0 0 18px' }}>{suggestion.questions.map(q => <li key={q}>{q}</li>)}</ul>
                </div>
              )}
              <p className="odoo-setting-help" style={{ margin: 0 }}>
                « Mettre dans le brouillon » ajuste les modules et options ici, avec l'aperçu d'impact avant d'enregistrer. « Ajouter ce secteur » l'enregistre dans la liste avec son vocabulaire et ses données de départ, sans l'appliquer.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="odoo-btn-primary"
                  disabled={!Object.keys(suggestion.changes.modules).length && !Object.keys(suggestion.changes.features).length}
                  onClick={() => suggestionToDraft(suggestion)}>Mettre dans le brouillon</button>
                <button type="button" className="odoo-btn-secondary" disabled={sectorCreateMut.isPending}
                  onClick={() => sectorCreateMut.mutate({ model: suggestion.model })}>Ajouter ce secteur</button>
                <button type="button" className="odoo-btn-secondary" onClick={() => setSuggestion(null)}>Modifier la description</button>
              </div>
            </div>
          )}
          {imported && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '0.7rem 0.9rem', display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>Modèle « {imported.preview.name} »</div>
              <p className="odoo-setting-help" style={{ margin: 0 }}>
                {imported.preview.modules} module(s), {imported.preview.features} option(s), {imported.preview.labels} libellé(s),
                {' '}{imported.preview.starter.stepTypes} type(s) d'étape, {imported.preview.starter.equipmentTypes} type(s) d'équipement, {imported.preview.starter.units} unité(s).
              </p>
              {imported.preview.addedModules.length > 0 && <p className="odoo-setting-help" style={{ margin: 0 }}>Par rapport à aujourd'hui, en plus : {imported.preview.addedModules.join(', ')}</p>}
              {imported.preview.removedModules.length > 0 && <p className="odoo-setting-help" style={{ margin: 0 }}>En moins : {imported.preview.removedModules.join(', ')}</p>}
              {imported.preview.warnings.map(w => (
                <p key={w} className="odoo-setting-help" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {w}
                </p>
              ))}
              <p className="odoo-setting-help" style={{ margin: 0 }}>Le secteur est ajouté à la liste sans être appliqué : vous le choisirez ensuite.</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="odoo-btn-primary" disabled={sectorCreateMut.isPending}
                  onClick={() => sectorCreateMut.mutate({ model: imported.model })}>Ajouter ce secteur</button>
                <button type="button" className="odoo-btn-secondary" onClick={() => setImported(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>
          </>
        ) },
      ]} />

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
