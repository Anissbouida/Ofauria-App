import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { allowedSettingsSections } from '@ofauria/shared';
import { settingsApi } from '../../api/settings.api';
import { salesChannelsApi, type SalesChannel } from '../../api/sales-channels.api';
import { Upload, Image, Eye, Check, Search, Lock, Users, ExternalLink, Printer } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import PrinterSettingsCard from './PrinterSettingsCard';
import SachetsTab from './SachetsTab';
import ProductionMarkupTab from './ProductionMarkupTab';
import AuditLogTab from './AuditLogTab';
import NumberingTab from './NumberingTab';
import ParametersPanel from './ParametersPanel';
import CompanyBankAccounts from './CompanyBankAccounts';
import StoresPanel from './StoresPanel';
import TaxCodesTab from './TaxCodesTab';
import CurrenciesTab from './CurrenciesTab';
import MailTab from './MailTab';
import JobsTab from './JobsTab';
import DocumentsTab from './DocumentsTab';
import NotificationsTab from './NotificationsTab';
import DataTab from './DataTab';
import ApprovalsTab from './ApprovalsTab';
import ReferentielTab from './ReferentielTab';
import SettingsSearch from './SettingsSearch';
import SetupHome from './SetupHome';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { SettingsSection, SettingItem } from './SettingsPrimitives';
import { DirtyFormsProvider, SaveBar, useDirtyForm, useDirtyForms, useDraft } from './DirtyForms';
import { HOME_PAGE, SETTINGS_GROUPS, SETTINGS_PAGES, type SearchEntry, type SettingsPageKey } from './settingsPages';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function SettingsPage() {
  const { hasModule } = usePermissions();
  // Acces par le droit « Parametres » (ecran Utilisateurs), eventuellement
  // restreint a certaines sections ; meme regle que le serveur.
  if (!hasModule('settings')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Vous n'avez pas accès aux paramètres.</p>
      </div>
    );
  }
  return (
    <DirtyFormsProvider>
      <SettingsShell />
    </DirtyFormsProvider>
  );
}

/* ============ COQUILLE : navigation groupee, fil d'Ariane, ⌘K ============ */

function SettingsShell() {
  const { hasModule, canEdit, getModuleConfig } = usePermissions();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const dirtyForms = useDirtyForms();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const allowedSections = allowedSettingsSections(getModuleConfig('settings'));
  const readOnly = !canEdit('settings');
  const pages = useMemo(
    () => (allowedSections ? SETTINGS_PAGES.filter(p => allowedSections.includes(p.section)) : SETTINGS_PAGES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(allowedSections)],
  );
  const requested = params.get('page') as SettingsPageKey | null;
  // Page absente, inconnue ou non permise : accueil de la configuration (lot B).
  const current = pages.find(p => p.key === requested) ?? HOME_PAGE;
  const isHome = current.key === 'home';

  /** Quitte les brouillons en cours apres confirmation ; true si on peut continuer. */
  const confirmLeave = useCallback(async () => {
    if (!dirtyForms?.hasChanges()) return true;
    const ok = await confirm('Les modifications non enregistrées de cette page seront perdues.', {
      title: 'Quitter sans enregistrer ?', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Rester', danger: true,
    });
    if (ok) dirtyForms.resetAll();
    return ok;
  }, [dirtyForms, confirm]);

  const goTo = useCallback(async (page: SettingsPageKey, opts: { anchor?: string; extra?: Record<string, string> } = {}) => {
    if (page !== current?.key && !(await confirmLeave())) return;
    const next = new URLSearchParams({ page, ...(opts.extra ?? {}) });
    if (next.toString() !== params.toString()) setParams(next);
    if (opts.anchor) setPendingAnchor(opts.anchor);
  }, [current?.key, confirmLeave, params, setParams]);

  const leaveTo = async (href: string) => { if (await confirmLeave()) navigate(href); };

  // ⌘K / Ctrl+K : recherche dans les reglages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Apres une recherche : attend que le reglage soit affiche (donnees chargees), le fait
  // defiler a l'ecran et le surligne brievement.
  useEffect(() => {
    if (!pendingAnchor) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(pendingAnchor);
      if (el || ++tries > 40) {
        window.clearInterval(timer);
        setPendingAnchor(null);
        if (!el) return;
        const target = (el.closest('tr') as HTMLElement | null) ?? el;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('odoo-setting-flash');
        void target.offsetWidth;
        target.classList.add('odoo-setting-flash');
        window.setTimeout(() => target.classList.remove('odoo-setting-flash'), 2000);
        target.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
      }
    }, 75);
    return () => window.clearInterval(timer);
  }, [pendingAnchor, current?.key]);

  const onSearchSelect = (e: SearchEntry) => { void goTo(e.page, { anchor: e.anchor, extra: e.extra }); };

  if (!pages.length) {
    return <div className="odoo-scope"><p className="odoo-settings-subtitle">Aucune section des paramètres ne vous est ouverte.</p></div>;
  }

  const pageContent: Record<SettingsPageKey, React.ReactNode> = {
    home: <SetupHome onOpen={(page, anchor) => void goTo(page, { anchor })} onOpenUsers={() => void leaveTo('/users')} />,
    company: <CompanyPage />,
    stores: <StoresPanel />,
    appearance: <AppearanceTab />,
    print: <PrintTab />,
    channels: <SalesChannelsTab />,
    sachets: <SachetsTab />,
    production: (
      <>
        <ParametersPanel keys={['production.fixed_charges', 'production.steps_blocking', 'pricing.rounding']} />
        <ProductionMarkupTab />
      </>
    ),
    purchasing: <ParametersPanel domains={['purchasing']} />,
    salesRules: <ParametersPanel keys={['sales.quotes', 'sales.dunning']} />,
    tax: <TaxCodesTab />,
    currencies: <CurrenciesTab />,
    numbering: <NumberingTab />,
    documents: <DocumentsTab />,
    ledger: <ParametersPanel keys={['ledger.posting_mode', 'accounting.card_commission']} />,
    referentiel: <ReferentielTab />,
    data: <DataTab />,
    notifications: <NotificationsTab />,
    mail: <MailTab />,
    jobs: <JobsTab />,
    approvals: <ApprovalsTab />,
    audit: <AuditLogTab />,
  };
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <div className="odoo-scope max-w-7xl mx-auto" style={{ minHeight: 0, background: 'transparent' }}>
      <h1 className="odoo-settings-title" style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Paramètres</h1>

      <div className="odoo-settings">
        <aside className="odoo-settings-nav" aria-label="Pages des paramètres">
          <button type="button" className="odoo-settings-nav-search" onClick={() => setSearchOpen(true)}>
            <Search size={14} /> Rechercher…
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <div className="odoo-settings-nav-group" style={{ borderTop: 'none', paddingTop: 0 }}>
            <button type="button" className={`odoo-settings-nav-item${isHome ? ' active' : ''}`}
              aria-current={isHome ? 'page' : undefined} onClick={() => void goTo('home')}>
              <HOME_PAGE.icon size={15} /> {HOME_PAGE.label}
            </button>
          </div>
          {SETTINGS_GROUPS.map(group => {
            const items = pages.filter(p => p.group === group);
            const usersLink = group === 'Sécurité et contrôle' && hasModule('users');
            if (!items.length && !usersLink) return null;
            return (
              <nav key={group} className="odoo-settings-nav-group" aria-label={group}>
                <div className="odoo-settings-nav-group-title">{group}</div>
                {items.map(p => {
                  const Icon = p.icon;
                  const active = p.key === current.key;
                  return (
                    <button key={p.key} type="button" className={`odoo-settings-nav-item${active ? ' active' : ''}`}
                      aria-current={active ? 'page' : undefined} onClick={() => void goTo(p.key)}>
                      <Icon size={15} /> {p.label}
                      {active && dirtyForms?.hasChanges() && <span className="odoo-settings-nav-dot" title="Modifications non enregistrées" />}
                    </button>
                  );
                })}
                {usersLink && (
                  <button type="button" className="odoo-settings-nav-item" onClick={() => void leaveTo('/users')}>
                    <Users size={15} /> Utilisateurs et droits <ExternalLink size={12} style={{ marginLeft: 'auto' }} />
                  </button>
                )}
              </nav>
            );
          })}
        </aside>

        <div className="odoo-settings-main">
          <div className="odoo-settings-head">
            <div className="odoo-breadcrumb" aria-label="Fil d'Ariane">
              <button type="button" onClick={() => void goTo('home')}>Paramètres</button>
              <span className="odoo-breadcrumb-separator">›</span>
              {!isHome && <><span>{current.group}</span><span className="odoo-breadcrumb-separator">›</span></>}
              <span className="odoo-breadcrumb-current">{current.label}</span>
            </div>
            <h2 className="odoo-settings-title">{current.label}</h2>
            <p className="odoo-settings-subtitle">{current.description}</p>
          </div>
          <div className="odoo-settings-body">
            {readOnly && !isHome && current.key !== 'audit' && (
              <StatusBanner tone="info" icon={Lock} title="Consultation seule">
                Votre droit « Paramètres » ne permet pas de modifier : les enregistrements seront refusés.
                Un administrateur peut l'étendre depuis Utilisateurs.
              </StatusBanner>
            )}
            <div key={current.key} style={{ display: 'grid', gap: '1.5rem', minWidth: 0 }}>
              {pageContent[current.key]}
            </div>
          </div>
          <SaveBar readOnly={readOnly} />
        </div>
      </div>

      {/* Monte a l'ouverture seulement : chaque recherche repart d'une saisie vide. */}
      {searchOpen && <SettingsSearch open onClose={() => setSearchOpen(false)} pages={pages} onSelect={onSearchSelect} />}
    </div>
  );
}

/* ============ SOCIETE ============ */

function CompanyPage() {
  return (
    <>
      <CompanyInfoSection />
      <LegalIdentitySection />
      <CompanyBankAccounts />
      <ParametersPanel keys={['sales.staff_discount', 'company.country_code']} />
    </>
  );
}

function CompanyInfoSection() {
  const { settings, updateSettings } = useSettings();
  const { draft, set, changes, reset, adopt } = useDraft({ companyName: settings.companyName, subtitle: settings.subtitle });
  useDirtyForm('company-info', {
    dirty: changes > 0, changes, reset,
    save: async () => { await updateSettings(draft); adopt(); },
  });

  return (
    <SettingsSection title="Informations de l'entreprise">
      <SettingItem title="Nom de l'entreprise" description="Affiché dans l'application et sur les tickets">
        <input id="company-name" type="text" value={draft.companyName} onChange={(e) => set('companyName', e.target.value)}
          className="odoo-input" placeholder="Nom de votre entreprise" />
      </SettingItem>
      <SettingItem title="Sous-titre" description="Texte affiché sous le logo">
        <input id="company-subtitle" type="text" value={draft.subtitle} onChange={(e) => set('subtitle', e.target.value)}
          className="odoo-input" placeholder="Boulangerie & Pâtisserie" />
      </SettingItem>
    </SettingsSection>
  );
}

/* ─── Identite legale (mig 326) ─── */
const LEGAL_FIELDS: Array<{ key: 'legalName' | 'legalAddress' | 'legalCity' | 'legalPhone' | 'legalEmail' | 'legalRc' | 'legalIf' | 'legalIce' | 'legalPatente'; title: string; description: string; placeholder?: string }> = [
  { key: 'legalName', title: 'Raison sociale', description: 'Nom légal (ex. « SARL ») sur les factures, bons de commande, bulletins et attestations' },
  { key: 'legalAddress', title: 'Siège social', description: 'Adresse légale complète' },
  { key: 'legalCity', title: 'Ville', description: 'Utilisée dans « Fait à … » des attestations et pièces RH' },
  { key: 'legalPhone', title: 'Téléphone', description: 'Pied de page des factures et bons de commande' },
  { key: 'legalEmail', title: 'Email', description: 'Pied de page des factures et bons de commande' },
  { key: 'legalRc', title: 'Registre de commerce (RC)', description: 'Numéro RC' },
  { key: 'legalIf', title: 'Identifiant fiscal (IF)', description: 'Numéro IF' },
  { key: 'legalIce', title: 'ICE', description: 'Identifiant commun de l\'entreprise : 15 chiffres', placeholder: '000000000000000' },
  { key: 'legalPatente', title: 'Patente / Taxe professionnelle', description: 'Numéro de patente du siège (chaque établissement peut avoir la sienne)' },
];

// Fiche societe (mig 331) : saisis avec l'identite legale, types propres.
const LEGAL_FORMS: [string, string][] = [
  ['', '—'], ['SARL', 'SARL'], ['SARL AU', 'SARL à associé unique'], ['SA', 'SA'], ['SAS', 'SAS'], ['SNC', 'SNC'],
  ['SCS', 'SCS'], ['EI', 'Entreprise individuelle'], ['AUTO_ENTREPRENEUR', 'Auto-entrepreneur'], ['COOPERATIVE', 'Coopérative'], ['AUTRE', 'Autre'],
];

function LegalIdentitySection() {
  const { settings, updateSettings } = useSettings();
  const { draft: form, set, changes, reset, adopt } = useDraft<Record<string, string>>({
    ...Object.fromEntries(LEGAL_FIELDS.map(f => [f.key, settings[f.key] ?? ''])),
    legalForm: settings.legalForm ?? '',
    legalCapital: settings.legalCapital === null || settings.legalCapital === undefined ? '' : String(settings.legalCapital),
    legalWebsite: settings.legalWebsite ?? '',
  });
  const capitalInvalid = form.legalCapital !== '' && !(Number(form.legalCapital) >= 0);
  const iceInvalid = !!form.legalIce && !/^\d{15}$/.test(form.legalIce.replace(/\s/g, ''));

  useDirtyForm('company-legal', {
    dirty: changes > 0, changes, reset,
    invalid: iceInvalid ? 'L\'ICE doit compter 15 chiffres.' : capitalInvalid ? 'Le capital social doit être un montant positif.' : null,
    save: async () => {
      await updateSettings({ ...form, legalCapital: form.legalCapital === '' ? null : Number(form.legalCapital) } as Partial<typeof settings>);
      adopt();
    },
  });

  return (
    <SettingsSection title="Identité légale">
      <SettingItem title="Forme juridique" description="Mentionnée sur les factures avec le capital">
        <select id="legal-form" value={form.legalForm ?? ''} onChange={(e) => set('legalForm', e.target.value)} className="odoo-input">
          {LEGAL_FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </SettingItem>
      <SettingItem title="Capital social" description="En dirhams">
        <input id="legal-capital" type="number" min="0" step="1000" value={form.legalCapital ?? ''}
          onChange={(e) => set('legalCapital', e.target.value)}
          className={`odoo-input${capitalInvalid ? ' invalid' : ''}`} />
      </SettingItem>
      {LEGAL_FIELDS.map(f => (
        <SettingItem key={f.key} title={f.title} description={f.description}>
          <input id={`legal-${f.key}`} type="text" value={form[f.key] ?? ''} placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)}
            className={`odoo-input${f.key === 'legalIce' && iceInvalid ? ' invalid' : ''}`} />
        </SettingItem>
      ))}
      <SettingItem title="Site web" description="Pied de page des documents">
        <input id="legal-website" type="text" value={form.legalWebsite ?? ''} placeholder="www.exemple.ma"
          onChange={(e) => set('legalWebsite', e.target.value)} className="odoo-input" />
      </SettingItem>
      <SettingItem title="N° d'affiliation CNSS" description="Tenu dans Personnel › Paie › Paramètres de paie (déclarations sociales)">
        <span style={{ fontSize: '0.875rem' }}>{settings.employerCnssNumber || <span style={{ color: 'var(--odoo-text-muted)' }}>Non renseigné</span>}</span>
      </SettingItem>
    </SettingsSection>
  );
}

/* ============ APPEARANCE TAB ============ */

const THEME_PRESETS = [
  {
    name: 'Dore',
    desc: 'Clair, chaud, boulangerie',
    icon: '🥖',
    values: {
      themeBgPage: '#FAF6F1', themeBgCard: '#FFFDF9', themeBgSecondary: '#F3ECE2', themeBgSeparator: '#E8DDD0',
      themeTextStrong: '#2D1810', themeTextBody: '#5C3D2E', themeTextMuted: '#8B7355',
      themeAccent: '#C4872B', themeAccentHover: '#A8721F', themeAccentLight: '#F5E6CC',
      themeCtaColor: '#C4872B', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Terroir',
    desc: 'Sombre, chaud, immersif',
    icon: '🌿',
    values: {
      themeBgPage: '#1E1714', themeBgCard: '#2A211C', themeBgSecondary: '#362B25', themeBgSeparator: '#4A3D35',
      themeTextStrong: '#F5EDE7', themeTextBody: '#D4C4B8', themeTextMuted: '#A89585',
      themeAccent: '#7FA37E', themeAccentHover: '#6B8E6A', themeAccentLight: '#2D3D2C',
      themeCtaColor: '#7FA37E', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Classique',
    desc: 'Blanc neutre, standard',
    icon: '📋',
    values: {
      themeBgPage: '#F9FAFB', themeBgCard: '#FFFFFF', themeBgSecondary: '#F3F4F6', themeBgSeparator: '#E5E7EB',
      themeTextStrong: '#111827', themeTextBody: '#374151', themeTextMuted: '#6B7280',
      themeAccent: '#714B67', themeAccentHover: '#5f3d57', themeAccentLight: '#F3E8F0',
      themeCtaColor: '#714B67', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Ocean',
    desc: 'Bleu, frais, professionnel',
    icon: '🌊',
    values: {
      themeBgPage: '#F0F4F8', themeBgCard: '#FFFFFF', themeBgSecondary: '#E2E8F0', themeBgSeparator: '#CBD5E1',
      themeTextStrong: '#0F172A', themeTextBody: '#334155', themeTextMuted: '#64748B',
      themeAccent: '#2563EB', themeAccentHover: '#1D4ED8', themeAccentLight: '#DBEAFE',
      themeCtaColor: '#2563EB', themeCtaText: '#FFFFFF',
    },
  },
];

type ThemeKey = keyof typeof THEME_PRESETS[0]['values'];

const THEME_FIELDS: { key: ThemeKey; label: string; group: string }[] = [
  { key: 'themeBgPage', label: 'Fond de page', group: 'Surfaces' },
  { key: 'themeBgCard', label: 'Cartes / Panneaux', group: 'Surfaces' },
  { key: 'themeBgSecondary', label: 'Zones secondaires', group: 'Surfaces' },
  { key: 'themeBgSeparator', label: 'Bordures / Séparateurs', group: 'Surfaces' },
  { key: 'themeTextStrong', label: 'Titres', group: 'Texte' },
  { key: 'themeTextBody', label: 'Corps de texte', group: 'Texte' },
  { key: 'themeTextMuted', label: 'Texte secondaire', group: 'Texte' },
  { key: 'themeAccent', label: 'Accent principal', group: 'Accents' },
  { key: 'themeAccentHover', label: 'Accent survol', group: 'Accents' },
  { key: 'themeAccentLight', label: 'Accent léger (fond)', group: 'Accents' },
  { key: 'themeCtaColor', label: 'Bouton action (CTA)', group: 'Bouton principal' },
  { key: 'themeCtaText', label: 'Texte du bouton', group: 'Bouton principal' },
];

function AppearanceTab() {
  const { settings, updateSettings } = useSettings();
  const { draft: theme, setDraft: setTheme, set: setColor, changes, reset, adopt } = useDraft<Record<ThemeKey, string>>(
    Object.fromEntries(THEME_FIELDS.map(f => [f.key, (settings as unknown as Record<string, string>)[f.key]])) as Record<ThemeKey, string>,
  );
  const invalidColor = THEME_FIELDS.find(f => !/^#[0-9a-fA-F]{6}$/.test(theme[f.key] ?? ''));
  useDirtyForm('appearance', {
    dirty: changes > 0, changes, reset,
    invalid: invalidColor ? `Couleur « ${invalidColor.label} » incomplète (format #RRGGBB).` : null,
    save: async () => { await updateSettings(theme); adopt(); },
  });

  const applyPreset = (preset: typeof THEME_PRESETS[0]) => {
    setTheme(preset.values);
  };

  const groups = [...new Set(THEME_FIELDS.map(f => f.group))];

  return (
    <>
      <SettingsSection
        title="Thèmes prédéfinis"
        description="Sélectionnez un thème de base puis personnalisez les couleurs"
        columns={1}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {THEME_PRESETS.map(preset => {
            const isActive = Object.entries(preset.values).every(([k, v]) => theme[k as ThemeKey] === v);
            return (
              <button key={preset.name} onClick={() => applyPreset(preset)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-left ${
                  isActive
                    ? 'border-gray-800 shadow-lg bg-gray-50'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}>
                {isActive && (
                  <span className="absolute top-2 right-2 w-5 h-5 bg-gray-800 rounded-full flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </span>
                )}
                {/* Mini preview */}
                <div className="w-full h-16 rounded-lg overflow-hidden border border-gray-200"
                  style={{ background: preset.values.themeBgPage }}>
                  <div className="h-4 flex items-center px-2" style={{ background: preset.values.themeAccent }}>
                    <span className="text-[6px] font-bold" style={{ color: preset.values.themeCtaText }}>{settings.companyName}</span>
                  </div>
                  <div className="p-1.5 flex gap-1">
                    <div className="w-5 h-5 rounded" style={{ background: preset.values.themeBgCard, border: `1px solid ${preset.values.themeBgSeparator}` }} />
                    <div className="w-5 h-5 rounded" style={{ background: preset.values.themeBgCard, border: `1px solid ${preset.values.themeBgSeparator}` }} />
                    <div className="flex-1 rounded" style={{ background: preset.values.themeBgSecondary }} />
                  </div>
                </div>
                <span className="text-lg">{preset.icon}</span>
                <span className="font-semibold text-sm text-gray-800">{preset.name}</span>
                <span className="text-xs text-gray-500 text-center">{preset.desc}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {/* Custom color pickers by group */}
      {groups.map(group => (
        <SettingsSection key={group} title={group}>
          {THEME_FIELDS.filter(f => f.group === group).map(field => (
            <SettingItem key={field.key} title={field.label}>
              <div className="flex gap-2">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(theme[field.key]) ? theme[field.key] : '#000000'}
                  onChange={e => setColor(field.key, e.target.value)} aria-label={`${field.label} : couleur`}
                  className="odoo-input" style={{ width: 48, height: 34, padding: 2, cursor: 'pointer' }} />
                <input id={`theme-${field.key}`} type="text" value={theme[field.key]}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value) || e.target.value === '') setColor(field.key, e.target.value); }}
                  className={`odoo-input${/^#[0-9a-fA-F]{6}$/.test(theme[field.key]) ? '' : ' invalid'}`} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="#000000" maxLength={7} />
              </div>
            </SettingItem>
          ))}
        </SettingsSection>
      ))}

      <SettingsSection title="Aperçu en direct" columns={1}>
        <div className="rounded-xl overflow-hidden border border-gray-200">
          {/* Header preview */}
          <div className="h-14 flex items-center px-5" style={{ background: theme.themeAccent }}>
            <span className="font-bold tracking-wide" style={{ color: theme.themeCtaText }}>{settings.companyName}</span>
            <span className="text-sm ml-2" style={{ color: theme.themeCtaText, opacity: 0.6 }}>/ Caisse</span>
            <div className="flex-1" />
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: `${theme.themeCtaText}33`, color: theme.themeCtaText }}>SF</div>
          </div>

          {/* Content preview */}
          <div className="p-5 flex gap-4" style={{ background: theme.themeBgPage }}>
            {/* Product cards */}
            <div className="flex-1 space-y-3">
              <div className="flex gap-3">
                {['Pain complet', 'Croissant', 'Muffin'].map(name => (
                  <div key={name} className="flex-1 rounded-xl p-3"
                    style={{ background: theme.themeBgCard, border: `1px solid ${theme.themeBgSeparator}` }}>
                    <div className="text-center text-2xl mb-2">{name === 'Pain complet' ? '🥖' : name === 'Croissant' ? '🥐' : '🧁'}</div>
                    <p className="text-sm font-semibold" style={{ color: theme.themeTextStrong }}>{name}</p>
                    <p className="text-sm font-bold" style={{ color: theme.themeAccent }}>8.00 DH</p>
                    <p className="text-xs" style={{ color: theme.themeTextMuted }}>Stock: 24</p>
                  </div>
                ))}
              </div>
              {/* Category chips */}
              <div className="flex gap-2">
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeAccentLight, color: theme.themeAccent }}>
                  Tous
                </span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeBgSecondary, color: theme.themeTextMuted }}>
                  Pains
                </span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeBgSecondary, color: theme.themeTextMuted }}>
                  Patisseries
                </span>
              </div>
            </div>

            {/* Cart preview */}
            <div className="w-48 rounded-xl flex flex-col"
              style={{ background: theme.themeBgCard, border: `1px solid ${theme.themeBgSeparator}` }}>
              <div className="px-3 py-2.5" style={{ borderBottom: `1px solid ${theme.themeBgSecondary}` }}>
                <span className="font-bold text-sm" style={{ color: theme.themeTextStrong }}>Panier</span>
              </div>
              <div className="px-3 py-2 text-xs space-y-2 flex-1">
                <div className="flex justify-between">
                  <span style={{ color: theme.themeTextBody }}>Pain complet x2</span>
                  <span className="font-semibold" style={{ color: theme.themeTextStrong }}>16.00</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.themeTextBody }}>Croissant x3</span>
                  <span className="font-semibold" style={{ color: theme.themeTextStrong }}>10.50</span>
                </div>
                <div className="pt-2 flex justify-between font-bold text-sm"
                  style={{ borderTop: `1px solid ${theme.themeBgSeparator}`, color: theme.themeAccent }}>
                  <span>Total</span><span>26.50 DH</span>
                </div>
              </div>
              <div className="p-2">
                <button className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors"
                  style={{ background: theme.themeCtaColor, color: theme.themeCtaText }}>
                  Encaisser
                </button>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

/* ============ PRINT TAB ============ */

const PRINT_KEYS = [
  'logoUrl', 'receiptShowLogo', 'receiptLogoSize', 'receiptHeader', 'receiptFooter', 'receiptFontSize', 'receiptPaperWidth',
  'receiptShowCashier', 'receiptShowDate', 'receiptShowPaymentDetail', 'receiptExtraLines', 'receiptAutoPrint',
  'receiptOpenDrawer', 'receiptNumCopies',
] as const;
type PrintDraft = Pick<ReturnType<typeof useSettings>['settings'], typeof PRINT_KEYS[number]>;

function PrintTab() {
  const { settings, updateSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { draft, set, changes, reset, adopt } = useDraft<PrintDraft>(
    Object.fromEntries(PRINT_KEYS.map(k => [k, settings[k]])) as PrintDraft,
  );
  useDirtyForm('print', {
    dirty: changes > 0, changes, reset,
    save: async () => { await updateSettings(draft); adopt(); },
  });
  const {
    logoUrl, receiptShowLogo, receiptLogoSize, receiptHeader, receiptFooter, receiptFontSize, receiptPaperWidth,
    receiptShowCashier, receiptShowDate, receiptShowPaymentDetail, receiptExtraLines, receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
  } = draft;
  const setter = <K extends keyof PrintDraft>(k: K) => (v: PrintDraft[K]) => set(k, v);
  const setLogoUrl = setter('logoUrl');
  const setReceiptShowLogo = setter('receiptShowLogo');
  const setReceiptLogoSize = setter('receiptLogoSize');
  const setReceiptHeader = setter('receiptHeader');
  const setReceiptFooter = setter('receiptFooter');
  const setReceiptFontSize = setter('receiptFontSize');
  const setReceiptPaperWidth = setter('receiptPaperWidth');
  const setReceiptShowCashier = setter('receiptShowCashier');
  const setReceiptShowDate = setter('receiptShowDate');
  const setReceiptShowPaymentDetail = setter('receiptShowPaymentDetail');
  const setReceiptExtraLines = setter('receiptExtraLines');
  const setReceiptAutoPrint = setter('receiptAutoPrint');
  const setReceiptOpenDrawer = setter('receiptOpenDrawer');
  const setReceiptNumCopies = setter('receiptNumCopies');

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify.error('Le fichier ne doit pas dépasser 10 Mo');
      return;
    }
    setUploading(true);
    try {
      const result = await settingsApi.uploadLogo(file);
      setLogoUrl(result.url);
      notify.success('Logo téléchargé');
    } catch {
      notify.error('Erreur lors du téléchargement');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
  };

  // Resolve logo source — /uploads paths are proxied to the API server
  const logoSrc = logoUrl || '/images/logo-horizontal.png';

  const nowStr = format(new Date(), "dd MMMM yyyy 'a' HH:mm", { locale: fr });

  return (
    <div className="odoo-settings-with-preview">
      {/* Reglages */}
      <div style={{ display: 'grid', gap: '1.5rem', minWidth: 0 }}>
        <PrinterSettingsCard />

        <SettingsSection title="Logo" columns={1}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem' }}>
            <div style={{ flexShrink: 0, width: 128, height: 80, borderRadius: 6, border: '2px dashed var(--odoo-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--odoo-bg-alt)', overflow: 'hidden' }}>
              {logoUrl ? (
                <img src={logoSrc} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
                  <Image size={24} style={{ margin: '0 auto 4px' }} />
                  <span style={{ fontSize: 10 }}>Logo par défaut</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: 'grid', gap: 8 }}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={handleLogoUpload} style={{ display: 'none' }} />
              <p className="odoo-setting-help">Logo affiché sur les reçus et tickets (PNG, JPG, SVG — 10 Mo maximum)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="odoo-btn-secondary">
                  <Upload size={13} />
                  {uploading ? 'Téléchargement…' : 'Télécharger un logo'}
                </button>
                {logoUrl && (
                  <button type="button" onClick={handleRemoveLogo} className="odoo-btn-danger">Supprimer</button>
                )}
              </div>
            </div>
          </div>
          <SettingItem
            title="Afficher le logo sur le reçu"
            description="Le logo apparaît en haut du ticket imprimé"
            toggle={{ checked: receiptShowLogo, onChange: setReceiptShowLogo }}
          >
            {receiptShowLogo && (
              <label style={{ display: 'grid', gap: 4, maxWidth: 320, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                Taille du logo (px) : {receiptLogoSize}
                <input type="range" min="20" max="80" value={receiptLogoSize}
                  onChange={(e) => setReceiptLogoSize(parseInt(e.target.value))} style={{ accentColor: 'var(--odoo-purple)' }} />
              </label>
            )}
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Contenu du reçu" columns={1}>
          <SettingItem title="En-tête supplémentaire" description="Affiché sous le sous-titre (adresse, téléphone, ICE…)">
            <input id="receipt-header" type="text" value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)}
              className="odoo-input" style={{ maxWidth: 448 }} placeholder="Ex. : adresse, téléphone, ICE…" />
          </SettingItem>
          <SettingItem title="Message de pied de page" description="Texte de remerciement en bas du ticket">
            <input id="receipt-footer" type="text" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)}
              className="odoo-input" style={{ maxWidth: 448 }} placeholder="Merci pour votre visite !" />
          </SettingItem>
          <SettingItem title="Lignes supplémentaires" description="Chaque ligne sera affichée en bas du reçu">
            <textarea id="receipt-extra" value={receiptExtraLines} onChange={(e) => setReceiptExtraLines(e.target.value)}
              className="odoo-input" style={{ maxWidth: 448 }} rows={3}
              placeholder="Ex. : horaires d'ouverture, conditions de retour…" />
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Options d'affichage">
          <SettingItem title="Nom du caissier" description="Affiche le caissier sur le ticket"
            toggle={{ checked: receiptShowCashier, onChange: setReceiptShowCashier }} />
          <SettingItem title="Date et heure" description="Affiche la date de la vente"
            toggle={{ checked: receiptShowDate, onChange: setReceiptShowDate }} />
          <SettingItem title="Détail du paiement" description="Espèces reçues et monnaie rendue"
            toggle={{ checked: receiptShowPaymentDetail, onChange: setReceiptShowPaymentDetail }} />
        </SettingsSection>

        <SettingsSection title="Imprimante thermique">
          <SettingItem
            title="Impression automatique"
            description="Le reçu s'imprime après chaque encaissement sans cliquer sur Imprimer"
            toggle={{ checked: receiptAutoPrint, onChange: setReceiptAutoPrint }}
          />
          <SettingItem
            title="Ouvrir le tiroir-caisse"
            description="Le tiroir s'ouvre à chaque impression (tiroir connecté à l'imprimante)"
            toggle={{ checked: receiptOpenDrawer, onChange: setReceiptOpenDrawer }}
          />
          <SettingItem title="Nombre de copies" description="Nombre de reçus imprimés à chaque vente">
            <select id="receipt-copies" value={receiptNumCopies} onChange={(e) => setReceiptNumCopies(parseInt(e.target.value))}
              className="odoo-input" style={{ width: 160 }}>
              <option value={1}>1 copie</option>
              <option value={2}>2 copies</option>
              <option value={3}>3 copies</option>
            </select>
          </SettingItem>
          <div>
            <StatusBanner tone="neutral" icon={Printer} title="Configuration de l'imprimante">
              Connectez l'imprimante thermique (USB ou réseau) et installez son pilote ; choisissez-la comme imprimante
              par défaut du navigateur et désactivez ses en-têtes et pieds de page. Le tiroir-caisse se branche sur le port RJ11/DK de l'imprimante.
            </StatusBanner>
          </div>
        </SettingsSection>

        <SettingsSection title="Format d'impression">
          <SettingItem title="Taille de police" description={`Texte du ticket : ${receiptFontSize} px`}>
            <input id="receipt-font" type="range" min="9" max="16" value={receiptFontSize}
              onChange={(e) => setReceiptFontSize(parseInt(e.target.value))}
              style={{ width: '100%', maxWidth: 320, accentColor: 'var(--odoo-purple)' }} />
          </SettingItem>
          <SettingItem title="Largeur du papier" description="Format du rouleau thermique">
            <select id="receipt-width" value={receiptPaperWidth} onChange={(e) => setReceiptPaperWidth(parseInt(e.target.value))}
              className="odoo-input" style={{ width: 176 }}>
              <option value={58}>58 mm (petit)</option>
              <option value={80}>80 mm (standard)</option>
            </select>
          </SettingItem>
        </SettingsSection>
      </div>

        {/* Live receipt preview */}
        <div className="odoo-settings-preview">
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Eye size={15} style={{ color: 'var(--odoo-text-muted)' }} />
              <h3 className="odoo-setting-label" style={{ margin: 0 }}>Aperçu du reçu</h3>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, overflow: 'hidden', maxWidth: `${Math.min(receiptPaperWidth * 3.2, 280)}px`, margin: '0 auto' }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: `${Math.max(receiptFontSize - 2, 8)}px`, color: '#000', lineHeight: 1.4 }}>
                {/* Logo */}
                {receiptShowLogo && (
                  <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                    <img src={logoSrc} alt="Logo"
                      style={{ height: `${receiptLogoSize * 0.6}px`, margin: '0 auto', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}

                {/* Subtitle */}
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555', marginBottom: '2px' }}>
                  {settings.subtitle}
                </div>

                {/* Header */}
                {receiptHeader && (
                  <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555', marginBottom: '2px' }}>
                    {receiptHeader}
                  </div>
                )}

                {/* Divider */}
                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Info */}
                <div style={{ fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                  <div>N: VNT-20260404-0001</div>
                  {receiptShowDate && <div>Date: {nowStr}</div>}
                  {receiptShowCashier && <div>Caissier: Aniss B.</div>}
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Items */}
                <div>
                  <div style={{ fontWeight: 'bold' }}>Pain complet</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '6px' }}>
                    <span>2 x 8.00 DH</span>
                    <span style={{ fontWeight: 'bold' }}>16.00 DH</span>
                  </div>
                  <div style={{ fontWeight: 'bold', marginTop: '2px' }}>Croissant beurre</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '6px' }}>
                    <span>3 x 5.00 DH</span>
                    <span style={{ fontWeight: 'bold' }}>15.00 DH</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sous-total</span>
                  <span>31.00 DH</span>
                </div>
                <div style={{ borderTop: '2px solid #000', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: `${receiptFontSize}px` }}>
                  <span>TOTAL</span>
                  <span>31.00 DH</span>
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Payment */}
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                  Paye par: <strong>Especes</strong>
                </div>
                {receiptShowPaymentDetail && (
                  <div style={{ fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Montant donne</span><span>50.00 DH</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span>Monnaie rendue</span><span>19.00 DH</span>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555' }}>
                  {receiptFooter && <p>{receiptFooter}</p>}
                  <p>A bientot chez {settings.companyName}</p>
                  {receiptExtraLines && receiptExtraLines.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}

// ─── Canaux de vente (mig 172) ───
function SalesChannelsTab() {
  const queryClient = useQueryClient();
  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['sales-channels'],
    queryFn: salesChannelsApi.list,
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#64748b');

  const createMutation = useMutation({
    mutationFn: salesChannelsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal créé');
      setNewCode(''); setNewLabel(''); setNewColor('#64748b');
      setShowAddForm(false);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message || 'Erreur lors de la création');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ label: string; color: string; isDefault: boolean; isActive: boolean }> }) =>
      salesChannelsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal mis à jour');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: salesChannelsApi.deactivate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal désactivé');
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message || 'Erreur');
    },
  });

  const handleSetDefault = (channel: SalesChannel) => {
    updateMutation.mutate({ id: channel.id, data: { isDefault: true } });
  };

  return (
    <SettingsSection
      title="Canaux de vente"
      description="Boutique, commande, événement, gros, livraison… Chaque vente est rattachée à un canal. Les prix peuvent être différents par canal (voir fiche produit)."
      columns={1}
    >
      {isLoading ? (
        <div className="odoo-setting-help">Chargement…</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {channels.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.625rem 0.75rem', borderRadius: 4, border: '1px solid var(--odoo-border)', background: c.is_active ? 'var(--odoo-bg)' : 'var(--odoo-bg-alt)', opacity: c.is_active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: c.color }} />
                <div>
                  <div className="odoo-setting-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.label}
                    {c.is_default && <span className="odoo-tag odoo-tag-green">Par défaut</span>}
                    {!c.is_active && <span className="odoo-tag odoo-tag-grey">Inactif</span>}
                  </div>
                  <div className="odoo-setting-help" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.code}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!c.is_default && c.is_active && (
                  <button type="button" onClick={() => handleSetDefault(c)} className="odoo-btn-secondary">
                    Définir par défaut
                  </button>
                )}
                {!c.is_default && c.is_active && (
                  <button type="button" onClick={() => deactivateMutation.mutate(c.id)} className="odoo-btn-danger">
                    Désactiver
                  </button>
                )}
                {!c.is_active && (
                  <button type="button" onClick={() => updateMutation.mutate({ id: c.id, data: { isActive: true } })} className="odoo-btn-secondary">
                    Réactiver
                  </button>
                )}
              </div>
            </div>
          ))}

          {showAddForm ? (
            <div style={{ padding: '0.75rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg-alt)', display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 64px', gap: 8 }}>
                <input id="channel-code" type="text" placeholder="code (ex. pro_b2b)" aria-label="Code du canal"
                  value={newCode} onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="odoo-input" />
                <input id="channel-label" type="text" placeholder="Libellé" aria-label="Libellé du canal"
                  value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  className="odoo-input" />
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} aria-label="Couleur du canal"
                  className="odoo-input" style={{ height: 34, padding: 2 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setShowAddForm(false)} className="odoo-btn-secondary">Annuler</button>
                <button type="button"
                  onClick={() => createMutation.mutate({ code: newCode, label: newLabel, color: newColor })}
                  disabled={!newCode || !newLabel || createMutation.isPending}
                  className="odoo-btn-primary">
                  Créer
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setShowAddForm(true)} className="odoo-btn-secondary">
                + Ajouter un canal
              </button>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
