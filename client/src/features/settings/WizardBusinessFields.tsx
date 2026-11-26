import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { storesApi } from '../../api/stores.api';
import { settingsApi } from '../../api/settings.api';
import { BASE_CURRENCY } from '../../api/currencies.api';
import { currencySymbol } from '../../utils/money';
import { Briefcase, Check, Download, Upload, ChefHat, Cross, Factory, Hammer, Info, Layers, LayoutGrid, Lightbulb, Lock, Package, Plus, Shirt, ShoppingCart, Sprout, Store, Truck, TriangleAlert, Utensils } from 'lucide-react';
import { ACTIVATABLE_MODULES, CORE_MODULES, MODULE_GROUPS, MODULE_LABELS, requiredModules, dependentModules, effectiveModules, VOCABULARY_KEYS, WORKSPACES, TABLE_DENSITIES, parseWorkspace, parseTableDensity, type AppModule } from '@ofauria/shared';
import type { WizardAnswers, WizardCatalog, WizardData } from '../../api/wizard.api';
import { Switch } from '../../components/ds/Switch';

/* Contenu des étapes de l'assistant, au gabarit de la maquette validée
   (docs/personnalisation-multisectorielle/maquette/assistant-configuration.html). */

const list = (v: unknown): string[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const VOCAB = VOCABULARY_KEYS.filter(v => ['reserve_zone','ingredient','recipe','production_plan','production_plans','doc_bon_sortie'].includes(v.key));
const STORE_KIND_LABELS: Record<string, string> = { shop: 'Magasin', workshop: 'Site de production', warehouse: 'Dépôt', office: 'Bureau', mixed: 'Magasin et production' };
const SCOPE_LABELS: Record<string, string> = { own: 'Ses dossiers', store: 'Son établissement', all: 'Toute la société' };
const RIGHT_LABELS: Record<string, string> = { v: 'consulter', c: 'créer', e: 'modifier', d: 'supprimer' };
const VERB_LABELS: Record<string, string> = { approve: 'approuver', post: 'comptabiliser' };

export const Tag = ({ tone, children, lock }: { tone: 'g' | 'o' | 'r' | 'b' | 'x'; children: ReactNode; lock?: boolean }) =>
  <span className={`kl-tag ${tone}`}>{lock && <Lock size={11} aria-hidden="true" />}{children}</span>;
export const Alert = ({ tone, icon, children, action }: { tone: 'info' | 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) =>
  <div className={`ds-alert ${tone}`}>{icon ?? <Info size={16} aria-hidden="true" />}<span style={{ flex: 1 }}>{children}</span>{action}</div>;
const Row = ({ title, help, children, off }: { title: ReactNode; help?: ReactNode; children?: ReactNode; off?: boolean }) =>
  <div className={`wz-row${off ? ' off' : ''}`}><div><b>{title}</b>{help && <p>{help}</p>}</div>{children}</div>;
function Segmented({ value, options, onChange, disabled, label }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  return <div className="prj-views" role="group" aria-label={label}>{options.map(o =>
    <button key={o.value} type="button" className={value === o.value ? 'active' : ''} aria-pressed={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

/** Icône d'un profil sectoriel (par famille de code). */
export function profileIcon(code: string, size = 20) {
  if (/boulang|patiss|bouche/.test(code)) return <ChefHat size={size} />;
  if (/agro/.test(code)) return <Package size={size} />;
  if (/negoce|gros|distri|transport/.test(code)) return <Truck size={size} />;
  if (/restau|hotel/.test(code)) return <Utensils size={size} />;
  if (/btp|batiment/.test(code)) return <Hammer size={size} />;
  if (/agri/.test(code)) return <Sprout size={size} />;
  if (/textile/.test(code)) return <Shirt size={size} />;
  if (/services/.test(code)) return <Briefcase size={size} />;
  if (/sante|pharma/.test(code)) return <Cross size={size} />;
  if (/ecommerce/.test(code)) return <ShoppingCart size={size} />;
  if (/detail|commerce/.test(code)) return <Store size={size} />;
  if (/fabric|discret|process|atelier|indus/.test(code)) return <Factory size={size} />;
  return <LayoutGrid size={size} />;
}
export const profileStatus = (status?: string) => status === 'a_valider' ? <Tag tone="o">À valider</Tag> : status === 'nouveau' ? <Tag tone="b">Nouveau profil</Tag> : status === 'sur_demande' ? <Tag tone="x">Sur demande</Tag> : <Tag tone="g">Disponible</Tag>;

/** Capacités proposées par défaut : actives aujourd'hui si le secteur ne change pas, sinon
 *  celles des profils retenus et du socle. */
function defaultCapabilities(catalog: WizardCatalog | undefined, profiles: WizardCatalog['profiles'], unchanged: boolean): string[] {
  if (unchanged) return catalog?.activeCapabilities ?? [];
  // Socle (default_on) moins ce que tous les profils retenus éteignent par défaut (mig 711).
  const off = (code: string) => profiles.length > 0 && profiles.every(p => (p.offFeatures ?? []).includes(code) && !p.features.includes(code));
  return [...new Set([...profiles.flatMap(p => p.features), ...(catalog?.capabilities ?? []).filter(c => c.default_on && !off(c.code)).map(c => c.code)])];
}
/** Une capacité et, récursivement, celles dont elle a besoin. */
function withRequirements(code: string, catalog: WizardCatalog | undefined, out = new Set<string>()): Set<string> {
  if (out.has(code)) return out;
  out.add(code);
  for (const r of catalog?.capabilities?.find(c => c.code === code)?.requires ?? []) withRequirements(r, catalog, out);
  return out;
}
/** Capacités qui dépendent, directement ou non, de celle-ci. */
function dependentCapabilities(code: string, catalog: WizardCatalog | undefined, active: Set<string>): string[] {
  const out = new Set<string>();
  const walk = (k: string) => (catalog?.capabilities ?? []).filter(c => c.requires.includes(k) && active.has(c.code) && !out.has(c.code)).forEach(c => { out.add(c.code); walk(c.code); });
  walk(code);
  return [...out];
}

/** Profils du brouillon (principal + complémentaires) et modules qu'ils recommandent. */
export function draftProfiles(answers: WizardAnswers, catalog: WizardCatalog | undefined) {
  const primary = text(answers.sector?.data?.primary) || catalog?.currentSector || '';
  const secondary = list(answers.sector?.data?.secondary ?? catalog?.currentSecondary).filter(c => c !== primary);
  const profiles = catalog?.profiles.filter(p => p.code === primary || secondary.includes(p.code)) ?? [];
  return { primary, secondary, profiles, main: catalog?.profiles.find(p => p.code === primary), recommended: new Set(effectiveModules(profiles.flatMap(p => p.modules), {}) as Iterable<string>) };
}

/** Lot 11 : modèles de rôles adaptés aux secteurs (et ascendants), spécialités et modules du brouillon. */
export function proposedRoleTemplates(answers: WizardAnswers, catalog: WizardCatalog | undefined, company: string) {
  const { profiles } = draftProfiles(answers, catalog);
  const lineage = new Set(profiles.flatMap(p => p.lineage));
  const modules = list(draftData('modules', answers, catalog, company).selected);
  const specialties = list(draftData('specialties', answers, catalog, company).selected);
  return (catalog?.roleTemplates ?? []).filter(t => (!t.sector_code || lineage.has(t.sector_code))
    && (!t.specialization_code || specialties.includes(t.specialization_code))
    && t.requires_modules.every(m => modules.includes(m)));
}

export function draftData(step: string, answers: WizardAnswers, catalog: WizardCatalog | undefined, company: string): WizardData {
  const { primary, secondary, profiles, recommended } = draftProfiles(answers, catalog);
  let defaults: WizardData = {};
  if (step === 'company') defaults = { name: company, locale:'fr',timezone:'Africa/Casablanca',...catalog?.company,country:catalog?.country??'',currency:catalog?.currency??'' };
  if (step === 'sector') defaults = { primary, secondary };
  if (step === 'specialties') defaults = { selected: catalog?.specialties.filter(s => s.enabled && profiles.some(p => p.lineage.includes(s.sector))).map(s => s.code) ?? [] };
  if (step === 'modules') {
    const unchanged = !!catalog && primary === catalog.currentSector && JSON.stringify([...secondary].sort()) === JSON.stringify([...(catalog.currentSecondary ?? [])].sort());
    defaults = { selected: unchanged ? catalog!.modules : [...recommended], features: defaultCapabilities(catalog, profiles, unchanged) };
  }
  if (step === 'vocabulary') defaults = Object.fromEntries(VOCAB.map(v => [v.key, profiles.find(p => p.code === primary)?.labels?.[v.key] ?? v.fallback]));
  if (step === 'roles') defaults = { selected: proposedRoleTemplates(answers,catalog,company).filter(t => !t.exists).map(t => t.code) };
  if (step === 'data') defaults = { referentials: true, demo: false };
  return { ...defaults, ...answers[step]?.data };
}

/** Aperçu de l'espace de travail (bandeau, menu, accueil), comme dans la maquette. */
export function PreviewBox({ answers, catalog, company }: { answers: WizardAnswers; catalog: WizardCatalog | undefined; company: string }) {
  const order = MODULE_GROUPS.flatMap(g => g.modules as string[]);
  const modules = list(draftData('modules', answers, catalog, company).selected).filter(m => !CORE_MODULES.has(m as AppModule))
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const voc = draftData('vocabulary', answers, catalog, company);
  const name = text(draftData('company', answers, catalog, company).name) || 'Kalum';
  const prod = modules.includes('production');
  const menu = (m: string) => m === 'stock' && text(voc.reserve_zone) ? `Stock — ${text(voc.reserve_zone).toLowerCase()}` : m === 'recipes' && text(voc.recipe) ? text(voc.recipe) : m === 'production' && text(voc.production_plans) ? `Production — ${text(voc.production_plans).toLowerCase()}` : MODULE_LABELS[m as AppModule] ?? m;
  return <div className="wz-prev"><div className="wz-prev-top"><LayoutGrid size={14} aria-hidden="true" />{name.toUpperCase()} / {prod ? 'Production' : 'Accueil'}</div>
    <div className="wz-prev-body"><nav aria-label="Menu prévu">{modules.slice(0, 8).map(m => <span key={m}>{menu(m)}</span>)}</nav>
      <div><b className="ds-subhead">{prod ? `${text(voc.production_plans) || 'Plans de production'} du jour` : 'Vue d’ensemble'}</b>
        <div className="wz-prev-kpis"><div>À traiter<strong>12</strong></div><div>Terminés<strong>24</strong></div></div><span className="mq-sub">Aperçu illustratif, données fictives</span></div></div></div>;
}

export default function WizardBusinessFields({ step, answers, catalog, company, disabled, onChange }: {
  step: string; answers: WizardAnswers; catalog: WizardCatalog | undefined; company: string; disabled: boolean; onChange: (data: WizardData) => void;
}) {
  const navigate = useNavigate();
  const stores = useQuery({ queryKey: ['stores'], queryFn: storesApi.list, enabled: step === 'company' });
  const starterSector = text(answers.sector?.data?.primary) || catalog?.currentSector || '';
  const starter = useQuery({ queryKey: ['sector-starter', starterSector], queryFn: () => settingsApi.sectorStarter(starterSector), enabled: step === 'data' && !!starterSector });
  const [search, setSearch] = useState('');
  const [showAllTerms, setShowAllTerms] = useState(false);
  const download = async (entity: string) => {
    const { blob, filename } = await settingsApi.download(`import/${entity}/template`);
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };
  const [note, setNote] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const data = draftData(step, answers, catalog, company);
  const set = (key: string, value: WizardData[string]) => onChange({ ...data, [key]: value });
  const unset = (key: string) => { const next = { ...data }; delete next[key]; onChange(next); };
  const toggleItem = (key: string, id: string) => { const values = list(data[key]); set(key, values.includes(id) ? values.filter(v => v !== id) : [...values, id]); };
  const field = (label: string, control: ReactNode, hint?: string, req?: boolean) =>
    <div className="ds-field"><label>{label}{req && <span aria-hidden="true" style={{ color: 'var(--ds-danger)' }}> *</span>}</label>{control}{hint && <span className="ds-field-hint">{hint}</span>}</div>;
  const select = (key: string, options: { value: string; label: string }[], lock = false) =>
    <select className="ds-input" aria-label={key} disabled={disabled || lock} value={text(data[key])} onChange={e => set(key, e.target.value)}>
      {!options.some(o => o.value === text(data[key])) && <option value={text(data[key])}>{text(data[key]) || 'À choisir'}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  const { primary, profiles, main, recommended } = draftProfiles(answers, catalog);

  if (step === 'company') {
    const name = text(data.name);
    // Établissements préparés (lot 3) : créés à l'activation.
    const newStores = [...new Set(Object.keys(data).map(k => /^store:(\d{1,2}):/.exec(k)?.[1]).filter((x): x is string => !!x).map(Number))].sort((a, b) => a - b);
    return <>
      <fieldset className="ds-fieldset"><legend className="ds-subhead">Identité</legend><div className="ds-form-grid">
        {field('Raison sociale', <input className="ds-input" value={name} aria-invalid={!name.trim()} disabled={disabled} onChange={e => set('name', e.target.value)} />, name.trim() ? undefined : 'Saisissez la raison sociale.', true)}
        {field('Forme juridique', select('legalForm', ['SARL', 'SARL AU', 'SA', 'SAS', 'Entreprise individuelle', 'Coopérative'].map(v => ({ value: v, label: v }))))}
        {field('Pays et juridiction fiscale', select('country', [{ value: text(data.country), label: text(data.country) === 'MA' ? 'Maroc' : text(data.country) }], true), 'Pose le plan comptable, la TVA et la paie. Ne se change pas depuis l’assistant.', true)}
        {field('Devise principale', select('currency', [{ value: text(data.currency), label: text(data.currency) === BASE_CURRENCY ? `Dirham marocain (${currencySymbol()})` : text(data.currency) }], true), 'Ne se change plus après la première écriture.', true)}
        {field('Langue', select('locale', [{ value: 'fr', label: 'Français' }, { value: 'ar', label: 'Arabe' }, { value: 'en', label: 'Anglais' }]))}
        {field('Fuseau horaire', select('timezone', [{ value: 'Africa/Casablanca', label: 'Casablanca (UTC+1)' }, { value: 'Europe/Paris', label: 'Paris' }, { value: 'America/Toronto', label: 'Toronto' }]))}
        {field('Taille de l’entreprise', select('size', [{ value: 'TPE', label: '1 à 9 salariés (TPE)' }, { value: 'PME', label: '10 à 249 salariés (PME)' }, { value: 'Grande entreprise', label: '250 salariés et plus' }]), 'Sert aux recommandations de modules et de rôles.')}
        {field('Nombre d’établissements', <input className="ds-input" type="number" min={1} value={text(data.sites)} disabled={disabled} onChange={e => set('sites', e.target.value)} />, 'Magasins, sites de production, dépôts. Ils se créent dans Paramètres › Établissements.')}
      </div></fieldset>
      <div><div className="ds-section-head" style={{ marginBottom: 8 }}><h2 style={{ fontSize: 14 }}>Établissements</h2><small>Magasins, sites de production, dépôts</small><span className="ds-grow" style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={disabled} onClick={() => { const next = Math.max(0, ...newStores) + 1; onChange({ ...data, [`store:${next}:name`]: '', [`store:${next}:kind`]: 'shop' }); }}><Plus size={13} aria-hidden="true" /> Ajouter</button></div>
        <div className="ds-scroll"><table className="odoo-table ds-dense" style={{ width: '100%' }}><thead><tr><th>Nom</th><th>Type</th><th>Adresse</th><th style={{ width: 110 }}>État</th></tr></thead><tbody>
          {(stores.data as { id: string; name: string; kind?: string; address?: string | null; is_active?: boolean }[] | undefined ?? []).map(s => <tr key={s.id}>
            <td className="ds-strong">{s.name}</td><td>{STORE_KIND_LABELS[s.kind ?? ''] ?? s.kind ?? '—'}</td>
            <td>{s.address || '—'}</td><td>{s.is_active === false ? <Tag tone="x">Inactif</Tag> : <Tag tone="g">Actif</Tag>}</td></tr>)}
          {stores.isLoading && <tr><td colSpan={4} className="mq-sub">Chargement…</td></tr>}
          {newStores.map(i => <tr key={`new-${i}`}>
            <td><input className="ds-input sm" style={{ width: '100%' }} aria-label="Nom du nouvel établissement" placeholder="Nom" value={text(data[`store:${i}:name`])} disabled={disabled} onChange={e => set(`store:${i}:name`, e.target.value)} /></td>
            <td><select className="ds-input sm" aria-label="Type" value={text(data[`store:${i}:kind`]) || 'shop'} disabled={disabled} onChange={e => set(`store:${i}:kind`, e.target.value)}>
              {Object.entries(STORE_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
            <td><input className="ds-input sm" style={{ width: '100%' }} aria-label="Ville" placeholder="Ville" value={text(data[`store:${i}:city`])} disabled={disabled} onChange={e => set(`store:${i}:city`, e.target.value)} /></td>
            <td><span className="wz-control"><Tag tone="b">À créer</Tag><button type="button" className="odoo-btn-link" disabled={disabled} onClick={() => { const n = { ...data }; for (const f of ['name', 'kind', 'city']) delete n[`store:${i}:${f}`]; onChange(n); }}>Retirer</button></span></td></tr>)}
        </tbody></table></div></div>
    </>;
  }

  if (step === 'sector') {
    const current = [catalog?.currentSector, ...(catalog?.currentSecondary ?? []), text(data.primary), ...list(data.secondary)];
    const all = (catalog?.profiles ?? []).filter(p => p.wizard || current.includes(p.code));
    const shown = all.filter(p => `${p.label} ${p.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
    const secondary = list(data.secondary);
    return <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input type="search" className="ds-input" placeholder="Rechercher un secteur…" aria-label="Rechercher un secteur" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
        <Tag tone="b">{all.length} secteurs</Tag></div>
      <div className="wz-cards">{shown.map(p => {
        const on = data.primary === p.code, sec = secondary.includes(p.code);
        return <button key={p.code} type="button" className={`wz-card${on ? ' on' : sec ? ' second' : ''}`} aria-pressed={on} disabled={disabled}
          onClick={() => onChange({ ...data, primary: p.code, secondary: secondary.filter(v => v !== p.code) })}>
          <span className="wz-ico">{profileIcon(p.code)}</span>
          <span className="wz-txt"><b>{p.label}</b><small>{p.description || `${p.modules.length} modules préréglés.`}</small>
            <span className="wz-tags">{profileStatus(p.status)}{sec && <Tag tone="x">Complémentaire</Tag>}</span></span>
          <span className="wz-tick">{on && <Check size={11} />}</span></button>;
      })}
        <button type="button" className="wz-card dashed" onClick={() => navigate('/settings?page=sector')}><span className="wz-ico"><Plus size={20} /></span>
          <span className="wz-txt"><b>Profil personnalisé</b><small>Créé à partir d’un profil existant, sans développement.</small></span></button></div>
      <div><h3 className="ds-subhead">Activités complémentaires</h3><div className="wz-checks">{all.filter(p => p.code !== data.primary).map(p =>
        <label key={p.code}><input type="checkbox" disabled={disabled} checked={secondary.includes(p.code)} onChange={() => toggleItem('secondary', p.code)} /> {p.label}</label>)}</div></div>
    </>;
  }

  if (step === 'specialties') {
    const selected = list(data.selected);
    const groups = profiles.map(p => ({ p, items: (catalog?.specialties ?? []).filter(s => p.lineage.includes(s.sector)) }))
      .filter((g, i, arr) => g.items.length && arr.findIndex(x => x.items.map(s => s.code).join() === g.items.map(s => s.code).join()) === i);
    const offered = new Set(groups.flatMap(g => g.items.map(s => s.code)));
    const stale = selected.filter(c => !offered.has(c));
    const staleAlert = stale.length > 0 && <Alert tone="warning" icon={<TriangleAlert size={16} />} action={<button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={disabled} onClick={() => set('selected', selected.filter(c => offered.has(c)))}>Retirer</button>}>
      {stale.length} spécialité{stale.length > 1 ? 's' : ''} d’un secteur qui n’est plus retenu : {stale.map(c => catalog?.specialties.find(s => s.code === c)?.label ?? c).join(', ')}.</Alert>;
    if (!groups.length) return <Alert tone="warning" icon={<TriangleAlert size={16} />}>Le profil « {main?.label ?? primary} » n’a pas encore de spécialités. L’assistant applique le socle commun ; vous pourrez enregistrer votre configuration comme profil.</Alert>;
    return <>{staleAlert}{groups.map(({ p, items }) => {
      const n = items.filter(s => selected.includes(s.code)).length;
      return <div key={p.code} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h3 className="ds-subhead" style={{ margin: 0 }}>{p.code === primary ? p.label : `Activité secondaire — ${p.label}`}</h3><span style={{ flex: 1 }} /><Tag tone="b">{n} sélectionnée{n > 1 ? 's' : ''}</Tag></div>
        <div className="wz-cards">{items.map(s => {
          const on = selected.includes(s.code);
          return <button key={s.code} type="button" className={`wz-card${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => toggleItem('selected', s.code)}>
            <span className="wz-ico"><Layers size={20} /></span><span className="wz-txt"><b>{s.label}</b><small>{s.description ?? ''}</small></span>
            <span className="wz-tick">{on && <Check size={11} />}</span></button>;
        })}</div></div>;
    })}</>;
  }

  if (step === 'modules') {
    const selected = new Set(list(data.selected));
    const known = new Set<string>(MODULE_GROUPS.flatMap(g => g.modules));
    const groups = [...MODULE_GROUPS.filter(g => g.key !== 'core'), { key: 'other', label: 'Autres', modules: ACTIVATABLE_MODULES.filter(m => !known.has(m) && !CORE_MODULES.has(m)) }]
      .map(g => ({ ...g, modules: g.modules.filter(m => (ACTIVATABLE_MODULES as string[]).includes(m)) })).filter(g => g.modules.length);
    const missing = [...recommended].filter(m => !selected.has(m) && !CORE_MODULES.has(m as AppModule) && (ACTIVATABLE_MODULES as string[]).includes(m));
    const caps = new Set(list(data.features));
    const switchCapability = (code: string, on: boolean) => {
      const next = new Set(caps);
      const label = (k: string) => catalog?.capabilities?.find(c => c.code === k)?.label ?? k;
      if (on) {
        const added = [...withRequirements(code, catalog)].filter(k => !next.has(k) && k !== code);
        withRequirements(code, catalog).forEach(k => next.add(k));
        setNote(added.length ? { tone: 'info', text: `« ${label(code)} » a besoin de ${added.map(label).join(', ')} : activé${added.length > 1 ? 'es' : 'e'} en même temps.` } : null);
      } else {
        const removed = dependentCapabilities(code, catalog, next);
        [code, ...removed].forEach(k => next.delete(k));
        setNote(removed.length ? { tone: 'info', text: `« ${label(code)} » retirée : ${removed.map(label).join(', ')} en dépend${removed.length > 1 ? 'ent' : ''} et ${removed.length > 1 ? 'sont retirées' : 'est retirée'} aussi.` } : null);
      }
      set('features', [...next]);
    };
    const switchModule = (m: AppModule, on: boolean) => {
      const next = new Set(selected);
      if (on) {
        const added = requiredModules(m).filter(x => !next.has(x));
        [m, ...added].forEach(x => next.add(x));
        setNote(added.length ? { tone: 'info', text: `« ${MODULE_LABELS[m]} » a besoin de ${added.map(x => MODULE_LABELS[x]).join(', ')} : activé${added.length > 1 ? 's' : ''} en même temps.` } : null);
      } else {
        const dependents = dependentModules(m).filter(x => next.has(x));
        if (dependents.length) { setNote({ tone: 'danger', text: `« ${MODULE_LABELS[m]} » ne peut pas être retiré : ${dependents.map(x => MODULE_LABELS[x]).join(', ')} en ${dependents.length > 1 ? 'ont' : 'a'} besoin. Retirez d’abord ${dependents.length > 1 ? 'ces modules' : 'ce module'}.` }); return; }
        next.delete(m); setNote(null);
      }
      set('selected', [...next]);
    };
    return <>
      {note && <Alert tone={note.tone} icon={note.tone === 'danger' ? <TriangleAlert size={16} /> : undefined}>{note.text}</Alert>}
      {missing.length > 0 && <Alert tone="info" icon={<Lightbulb size={16} />} action={<button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={disabled}
        onClick={() => { const next = new Set(selected); missing.forEach(m => [m, ...requiredModules(m as AppModule)].forEach(x => next.add(x))); setNote(null); set('selected', [...next]); }}>Activer</button>}>
        {missing.length} module{missing.length > 1 ? 's recommandés ne sont pas activés' : ' recommandé n’est pas activé'} : {missing.map(m => MODULE_LABELS[m as AppModule]).join(', ')}.</Alert>}
      {groups.map(g => <div key={g.key}><h3 className="ds-subhead" style={{ marginBottom: 2 }}>{g.label}</h3>{g.modules.map(m => {
        const core = CORE_MODULES.has(m), on = core || selected.has(m), reco = recommended.has(m), deps = requiredModules(m);
        const tag = core ? <Tag tone="x" lock>Obligatoire</Tag> : reco ? <Tag tone="b">Recommandé</Tag> : <Tag tone="x">Facultatif</Tag>;
        const subs = on ? (catalog?.capabilities ?? []).filter(c => c.module === m) : [];
        return <Row key={m} title={<>{MODULE_LABELS[m]} {tag}</>} help={<>{deps.length ? `A besoin de : ${deps.map(x => MODULE_LABELS[x]).join(', ')}.` : null}
          {subs.length > 0 && <span className="wz-subs">{subs.map(c => <label key={c.code} title={c.description ?? undefined}>
            <Switch label={c.label} checked={caps.has(c.code)} disabled={disabled} onChange={v => switchCapability(c.code, v)} />{c.label}{c.kind === 'reglementaire' && <Lock size={11} aria-label="Réglementaire" style={{ color: 'var(--ds-warning)' }} />}</label>)}</span>}</>}>
          <Switch label={MODULE_LABELS[m]} checked={on} disabled={disabled || core} onChange={v => switchModule(m, v)} /></Row>;
      })}</div>)}
    </>;
  }

  if (step === 'operations' || step === 'rules') {
    const mods = new Set(list(draftData('modules', answers, catalog, company).selected) as AppModule[]);
    const params = (catalog?.parameters ?? []).filter(p => p.step === step && mods.has(p.module as AppModule));
    const orphaned = Object.keys(data).filter(key => !key.startsWith('approval:') && !params.some(p => p.fields.some(f => `${p.key}:${f.name}` === key)));
    const byModule = [...new Set(params.map(p => p.module))];
    // Le rythme propose l'horizon du plan directeur qui lui correspond (modifiable ensuite).
    const RHYTHM_HORIZON: Record<string, number> = { artisanal: 3, industrial: 14, continuous: 28 };
    const setField = (id: string, v: WizardData[string]) => {
      if (id === 'production.rhythm:mode' && typeof v === 'string' && RHYTHM_HORIZON[v] && params.some(p => p.key === 'production.mrp_horizon'))
        onChange({ ...data, [id]: v, 'production.mrp_horizon:days': String(RHYTHM_HORIZON[v]) });
      else set(id, v);
    };
    return <>
      {orphaned.length > 0 && <Alert tone="warning" icon={<TriangleAlert size={16} />}>Choix antérieurs pour des modules retirés : {orphaned.map(key =>
        <span key={key} style={{ display: 'block' }}>{key} : {String(data[key])} <button type="button" className="odoo-btn-link" disabled={disabled} onClick={() => unset(key)}>Retirer du brouillon</button></span>)}</Alert>}
      {!params.length && <Alert tone="info">Aucun réglage proposé pour les modules retenus.</Alert>}
      {byModule.map(module => <div key={module}><h3 className="ds-subhead">{MODULE_LABELS[module as AppModule] ?? module}</h3>
        {params.filter(p => p.module === module && p.key === 'production.flow' && p.value).map(p => {
          // Parcours d'une production, comme la maquette : étapes cliquables, l'ordre toujours présent.
          const val = (name: string) => { const id = `${p.key}:${name}`; return id in data ? data[id] === true : p.value?.[name] === true; };
          const voc = draftData('vocabulary', answers, catalog, company);
          const steps: { name: string | null; label: string; hint: string }[] = [
            { name: 'recipe_required', label: text(voc.recipe) || 'Fiche technique', hint: 'pour lancer' },
            { name: 'material_issue_required', label: text(voc.doc_bon_sortie) || 'Bon de sortie des matières', hint: 'avant de démarrer' },
            { name: null, label: text(voc.production_plan) || 'Ordre de fabrication', hint: 'toujours présent' },
            { name: 'quality_before_transfer', label: 'Contrôle qualité', hint: 'avant transfert' },
            { name: 'transfer_reception', label: 'Validation du transfert', hint: 'réception par la boutique' },
          ];
          return <div key={p.key} style={{ display: 'grid', gap: 8, padding: '8px 0 4px' }}><b style={{ color: 'var(--ds-ink)' }}>Parcours d’une production {Object.keys(data).some(k => k.startsWith(`${p.key}:`)) && <Tag tone="o">Modifié</Tag>}</b>
            <p className="mq-sub" style={{ margin: 0 }}>Cliquez une étape pour la rendre obligatoire ou facultative.</p>
            <div className="wz-flow">{steps.map((s, i) => { const on = s.name ? val(s.name) : true;
              return <span key={s.label} style={{ display: 'contents' }}>{i > 0 && <span className="arrow" aria-hidden="true">›</span>}
                <button type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={disabled || !s.name} onClick={() => s.name && set(`${p.key}:${s.name}`, !on)}>{s.label}<small>{s.name ? `${on ? 'obligatoire' : 'facultative'} · ${s.hint}` : s.hint}</small></button></span>; })}</div></div>;
        })}
        {params.filter(p => p.module === module && p.key !== 'production.flow').flatMap(p => p.fields.map((f, fi) => {
          const id = `${p.key}:${f.name}`, draft = id in data, value = draft ? data[id] : p.value?.[f.name], locked = disabled || !p.value;
          const title = <>{p.fields.length > 1 ? `${p.label} — ${f.label}` : p.label}{f.unit ? ` (${f.unit})` : ''} {draft && <Tag tone="o">Modifié</Tag>}</>;
          const control = !p.value ? <Tag tone="x">Indisponible</Tag>
            : f.type === 'boolean' ? <Switch label={f.label} checked={value === true} disabled={locked} onChange={v => set(id, v)} />
            : f.type === 'enum' && (f.options?.length ?? 0) <= 4 ? <Segmented label={f.label} value={String(value ?? '')} options={f.options ?? []} disabled={locked} onChange={v => setField(id, v)} />
            : f.type === 'enum' ? <select aria-label={f.label} className="ds-input" value={String(value ?? '')} disabled={locked} onChange={e => set(id, e.target.value)}>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            : <input aria-label={f.label} className="ds-input" style={{ width: 140 }} type={['number','integer','percent'].includes(f.type) ? 'number' : 'text'} min={f.min} max={f.max} step={f.type === 'integer' ? 1 : 'any'} disabled={locked} value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onChange={e => set(id, e.target.value)} />;
          const synced = id === 'production.mrp_horizon:days' && 'production.rhythm:mode' in data && draft;
          return <Row key={id} title={title} help={fi === 0 ? <>{p.help}{synced && <> Proposé par le rythme choisi.</>}</> : undefined}><span className="wz-control">{control}{draft && <button type="button" className="odoo-btn-link" disabled={disabled} onClick={() => unset(id)}>Annuler</button>}</span></Row>;
        }))}</div>)}
      {step === 'rules' && <>
        {(catalog?.approvalRules?.length ?? 0) > 0 && <div><h3 className="ds-subhead" style={{ marginBottom: 8 }}>Approbations</h3>
          <div className="ds-scroll"><table className="odoo-table ds-dense" style={{ width: '100%' }}><thead><tr><th>Pièce</th><th style={{ width: 210 }}>Condition</th><th>Approbateur</th><th style={{ width: 60 }} aria-label="Active"></th></tr></thead><tbody>
            {catalog!.approvalRules!.map(r => {
              const ek = `approval:${r.code}:enabled`, vk = `approval:${r.code}:value`;
              const on = ek in data ? data[ek] === true : r.enabled;
              const value = vk in data ? text(data[vk]) : String(r.value);
              const changed = ek in data || vk in data;
              return <tr key={r.code}><td className="ds-strong">{r.label} {changed && <Tag tone="o">Modifié</Tag>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.op === 'gte' ? 'à partir de' : 'au-delà de'} <input className="ds-input sm" style={{ width: 90, display: 'inline-block' }} inputMode="decimal" aria-label={`Seuil — ${r.label}`} value={value} disabled={disabled || !on} onChange={e => set(vk, e.target.value)} /> {r.unit}</td>
                <td>{r.approver ?? '—'}</td>
                <td><Switch label={r.label} checked={on} disabled={disabled} onChange={v => set(ek, v)} /></td></tr>;
            })}
          </tbody></table></div>
          <p className="mq-sub" style={{ margin: '6px 0 0' }}>Approbateurs et circuits à plusieurs niveaux : <button type="button" className="odoo-btn-link" onClick={() => navigate('/settings?page=approvals')}>Circuits d’approbation</button>.</p></div>}
        <div><h3 className="ds-subhead">Automatismes</h3>
          <Row title={<>Numérotation des documents <Tag tone="o" lock>Réglementaire</Tag></>} help="Préfixe, année et compteur par type de pièce et par établissement ; sans rupture pour les factures.">
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/settings?page=numbering')}>Régler</button></Row>
          <Row title="Comptabilisation automatique" help="Chaque pièce validée passe son écriture au grand livre.">
            <Switch label="Comptabilisation automatique" checked disabled onChange={() => undefined} /></Row>
        </div>
      </>}
    </>;
  }

  if (step === 'vocabulary') {
    const proposed = (key: string, fallback: string) => main?.labels?.[key] ?? fallback;
    return <>
      <div className="ds-scroll"><table className="odoo-table" style={{ width: '100%' }}><thead><tr><th>Terme générique</th><th>Proposé par le profil</th><th style={{ width: '38%' }}>Votre terme</th><th style={{ width: 90 }}></th></tr></thead><tbody>
        {(showAllTerms ? VOCABULARY_KEYS : VOCAB).map(v => { const val = v.key in data ? text(data[v.key]) : proposed(v.key, v.fallback), changed = val !== proposed(v.key, v.fallback);
          return <tr key={v.key}><td className="ds-strong">{v.designates}</td><td>{proposed(v.key, v.fallback)}</td>
            <td><input className="ds-input sm" style={{ width: '100%' }} aria-label={`Terme pour ${v.designates}`} value={val} disabled={disabled} onChange={e => set(v.key, e.target.value)} /></td>
            <td>{changed && <Tag tone="o">Modifié</Tag>}</td></tr>; })}
      </tbody></table></div>
      <div className="wz-bar"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setShowAllTerms(v => !v)}>{showAllTerms ? `Termes principaux (${VOCAB.length})` : `Tous les termes (${VOCABULARY_KEYS.length})`}</button>
        <span className="mq-sub">Les mots changent à l’écran, sur les documents et les rapports.</span></div>
    </>;
  }

  if (step === 'interfaces') {
    const prefs = catalog?.interfacePreferences;
    const mods = new Set(list(draftData('modules', answers, catalog, company).selected));
    const workspace = parseWorkspace(data.workspace) ?? prefs?.values.workspace ?? 'sector';
    const density = parseTableDensity(data.density) ?? prefs?.values.density ?? 'standard';
    return <>
      <PreviewBox answers={answers} catalog={catalog} company={company} />
      {!prefs?.available && <Alert tone="warning" icon={<TriangleAlert size={16} />}>Préférences indisponibles sur cette installation.</Alert>}
      <div>
        <Row title={<>Espace de travail par défaut {'workspace' in data && <Tag tone="o">Modifié</Tag>}</>} help="L’écran d’accueil de la société ; chaque utilisateur peut choisir le sien sans changer ses droits.">
          <select className="ds-input" style={{ width: 240 }} aria-label="Espace de travail" value={workspace} disabled={disabled || !prefs?.available} onChange={e => set('workspace', e.target.value)}>
            {WORKSPACES.map(w => <option key={w.value} value={w.value} disabled={!!w.module && !mods.has(w.module)}>{w.label}{w.module && !mods.has(w.module) ? ' — module inactif' : ''}</option>)}</select></Row>
        <Row title={<>Densité des tableaux {'density' in data && <Tag tone="o">Modifié</Tag>}</>} help="Standard ou compacte, pour toutes les listes.">
          <Segmented label="Densité des tableaux" value={density} options={TABLE_DENSITIES.map(d => ({ value: d.value, label: d.label }))} disabled={disabled || !prefs?.available} onChange={v => set('density', v)} /></Row>
      </div>
      {(() => {
        const chosen = list(draftData('roles', answers, catalog, company).selected);
        const roles = proposedRoleTemplates(answers, catalog, company).filter(t => t.exists || chosen.includes(t.code));
        const home = (route: string | null) => {
          const m = (route ?? '/').split('/')[1] ?? '';
          const map: Record<string, [string, string]> = {
            '': ['Tableau de bord général', 'Chiffre d’affaires, marge, trésorerie'], pos: ['Caisse', 'Ventes du jour, fond de caisse'],
            production: ['Poste de production', `${text(draftData('vocabulary', answers, catalog, company).production_plans) || 'Ordres'} du jour, matières à sortir`],
            purchasing: ['Poste de travail achats', 'À commander, réceptions attendues'], accounting: ['Tableau de bord comptable', 'À comptabiliser, échéances'],
            stock: ['Stock', 'Ruptures, péremptions proches'], sales: ['Tableau de bord des ventes', 'Devis à relancer, encours'],
            controle: ['Contrôle et qualité', 'Lots retenus, contrôles à faire'], maintenance: ['Maintenance', 'Interventions ouvertes, équipements'],
            projects: ['Mes projets', 'Temps à saisir, jalons'], employees: ['Personnel', 'Pointage, absences, paie'],
          };
          return map[m] ?? [MODULE_LABELS[m as AppModule] ?? m, '—'];
        };
        return roles.length > 0 && <div className="ds-scroll"><table className="odoo-table" style={{ width: '100%' }}><thead><tr><th>Rôle</th><th>Écran d’accueil</th><th>Indicateurs et raccourcis</th></tr></thead><tbody>
          {roles.map(t => { const [screen, kpis] = home(t.home_route); return <tr key={t.code}><td className="ds-strong">{t.label}</td><td>{screen}</td><td>{kpis}</td></tr>; })}
        </tbody></table></div>;
      })()}
      <p className="mq-sub" style={{ margin: 0 }}>Tous les écrans gardent le même gabarit Kalum.</p>
    </>;
  }

  if (step === 'finance') {
    const mods = new Set(list(draftData('modules', answers, catalog, company).selected));
    return <>
      <Alert tone="info">Les obligations légales viennent du pays ; l’assistant ne modifie aucune écriture ni aucun taux légal.</Alert>
      <div>
        <Row title={<>Plan comptable <Tag tone="o" lock>Réglementaire</Tag></>} help="Plan comptable marocain (CGNC). Vous pouvez ajouter des sous-comptes, pas retirer les comptes du plan." />
        <Row title="Journaux" help={`Achats, ventes, banque, caisse${mods.has('employees') ? ', paie' : ''}, opérations diverses${mods.has('production') ? ', production' : ''}.`}><Tag tone="g">Créés par le profil</Tag></Row>
        <Row title={<>TVA <Tag tone="o" lock>Réglementaire</Tag></>} help="Taux légaux datés. Régime de déclaration : l’écran TVA calcule sur un mois ou sur un trimestre.">
          {(() => { const p = catalog?.parameters?.find(x => x.key === 'accounting.vat_periodicity'); const id = 'accounting.vat_periodicity:mode';
            return p?.value ? <span className="wz-control"><Segmented label="Régime de TVA" value={text(id in data ? data[id] : p.value.mode) || 'monthly'} options={[{ value: 'monthly', label: 'Mensuelle' }, { value: 'quarterly', label: 'Trimestrielle' }]} disabled={disabled} onChange={v => set(id, v)} />{id in data && <Tag tone="o">Modifié</Tag>}</span> : <Tag tone="x">Indisponible</Tag>; })()}</Row>
        <Row title="Exercice comptable" help={catalog?.finance?.fiscalYear ? `Exercice ${catalog.finance.fiscalYear.year} en cours : du ${new Date(catalog.finance.fiscalYear.start).toLocaleDateString('fr-FR')} au ${new Date(catalog.finance.fiscalYear.end).toLocaleDateString('fr-FR')}. Les exercices et leur clôture se gèrent en comptabilité.` : 'Aucun exercice ouvert couvrant la date du jour : à ouvrir en comptabilité.'}>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/accounting?tab=cloture')}>Voir les exercices</button></Row>
        <Row title="Comptabilité analytique" help={catalog?.finance?.analyticAxes ? `${catalog.finance.analyticAxes} axe${catalog.finance.analyticAxes > 1 ? 's' : ''} analytique${catalog.finance.analyticAxes > 1 ? 's' : ''} actif${catalog.finance.analyticAxes > 1 ? 's' : ''} ; centres de coûts par établissement et par atelier.` : 'Aucun axe analytique actif.'}>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/accounting?tab=costcenters')}>Régler l’analytique</button></Row>
        <Row title={<>Clôture <Tag tone="o" lock>Réglementaire</Tag></>} help="Une période fermée n’accepte plus d’écriture ; les contrôles de clôture légaux ne se désactivent pas.">
          <Switch label="Contrôles de clôture" checked disabled onChange={() => undefined} /></Row>
      </div>
    </>;
  }

  if (step === 'roles') {
    const templates = proposedRoleTemplates(answers, catalog, company);
    const modules = new Set(list(draftData('modules', answers, catalog, company).selected));
    const chosen = list(data.selected);
    const hasAccounting = templates.some(t => t.code === 'comptable' && (t.exists || chosen.includes(t.code)));
    return <>
      {!templates.length ? <Alert tone="info">Aucun modèle de rôle pour cette sélection.</Alert> :
        <div className="ds-scroll"><table className="odoo-table ds-dense" style={{ width: '100%' }}><thead><tr><th style={{ width: 36 }} aria-label="Retenu"></th><th>Rôle proposé</th><th>Accès principaux</th><th style={{ width: 160 }}>Périmètre</th><th style={{ width: 110 }}>État</th></tr></thead><tbody>
          {templates.map(t => {
            const perms = t.permissions.filter(p => !(ACTIVATABLE_MODULES as string[]).includes(p.module) || CORE_MODULES.has(p.module as AppModule) || modules.has(p.module));
            // Périmètre du module principal du rôle (le premier déclaré), comme dans la maquette.
            const scopes = SCOPE_LABELS[perms[0]?.scope ?? 'store'];
            const byRights = new Map<string, string[]>();
            for (const p of perms) {
              const key = p.rights.split('').map(r => RIGHT_LABELS[r]).filter(Boolean).join(', ');
              byRights.set(key, [...(byRights.get(key) ?? []), MODULE_LABELS[p.module as AppModule] ?? p.module]);
            }
            const verbs = perms.flatMap(p => (p.verbs ?? []).map(v => `${VERB_LABELS[v] ?? v} (${MODULE_LABELS[p.module as AppModule] ?? p.module})`));
            const on = t.exists || chosen.includes(t.code);
            return <tr key={t.code}>
              <td><input type="checkbox" aria-label={`Retenir ${t.label}`} checked={on} disabled={disabled || t.exists} onChange={() => toggleItem('selected', t.code)} /></td>
              <td className="ds-strong">{t.label}<div className="mq-sub">{t.description}</div>{t.sod.map(v => <div key={v.code} style={{ marginTop: 4 }}><Tag tone={v.severity === 'critical' ? 'r' : 'o'}>Séparation des tâches : {v.label}</Tag></div>)}</td>
              <td>{[...byRights].map(([rights, mods]) => <div key={rights}><span style={{ color: 'var(--ds-muted)' }}>{rights.charAt(0).toUpperCase() + rights.slice(1)} :</span> {mods.join(', ')}</div>)}
                {verbs.length > 0 && <div><span style={{ color: 'var(--ds-muted)' }}>Valide :</span> {verbs.join(', ')}</div>}</td>
              <td>{scopes}</td>
              <td>{t.exists ? <Tag tone="x">Existe déjà</Tag> : on ? <Tag tone="b">À créer</Tag> : <Tag tone="x">Non retenu</Tag>}</td></tr>;
          })}</tbody></table></div>}
      {modules.has('accounting') && !hasAccounting && templates.some(t => t.code === 'comptable') && <Alert tone="warning" icon={<TriangleAlert size={16} />}
        action={<button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={disabled} onClick={() => toggleItem('selected', 'comptable')}>Ajouter le rôle</button>}>
        Séparation des tâches : sans rôle comptable, la personne qui saisit une facture pourra aussi la payer.</Alert>}
      <p className="mq-sub" style={{ margin: 0 }}>Seuls les rôles absents sont créés, avec des droits limités aux modules retenus ; un rôle existant n’est jamais modifié. Les utilisateurs se créent ensuite dans Utilisateurs et droits.</p>
    </>;
  }

  if (step === 'data') {
    const mods = new Set(list(draftData('modules', answers, catalog, company).selected));
    const items = ([
      ['suppliers', 'Fournisseurs', 'Doublons détectés sur l’ICE et le nom', mods.has('purchasing')],
      ['customers', 'Clients', 'Doublons détectés sur l’e-mail et le téléphone', mods.has('customers') || mods.has('sales')],
      ['ingredients', text(draftData('vocabulary', answers, catalog, company).ingredient) ? `Matières (${text(draftData('vocabulary', answers, catalog, company).ingredient).toLowerCase()})` : 'Matières premières', 'Unités, contenants, fournisseur habituel', mods.has('stock')],
      ['packaging_items', 'Consommables', 'Emballages, fournitures', mods.has('packaging')],
      ['products', 'Produits', 'Prix, catégories, codes', mods.has('products')],
    ] as const).filter(x => x[3]);
    return <>
    <div className="ds-scroll"><table className="odoo-table" style={{ width: '100%' }}><thead><tr><th>Donnée</th><th style={{ width: 150 }}>État</th><th className="ds-actions" style={{ width: 270 }}>Action</th></tr></thead><tbody>
      {items.map(([key, label, hint]) => <tr key={key}><td className="ds-strong">{label}<div className="mq-sub">{hint}</div></td><td><Tag tone="x">À importer</Tag></td>
        <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void download(key)}><Download size={13} aria-hidden="true" /> Modèle de fichier</button> <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/settings?page=data')}><Upload size={13} aria-hidden="true" /> Importer</button></td></tr>)}
    </tbody></table></div>
    <div>
      <Row title="Référentiels du profil" help={<>Créés à l’activation, seulement s’ils manquent ; rien d’existant n’est modifié.{(starter.data?.preview.items ?? []).filter(i => !i.startsWith('Nomenclature de démonstration')).map(i => <span key={i} style={{ display: 'block', marginTop: 2 }}>· {i}</span>)}</>}>
        <Switch label="Référentiels du profil" checked={data.referentials === true} disabled={disabled} onChange={v => set('referentials', v)} /></Row>
      {(() => { const demo = (starter.data?.preview.items ?? []).find(i => i.startsWith('Nomenclature de démonstration'));
        return <Row title="Nomenclature de démonstration" help={demo ? `${demo.replace('Nomenclature de démonstration : ', '')} : un produit, ses matières et sa fiche, pour essayer la production. Ce sont de vraies fiches, à supprimer à la main si vous n’en voulez plus.` : 'Ce profil ne propose pas de nomenclature de démonstration.'} off={!demo}>
          <Switch label="Nomenclature de démonstration" checked={!!demo && data.demo === true && data.referentials === true} disabled={disabled || !demo || data.referentials !== true} onChange={v => set('demo', v)} /></Row>; })()}
    </div>
    <p className="mq-sub" style={{ margin: 0 }}>Chaque import passe par un aperçu et peut être annulé (Paramètres › Données). Importez de préférence après l’activation, pour que les fiches reçoivent les bons modules et libellés.</p>
  </>;
  }

  return null;
}
