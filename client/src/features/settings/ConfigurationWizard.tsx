import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Sparkles, Check, Layers } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { allowedSettingsSections, hasWizardSettingsScope, WORKSPACES, TABLE_DENSITIES } from '@ofauria/shared';
import { wizardApi, type WizardSession, type WizardAnswers, type WizardMode } from '../../api/wizard.api';
import { settingsApi } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useSettings } from '../../context/SettingsContext';
import { Stepper, ChoiceCard } from '../../components/ds/Stepper';
import { Switch } from '../../components/ds/Switch';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import WizardBusinessFields, { draftData } from './WizardBusinessFields';
import WizardImpact from './WizardImpact';
import './configuration-wizard.css';

const errorText = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Enregistrement impossible. Réessayez.';

export default function ConfigurationWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canEdit, canView, getModuleConfig } = usePermissions();
  const scope = allowedSettingsSections(getModuleConfig('settings'));
  const allowed = canView('settings') && canEdit('settings') && hasWizardSettingsScope(scope);
  const { settings } = useSettings();
  const list = useQuery({ queryKey: ['configuration-wizard'], queryFn: wizardApi.list, enabled: allowed });
  const sector = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector, enabled: allowed });
  const catalog = useQuery({ queryKey: ['configuration-wizard-catalog'], queryFn: wizardApi.catalog, enabled: allowed });
  const [session, setSession] = useState<WizardSession | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dirty = !!session && JSON.stringify(session.answers) !== JSON.stringify(answers);
  const preview = useQuery({ queryKey: ['wizard-impact', session?.id, session?.revision], queryFn: () => wizardApi.preview(session!.id), enabled: allowed && session?.current_step === 'review' && !dirty });
  const changeSetKey = ['wizard-changeset',session?.id,session?.revision];
  const changeSet = useQuery({queryKey:changeSetKey,queryFn:()=>wizardApi.changeset(session!.id),enabled:allowed && session?.current_step==='review'&&!dirty});
  const open = (s: WizardSession) => { setSession(s); setAnswers(s.answers); setError(''); };
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['configuration-wizard'] }); void qc.invalidateQueries({ queryKey: ['settings', 'setup'] }); };
  async function create(kind: WizardSession['kind']) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { open(await wizardApi.create(kind, 'advanced')); invalidate(); }
    catch (e) { setError(errorText(e)); invalidate(); }
    finally { lock.current = false; setBusy(false); }
  }
  async function persist(mode: WizardMode, key: string, nextAnswers: WizardAnswers, exit = false) {
    if (!session || lock.current) return;
    if(mode===session.mode&&key===session.current_step&&JSON.stringify(nextAnswers)===JSON.stringify(session.answers)) { if(exit)navigate('/settings'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await wizardApi.save(session.id, { mode, current_step: key, answers: nextAnswers, revision: session.revision });
      open(result); invalidate();
      if (exit) navigate('/settings');
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function abandon() {
    if (!session || lock.current || !(await confirm('Abandonner ce brouillon ? La configuration active reste inchangée.', { title: 'Abandonner la préparation', confirmLabel: 'Abandonner' }))) return;
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await wizardApi.abandon(session.id, session.revision); setSession(null); setAnswers({}); setError(''); invalidate(); }
    catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function prepareChanges(simulate = false) {
    if (!session || lock.current || dirty) return;
    lock.current = true; setBusy(true); setError('');
    try {
      // A compilation must reference the reviewed revision, not a revision invalidated
      // immediately afterwards by the final review button.
      const reviewed=!simulate&&!session.answers.review?.reviewed
        ? await wizardApi.save(session.id,{mode:session.mode,current_step:'review',revision:session.revision,answers:{...answers,review:{...answers.review,reviewed:true}}}) : session;
      if(reviewed!==session){open(reviewed);invalidate()}
      qc.setQueryData(['wizard-changeset',reviewed.id,reviewed.revision],await(simulate?wizardApi.simulate(reviewed.id,reviewed.revision):wizardApi.compile(reviewed.id,reviewed.revision)));
    }
    catch(e) { setError(errorText(e)); }
    finally { lock.current=false;setBusy(false); }
  }
  async function rebase() {
    if(!session||lock.current||dirty||!(await confirm('Actualiser la version de référence ? Les choix sont conservés, mais le jeu de changements devra être recompilé.',{title:'Actualiser la référence',confirmLabel:'Actualiser'})))return;
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{open(await wizardApi.rebase(session.id,session.revision));invalidate()}catch(e){setError(errorText(e))}finally{lock.current=false;setBusy(false)}
  }
  useEffect(() => {
    if (!session || !dirty || busy || error) return;
    const timer = window.setTimeout(() => void persist(session.mode, session.current_step, answers), 2000);
    return () => window.clearTimeout(timer);
    // The pending draft and revision identify the save; a failed save must not retry endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, answers, dirty, busy, error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!allowed) return <div className="wz-page"><p>Accès interdit aux paramètres de configuration.</p></div>;
  const banner = error && <div className="ds-alert danger" role="alert">{error} <button className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={async () => { const r = await list.refetch(); const latest = r.data?.find(s => s.id === session?.id); if (latest) open(latest); else { setSession(null); setError(''); } }}>Recharger le brouillon</button></div>;
  if (!session) return <div className="wz-page"><div className="wz-muted">Paramètres › Assistant de configuration</div><h1>Assistant de configuration</h1><p>Préparez votre environnement multisectoriel sans modifier les paramètres actifs.</p>{banner}
    <section className="ds-panel wz-box"><h2>Reprendre une configuration</h2>{list.isLoading ? <p>Chargement…</p> : list.isError ? <div className="ds-alert danger" role="alert">Impossible de charger les brouillons : {errorText(list.error)} <button className="odoo-btn-secondary ds-btn-sm" onClick={()=>void list.refetch()}>Réessayer</button></div> : list.data?.length ? list.data.map(s => <ChoiceCard key={s.id} selected={false} title={`${s.kind === 'initial' ? 'Configuration initiale' : s.kind === 'evolution' ? 'Évolution' : 'Mise à niveau'} · ${s.steps.find(x => x.key === s.current_step)?.label}`} description={`Brouillon enregistré le ${new Date(s.updated_at).toLocaleString('fr-CA')}`} onClick={() => open(s)} />) : <p>Aucun brouillon en cours.</p>}
      <div className="wz-actions"><button className="odoo-btn-primary" disabled={busy || list.isLoading || list.isError || !!list.data?.some(s => s.kind === 'initial')} onClick={() => void create('initial')}>Nouvelle configuration</button><button className="odoo-btn-secondary" disabled={busy || list.isLoading || list.isError} onClick={() => void create('evolution')}>Faire évoluer la configuration</button><button className="odoo-btn-secondary" onClick={() => navigate('/settings')}>Retour</button></div></section></div>;
  const current = session.steps.find(s => s.key === session.current_step) ?? session.steps[0];
  const index = session.steps.indexOf(current);
  const completed = new Set(Object.keys(answers).filter(k => answers[k]?.reviewed && !session.issues.some(i => i.step === k && i.severity === 'blocking')));
  const answer = answers[current.key] ?? {};
  const change = (patch: typeof answer) => setAnswers(a => ({ ...a, [current.key]: { ...a[current.key], ...patch } }));
  const changeData = (data: NonNullable<typeof answer.data>) => setAnswers(a => {
    const out: WizardAnswers = { ...a, [current.key]: { ...a[current.key], data, reviewed: false }, review: { ...a.review, reviewed: false } };
    if (current.key === 'sector') for (const key of ['specialties','modules','operations','vocabulary','rules','interfaces','roles']) out[key] = { ...a[key], reviewed: false };
    if (current.key === 'modules') for (const key of ['operations','rules','interfaces','roles']) out[key] = { ...a[key], reviewed: false };
    return out;
  });
  const next = () => { const a = { ...answers, [current.key]: { ...answer, data: draftData(current.key, answers, catalog.data, settings.legalName || settings.companyName), reviewed: true } }; void persist(session.mode, session.steps[index + 1]?.key ?? current.key, a); };
  const allPrepared = session.steps.filter(s => s.key !== 'review').every(s => completed.has(s.key)) && !!preview.data?.impact && !preview.data.issues.some(i => i.severity === 'blocking');
  return <div className="wz-page"><div className="wz-between wz-muted"><span>Paramètres › Configuration de l’entreprise › Assistant multisectoriel</span><span className="kl-tag x">Brouillon · v{session.revision + 1}</span></div>
    <div className="wz-between wz-heading"><div><h1>Assistant de configuration</h1><p>Adaptez KALUM à votre activité, étape par étape.</p></div><div className="wz-actions">{(['quick','advanced'] as const).map(m => <button key={m} type="button" aria-pressed={m === session.mode} disabled={busy} className={m === session.mode ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => void persist(m, current.key, answers)}>{m === 'quick' ? 'Rapide' : 'Avancé'}</button>)}</div></div>
    {banner}<div className="wz-grid"><Stepper steps={session.steps} current={current.key} completed={completed} disabled={busy} onSelect={key => void persist(session.mode, key, answers)} />
      <section className="ds-panel wz-box"><h2>{current.label}</h2><p className="wz-muted">{current.description}</p><div className="ds-alert info">Préparation du brouillon : aucun réglage actif ne sera modifié.</div>
        {catalog.isError && <div className="ds-alert danger">Catalogue indisponible. Rechargez avant de poursuivre.</div>}
        {session.issues.filter(i => i.severity === 'blocking' && (i.step === current.key || current.key === 'review')).map(i => <div key={`${i.step}:${i.message}`} className="ds-alert danger">{i.message}</div>)}
        {current.key !== 'review' && <WizardBusinessFields step={current.key} answers={answers} catalog={catalog.data} company={settings.legalName || settings.companyName} disabled={busy || !catalog.data} onChange={changeData}/>}
        {current.key === 'review' && <>{preview.isLoading && <p>Analyse d’impact en cours…</p>}{preview.isError && <div className="ds-alert danger">L’analyse d’impact est indisponible.</div>}{preview.data?.issues.filter(i => i.severity !== 'info' && !session.issues.some(s => s.message === i.message)).map(i => <div className={`ds-alert ${i.severity === 'blocking' ? 'danger' : 'warning'}`} key={`${i.step}:${i.message}`}>{i.message}</div>)}{preview.data?.impact && <WizardImpact impact={preview.data.impact}/>}</>}
        {current.key==='review'&&preview.data?.issues.some(i=>i.step==='review'&&i.severity==='warning')&&<button className="odoo-btn-secondary" disabled={busy||dirty} onClick={()=>void rebase()}>Actualiser la version de référence</button>}
        {current.key==='review'&&changeSet.data?.simulation?.interfaceImpact&&<section><h3>Interfaces vérifiées par la simulation</h3>{(['workspace','density'] as const).map(field=>{const impact=changeSet.data!.simulation!.interfaceImpact!;const options=field==='workspace'?WORKSPACES:TABLE_DENSITIES;const label=(value:string)=>options.find(o=>o.value===value)?.label??value;return <div className="wz-review" key={field}><span>{field==='workspace'?'Accueil':'Densité'}<small className="wz-muted" style={{display:'block'}}>{label(impact.before[field])} → {label(impact.after[field])}</small></span><span className="kl-tag b">Annulé après test</span></div>})}</section>}
        {current.key==='review'&&!!changeSet.data?.simulation?.parameterImpact?.length&&<section><h3>Paramètres vérifiés par la simulation</h3>{changeSet.data.simulation.parameterImpact.map(change=>{
          const def=catalog.data?.parameters?.find(p=>p.key===change.key);
          const format=(v:unknown,options?:{value:string;label:string}[])=>typeof v==='boolean'?(v?'Oui':'Non'):Array.isArray(v)?v.join(', '):options?.find(o=>o.value===v)?.label??String(v??'—');
          const fields=(def?.fields??[]).filter(f=>JSON.stringify(change.before[f.name])!==JSON.stringify(change.value[f.name]));
          return <div key={change.key} className="wz-review"><span>{def?.label??change.key}{fields.length?fields.map(f=><small className="wz-muted" style={{display:'block'}} key={f.name}>{f.label} : {format(change.before[f.name],f.options)} → {format(change.value[f.name],f.options)}</small>):<small className="wz-muted" style={{display:'block'}}>Aucun écart de valeur</small>}</span><span className="kl-tag b">Annulé après test</span></div>;
        })}</section>}
        {current.key === 'review' && <><h3>Jeu de changements</h3><div className="wz-actions"><button className="odoo-btn-secondary" disabled={busy||dirty||!allPrepared} onClick={()=>void prepareChanges()}>Compiler les changements</button><button className="odoo-btn-secondary" disabled={busy||dirty||!catalog.data?.technicalSimulationAvailable||!['compiled','simulated_partial'].includes(changeSet.data?.status??'')} onClick={()=>void prepareChanges(true)}>Simulation technique (test)</button></div>{changeSet.isError && <div className="ds-alert warning">Jeu de changements indisponible : {errorText(changeSet.error)}</div>}{changeSet.data && <><p className="wz-muted">Révision {changeSet.data.session_revision} · {changeSet.data.status}</p>{changeSet.data.operations.map(op=><div className="wz-review" key={`${op.step}:${op.execution}`}><span>{session.steps.find(s=>s.key===op.step)?.label??op.step}<small className="wz-muted" style={{display:'block'}}>{op.reason??'Inclus dans la simulation technique'}</small></span><span className={`kl-tag ${op.execution==='pending'?'o':'b'}`}>{op.execution==='pending'?'À raccorder':'Préparé'}</span></div>)}{changeSet.data.issues.filter(i=>i.severity==='blocking').map((i,index)=><div key={`${i.step}:${i.message}:${index}`} className="ds-alert danger">{i.message}</div>)}{changeSet.data.simulation && <div className="ds-alert info">{changeSet.data.simulation.note}</div>}</>}</>}
        {current.key === 'review' ? <><h3>Étapes préparées</h3>{session.steps.filter(s => s.key !== 'review').map(s => <div className="wz-review" key={s.key}><span>{s.label}</span><span className={`kl-tag ${completed.has(s.key) ? 'g' : 'x'}`}>{completed.has(s.key) ? 'Préparée' : 'À préparer'}</span></div>)}<div className="ds-alert warning">L’activation globale reste indisponible ; la simulation technique est réservée à la recette.</div><button className="odoo-btn-primary" disabled={busy || !allPrepared} onClick={() => void persist(session.mode, 'review', { ...answers, review: { reviewed: true } }, true)}>Terminer la préparation</button></> : <><label className="ds-field"><span>Notes de préparation</span><textarea className="ds-input" value={answer.note ?? ''} maxLength={4000} disabled={busy} onChange={e => change({ note: e.target.value })} placeholder="Choix, questions ou contraintes à confirmer…" /></label><div className="wz-actions"><Switch checked={!!answer.reviewed} disabled={busy} label="Étape préparée" onChange={reviewed => change({ reviewed })}/>Étape préparée</div></>}
      </section><aside className="ds-panel wz-box"><h2 className="wz-actions"><Sparkles size={18} /> Assistance Kalum</h2><p>{current.description}</p><div className="wz-recommend"><strong>Recommandation</strong><p>Conservez la configuration active jusqu’à la validation du jeu de changements.</p></div><h2>Configuration actuelle</h2><dl><dt>Entreprise</dt><dd>{settings.companyName}</dd><dt>Secteur principal</dt><dd>{sector.data?.current.label ?? 'Chargement…'}</dd><dt>Modules actifs</dt><dd>{sector.data?.current.modules.length ?? '—'}</dd></dl><hr/><p className="wz-muted"><Layers size={14} /> Socle KALUM › Pays › Secteur › Spécialité › Entreprise › Établissement › Utilisateur</p><button className="ds-btn-danger" disabled={busy} onClick={() => void abandon()}>Abandonner le brouillon</button></aside></div>
    <footer className="wz-footer"><span className="wz-muted" aria-live="polite">{busy ? 'Enregistrement…' : error ? 'Enregistrement en échec' : dirty ? 'Modifications à enregistrer' : <><Check size={15} /> Brouillon enregistré</>}</span><button className="odoo-btn-secondary" disabled={busy} onClick={() => void persist(session.mode, current.key, answers, true)}>Enregistrer et quitter</button><span style={{ flex: 1 }}/><button className="odoo-btn-secondary" disabled={busy || index === 0} onClick={() => void persist(session.mode, session.steps[index - 1].key, answers)}><ArrowLeft size={15}/> Précédent</button><button className="odoo-btn-primary" disabled={busy || current.key === 'review'} onClick={next}>Suivant <ArrowRight size={15}/></button></footer>
  </div>;
}
