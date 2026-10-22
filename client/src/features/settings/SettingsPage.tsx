import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSettings } from '../../context/SettingsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { allowedSettingsSections, type SettingsSection as SettingsSectionKey } from '@ofauria/shared';
import { settingsApi } from '../../api/settings.api';
import { salesChannelsApi, type SalesChannel } from '../../api/sales-channels.api';
import {
  Save, Building2, RotateCcw, Store, Printer, Upload, Image, Eye, Database, Check, Search,
  BarChart3, Paintbrush, ShoppingBag, ShieldCheck, Lock, Hash, SlidersHorizontal, Percent,
  FileText, Bell, HardDrive,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import PrinterSettingsCard from './PrinterSettingsCard';
import SachetsTab from './SachetsTab';
import ProductionMarkupTab from './ProductionMarkupTab';
import AuditLogTab from './AuditLogTab';
import NumberingTab from './NumberingTab';
import ParametersPanel from './ParametersPanel';
import CompanyBankAccounts from './CompanyBankAccounts';
import StoresPanel from './StoresPanel';
import TaxCodesTab from './TaxCodesTab';
import DocumentsTab from './DocumentsTab';
import NotificationsTab from './NotificationsTab';
import DataTab from './DataTab';
import ReferentielTab from './ReferentielTab';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { SettingsSection, SettingItem } from './SettingsPrimitives';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type SettingsTab = 'general' | 'appearance' | 'print' | 'stores' | 'referentiel' | 'production' | 'sachets' | 'audit' | 'numbering' | 'parameters' | 'tax' | 'documents' | 'notifications' | 'data';

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { hasModule, canEdit, getModuleConfig } = usePermissions();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [tabSearch, setTabSearch] = useState('');

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [subtitle, setSubtitle] = useState(settings.subtitle);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setSubtitle(settings.subtitle);
  }, [settings]);

  // Acces par le droit « Parametres » (ecran Utilisateurs), eventuellement
  // restreint a certaines sections ; meme regle que le serveur.
  if (!hasModule('settings')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Vous n'avez pas accès aux paramètres.</p>
      </div>
    );
  }
  const allowedSections = allowedSettingsSections(getModuleConfig('settings'));
  const readOnly = !canEdit('settings');

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({ companyName, subtitle });
      notify.success('Parametres enregistres');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCompanyName(settings.companyName);
    setSubtitle(settings.subtitle);
  };

  const hasChanges =
    companyName !== settings.companyName ||
    subtitle !== settings.subtitle;

  const allTabs: { key: SettingsTab; section: SettingsSectionKey; label: string; description: string; icon: React.ReactNode }[] = [
    { key: 'general', section: 'company', label: 'Societe', description: 'Identite legale, comptes bancaires', icon: <Building2 size={18} /> },
    { key: 'appearance', section: 'appearance', label: 'Apparence', description: 'Theme, couleurs et affichage', icon: <Paintbrush size={18} /> },
    { key: 'print', section: 'print', label: 'Impression', description: 'Tickets de caisse et imprimantes', icon: <Printer size={18} /> },
    { key: 'stores', section: 'stores', label: 'Etablissements', description: 'Boutiques, laboratoire, entrepot, siege', icon: <Store size={18} /> },
    { key: 'tax', section: 'tax', label: 'TVA', description: 'Taux de TVA dates', icon: <Percent size={18} /> },
    { key: 'documents', section: 'documents', label: 'Documents', description: 'Mentions des factures et bons de commande', icon: <FileText size={18} /> },
    { key: 'notifications', section: 'notifications', label: 'Notifications', description: 'Qui est prevenu, et de quoi', icon: <Bell size={18} /> },
    { key: 'parameters', section: 'business', label: 'Parametres metier', description: 'Regles de gestion par domaine, en un seul endroit', icon: <SlidersHorizontal size={18} /> },
    { key: 'numbering', section: 'numbering', label: 'Numerotation', description: 'Series de numeros des pieces', icon: <Hash size={18} /> },
    { key: 'referentiel', section: 'referentiel', label: 'Referentiel', description: 'Tables de parametrage', icon: <Database size={18} /> },
    { key: 'production', section: 'production', label: 'Production', description: 'Charges fixes et couts', icon: <BarChart3 size={18} /> },
    { key: 'sachets', section: 'sachets', label: 'Sachets', description: 'Controle des sachets de caisse', icon: <ShoppingBag size={18} /> },
    { key: 'data', section: 'data', label: 'Donnees', description: 'Import, export et etat de la base', icon: <HardDrive size={18} /> },
    { key: 'audit', section: 'audit', label: 'Journal', description: 'Modifications du parametrage et connexions', icon: <ShieldCheck size={18} /> },
  ];
  const tabs = allowedSections ? allTabs.filter((t) => allowedSections.includes(t.section)) : allTabs;
  // Onglet par defaut non autorise (droit limite a d'autres sections) : premier onglet permis.
  const currentTab: SettingsTab | undefined = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]?.key;

  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const search = normalize(tabSearch.trim());
  const filteredTabs = search
    ? tabs.filter((t) => normalize(t.label).includes(search) || normalize(t.description).includes(search))
    : tabs;

  const activeMeta = tabs.find((t) => t.key === currentTab);

  const tabContent = (
    <>
      {currentTab === 'general' && (
        <GeneralTab
          companyName={companyName} setCompanyName={setCompanyName}
          subtitle={subtitle} setSubtitle={setSubtitle}
        />
      )}
      {currentTab === 'appearance' && <AppearanceTab />}
      {currentTab === 'print' && <PrintTab />}
      {currentTab === 'stores' && <StoresPanel />}
      {currentTab === 'tax' && <TaxCodesTab />}
      {currentTab === 'documents' && <DocumentsTab />}
      {currentTab === 'notifications' && <NotificationsTab />}
      {currentTab === 'data' && <DataTab />}
      {currentTab === 'referentiel' && <ReferentielTab />}
      {currentTab === 'production' && (
        <>
          <ParametersPanel keys={['production.fixed_charges', 'production.steps_blocking', 'pricing.rounding']} />
          <SalesChannelsTab />
          <ProductionMarkupTab />
        </>
      )}
      {currentTab === 'sachets' && <SachetsTab />}
      {currentTab === 'audit' && <AuditLogTab />}
      {currentTab === 'numbering' && <NumberingTab />}
      {currentTab === 'parameters' && (
        <div className="space-y-6">
          <ParametersPanel />
          <OtherSettingsLinks onOpen={(t) => setActiveTab(t)} />
        </div>
      )}
    </>
  );

  const sectionHeader = activeMeta && (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0">
          {activeMeta.icon}
        </span>
        <div>
          <h2 className="text-base font-bold text-gray-800 leading-tight">{activeMeta.label}</h2>
          <p className="text-xs text-gray-400">{activeMeta.description}</p>
        </div>
      </div>
      {currentTab === 'general' && (
        <div className="flex gap-2">
          {hasChanges && (
            <button onClick={handleReset} className="btn-secondary flex items-center gap-2">
              <RotateCcw size={16} /> Annuler
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !hasChanges}
            className="btn-primary flex items-center gap-2">
            <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Paramètres</h1>

      <div className="flex gap-5 items-start">
        {/* Navigation laterale plate */}
        <aside className="w-60 shrink-0 sticky top-4 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-2.5 border-b border-gray-100">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={tabSearch}
                onChange={(e) => setTabSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-8 pr-2 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 focus:bg-white"
              />
            </div>
          </div>
          <nav className="p-1.5">
            {filteredTabs.map((tab) => {
              const isActive = currentTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`w-full flex items-center gap-2.5 pl-2.5 pr-2 py-2 rounded-md text-sm text-left transition-colors border-l-2 ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-semibold border-primary-600'
                      : 'text-gray-600 hover:bg-gray-100 border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-primary-600' : 'text-gray-400'}>
                    {tab.icon}
                  </span>
                  {tab.label}
                </button>
              );
            })}
            {filteredTabs.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">Aucun reglage trouve.</p>
            )}
          </nav>
        </aside>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="px-6 py-4 border-b border-gray-100">
              {sectionHeader}
            </div>
            <div className="p-6">
              {readOnly && currentTab !== 'audit' && (
                <div className="mb-4">
                  <StatusBanner tone="info" icon={Lock} title="Consultation seule">
                    Votre droit « Paramètres » ne permet pas de modifier : les enregistrements seront refusés.
                    Un administrateur peut l'étendre depuis Utilisateurs.
                  </StatusBanner>
                </div>
              )}
              {tabContent}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ GENERAL TAB ============ */

function GeneralTab({
  companyName, setCompanyName, subtitle, setSubtitle,
}: {
  companyName: string; setCompanyName: (v: string) => void;
  subtitle: string; setSubtitle: (v: string) => void;
}) {
  return (
    <>
      <SettingsSection title="Informations de l'entreprise">
        <SettingItem title="Nom de l'entreprise" description="Affiche dans l'application et sur les tickets">
          <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
            className="input w-full" placeholder="Nom de votre entreprise" />
        </SettingItem>
        <SettingItem title="Sous-titre" description="Texte affiche sous le logo">
          <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
            className="input w-full" placeholder="Boulangerie & Patisserie" />
        </SettingItem>
      </SettingsSection>

      <LegalIdentitySection />
      <CompanyBankAccounts />
      <ParametersPanel keys={['sales.staff_discount']} />
    </>
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
const EXTRA_LEGAL_KEYS = ['legalForm', 'legalCapital', 'legalWebsite'] as const;

function LegalIdentitySection() {
  const { settings, updateSettings } = useSettings();
  const initial = () => ({
    ...Object.fromEntries(LEGAL_FIELDS.map(f => [f.key, settings[f.key] ?? ''])),
    legalForm: settings.legalForm ?? '',
    legalCapital: settings.legalCapital === null || settings.legalCapital === undefined ? '' : String(settings.legalCapital),
    legalWebsite: settings.legalWebsite ?? '',
  }) as Record<string, string>;
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(initial()); }, [settings]);

  const saved = initial();
  const hasChanges = [...LEGAL_FIELDS.map(f => f.key), ...EXTRA_LEGAL_KEYS].some(k => (form[k] ?? '') !== (saved[k] ?? ''));
  const capitalInvalid = form.legalCapital !== '' && !(Number(form.legalCapital) >= 0);
  const iceInvalid = !!form.legalIce && !/^\d{15}$/.test(form.legalIce.replace(/\s/g, ''));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({ ...form, legalCapital: form.legalCapital === '' ? null : Number(form.legalCapital) } as Partial<typeof settings>);
      notify.success('Identité légale enregistrée');
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Identité légale">
      <SettingItem title="Forme juridique" description="Mentionnée sur les factures avec le capital">
        <select id="legal-form" value={form.legalForm ?? ''} onChange={(e) => setForm({ ...form, legalForm: e.target.value })} className="input w-full">
          {LEGAL_FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </SettingItem>
      <SettingItem title="Capital social" description="En dirhams">
        <input id="legal-capital" type="number" min="0" step="1000" value={form.legalCapital ?? ''}
          onChange={(e) => setForm({ ...form, legalCapital: e.target.value })}
          className={`input w-full${capitalInvalid ? ' border-red-400' : ''}`} />
      </SettingItem>
      {LEGAL_FIELDS.map(f => (
        <SettingItem key={f.key} title={f.title} description={f.description}>
          <input type="text" value={form[f.key] ?? ''} placeholder={f.placeholder}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            className={`input w-full${f.key === 'legalIce' && iceInvalid ? ' border-red-400' : ''}`} />
        </SettingItem>
      ))}
      <SettingItem title="Site web" description="Pied de page des documents">
        <input id="legal-website" type="text" value={form.legalWebsite ?? ''} placeholder="www.exemple.ma"
          onChange={(e) => setForm({ ...form, legalWebsite: e.target.value })} className="input w-full" />
      </SettingItem>
      <SettingItem title="N° d'affiliation CNSS" description="Tenu dans Personnel › Paie › Paramètres de paie (déclarations sociales)">
        <span className="text-sm text-gray-700">{settings.employerCnssNumber || <span className="text-gray-400">Non renseigné</span>}</span>
      </SettingItem>
      {hasChanges && (
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving || iceInvalid || capitalInvalid}
            className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={16} />}
            Enregistrer l'identité légale
          </button>
        </div>
      )}
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
  { key: 'themeBgSeparator', label: 'Bordures / Separateurs', group: 'Surfaces' },
  { key: 'themeTextStrong', label: 'Titres', group: 'Texte' },
  { key: 'themeTextBody', label: 'Corps de texte', group: 'Texte' },
  { key: 'themeTextMuted', label: 'Texte secondaire', group: 'Texte' },
  { key: 'themeAccent', label: 'Accent principal', group: 'Accents' },
  { key: 'themeAccentHover', label: 'Accent survol', group: 'Accents' },
  { key: 'themeAccentLight', label: 'Accent leger (fond)', group: 'Accents' },
  { key: 'themeCtaColor', label: 'Bouton action (CTA)', group: 'Bouton principal' },
  { key: 'themeCtaText', label: 'Texte du bouton', group: 'Bouton principal' },
];

function AppearanceTab() {
  const { settings, updateSettings } = useSettings();
  const [theme, setTheme] = useState<Record<ThemeKey, string>>(() => ({
    themeBgPage: settings.themeBgPage,
    themeBgCard: settings.themeBgCard,
    themeBgSecondary: settings.themeBgSecondary,
    themeBgSeparator: settings.themeBgSeparator,
    themeTextStrong: settings.themeTextStrong,
    themeTextBody: settings.themeTextBody,
    themeTextMuted: settings.themeTextMuted,
    themeAccent: settings.themeAccent,
    themeAccentHover: settings.themeAccentHover,
    themeAccentLight: settings.themeAccentLight,
    themeCtaColor: settings.themeCtaColor,
    themeCtaText: settings.themeCtaText,
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTheme({
      themeBgPage: settings.themeBgPage,
      themeBgCard: settings.themeBgCard,
      themeBgSecondary: settings.themeBgSecondary,
      themeBgSeparator: settings.themeBgSeparator,
      themeTextStrong: settings.themeTextStrong,
      themeTextBody: settings.themeTextBody,
      themeTextMuted: settings.themeTextMuted,
      themeAccent: settings.themeAccent,
      themeAccentHover: settings.themeAccentHover,
      themeAccentLight: settings.themeAccentLight,
      themeCtaColor: settings.themeCtaColor,
      themeCtaText: settings.themeCtaText,
    });
  }, [settings]);

  const hasChanges = THEME_FIELDS.some(f => theme[f.key] !== (settings as unknown as Record<string, string>)[f.key]);

  const applyPreset = (preset: typeof THEME_PRESETS[0]) => {
    setTheme(preset.values);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(theme);
      notify.success('Apparence enregistree');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setTheme({
      themeBgPage: settings.themeBgPage,
      themeBgCard: settings.themeBgCard,
      themeBgSecondary: settings.themeBgSecondary,
      themeBgSeparator: settings.themeBgSeparator,
      themeTextStrong: settings.themeTextStrong,
      themeTextBody: settings.themeTextBody,
      themeTextMuted: settings.themeTextMuted,
      themeAccent: settings.themeAccent,
      themeAccentHover: settings.themeAccentHover,
      themeAccentLight: settings.themeAccentLight,
      themeCtaColor: settings.themeCtaColor,
      themeCtaText: settings.themeCtaText,
    });
  };

  const setColor = (key: ThemeKey, value: string) => {
    setTheme(prev => ({ ...prev, [key]: value }));
  };

  const groups = [...new Set(THEME_FIELDS.map(f => f.group))];

  return (
    <>
      <div className="flex justify-end gap-2 mb-5">
        {hasChanges && (
          <button onClick={handleReset} className="btn-secondary flex items-center gap-2">
            <RotateCcw size={16} /> Annuler
          </button>
        )}
        <button onClick={handleSave} disabled={saving || !hasChanges}
          className="btn-primary flex items-center gap-2 disabled:opacity-60">
          <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      <SettingsSection
        title="Themes predefinis"
        description="Selectionnez un theme de base puis personnalisez les couleurs"
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
                <input type="color" value={theme[field.key]}
                  onChange={e => setColor(field.key, e.target.value)}
                  className="w-12 h-10 rounded cursor-pointer border border-gray-200 p-0.5" />
                <input type="text" value={theme[field.key]}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value) || e.target.value === '') setColor(field.key, e.target.value); }}
                  className="input flex-1 font-mono text-sm" placeholder="#000000" maxLength={7} />
              </div>
            </SettingItem>
          ))}
        </SettingsSection>
      ))}

      <SettingsSection title="Apercu en direct" columns={1}>
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

function PrintTab() {
  const { settings, updateSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Local state for print settings
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [receiptShowLogo, setReceiptShowLogo] = useState(settings.receiptShowLogo);
  const [receiptLogoSize, setReceiptLogoSize] = useState(settings.receiptLogoSize);
  const [receiptHeader, setReceiptHeader] = useState(settings.receiptHeader);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [receiptFontSize, setReceiptFontSize] = useState(settings.receiptFontSize);
  const [receiptPaperWidth, setReceiptPaperWidth] = useState(settings.receiptPaperWidth);
  const [receiptShowCashier, setReceiptShowCashier] = useState(settings.receiptShowCashier);
  const [receiptShowDate, setReceiptShowDate] = useState(settings.receiptShowDate);
  const [receiptShowPaymentDetail, setReceiptShowPaymentDetail] = useState(settings.receiptShowPaymentDetail);
  const [receiptExtraLines, setReceiptExtraLines] = useState(settings.receiptExtraLines);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(settings.receiptAutoPrint);
  const [receiptOpenDrawer, setReceiptOpenDrawer] = useState(settings.receiptOpenDrawer);
  const [receiptNumCopies, setReceiptNumCopies] = useState(settings.receiptNumCopies);

  useEffect(() => {
    setLogoUrl(settings.logoUrl);
    setReceiptShowLogo(settings.receiptShowLogo);
    setReceiptLogoSize(settings.receiptLogoSize);
    setReceiptHeader(settings.receiptHeader);
    setReceiptFooter(settings.receiptFooter);
    setReceiptFontSize(settings.receiptFontSize);
    setReceiptPaperWidth(settings.receiptPaperWidth);
    setReceiptShowCashier(settings.receiptShowCashier);
    setReceiptShowDate(settings.receiptShowDate);
    setReceiptShowPaymentDetail(settings.receiptShowPaymentDetail);
    setReceiptExtraLines(settings.receiptExtraLines);
    setReceiptAutoPrint(settings.receiptAutoPrint);
    setReceiptOpenDrawer(settings.receiptOpenDrawer);
    setReceiptNumCopies(settings.receiptNumCopies);
  }, [settings]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify.error('Le fichier ne doit pas depasser 10 Mo');
      return;
    }
    setUploading(true);
    try {
      const result = await settingsApi.uploadLogo(file);
      setLogoUrl(result.url);
      notify.success('Logo telecharge');
    } catch {
      notify.error('Erreur lors du telechargement');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
  };

  const handleSavePrint = async () => {
    setSaving(true);
    try {
      await updateSettings({
        logoUrl, receiptShowLogo, receiptLogoSize,
        receiptHeader, receiptFooter, receiptFontSize, receiptPaperWidth,
        receiptShowCashier, receiptShowDate, receiptShowPaymentDetail, receiptExtraLines,
        receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
      });
      notify.success('Parametres d\'impression enregistres');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    logoUrl !== settings.logoUrl ||
    receiptShowLogo !== settings.receiptShowLogo ||
    receiptLogoSize !== settings.receiptLogoSize ||
    receiptHeader !== settings.receiptHeader ||
    receiptFooter !== settings.receiptFooter ||
    receiptFontSize !== settings.receiptFontSize ||
    receiptPaperWidth !== settings.receiptPaperWidth ||
    receiptShowCashier !== settings.receiptShowCashier ||
    receiptShowDate !== settings.receiptShowDate ||
    receiptShowPaymentDetail !== settings.receiptShowPaymentDetail ||
    receiptExtraLines !== settings.receiptExtraLines ||
    receiptAutoPrint !== settings.receiptAutoPrint ||
    receiptOpenDrawer !== settings.receiptOpenDrawer ||
    receiptNumCopies !== settings.receiptNumCopies;

  // Resolve logo source — /uploads paths are proxied to the API server
  const logoSrc = logoUrl || '/images/logo-horizontal.png';

  const nowStr = format(new Date(), "dd MMMM yyyy 'a' HH:mm", { locale: fr });

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-8 items-start">
      {/* Settings panel */}
      <div>
        <div className="flex justify-end mb-5">
          <button onClick={handleSavePrint} disabled={saving || !hasChanges}
            className="btn-primary flex items-center gap-2 disabled:opacity-60">
            <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>

        <div className="mb-8">
          <PrinterSettingsCard />
        </div>

        <SettingsSection title="Logo" columns={1}>
          <div className="flex items-start gap-6 py-2">
            <div className="flex-shrink-0 w-32 h-20 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
              {logoUrl ? (
                <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-center">
                  <Image size={24} className="text-gray-300 mx-auto mb-1" />
                  <span className="text-[10px] text-gray-400">Logo par defaut</span>
                </div>
              )}
            </div>
            <div className="flex-1">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={handleLogoUpload} className="hidden" />
              <p className="text-sm text-gray-500 mb-2">Logo affiche sur les recus et tickets (PNG, JPG, SVG - max 10 Mo)</p>
              <div className="flex gap-2">
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="btn-secondary flex items-center gap-2 text-sm">
                  <Upload size={14} />
                  {uploading ? 'Telechargement...' : 'Telecharger un logo'}
                </button>
                {logoUrl && (
                  <button onClick={handleRemoveLogo}
                    className="btn-secondary text-sm text-red-500 hover:text-red-700">
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>
          <SettingItem
            title="Afficher le logo sur le recu"
            description="Le logo apparait en haut du ticket imprime"
            toggle={{ checked: receiptShowLogo, onChange: setReceiptShowLogo }}
          >
            {receiptShowLogo && (
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Taille du logo (px) : {receiptLogoSize}
                </label>
                <input type="range" min="20" max="80" value={receiptLogoSize}
                  onChange={(e) => setReceiptLogoSize(parseInt(e.target.value))}
                  className="w-full accent-primary-600" />
              </div>
            )}
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Contenu du recu" columns={1}>
          <SettingItem title="En-tete supplementaire" description="Affiche sous le sous-titre (adresse, tel, ICE...)">
            <input type="text" value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)}
              className="input w-full max-w-md" placeholder="Ex: Adresse, telephone, ICE..." />
          </SettingItem>
          <SettingItem title="Message de pied de page" description="Texte de remerciement en bas du ticket">
            <input type="text" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)}
              className="input w-full max-w-md" placeholder="Merci pour votre visite !" />
          </SettingItem>
          <SettingItem title="Lignes supplementaires" description="Chaque ligne sera affichee en bas du recu">
            <textarea value={receiptExtraLines} onChange={(e) => setReceiptExtraLines(e.target.value)}
              className="input w-full max-w-md" rows={3}
              placeholder="Ex: Horaires d'ouverture, conditions de retour..." />
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Options d'affichage">
          <SettingItem title="Nom du caissier" description="Affiche le caissier sur le ticket"
            toggle={{ checked: receiptShowCashier, onChange: setReceiptShowCashier }} />
          <SettingItem title="Date et heure" description="Affiche la date de la vente"
            toggle={{ checked: receiptShowDate, onChange: setReceiptShowDate }} />
          <SettingItem title="Detail du paiement" description="Especes recues et monnaie rendue"
            toggle={{ checked: receiptShowPaymentDetail, onChange: setReceiptShowPaymentDetail }} />
        </SettingsSection>

        <SettingsSection title="Imprimante thermique" columns={1}>
          <SettingItem
            title="Impression automatique"
            description="Le recu s'imprime apres chaque encaissement sans cliquer sur Imprimer"
            toggle={{ checked: receiptAutoPrint, onChange: setReceiptAutoPrint }}
          />
          <SettingItem
            title="Ouvrir le tiroir-caisse"
            description="Le tiroir s'ouvre a chaque impression (necessite un tiroir connecte a l'imprimante)"
            toggle={{ checked: receiptOpenDrawer, onChange: setReceiptOpenDrawer }}
          />
          <SettingItem title="Nombre de copies" description="Nombre de recus imprimes a chaque vente">
            <select value={receiptNumCopies} onChange={(e) => setReceiptNumCopies(parseInt(e.target.value))}
              className="input w-40">
              <option value={1}>1 copie</option>
              <option value={2}>2 copies</option>
              <option value={3}>3 copies</option>
            </select>
          </SettingItem>
          <div className="mt-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
            <h4 className="text-sm font-semibold text-blue-800 mb-2">Configuration de l'imprimante</h4>
            <ul className="text-xs text-blue-700 space-y-1.5">
              <li>1. Connectez votre imprimante thermique (USB ou reseau)</li>
              <li>2. Installez le pilote de l'imprimante sur votre ordinateur</li>
              <li>3. Dans les parametres d'impression du navigateur, selectionnez votre imprimante thermique comme imprimante par defaut</li>
              <li>4. Desactivez les en-tetes et pieds de page du navigateur dans les parametres d'impression</li>
              <li>5. Le tiroir-caisse doit etre connecte au port RJ11/DK de l'imprimante</li>
            </ul>
          </div>
        </SettingsSection>

        <SettingsSection title="Format d'impression">
          <SettingItem title="Taille de police" description={`Texte du ticket : ${receiptFontSize}px`}>
            <input type="range" min="9" max="16" value={receiptFontSize}
              onChange={(e) => setReceiptFontSize(parseInt(e.target.value))}
              className="w-full max-w-xs accent-primary-600" />
          </SettingItem>
          <SettingItem title="Largeur du papier" description="Format du rouleau thermique">
            <select value={receiptPaperWidth} onChange={(e) => setReceiptPaperWidth(parseInt(e.target.value))}
              className="input w-44">
              <option value={58}>58 mm (petit)</option>
              <option value={80}>80 mm (standard)</option>
            </select>
          </SettingItem>
        </SettingsSection>
      </div>

        {/* Live receipt preview */}
        <div className="lg:sticky lg:top-4 h-fit">
          <div className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Apercu du recu</h3>
            </div>
            <div className="bg-white border border-gray-200 shadow-sm rounded-lg p-3 overflow-hidden" style={{ maxWidth: `${Math.min(receiptPaperWidth * 3.2, 280)}px`, margin: '0 auto' }}>
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
      description="Boutique, commande, événement, gros, livraison... Chaque vente est rattachée à un canal. Les prix peuvent être différents par canal (voir fiche produit)."
    >
      {isLoading ? (
        <div className="text-sm text-gray-500">Chargement...</div>
      ) : (
        <div className="sm:col-span-2 space-y-2">
          {channels.map(c => (
            <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full" style={{ backgroundColor: c.color }} />
                <div>
                  <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    {c.label}
                    {c.is_default && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">Par défaut</span>}
                    {!c.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactif</span>}
                  </div>
                  <div className="text-xs text-gray-400 font-mono">{c.code}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!c.is_default && c.is_active && (
                  <button onClick={() => handleSetDefault(c)}
                    className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-medium">
                    Définir par défaut
                  </button>
                )}
                {!c.is_default && c.is_active && (
                  <button onClick={() => deactivateMutation.mutate(c.id)}
                    className="text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded font-medium">
                    Désactiver
                  </button>
                )}
                {!c.is_active && (
                  <button onClick={() => updateMutation.mutate({ id: c.id, data: { isActive: true } })}
                    className="text-xs px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded font-medium">
                    Réactiver
                  </button>
                )}
              </div>
            </div>
          ))}

          {showAddForm ? (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input type="text" placeholder="code (ex: pro_b2b)"
                  value={newCode} onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="input text-sm" />
                <input type="text" placeholder="Libellé"
                  value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  className="input text-sm" />
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                  className="w-full h-10 rounded border border-gray-200" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddForm(false)} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded">Annuler</button>
                <button
                  onClick={() => createMutation.mutate({ code: newCode, label: newLabel, color: newColor })}
                  disabled={!newCode || !newLabel || createMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50">
                  Créer
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddForm(true)}
              className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg text-sm font-medium border border-dashed border-gray-300">
              + Ajouter un canal
            </button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

/* ============ AUTRES REGLAGES (liens) ============ */

/** Réglages gérés dans leur propre écran, regroupés ici pour être trouvés (lot 4). */
function OtherSettingsLinks({ onOpen }: { onOpen: (tab: SettingsTab) => void }) {
  const links: { label: string; help: string; action: () => void; cta: string }[] = [
    { label: 'Numérotation des pièces', help: 'Modèles et compteurs des BC, factures, tickets, bons de sortie.', action: () => onOpen('numbering'), cta: 'Ouvrir' },
    { label: 'Journal des modifications', help: 'Qui a changé quoi, quand, avec l\'ancienne valeur.', action: () => onOpen('audit'), cta: 'Ouvrir' },
    { label: 'Rôles et contrôle des droits', help: 'Droits par rôle, mode observation ou blocage.', action: () => { window.location.href = '/users'; }, cta: 'Utilisateurs' },
    { label: 'Paramètres de paie', help: 'CNSS employeur, base de jours, heures supplémentaires, congés : Personnel › Paie › Paramètres de paie.', action: () => { window.location.href = '/employees'; }, cta: 'Personnel' },
  ];
  return (
    <SettingsSection title="Autres réglages" description="Gérés dans leur écran dédié.">
      {links.map(l => (
        <SettingItem key={l.label} title={l.label} description={l.help}>
          <button type="button" onClick={l.action} className="btn-secondary">{l.cta}</button>
        </SettingItem>
      ))}
    </SettingsSection>
  );
}
