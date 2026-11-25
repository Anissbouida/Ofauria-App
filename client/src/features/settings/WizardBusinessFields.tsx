import { ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, requiredModules, dependentModules, effectiveModules, VOCABULARY_KEYS, WORKSPACES, TABLE_DENSITIES, parseWorkspace, parseTableDensity, type AppModule } from '@ofauria/shared';
import type { WizardAnswers, WizardCatalog, WizardData } from '../../api/wizard.api';
import { ChoiceCard } from '../../components/ds/Stepper';
import { Switch } from '../../components/ds/Switch';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const list = (v: unknown): string[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const VOCAB = VOCABULARY_KEYS.filter(v => ['reserve_zone','ingredient','recipe','production_plan','production_plans','doc_bon_sortie'].includes(v.key));
/** Lot 11 : modèles de rôles adaptés aux secteurs (et ascendants), spécialités et modules du brouillon. */
export function proposedRoleTemplates(answers: WizardAnswers, catalog: WizardCatalog | undefined, company: string) {
  const primary = text(answers.sector?.data?.primary) || catalog?.currentSector || '';
  const secondary = list(answers.sector?.data?.secondary ?? catalog?.currentSecondary);
  const lineage = new Set((catalog?.profiles ?? []).filter(p => p.code === primary || secondary.includes(p.code)).flatMap(p => p.lineage));
  const modules = list(draftData('modules', answers, catalog, company).selected);
  const specialties = list(draftData('specialties', answers, catalog, company).selected);
  return (catalog?.roleTemplates ?? []).filter(t => (!t.sector_code || lineage.has(t.sector_code))
    && (!t.specialization_code || specialties.includes(t.specialization_code))
    && t.requires_modules.every(m => modules.includes(m)));
}
const SCOPE_LABELS: Record<string, string> = { own: 'Ses dossiers', store: 'Son établissement', all: 'Toute la société' };
const RIGHT_LABELS: Record<string, string> = { v: 'consulter', c: 'créer', e: 'modifier', d: 'supprimer' };
export function draftData(step: string, answers: WizardAnswers, catalog: WizardCatalog | undefined, company: string): WizardData {
  const primary = text(answers.sector?.data?.primary) || catalog?.currentSector || '';
  const secondary = list(answers.sector?.data?.secondary ?? catalog?.currentSecondary).filter(c=>c!==primary);
  const profiles = catalog?.profiles.filter(p => p.code === primary || secondary.includes(p.code)) ?? [];
  const modules = [...effectiveModules(profiles.flatMap(p => p.modules), {})];
  let defaults: WizardData = {};
  if (step === 'company') defaults = { name: company, locale:'fr',timezone:'Africa/Casablanca',...catalog?.company,country:catalog?.country??'',currency:catalog?.currency??'' };
  if (step === 'sector') defaults = { primary, secondary };
  if (step === 'specialties') defaults = { selected: catalog?.specialties.filter(s => s.enabled && profiles.some(p => p.lineage.includes(s.sector))).map(s => s.code) ?? [] };
  if (step === 'modules') defaults = { selected: catalog && primary === catalog.currentSector && JSON.stringify([...secondary].sort())===JSON.stringify([...(catalog.currentSecondary??[])].sort()) ? catalog.modules : modules };
  if (step === 'vocabulary') defaults = Object.fromEntries(VOCAB.map(v => [v.key, profiles.find(p => p.code === primary)?.labels?.[v.key] ?? v.fallback]));
  if (step === 'roles') defaults = { selected: proposedRoleTemplates(answers,catalog,company).filter(t => !t.exists).map(t => t.code) };
  return { ...defaults, ...answers[step]?.data };
}

export default function WizardBusinessFields({ step, answers, catalog, company, disabled, onChange }: {
  step: string; answers: WizardAnswers; catalog: WizardCatalog | undefined; company: string; disabled: boolean; onChange: (data: WizardData) => void;
}) {
  const confirm = useConfirm();
  const data = draftData(step, answers, catalog, company);
  const set = (key: string, value: WizardData[string]) => onChange({ ...data, [key]: value });
  const unset = (key:string) => { const next={...data}; delete next[key]; onChange(next); };
  const input = (key: string, label: string, lock = false) => <label className="ds-field" key={key}><span>{label}</span><input className="ds-input" disabled={disabled || lock} value={text(data[key])} onChange={e => set(key, e.target.value)} /></label>;
  const select = (key: string, label: string, options: string[]) => <label className="ds-field" key={key}><span>{label}</span><select className="ds-input" disabled={disabled} value={text(data[key])} onChange={e => set(key, e.target.value)}><option value="">À choisir</option>{options.map(v => <option key={v}>{v}</option>)}</select></label>;
  const toggle = (key: string, label: string) => <div className="wz-review" key={key}><span>{label}</span><Switch label={label} checked={data[key] === true} disabled={disabled} onChange={v => set(key, v)} /></div>;
  const toggleItem = (key: string, id: string) => { const values = list(data[key]); set(key, values.includes(id) ? values.filter(v => v !== id) : [...values, id]); };
  if (step === 'company') return <div className="ds-form-grid">{input('name','Raison sociale *')}{input('legalForm','Forme juridique')}{input('country','Pays actif (lecture seule)',true)}{input('currency','Devise active (lecture seule)',true)}{input('locale','Langue par défaut')}{input('timezone','Fuseau horaire')}{select('size','Taille de l’entreprise',['TPE','PME','Grande entreprise'])}{input('sites','Nombre d’établissements envisagés')}</div>;
  if (step === 'sector') return <><h3>Activité principale</h3>{(catalog?.profiles ?? []).map(p => <ChoiceCard key={p.code} title={p.label} description={`${p.description ?? ''} · ${p.modules.length} modules${p.status === 'a_valider' ? ' · À valider' : ''}`} selected={data.primary === p.code} disabled={disabled} onClick={() => onChange({ ...data, primary: p.code, secondary: list(data.secondary).filter(v => v !== p.code) })} />)}<h3>Activités complémentaires</h3>{(catalog?.profiles ?? []).filter(p => p.code !== data.primary).map(p => <label key={p.code} className="wz-actions"><input type="checkbox" disabled={disabled} checked={list(data.secondary).includes(p.code)} onChange={() => toggleItem('secondary',p.code)} />{p.label}</label>)}</>;
  if (step === 'specialties') {
    const selected = draftData('sector', answers, catalog, company);
    const scope = new Set((catalog?.profiles ?? []).filter(p => p.code === selected.primary || list(selected.secondary).includes(p.code)).flatMap(p => p.lineage));
    const offered = (catalog?.specialties ?? []).filter(s => scope.has(s.sector));
    return <>{!offered.length && <p>Aucune spécialité disponible pour les profils sélectionnés.</p>}{offered.map(s => <ChoiceCard key={s.code} title={s.label} description={s.description ?? ''} selected={list(data.selected).includes(s.code)} disabled={disabled} onClick={() => toggleItem('selected',s.code)} />)}</>;
  }
  if (step === 'modules') {
    const selected = new Set(list(data.selected));
    return <>{ACTIVATABLE_MODULES.map(m => {
      const core = CORE_MODULES.has(m);
      const dependents = dependentModules(m).filter(x => selected.has(x));
      const requirements = requiredModules(m);
      return <div key={m} className="wz-review"><div><strong>{MODULE_LABELS[m]}</strong><div className="wz-muted">{core ? 'Socle obligatoire' : requirements.length ? `Prérequis : ${requirements.map(x => MODULE_LABELS[x]).join(', ')}` : 'Module disponible'}{selected.has(m) && dependents.length ? ` · Requis par ${dependents.map(x => MODULE_LABELS[x]).join(', ')}` : ''}</div></div><Switch label={MODULE_LABELS[m]} checked={core || selected.has(m)} disabled={disabled || core} onChange={async on => { const next = new Set(selected); if (on) for (const x of [m,...requirements]) next.add(x); else { if (dependents.length && !(await confirm(`Retirer aussi ${dependents.map(x => MODULE_LABELS[x]).join(', ')} du brouillon ?`, { title: 'Dépendances', confirmLabel: 'Retirer du brouillon' }))) return; for (const x of [m,...dependents]) next.delete(x); } set('selected',[...next]); }} /></div>;
    })}</>;
  }
  if (step === 'operations' || step === 'rules') {
    const mods = new Set(list(draftData('modules',answers,catalog,company).selected) as AppModule[]);
    const params=(catalog?.parameters??[]).filter(p=>p.step===step);
    const orphaned=Object.keys(data).filter(key=>!params.some(p=>mods.has(p.module as AppModule)&&p.fields.some(f=>`${p.key}:${f.name}`===key)));
    return <><p className="wz-muted">Les valeurs actuelles sont affichées. Seuls les champs modifiés seront inclus dans la simulation ; les dérogations par site, atelier ou article sont conservées.</p>
      {orphaned.length>0&&<div className="ds-alert warning">Choix antérieurs ou modules retirés : {orphaned.map(key=><div key={key}>{key} : {String(data[key])} <button type="button" className="odoo-btn-secondary" disabled={disabled} onClick={()=>unset(key)}>Retirer du brouillon</button></div>)}</div>}
      {params.filter(p=>mods.has(p.module as AppModule)).map(p=><section key={p.key}><h3>{p.label}</h3><p className="wz-muted">{p.help}</p>{!p.value?<p>Paramètre indisponible sur cette installation.</p>:<div className="ds-form-grid">{p.fields.map(f=>{
        const id=`${p.key}:${f.name}`, draft=id in data, value=draft?data[id]:p.value?.[f.name], locked=disabled||!p.value;
        return <div className="ds-field" key={id}><span>{f.label}{f.unit?` (${f.unit})`:''}</span>{f.type==='boolean'?<Switch label={f.label} checked={value===true} disabled={locked} onChange={v=>set(id,v)}/>:f.type==='enum'?<select aria-label={f.label} className="ds-input" value={String(value??'')} disabled={locked} onChange={e=>set(id,e.target.value)}>{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input aria-label={f.label} className="ds-input" type={['number','integer','percent'].includes(f.type)?'number':'text'} min={f.min} max={f.max} step={f.type==='integer'?1:'any'} disabled={locked} value={Array.isArray(value)?value.join(', '):String(value??'')} onChange={e=>set(id,e.target.value)}/>}{draft?<button type="button" disabled={disabled} className="odoo-btn-secondary" onClick={()=>unset(id)}>Annuler la modification</button>:<small className="wz-muted">Valeur actuelle</small>}</div>;
      })}</div>}</section>)}{!params.some(p=>mods.has(p.module as AppModule))&&<p>Aucun paramètre proposé pour les modules retenus.</p>}</>;
  }
  if (step === 'vocabulary') return <><div className="ds-form-grid">{VOCAB.map(v => input(v.key,v.designates))}</div><div className="wz-recommend"><strong>Aperçu</strong><p>{text(data.production_plans)} · {text(data.recipe)} · {text(data.reserve_zone)}</p></div></>;
  if (step === 'interfaces') {
    const prefs=catalog?.interfacePreferences;
    const mods=new Set(list(draftData('modules',answers,catalog,company).selected));
    const workspace=parseWorkspace(data.workspace)??prefs?.values.workspace??'sector';
    const density=parseTableDensity(data.density)??prefs?.values.density??'standard';
    return <><p className="wz-muted">Valeurs par défaut de la société. Chaque utilisateur peut personnaliser son accueil et sa densité sans modifier ses droits.</p>{!prefs?.available&&<div className="ds-alert warning">Préférences indisponibles sur cette installation.</div>}<div className="ds-form-grid"><label className="ds-field"><span>Espace de travail</span><select className="ds-input" value={workspace} disabled={disabled||!prefs?.available} onChange={e=>set('workspace',e.target.value)}>{WORKSPACES.map(w=><option key={w.value} value={w.value} disabled={!!w.module&&!mods.has(w.module)}>{w.label}{w.module&&!mods.has(w.module)?' — module inactif':''}</option>)}</select>{'workspace' in data&&<button type="button" className="odoo-btn-secondary" onClick={()=>unset('workspace')} disabled={disabled}>Annuler la modification</button>}</label><label className="ds-field"><span>Densité des tableaux</span><select className="ds-input" value={density} disabled={disabled||!prefs?.available} onChange={e=>set('density',e.target.value)}>{TABLE_DENSITIES.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>{'density' in data&&<button type="button" className="odoo-btn-secondary" onClick={()=>unset('density')} disabled={disabled}>Annuler la modification</button>}</label></div></>;
  }
  if (step === 'finance') return <><div className="ds-alert info">Les exigences réglementaires restent celles du référentiel en vigueur. Ces réponses ne changent aucune écriture.</div><div className="ds-form-grid">{input('year','Exercice envisagé')}{select('vat','Périodicité TVA envisagée',['Mensuelle','Trimestrielle'])}</div>{toggle('analytics','Comptabilité analytique')}</>;
  if (step === 'roles') {
    const templates = proposedRoleTemplates(answers, catalog, company);
    const modules = new Set(list(draftData('modules', answers, catalog, company).selected));
    const chosen = list(data.selected);
    const scopes = (perms: { scope?: string }[]) => [...new Set(perms.map(p => SCOPE_LABELS[p.scope ?? 'store']))].join(', ');
    return <><p>Rôles proposés selon les secteurs, spécialités et modules retenus. À la publication, seuls les rôles absents sont créés, avec des droits limités aux modules retenus ; les rôles existants ne sont jamais modifiés. Les comptes utilisateurs se créent ensuite dans Utilisateurs.</p>
      {!templates.length ? <div className="ds-alert info">Aucun modèle de rôle pour cette sélection.</div> :
      <div className="ds-panel"><table className="odoo-table"><thead><tr><th style={{ width: 44 }} aria-label="Retenu"></th><th>Rôle</th><th>Accès</th><th style={{ width: 170 }}>Périmètre</th><th style={{ width: 120 }}>État</th></tr></thead><tbody>
        {templates.map(t => {
          const perms = t.permissions.filter(p => !(ACTIVATABLE_MODULES as string[]).includes(p.module) || CORE_MODULES.has(p.module as AppModule) || modules.has(p.module));
          return <tr key={t.code}>
            <td><input type="checkbox" aria-label={`Retenir ${t.label}`} checked={t.exists || chosen.includes(t.code)} disabled={disabled || t.exists} onChange={() => toggleItem('selected', t.code)}/></td>
            <td><strong>{t.label}</strong><small className="wz-muted" style={{ display: 'block' }}>{t.description}</small>
              {t.sod.map(v => <small key={v.code} className={`kl-tag ${v.severity === 'critical' ? 'r' : 'o'}`} style={{ display: 'inline-block', marginTop: 4 }}>Séparation des tâches : {v.label}</small>)}</td>
            <td>{perms.map(p => <small key={p.module} style={{ display: 'block' }}>{MODULE_LABELS[p.module as AppModule] ?? p.module} : {p.rights.split('').map(r => RIGHT_LABELS[r]).filter(Boolean).join(', ')}{p.verbs?.length ? ` + ${p.verbs.map(v => v === 'approve' ? 'approuver' : v === 'post' ? 'comptabiliser' : v).join(', ')}` : ''}</small>)}</td>
            <td>{scopes(perms)}</td>
            <td><span className={`kl-tag ${t.exists ? 'x' : chosen.includes(t.code) ? 'b' : 'x'}`}>{t.exists ? 'Existe déjà' : chosen.includes(t.code) ? 'À créer' : 'Non retenu'}</span></td>
          </tr>;
        })}
      </tbody></table></div>}</>;
  }
  if (step === 'data') return <>{toggle('demo','Prévoir des données de démonstration isolées')}<p className="wz-muted">Aucun fichier ni donnée ne sera importé à ce stade.</p></>;
  return null;
}
