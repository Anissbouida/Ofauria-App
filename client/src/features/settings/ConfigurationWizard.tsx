import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Info, Play, Sparkles, TriangleAlert } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { allowedSettingsSections, hasWizardSettingsScope, ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { wizardApi, type WizardSession, type WizardAnswers, type WizardMode, type WizardChangeSet } from '../../api/wizard.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useSettings } from '../../context/SettingsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import WizardBusinessFields, { draftData, draftProfiles, proposedRoleTemplates, PreviewBox, Tag, Alert, profileIcon } from './WizardBusinessFields';
import WizardImpact from './WizardImpact';
import './configuration-wizard.css';

/* Assistant de configuration — reproduction de la maquette validée
   (docs/personnalisation-multisectorielle/maquette/assistant-configuration.html),
   branchée sur les brouillons, la compilation et la publication réelles. */

const errorText = (e: unknown) => {
  const err = (e as { response?: { data?: { error?: { message?: string; details?: Record<string, string[]> } } } })?.response?.data?.error;
  // Erreur de validation : nommer le champ refusé plutôt qu'un simple « Données invalides ».
  const detail = err?.details && Object.entries(err.details)[0];
  return detail ? `${err?.message ?? 'Données invalides'} : ${detail[0].replace(/^answers\./, '')} — ${detail[1].join(', ')}` : err?.message ?? 'Enregistrement impossible. Réessayez.';
};
const list = (v: unknown): string[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const ACTIVE_MODULES = (ACTIVATABLE_MODULES as string[]).filter(m => !CORE_MODULES.has(m as AppModule));

/** Titre de chaque étape (le libellé court et l'explication viennent du serveur). */
const HEADINGS: Record<string, string> = {
  company: 'Informations générales', sector: 'Quel est votre secteur d’activité ?', specialties: 'Quelles spécialités exercez-vous ?',
  modules: 'Modules et fonctionnalités', operations: 'Modèle opérationnel', vocabulary: 'Vocabulaire métier', rules: 'Processus et règles de gestion',
  interfaces: 'Interfaces par métier', finance: 'Comptabilité et fiscalité', roles: 'Utilisateurs, rôles et autorisations', data: 'Initialisation des données',
  review: 'Révision et activation',
};
/** Texte d'assistance (panneau de droite), repris de la maquette. */
const WHY: Record<string, string> = {
  company: 'Le pays pose les règles comptables et fiscales, verrouillées pour la suite.',
  sector: 'Le secteur principal détermine le profil de référence. Les activités complémentaires ajoutent leurs modules.',
  specialties: 'Une spécialité ajoute sans rien retirer ; la désactiver plus tard ne supprime aucune donnée.',
  modules: 'Activer un module ajoute ses menus. Le retirer les masque, sans supprimer de données.',
  operations: 'Ces choix fixent les valeurs par défaut des pièces ; chaque établissement peut y déroger.',
  vocabulary: 'Les mots changent à l’écran, sur les documents et les rapports. Les identifiants techniques ne changent pas.',
  rules: 'Une étape obligatoire bloque la suivante tant qu’elle n’est pas faite.',
  interfaces: 'Chaque rôle arrive sur l’écran de son métier, avec le même gabarit Kalum.',
  finance: 'Les paramètres marqués « Réglementaire » viennent du pays et ne se désactivent pas.',
  roles: 'Un rôle non retenu peut être ajouté plus tard.',
  data: 'Chaque import passe par un aperçu et peut être annulé.',
  review: 'L’activation crée une version de la configuration, restaurable depuis l’historique.',
};
function recommendation(code: string) {
  if (/boulang/.test(code)) return 'Pour les métiers de bouche, associez production, fiches techniques, économat, point de vente et traçabilité par lots.';
  if (/agro/.test(code)) return 'En agroalimentaire, la traçabilité par lot et le contrôle qualité avant transfert sont imposés par le profil.';
  if (/fabric|discret|process|atelier/.test(code)) return 'Associez nomenclatures, production, stocks, qualité et maintenance.';
  if (/negoce/.test(code)) return 'Sans fabrication : achats, stocks, ventes et logistique suffisent.';
  return 'Partez du socle commun et activez seulement les modules utiles à votre modèle opérationnel.';
}
const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

export default function ConfigurationWizard() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canEdit, canView, getModuleConfig } = usePermissions();
  const scope = allowedSettingsSections(getModuleConfig('settings'));
  const allowed = canView('settings') && canEdit('settings') && hasWizardSettingsScope(scope);
  const { settings } = useSettings();
  const companyName = settings.legalName || settings.companyName;
  const drafts = useQuery({ queryKey: ['configuration-wizard'], queryFn: wizardApi.list, enabled: allowed });
  const catalog = useQuery({ queryKey: ['configuration-wizard-catalog'], queryFn: wizardApi.catalog, enabled: allowed });
  const [session, setSession] = useState<WizardSession | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const lock = useRef(false);
  const dirty = !!session && JSON.stringify(session.answers) !== JSON.stringify(answers);
  const onReview = session?.current_step === 'review';
  const preview = useQuery({ queryKey: ['wizard-impact', session?.id, session?.revision], queryFn: () => wizardApi.preview(session!.id), enabled: allowed && onReview && !dirty });
  const changeSet = useQuery({ queryKey: ['wizard-changeset', session?.id, session?.revision], queryFn: () => wizardApi.changeset(session!.id), enabled: allowed && onReview && !dirty });
  const open = (s: WizardSession) => {
    setSession(s); setAnswers(s.answers); setError('');
    // Le brouillon ouvert est dans l'adresse : un rechargement le rouvre à la même étape.
    if (params.get('brouillon') !== s.id) setParams(p => { const n = new URLSearchParams(p); n.set('brouillon', s.id); return n; }, { replace: true });
  };
  const close = () => { setSession(null); setAnswers({}); setParams(p => { const n = new URLSearchParams(p); n.delete('brouillon'); return n; }, { replace: true }); };
  useEffect(() => {
    const id = params.get('brouillon');
    if (session || !id || !drafts.data) return;
    const found = drafts.data.find(d => d.id === id);
    if (found) open(found); else close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.data, params]);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['configuration-wizard'] }); void qc.invalidateQueries({ queryKey: ['settings', 'setup'] }); };

  /** Une seule opération à la fois ; l'erreur s'affiche dans le bandeau. */
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true); setError('');
    try { return await fn(); }
    catch (e) { setError(errorText(e)); return undefined; }
    finally { lock.current = false; setBusy(false); }
  }
  const create = (kind: WizardSession['kind']) => run(async () => { open(await wizardApi.create(kind, 'advanced')); invalidate(); });
  async function persist(mode: WizardMode, key: string, nextAnswers: WizardAnswers, exit = false) {
    if (!session) return;
    if (mode === session.mode && key === session.current_step && JSON.stringify(nextAnswers) === JSON.stringify(session.answers)) { if (exit) navigate('/settings'); return; }
    await run(async () => {
      open(await wizardApi.save(session.id, { mode, current_step: key, answers: nextAnswers, revision: session.revision })); invalidate();
      if (exit) navigate('/settings');
    });
  }
  async function abandon() {
    if (!session || lock.current || !(await confirm('Abandonner ce brouillon ? La configuration active reste inchangée.', { title: 'Abandonner la préparation', confirmLabel: 'Abandonner' }))) return;
    await run(async () => { await wizardApi.abandon(session.id, session.revision); close(); invalidate(); });
  }
  /** Révision marquée vue, puis jeu de changements compilé sur cette révision exacte. */
  async function compiled(): Promise<{ target: WizardSession; cs: WizardChangeSet } | undefined> {
    if (!session) return undefined;
    let target = session;
    if (!session.answers.review?.reviewed) {
      target = await wizardApi.save(session.id, { mode: session.mode, current_step: 'review', revision: session.revision, answers: { ...answers, review: { ...answers.review, reviewed: true } } });
      open(target); invalidate();
    }
    const cs = await wizardApi.compile(target.id, target.revision);
    qc.setQueryData(['wizard-changeset', target.id, target.revision], cs);
    return { target, cs };
  }
  const ready = (cs?: WizardChangeSet | null) => ['compiled', 'simulated_partial'].includes(cs?.status ?? '');
  const simulate = () => run(async () => {
    const r = await compiled();
    if (r && ready(r.cs)) qc.setQueryData(['wizard-changeset', r.target.id, r.target.revision], await wizardApi.simulate(r.target.id, r.target.revision));
  });
  /** « Terminer et activer » : compile, demande confirmation, publie en une transaction. */
  async function finish() {
    if (!session || dirty) return;
    const r = await run(compiled);
    if (!r) return;
    if (!ready(r.cs)) { setError(r.cs.issues.find(i => i.severity === 'blocking')?.message ?? 'Des points restent à régler avant l’activation.'); return; }
    const ok = await confirm('Activer cette configuration ? Secteurs, modules, spécialités, paramètres, vocabulaire, préférences et rôles préparés deviennent actifs en une seule opération. La version actuelle reste restaurable depuis l’historique des configurations.', { title: 'Terminer et activer', confirmLabel: 'Activer' });
    if (!ok) return;
    await run(async () => {
      const result = await wizardApi.apply(r.target.id, r.target.revision);
      if (result.status === 'pending_approval') {
        // Changement sensible : soumis à l'approbation d'un administrateur, appliqué à son accord.
        qc.setQueryData(['wizard-changeset', r.target.id, r.target.revision], result);
        setPendingApproval(true);
        return;
      }
      setPublished(String(result.published_version_id ?? ''));
      close();
      void qc.invalidateQueries(); // menus, modules et libellés dépendent de la configuration publiée
    });
  }
  async function rebase() {
    if (!session || dirty || !(await confirm('Actualiser la version de référence ? Les choix sont conservés ; le jeu de changements sera recompilé.', { title: 'Actualiser la référence', confirmLabel: 'Actualiser' }))) return;
    await run(async () => { open(await wizardApi.rebase(session.id, session.revision)); invalidate(); });
  }

  useEffect(() => {
    if (!session || !dirty || busy || error) return;
    const timer = window.setTimeout(() => void persist(session.mode, session.current_step, answers), 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, answers, dirty, busy, error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const crumbBar = (tag?: string) => <div className="odoo-control-bar odoo-settings-bar">
    <div className="odoo-breadcrumb" aria-label="Fil d’Ariane"><button type="button" className="odoo-btn-link" onClick={() => navigate('/settings')}>Paramètres</button><span className="odoo-breadcrumb-separator">›</span><span>Activité et modules</span><span className="odoo-breadcrumb-separator">›</span><span className="odoo-breadcrumb-current">Assistant de configuration</span></div>
    <div style={{ flex: 1 }} />{tag && <span className="kl-tag x">{tag}</span>}</div>;
  const banner = error && <Alert tone="danger" icon={<TriangleAlert size={16} />} action={session && <button className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={async () => { const r = await drafts.refetch(); const latest = r.data?.find(s => s.id === session.id); if (latest) open(latest); else { close(); setError(''); } }}>Recharger le brouillon</button>}>{error}</Alert>;

  if (!allowed) return <div className="wz-app">{crumbBar()}<div className="wz-page"><Alert tone="danger">Accès interdit aux paramètres de configuration.</Alert></div></div>;

  /* ── Aucun brouillon ouvert : reprise ou démarrage ── */
  if (!session) {
    const kinds: Record<string, string> = { initial: 'Configuration initiale', evolution: 'Évolution de la configuration', upgrade: 'Mise à niveau' };
    return <div className="wz-app">{crumbBar()}<div className="wz-page">
      <header className="kl-largetitle wz-title"><div><h1>Assistant de configuration</h1><p>Adaptez Kalum à votre activité, étape par étape.</p></div></header>
      {banner}
      {published !== null && <Alert tone="success" icon={<Check size={16} />} action={<><button className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/settings?page=sector')}>Historique des configurations</button><button className="odoo-btn-secondary ds-btn-sm" onClick={() => window.location.reload()}>Recharger l’application</button></>}>
        <strong>Configuration activée.</strong> Modules, menus et libellés sont à jour. Pour revenir en arrière, restaurez la version précédente dans l’historique des configurations.</Alert>}
      <section className="ds-panel"><div className="wz-start">
        <h2 className="ds-subhead" style={{ fontSize: 17 }}>Configuration en cours</h2>
        {drafts.isLoading ? <p className="mq-sub">Chargement…</p> : drafts.isError ? <Alert tone="danger" action={<button className="odoo-btn-secondary ds-btn-sm" onClick={() => void drafts.refetch()}>Réessayer</button>}>Impossible de charger les brouillons : {errorText(drafts.error)}</Alert>
          : drafts.data?.length ? drafts.data.map(s => {
            const n = s.steps.length, done = s.steps.filter(x => s.answers[x.key]?.reviewed).length;
            return <div key={s.id} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', display: 'grid', gap: 4 }}><b style={{ color: 'var(--ds-ink)' }}>{kinds[s.kind]}</b>
                <span className="mq-sub">Arrêtée à « {s.steps.find(x => x.key === s.current_step)?.label} » · enregistrée le {new Date(s.updated_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <div className="wz-progbar" style={{ marginTop: 6 }}><span style={{ width: `${Math.round(100 * done / n)}%` }} /></div><span className="mq-sub">{done} étape{done > 1 ? 's' : ''} sur {n} terminée{done > 1 ? 's' : ''}</span></div>
              <button type="button" className="odoo-btn-primary" onClick={() => open(s)}>Reprendre</button></div>;
          }) : <p className="mq-sub">Aucune configuration en cours. La configuration active n’est modifiée qu’à l’activation finale.</p>}
        <div className="wz-bar" style={{ flexWrap: 'wrap' }}><button className="odoo-btn-primary" disabled={busy || drafts.isLoading || drafts.isError || !!drafts.data?.some(s => s.kind === 'initial')} onClick={() => void create('initial')}>Nouvelle configuration</button>
          <button className="odoo-btn-secondary" disabled={busy || drafts.isLoading || drafts.isError} onClick={() => void create('evolution')}>Faire évoluer la configuration</button>
          <button className="odoo-btn-secondary" onClick={() => navigate('/settings')}>Retour aux paramètres</button></div>
      </div></section>
    </div></div>;
  }

  /* ── Brouillon ouvert ── */
  const steps = session.steps;
  const current = steps.find(s => s.key === session.current_step) ?? steps[0];
  const index = steps.indexOf(current);
  const last = current.key === 'review';
  const blocking = session.issues.filter(i => i.severity === 'blocking');
  const completed = new Set(steps.filter(s => answers[s.key]?.reviewed && !blocking.some(i => i.step === s.key)).map(s => s.key));
  const pct = Math.round(100 * completed.size / steps.length);
  const changeData = (data: NonNullable<WizardAnswers[string]['data']>) => setAnswers(a => {
    const out: WizardAnswers = { ...a, [current.key]: { ...a[current.key], data, reviewed: false }, review: { ...a.review, reviewed: false } };
    if (current.key === 'sector') {
      for (const key of ['specialties','modules','operations','vocabulary','rules','interfaces','roles']) out[key] = { ...a[key], reviewed: false };
      // Les spécialités d'un secteur qui n'est plus retenu sont retirées du brouillon.
      const codes = [data.primary, ...(Array.isArray(data.secondary) ? data.secondary : [])];
      const lineage = new Set((catalog.data?.profiles ?? []).filter(p => codes.includes(p.code)).flatMap(p => p.lineage));
      const chosen = a.specialties?.data?.selected;
      if (Array.isArray(chosen)) out.specialties = { ...out.specialties, data: { ...a.specialties!.data, selected: chosen.filter(c => lineage.has(catalog.data?.specialties.find(s => s.code === c)?.sector ?? '')) } };
    }
    if (current.key === 'modules') for (const key of ['operations','rules','interfaces','roles']) out[key] = { ...a[key], reviewed: false };
    return out;
  });
  const go = (key: string, extra: WizardAnswers = answers) => void persist(session.mode, key, extra);
  const next = () => go(steps[index + 1]?.key ?? current.key, { ...answers, [current.key]: { ...answers[current.key], data: draftData(current.key, answers, catalog.data, companyName), reviewed: true } });
  const { main, secondary: secondaryCodes, recommended } = draftProfiles(answers, catalog.data);
  const modules = list(draftData('modules', answers, catalog.data, companyName).selected).filter(m => ACTIVE_MODULES.includes(m));
  const specialties = list(draftData('specialties', answers, catalog.data, companyName).selected);
  const roles = proposedRoleTemplates(answers, catalog.data, companyName);
  const chosenRoles = list(draftData('roles', answers, catalog.data, companyName).selected);
  const rolesToCreate = roles.filter(t => !t.exists && chosenRoles.includes(t.code));
  const missing = [...recommended].filter(m => ACTIVE_MODULES.includes(m) && !modules.includes(m));
  const secondaryLabels = secondaryCodes.map(c => catalog.data?.profiles.find(p => p.code === c)?.label ?? c);
  const reviewIssues = [...blocking, ...(preview.data?.issues ?? []).filter(i => i.severity !== 'info'), ...(changeSet.data?.issues ?? []).filter(i => i.severity !== 'info')]
    .filter((i, n, arr) => arr.findIndex(x => x.message === i.message) === n);
  const blockers = reviewIssues.filter(i => i.severity === 'blocking');
  const footBlock = (last ? blockers : blocking.filter(i => i.step === current.key))[0]?.message;
  const stepLabel = (key: string) => steps.find(s => s.key === key)?.label ?? key;
  const companyLabel = text(draftData('company', answers, catalog.data, companyName).name);

  const reviewBody = <>
    <section className="ds-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }} aria-label="Synthèse">
      <div className="ds-kpi"><span className="ds-kpi-label"><span>Modules</span></span><span className="ds-kpi-value">{modules.length} / {ACTIVE_MODULES.length}</span><span className="ds-kpi-sub">dépendances vérifiées</span></div>
      <div className="ds-kpi"><span className="ds-kpi-label"><span>Spécialités</span></span><span className="ds-kpi-value">{specialties.length}</span><span className="ds-kpi-sub">{1 + secondaryCodes.length} activité{secondaryCodes.length ? 's' : ''}</span></div>
      <div className="ds-kpi"><span className="ds-kpi-label"><span>Rôles à créer</span></span><span className="ds-kpi-value">{rolesToCreate.length}</span><span className="ds-kpi-sub">moindre privilège</span></div>
      <div className="ds-kpi"><span className="ds-kpi-label"><span>Points à régler</span></span><span className="ds-kpi-value">{reviewIssues.length}</span><span className={`ds-kpi-sub ${blockers.length ? 'red' : reviewIssues.length ? 'orange' : 'green'}`}>{blockers.length ? `${blockers.length} bloquant${blockers.length > 1 ? 's' : ''}` : reviewIssues.length ? 'aucun bloquant' : 'tout est cohérent'}</span></div>
    </section>
    <div><h3 className="ds-subhead">Aperçu de l’espace de travail</h3><PreviewBox answers={answers} catalog={catalog.data} company={companyName} /></div>
    {reviewIssues.length > 0 && <div className="ds-scroll"><table className="odoo-table ds-dense" style={{ width: '100%' }}><thead><tr><th>Point</th><th style={{ width: 130 }}>Gravité</th><th className="ds-actions" style={{ width: 120 }}>Action</th></tr></thead><tbody>
      {reviewIssues.map((i, n) => <tr key={`${i.step}:${n}`}><td className="ds-strong">{i.message}</td><td><Tag tone={i.severity === 'blocking' ? 'r' : 'o'}>{i.severity === 'blocking' ? 'Bloquant' : 'Avertissement'}</Tag></td>
        <td className="ds-actions">{i.step !== 'review' && steps.some(s => s.key === i.step) ? <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => go(i.step)}>Corriger</button>
          : i.step === 'review' ? <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy || dirty} onClick={() => void rebase()}>Actualiser</button> : null}</td></tr>)}</tbody></table></div>}
    <div className="ds-scroll"><table className="odoo-table ds-dense" style={{ width: '100%' }}><thead><tr><th style={{ width: 200 }}>Rubrique</th><th>Configuration retenue</th><th className="ds-actions" style={{ width: 110 }}></th></tr></thead><tbody>
      {([
        ['company', 'Entreprise', `${companyLabel || '—'} · ${catalog.data?.country === 'MA' ? 'Maroc' : catalog.data?.country ?? ''} · ${catalog.data?.currency ?? ''}`],
        ['sector', 'Secteur', `${main?.label ?? '—'}${secondaryLabels.length ? ` ; complémentaire : ${secondaryLabels.join(', ')}` : ''}`],
        ['specialties', 'Spécialités', specialties.map(c => catalog.data?.specialties.find(s => s.code === c)?.label ?? c).join(', ') || '—'],
        ['modules', 'Modules', modules.map(m => MODULE_LABELS[m as AppModule] ?? m).join(', ') || '—'],
        ['vocabulary', 'Vocabulaire', Object.values(draftData('vocabulary', answers, catalog.data, companyName)).filter((v): v is string => typeof v === 'string').slice(0, 4).join(', ') + '…'],
        ['roles', 'Rôles', rolesToCreate.map(t => t.label).join(', ') || 'Aucun rôle à créer'],
      ] as const).filter(r => steps.some(s => s.key === r[0])).map(r => <tr key={r[0]}><td className="ds-strong">{r[1]}</td><td>{r[2]}</td><td className="ds-actions"><button type="button" className="odoo-btn-link" disabled={busy} onClick={() => go(r[0])}>Modifier</button></td></tr>)}
    </tbody></table></div>
    {preview.data?.impact && <WizardImpact impact={preview.data.impact} />}
    {changeSet.data?.operations.some(o => o.execution === 'pending') && <Alert tone="info">Préparé dans le brouillon, sans effet à l’activation pour l’instant : {[...new Set(changeSet.data.operations.filter(o => o.execution === 'pending').map(o => stepLabel(o.step)))].join(', ')}.</Alert>}
    {changeSet.data?.simulation && <Alert tone="success" icon={<Check size={16} />}>{changeSet.data.simulation.note}</Alert>}
    {(pendingApproval || changeSet.data?.status === 'pending_approval') && <Alert tone="info" action={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/approvals')}>Voir les approbations</button>}><strong>En attente d’approbation.</strong> Ce changement retire des modules ou des capacités, ou change de secteur : un administrateur doit l’approuver. Il sera activé à son accord ; un refus laisse le brouillon modifiable.</Alert>}
  </>;

  return <div className="wz-app">
    {crumbBar(`Brouillon · v${session.revision + 1}`)}
    <div className="wz-page">
      <header className="kl-largetitle wz-title"><div><h1>Assistant de configuration</h1><p>Adaptez Kalum à votre activité, étape par étape.</p></div>
        <div className="prj-views" role="group" aria-label="Mode de configuration">{(['quick', 'advanced'] as const).map(m =>
          <button key={m} type="button" className={m === session.mode ? 'active' : ''} aria-pressed={m === session.mode} disabled={busy} onClick={() => void persist(m, current.key, answers)}>{m === 'quick' ? 'Rapide' : 'Avancé'}</button>)}</div></header>
      {banner}
      {catalog.isError && <Alert tone="danger">Catalogue indisponible. Rechargez avant de poursuivre.</Alert>}
      <div className="wz">
        <nav className="ds-panel wz-steps" aria-label="Étapes de l’assistant">
          <div className="wz-prog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Votre progression</strong><b>{pct} %</b></div>
            <div className="wz-progbar" role="progressbar" aria-label="Avancement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
            <span>{completed.size} sur {steps.length} étapes complétées</span>
          </div>
          <div className="wz-steplist">{steps.map((s, i) => {
            const active = s.key === current.key, warn = !active && !!answers[s.key]?.reviewed && blocking.some(x => x.step === s.key), done = !active && completed.has(s.key);
            return <div key={s.key}>{(i === 0 || steps[i - 1].phase !== s.phase) && <div className="wz-phase">{s.phase}</div>}
              <button type="button" className={`wz-step${active ? ' active' : warn ? ' warn' : done ? ' done' : ''}`} aria-current={active ? 'step' : undefined} disabled={busy} onClick={() => go(s.key)}>
                <span className="wz-num">{active ? i + 1 : warn ? '!' : done ? <Check size={12} /> : i + 1}</span>{s.label}</button></div>;
          })}</div>
        </nav>

        <section className="ds-panel" aria-live="polite">
          <div className="wz-head"><h2>{HEADINGS[current.key] ?? current.label}</h2><p>{current.description}</p></div>
          <div className="wz-body" key={current.key}>
            {!last && blocking.filter(i => i.step === current.key).map(i => <Alert key={i.message} tone="danger" icon={<TriangleAlert size={16} />}>{i.message}</Alert>)}
            {last ? reviewBody : <WizardBusinessFields step={current.key} answers={answers} catalog={catalog.data} company={companyName} disabled={busy || !catalog.data} onChange={changeData} />}
          </div>
        </section>

        <aside className="ds-panel wz-side" aria-label="Assistance et configuration actuelle">
          <div><h3><Sparkles size={18} aria-hidden="true" /> Assistance Kalum</h3><p style={{ marginTop: 8 }}>{WHY[current.key] ?? current.description}</p></div>
          <div className="wz-rec"><b>Recommandation</b><p>{missing.length ? `${missing.length} module${missing.length > 1 ? 's recommandés ne sont pas activés' : ' recommandé n’est pas activé'} : ${missing.slice(0, 3).map(m => MODULE_LABELS[m as AppModule]).join(', ')}${missing.length > 3 ? '…' : ''}.` : recommendation(main?.code ?? '')}</p></div>
          <hr className="wz-hr" />
          <h3>Configuration actuelle</h3>
          <dl className="wz-sum">
            <div><dt>Entreprise</dt><dd>{companyLabel || 'À renseigner'}</dd></div>
            <div><dt>Secteur principal</dt><dd style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{main && profileIcon(main.code, 14)}{main?.label ?? '—'}</dd></div>
            {secondaryLabels.length > 0 && <div><dt>Activités complémentaires</dt><dd>{secondaryLabels.join(', ')}</dd></div>}
            <div><dt>Spécialités</dt><dd>{specialties.length} métier{specialties.length > 1 ? 's' : ''}</dd></div>
            <div><dt>Modules actifs</dt><dd>{modules.length} / {ACTIVE_MODULES.length}</dd></div>
            <div><dt>Rôles proposés</dt><dd>{roles.length}</dd></div>
            <div><dt>Profil</dt><dd><Tag tone="b">Hérité du secteur</Tag></dd></div>
          </dl>
          <hr className="wz-hr" />
          <p className="mq-sub">Socle Kalum › Pays › Secteur › Spécialité › Entreprise › Établissement › Utilisateur</p>
          <div className="wz-bar" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/settings?page=sector')}><Info size={13} aria-hidden="true" /> Chaîne d’héritage</button>
            <button type="button" className="odoo-btn-link" disabled={busy} onClick={() => void abandon()}>Abandonner le brouillon</button>
          </div>
        </aside>
      </div>
    </div>

    <div className="wz-fixed">
      <span className={`wz-saved${error ? ' err' : ''}`} aria-live="polite">{busy ? 'Enregistrement…' : error ? 'Enregistrement en échec' : dirty ? 'Modifications en cours…' : <><Check size={14} aria-hidden="true" /> Brouillon enregistré à {hhmm(session.updated_at)}</>}</span>
      <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => void persist(session.mode, current.key, answers, true)}>Enregistrer et quitter</button>
      <div className="wz-foot">
        <span className={`ds-grow${footBlock ? ' block' : ''}`}>{footBlock ?? (session.mode === 'quick' ? 'Mode rapide : les réglages du profil s’appliquent aux étapes masquées.' : '')}</span>
        {index > 0 && <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => go(steps[index - 1].key)}><ArrowLeft size={14} aria-hidden="true" /> Précédent</button>}
        {last ? <>
          {catalog.data?.technicalSimulationAvailable && <button type="button" className="odoo-btn-secondary" disabled={busy || dirty} onClick={() => void simulate()}><Play size={13} aria-hidden="true" /> Simuler</button>}
          <button type="button" className="odoo-btn-primary" disabled={busy || dirty || blockers.length > 0 || pendingApproval || changeSet.data?.status === 'pending_approval'} onClick={() => void finish()}>Terminer et activer</button>
        </> : <button type="button" className="odoo-btn-primary" disabled={busy || !catalog.data} onClick={next}>Suivant <ArrowRight size={14} aria-hidden="true" /></button>}
      </div>
    </div>
  </div>;
}
