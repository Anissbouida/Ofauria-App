import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { settingsApi } from '../../api/settings.api';
import { storesApi } from '../../api/stores.api';
import { referentielApi } from '../../api/referentiel.api';
import { salesChannelsApi, type SalesChannel } from '../../api/sales-channels.api';
import {
  Save, Building2, RotateCcw, MapPin, Plus, Pencil, Trash2, Store,
  Printer, Upload, Image, Eye, Type,
  Database, Check, X, Search, Download,
  ChevronLeft, RotateCw, History, BarChart3, EyeOff, Users,
  Paintbrush, ChevronDown, ChevronUp, ShoppingBag,
  Wallet, Factory, Package, ChevronRight,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import PrinterSettingsCard from './PrinterSettingsCard';
import SachetsTab from './SachetsTab';
import ProductionMarkupTab from './ProductionMarkupTab';
import { SettingsSection, SettingItem } from './SettingsPrimitives';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type SettingsTab = 'general' | 'appearance' | 'print' | 'stores' | 'referentiel' | 'production' | 'sachets';

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [tabSearch, setTabSearch] = useState('');

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [subtitle, setSubtitle] = useState(settings.subtitle);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setSubtitle(settings.subtitle);
  }, [settings]);

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Acces reserve aux administrateurs.</p>
      </div>
    );
  }

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

  const tabs: { key: SettingsTab; label: string; description: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'General', description: 'Nom et identite de l\'entreprise', icon: <Building2 size={18} /> },
    { key: 'appearance', label: 'Apparence', description: 'Theme, couleurs et affichage', icon: <Paintbrush size={18} /> },
    { key: 'print', label: 'Impression', description: 'Tickets de caisse et imprimantes', icon: <Printer size={18} /> },
    { key: 'stores', label: 'Points de vente', description: 'Magasins et boutiques', icon: <Store size={18} /> },
    { key: 'referentiel', label: 'Referentiel', description: 'Tables de parametrage', icon: <Database size={18} /> },
    { key: 'production', label: 'Production', description: 'Charges fixes et couts', icon: <BarChart3 size={18} /> },
    { key: 'sachets', label: 'Sachets', description: 'Controle des sachets de caisse', icon: <ShoppingBag size={18} /> },
  ];

  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const search = normalize(tabSearch.trim());
  const filteredTabs = search
    ? tabs.filter((t) => normalize(t.label).includes(search) || normalize(t.description).includes(search))
    : tabs;

  const activeMeta = tabs.find((t) => t.key === activeTab);

  const tabContent = (
    <>
      {activeTab === 'general' && (
        <GeneralTab
          companyName={companyName} setCompanyName={setCompanyName}
          subtitle={subtitle} setSubtitle={setSubtitle}
        />
      )}
      {activeTab === 'appearance' && <AppearanceTab />}
      {activeTab === 'print' && <PrintTab />}
      {activeTab === 'stores' && <StoresSection />}
      {activeTab === 'referentiel' && <ReferentielTab />}
      {activeTab === 'production' && (
        <>
          <ProductionChargesTab />
          <PriceRoundingTab />
          <SalesChannelsTab />
          <ProductionMarkupTab />
        </>
      )}
      {activeTab === 'sachets' && <SachetsTab />}
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
      {activeTab === 'general' && (
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
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Parametres</h1>

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
              const isActive = activeTab === tab.key;
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
            className="input w-full" placeholder="OFAURIA" />
        </SettingItem>
        <SettingItem title="Sous-titre" description="Texte affiche sous le logo">
          <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
            className="input w-full" placeholder="Boulangerie & Patisserie" />
        </SettingItem>
      </SettingsSection>

      <StaffDiscountSection />
    </>
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
                    <span className="text-[6px] font-bold" style={{ color: preset.values.themeCtaText }}>OFAURIA</span>
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
            <span className="font-bold tracking-wide" style={{ color: theme.themeCtaText }}>OFAURIA</span>
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

/* ─── Staff Discount Section ─── */
function StaffDiscountSection() {
  const { settings, updateSettings } = useSettings();
  const [discount, setDiscount] = useState(settings.staffDiscountPercent ?? 10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDiscount(settings.staffDiscountPercent ?? 10);
  }, [settings.staffDiscountPercent]);

  const hasChanges = discount !== (settings.staffDiscountPercent ?? 10);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({ staffDiscountPercent: discount });
      notify.success('Remise personnel enregistree');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Commandes personnel">
      <SettingItem
        title="Remise personnel"
        description="Remise appliquee automatiquement aux commandes du personnel (ex: 10 = -10%)"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-32">
            <input type="number" min={0} max={100} step={1} value={discount}
              onChange={(e) => setDiscount(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
              className="input w-full font-bold pr-8" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
          </div>
          {hasChanges && (
            <button onClick={handleSave} disabled={saving}
              className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={16} />}
              Enregistrer
            </button>
          )}
        </div>
      </SettingItem>
    </SettingsSection>
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
    if (file.size > 2 * 1024 * 1024) {
      notify.error('Le fichier ne doit pas depasser 2 Mo');
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
              <p className="text-sm text-gray-500 mb-2">Logo affiche sur les recus et tickets (PNG, JPG, SVG - max 2 Mo)</p>
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

/* ============ TOGGLE SWITCH ============ */

function ToggleSwitch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-primary-600' : 'bg-gray-200'
        }`}
        style={checked ? { backgroundColor: 'var(--color-primary)' } : undefined}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </label>
  );
}

/* ============ STORES SECTION ============ */

function StoresSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editStore, setEditStore] = useState<Record<string, any> | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: storesApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => storesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => storesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: storesApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stores'] }),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditStore(null);
    setName('');
    setCity('');
    setAddress('');
    setPhone('');
  };

  const openEdit = (store: Record<string, any>) => {
    setEditStore(store);
    setName(store.name as string);
    setCity((store.city as string) || '');
    setAddress((store.address as string) || '');
    setPhone((store.phone as string) || '');
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), city: city.trim() || undefined, address: address.trim() || undefined, phone: phone.trim() || undefined };
    if (editStore) {
      updateMutation.mutate({ id: editStore.id as string, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {stores.length} point{stores.length > 1 ? 's' : ''} de vente configure{stores.length > 1 ? 's' : ''}
        </p>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} /> Ajouter
        </button>
      </div>

      {/* Store list */}
      <div className="divide-y divide-gray-100">
        {stores.map((store: Record<string, any>) => (
          <div key={store.id as string}
            className="flex items-center justify-between py-3 hover:bg-gray-50 transition-colors -mx-2 px-2 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <MapPin size={18} className="text-primary-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">{store.name as string}</p>
                <p className="text-sm text-gray-500">
                  {[store.city, store.address].filter(Boolean).join(' — ') || 'Aucune adresse'}
                  {store.phone as unknown as boolean && <span className="ml-2">| {String(store.phone)}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 mr-2">
                {store.user_count as number} utilisateur{(store.user_count as number) > 1 ? 's' : ''}
              </span>
              <button onClick={() => openEdit(store)}
                className="p-2 hover:bg-gray-100 rounded-lg">
                <Pencil size={16} className="text-gray-500" />
              </button>
              {(store.user_count as number) === 0 && (
                <button onClick={() => { if (confirm('Supprimer ce point de vente ?')) deleteMutation.mutate(store.id as string); }}
                  className="p-2 hover:bg-red-50 rounded-lg">
                  <Trash2 size={16} className="text-red-500" />
                </button>
              )}
            </div>
          </div>
        ))}
        {stores.length === 0 && (
          <p className="text-center py-6 text-gray-400">Aucun point de vente configure</p>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <h3 className="font-semibold text-gray-700 mb-3">
            {editStore ? 'Modifier le point de vente' : 'Nouveau point de vente'}
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nom *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="input" placeholder="Ex: Boutique Casablanca" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ville</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
                className="input" placeholder="Ex: Casablanca" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Adresse</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                className="input" placeholder="Ex: 123 Bd Mohammed V" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Telephone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="input" placeholder="Ex: 0522-123456" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="btn-secondary text-sm">Annuler</button>
            <button onClick={handleSubmit} disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
              className="btn-primary text-sm">
              {editStore ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ REFERENTIEL TAB ============ */

function ReferentielTab() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'table'>('dashboard');

  const openTable = (tableId: string) => {
    setSelectedTable(tableId);
    setView('table');
  };

  const goBack = () => {
    setSelectedTable(null);
    setView('dashboard');
  };

  if (view === 'table' && selectedTable) {
    return <ParamTable tableId={selectedTable} onBack={goBack} />;
  }

  return <RefDashboard onOpenTable={openTable} />;
}

/* ============ REFERENTIEL DASHBOARD ============ */

function RefDashboard({ onOpenTable }: { onOpenTable: (id: string) => void }) {
  const [dashSearch, setDashSearch] = useState('');
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const toggleDomain = (key: string) =>
    setCollapsedDomains((prev) => ({ ...prev, [key]: !prev[key] }));
  const { data, isLoading } = useQuery({
    queryKey: ['ref-dashboard'],
    queryFn: referentielApi.dashboard,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
      </div>
    );
  }

  const tables = (data?.tables || []) as Record<string, any>[];
  const recentChanges = (data?.recentChanges || []) as Record<string, any>[];
  const totalActive = tables.reduce((s: number, t: Record<string, any>) => s + ((t.active_count as number) || 0), 0);
  const totalInactive = tables.reduce((s: number, t: Record<string, any>) => s + ((t.inactive_count as number) || 0), 0);

  // Regroupement des tables par domaine metier. Les ids absents de cette
  // config tombent dans le domaine "Autres" pour ne jamais etre masques.
  const REF_DOMAINS: { key: string; label: string; icon: typeof Database; tableIds: string[] }[] = [
    { key: 'sales', label: 'Ventes & Comptabilite', icon: Wallet,
      tableIds: ['expense_categories', 'revenue_categories', 'payment_methods'] },
    { key: 'products', label: 'Produits & Ingredients', icon: Package,
      tableIds: ['product_categories', 'units', 'ingredient_categories'] },
    { key: 'production', label: 'Production & Pertes', icon: Factory,
      tableIds: ['yield_units', 'loss_types', 'loss_reasons', 'production_loss_reasons', 'unsold_destinations'] },
    { key: 'hr', label: 'Ressources humaines', icon: Users,
      tableIds: ['absence_reasons', 'employee_roles', 'contract_types', 'leave_types'] },
  ];
  const domainOf = (id: string) =>
    REF_DOMAINS.find((d) => d.tableIds.includes(id))?.key ?? 'other';

  const filteredTables = tables.filter(t => {
    if (!dashSearch) return true;
    const q = dashSearch.toLowerCase();
    return String(t.label).toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q);
  });

  // Construit la liste des sections affichees (domaines connus + "Autres").
  const sections = [
    ...REF_DOMAINS.map((d) => ({
      ...d,
      tables: filteredTables.filter((t) => domainOf(String(t.id)) === d.key),
    })),
    {
      key: 'other', label: 'Autres', icon: Database,
      tableIds: [] as string[],
      tables: filteredTables.filter((t) => domainOf(String(t.id)) === 'other'),
    },
  ].filter((s) => s.tables.length > 0);

  const actionLabels: Record<string, string> = {
    create: 'Ajout', update: 'Modification', deactivate: 'Desactivation', reactivate: 'Reactivation',
  };
  const actionColors: Record<string, string> = {
    create: 'bg-green-100 text-green-700', update: 'bg-blue-100 text-blue-700',
    deactivate: 'bg-red-100 text-red-700', reactivate: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* Colonne principale */}
      <div className="flex-1 min-w-0 w-full">
        {/* Resume */}
        <p className="text-xs text-gray-400 mb-3">
          {tables.length} tables &middot;{' '}
          <span className="text-emerald-600 font-medium">{totalActive}</span> entrees actives
          {totalInactive > 0 && (
            <> &middot; <span className="text-amber-500 font-medium">{totalInactive}</span> inactives</>
          )}
        </p>

        {/* Recherche */}
        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={dashSearch} onChange={e => setDashSearch(e.target.value)}
            placeholder="Rechercher une table de parametrage..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300" />
        </div>

        {/* Sections par domaine */}
        {sections.map((section) => {
          const DomainIcon = section.icon;
          // En recherche, on garde tout deplie pour voir les resultats.
          const isCollapsed = !dashSearch && collapsedDomains[section.key];
          return (
            <div key={section.key} className="mb-7 last:mb-0">
              <button
                type="button"
                onClick={() => toggleDomain(section.key)}
                className="w-full flex items-center gap-2 border-b-2 border-primary-100 pb-1.5 mb-1 group"
              >
                <DomainIcon size={15} className="text-gray-400" />
                <h3 className="text-[13px] font-bold text-gray-700 uppercase tracking-wide">{section.label}</h3>
                <span className="text-xs font-medium text-gray-400">({section.tables.length})</span>
                <span className="flex-1" />
                {isCollapsed
                  ? <ChevronDown size={15} className="text-gray-400 group-hover:text-gray-600" />
                  : <ChevronUp size={15} className="text-gray-400 group-hover:text-gray-600" />}
              </button>
              {!isCollapsed && (
                <div>
                  {section.tables.map((t) => {
                    const count = (t.active_count as number) || 0;
                    const inactiveCount = (t.inactive_count as number) || 0;
                    return (
                      <button key={String(t.id)} onClick={() => onOpenTable(String(t.id))}
                        className="w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left group hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 group-hover:text-primary-700 transition-colors">
                            {String(t.label)}
                          </p>
                          {Boolean(t.description) && (
                            <p className="text-xs text-gray-500 truncate">{String(t.description)}</p>
                          )}
                        </div>
                        {inactiveCount > 0 && (
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">
                            {inactiveCount} inactif{inactiveCount > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-sm font-bold text-gray-700 tabular-nums w-10 text-right flex-shrink-0">
                          {count}
                        </span>
                        <ChevronRight size={15} className="text-gray-300 group-hover:text-primary-500 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sections.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">Aucune table ne correspond a votre recherche</div>
        )}
      </div>

      {/* Panneau lateral : historique */}
      {recentChanges.length > 0 && (
        <aside className="w-full xl:w-72 xl:flex-shrink-0">
          <div className="border border-gray-200 rounded-lg overflow-hidden xl:sticky xl:top-4">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50/60">
              <History size={15} className="text-gray-400" />
              <h3 className="text-[13px] font-bold text-gray-700 uppercase tracking-wide">Historique</h3>
            </div>
            <div className="divide-y divide-gray-100 max-h-[26rem] overflow-y-auto">
              {recentChanges.slice(0, 20).map((log) => {
                const action = String(log.action);
                return (
                  <div key={String(log.id)} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${actionColors[action] || 'bg-gray-100 text-gray-600'}`}>
                        {actionLabels[action] || action}
                      </span>
                      <span className="text-sm text-gray-700 font-medium truncate">
                        {String(log.table_label || log.table_id)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span className="truncate">
                        {log.first_name ? `${String(log.first_name)} ${String(log.last_name || '')}`.trim() : '—'}
                      </span>
                      <span className="flex-1" />
                      <span className="whitespace-nowrap">
                        {log.created_at ? format(new Date(String(log.created_at)), 'dd/MM HH:mm', { locale: fr }) : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/* ============ UNIVERSAL PARAM TABLE COMPONENT ============ */

function ParamTable({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Record<string, any> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [showAudit, setShowAudit] = useState(false);

  // Form state
  const [fLabel, setFLabel] = useState('');
  const [fCode, setFCode] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [fColor, setFColor] = useState('');
  const [fMetadata, setFMetadata] = useState<Record<string, any>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['ref-entries', tableId, showInactive],
    queryFn: () => referentielApi.entries(tableId, showInactive),
  });

  const { data: auditData } = useQuery({
    queryKey: ['ref-audit', tableId],
    queryFn: () => referentielApi.audit(tableId),
    enabled: showAudit,
  });

  const table = data?.table as Record<string, any> | undefined;
  const entries = (data?.entries || []) as Record<string, any>[];
  const isNative = table?.source === 'native';
  const isHierarchical = tableId === 'expense_categories' || tableId === 'revenue_categories';

  const createMutation = useMutation({
    mutationFn: (d: Record<string, any>) => referentielApi.create(tableId, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ref-entries', tableId] });
      queryClient.invalidateQueries({ queryKey: ['ref-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['ref-audit', tableId] });
      // Also invalidate native caches so dropdowns update
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      notify.success('Entree ajoutee');
      resetForm();
    },
    onError: () => notify.error('Erreur lors de la creation'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Record<string, any> }) => referentielApi.update(tableId, id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ref-entries', tableId] });
      queryClient.invalidateQueries({ queryKey: ['ref-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['ref-audit', tableId] });
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      notify.success('Entree modifiee');
      resetForm();
    },
    onError: () => notify.error('Erreur lors de la modification'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => referentielApi.remove(tableId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ref-entries', tableId] });
      queryClient.invalidateQueries({ queryKey: ['ref-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      notify.success(isNative ? 'Entree supprimee' : 'Entree desactivee');
    },
    onError: (err: Error & { response?: { data?: { error?: { message?: string; usageCount?: number } } } }) => {
      const msg = err.response?.data?.error?.message || 'Impossible de supprimer';
      notify.error(msg);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => referentielApi.reactivate(tableId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ref-entries', tableId] });
      queryClient.invalidateQueries({ queryKey: ['ref-dashboard'] });
      notify.success('Entree reactivee');
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditItem(null);
    setFLabel(''); setFCode(''); setFDescription(''); setFColor('');
    setFMetadata({});
  };

  const openEdit = (entry: Record<string, any>) => {
    setEditItem(entry);
    setFLabel(String(entry.label || ''));
    setFCode(String(entry.code || ''));
    setFDescription(String(entry.description || ''));
    setFColor(String(entry.color || ''));
    setFMetadata((entry.metadata as Record<string, any>) || {});
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!fLabel.trim()) return;
    const payload: Record<string, any> = {
      label: fLabel.trim(),
      code: fCode.trim() || undefined,
      description: fDescription.trim() || undefined,
      color: fColor || undefined,
      metadata: Object.keys(fMetadata).length > 0 ? fMetadata : undefined,
    };
    if (editItem) {
      updateMutation.mutate({ id: String(editItem.id), d: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Filter by search
  const filtered = entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(e.label || '').toLowerCase().includes(q)
      || String(e.code || '').toLowerCase().includes(q)
      || String(e.description || '').toLowerCase().includes(q);
  });

  const activeCount = entries.filter(e => e.is_active !== false).length;
  const inactiveCount = entries.filter(e => e.is_active === false).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack}
              className="p-2.5 hover:bg-gray-100 rounded-xl transition-colors border border-gray-200">
              <ChevronLeft size={18} className="text-gray-500" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-800">{String(table?.label || tableId)}</h2>
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-700">{activeCount}</span> actif{activeCount > 1 ? 's' : ''}
                {inactiveCount > 0 && <span className="text-amber-500 ml-1.5">· {inactiveCount} inactif{inactiveCount > 1 ? 's' : ''}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAudit(!showAudit)}
              className={`p-2.5 rounded-xl border transition-colors ${showAudit ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'hover:bg-gray-50 border-gray-200 text-gray-400'}`}
              title="Historique">
              <History size={18} />
            </button>
            <button onClick={() => referentielApi.exportCsv(tableId, entries, String(table?.label || tableId))}
              className="p-2.5 hover:bg-gray-50 rounded-xl border border-gray-200 text-gray-400" title="Exporter CSV">
              <Download size={18} />
            </button>
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl">
              <Plus size={16} /> Ajouter
            </button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors" placeholder="Rechercher par libelle, code..." />
          </div>
          {!isNative && (
            <button onClick={() => setShowInactive(!showInactive)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                showInactive
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {showInactive ? <Eye size={14} /> : <EyeOff size={14} />}
              {showInactive ? 'Masquer inactifs' : 'Voir inactifs'}
            </button>
          )}
        </div>
      </div>

      {/* Audit log panel */}
      {showAudit && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <History size={16} className="text-indigo-500" />
            <h3 className="font-semibold text-gray-700 text-sm">Historique des modifications</h3>
          </div>
          <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
            {(auditData as Record<string, any>[] || []).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Aucune modification enregistree</p>
            )}
            {(auditData as Record<string, any>[] || []).slice(0, 30).map((log: Record<string, any>) => {
              const actionLabels: Record<string, string> = {
                create: 'Ajout', update: 'Modification', deactivate: 'Desactivation', reactivate: 'Reactivation',
              };
              const actionColors: Record<string, string> = {
                create: 'bg-green-100 text-green-700', update: 'bg-blue-100 text-blue-700',
                deactivate: 'bg-red-100 text-red-700', reactivate: 'bg-amber-100 text-amber-700',
              };
              const action = String(log.action);
              return (
                <div key={String(log.id)} className="flex items-center gap-3 text-xs py-2.5 px-5 hover:bg-gray-50/50">
                  <span className={`font-semibold px-2 py-0.5 rounded-full ${actionColors[action] || 'bg-gray-100 text-gray-600'}`}>
                    {actionLabels[action] || action}
                  </span>
                  <span className="text-gray-600 font-medium">
                    {log.first_name ? `${String(log.first_name)} ${String(log.last_name || '')}`.trim() : 'Systeme'}
                  </span>
                  <span className="flex-1" />
                  <span className="text-gray-400">
                    {log.created_at ? format(new Date(String(log.created_at)), 'dd/MM/yyyy HH:mm', { locale: fr }) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entries list — hierarchical or flat */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isHierarchical ? (
          <div className="p-5">
            <HierarchicalEntryList
              entries={filtered}
              onEdit={openEdit}
              onDelete={(id) => deleteMutation.mutate(id)}
              onReactivate={(id) => reactivateMutation.mutate(id)}
              onAddChild={(parent) => {
                resetForm();
                const parentLevel = (parent._level as number) || (parent.metadata as Record<string, any>)?.level as number || 1;
                setFMetadata({
                  ...fMetadata,
                  parent_id: String(parent.id),
                  level: parentLevel + 1,
                });
                setShowForm(true);
              }}
              isNative={isNative}
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((entry) => (
              <EntryRow key={String(entry.id)} entry={entry} onEdit={openEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                onReactivate={(id) => reactivateMutation.mutate(id)}
                isNative={isNative} indent={0} />
            ))}
          </div>
        )}
        {filtered.length === 0 && (
          <p className="text-center py-10 text-gray-400 text-sm">
            {search ? 'Aucun resultat pour cette recherche' : 'Aucune entree dans cette table'}
          </p>
        )}
      </div>

      {/* Add/Edit form — Modal overlay */}
      {showForm && (
        <ModalBackdrop onClose={resetForm} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-gray-800">
                {editItem ? 'Modifier l\'entree' : 'Nouvelle entree'}
                {Boolean(fMetadata.parent_id) && (
                  <span className="text-xs font-normal text-gray-400 ml-2">
                    (sous {String(entries.find(e => String(e.id) === String(fMetadata.parent_id))?.label || '...')})
                  </span>
                )}
              </h3>
              <button onClick={resetForm} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Libelle *</label>
                  <input type="text" value={fLabel} onChange={(e) => setFLabel(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder={isHierarchical ? 'Ex: Charges sociales' : 'Ex: Kilogramme'} autoFocus />
                </div>
                {!isHierarchical && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Code (optionnel)</label>
                    <input type="text" value={fCode} onChange={(e) => setFCode(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ex: kg" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
                <input type="text" value={fDescription} onChange={(e) => setFDescription(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Description optionnelle" />
              </div>

              {!isHierarchical && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Couleur</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={fColor || '#6b7280'} onChange={(e) => setFColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200" />
                    <input type="text" value={fColor} onChange={(e) => setFColor(e.target.value)}
                      className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="#6b7280" />
                    {fColor && (
                      <button onClick={() => setFColor('')} className="p-2 hover:bg-gray-100 rounded-lg">
                        <X size={16} className="text-gray-400" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Expense-specific: requires_po toggle */}
              {tableId === 'expense_categories' && (
                <ToggleSwitch
                  label="Bon de commande requis"
                  checked={Boolean(fMetadata.requires_po)}
                  onChange={(v) => setFMetadata({ ...fMetadata, requires_po: v })}
                />
              )}
            </div>
            <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 bg-gray-50/30">
              <button onClick={resetForm} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">Annuler</button>
              <button onClick={handleSubmit}
                disabled={!fLabel.trim() || createMutation.isPending || updateMutation.isPending}
                className="btn-primary text-sm px-5 py-2.5 rounded-xl">
                {editItem ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

/* ============ HIERARCHICAL ENTRY LIST ============ */

const LEVEL_LABELS = ['Categorie', 'Sous-categorie', 'Type'];

function HierarchicalEntryList({
  entries,
  onEdit,
  onDelete,
  onReactivate,
  onAddChild,
  isNative,
}: {
  entries: Record<string, any>[];
  onEdit: (e: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
  onAddChild: (parent: Record<string, any>) => void;
  isNative: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  // Build tree structure
  const level1 = entries.filter(e => (e._level as number) === 1);
  const level2 = entries.filter(e => (e._level as number) === 2);
  const level3 = entries.filter(e => (e._level as number) === 3);

  const getChildren = (parentId: string, fromLevel: Record<string, any>[]) =>
    fromLevel.filter(e => String(e._parent_id) === parentId);

  if (level1.length === 0 && entries.length > 0) {
    // Flat list fallback
    return (
      <div className="divide-y divide-gray-100">
        {entries.map((entry) => (
          <EntryRow key={String(entry.id)} entry={entry} onEdit={onEdit}
            onDelete={onDelete} onReactivate={onReactivate} isNative={isNative} indent={0} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {level1.map((cat) => {
        const catId = String(cat.id);
        const children2 = getChildren(catId, level2);
        const directChildren3 = getChildren(catId, level3);
        const inactive = cat.is_active === false;
        const isCollapsed = collapsed[catId];
        const childCount = children2.length + directChildren3.length;

        return (
          <div key={catId} className={`rounded-xl border overflow-hidden ${inactive ? 'opacity-50 border-gray-200' : 'border-gray-200 shadow-sm'}`}>
            {/* Level 1 header */}
            <div className={`flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-700 text-white`}>
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => toggleCollapse(catId)}
                  className="p-1 hover:bg-white/10 rounded-md transition-colors flex-shrink-0">
                  {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
                <span className="font-semibold text-sm">{String(cat.label)}</span>
                <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full">{LEVEL_LABELS[0]}</span>
                {Boolean(cat._requires_po) && (
                  <span className="text-[10px] bg-blue-400/25 text-blue-200 px-2 py-0.5 rounded-full font-medium">BC requis</span>
                )}
                <span className="text-[10px] text-white/50">{childCount} element{childCount > 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-0.5">
                {!inactive && (
                  <button onClick={() => onAddChild(cat)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                    title="Ajouter une sous-categorie">
                    <Plus size={15} />
                  </button>
                )}
                <button onClick={() => onEdit(cat)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" title="Modifier">
                  <Pencil size={14} />
                </button>
                <button onClick={() => { if (confirm('Desactiver cette categorie et tous ses enfants ?')) onDelete(catId); }}
                  className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors" title="Desactiver">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Level 2 subcategories — collapsible */}
            {!isCollapsed && (
              <div className="divide-y divide-gray-100">
                {children2.map((sub) => {
                  const subId = String(sub.id);
                  const children3 = getChildren(subId, level3);
                  const subInactive = sub.is_active === false;
                  const subCollapsed = collapsed[subId];
                  return (
                    <div key={subId} className={subInactive ? 'opacity-50' : ''}>
                      {/* Level 2 row */}
                      <div className="flex items-center justify-between px-5 py-3 bg-gray-50/80 group">
                        <div className="flex items-center gap-2.5">
                          {children3.length > 0 && (
                            <button onClick={() => toggleCollapse(subId)}
                              className="p-0.5 hover:bg-gray-200 rounded transition-colors">
                              {subCollapsed ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronUp size={14} className="text-gray-400" />}
                            </button>
                          )}
                          <div className="w-2 h-2 rounded-full bg-gray-400" />
                          <span className="font-semibold text-sm text-gray-700">{String(sub.label)}</span>
                          <span className="text-[10px] text-gray-400 bg-gray-200/60 px-1.5 py-0.5 rounded-full">{LEVEL_LABELS[1]}</span>
                          {children3.length > 0 && (
                            <span className="text-[10px] text-gray-400">{children3.length}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!subInactive && (
                            <button onClick={() => onAddChild(sub)} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                              title="Ajouter un type">
                              <Plus size={14} className="text-gray-500" />
                            </button>
                          )}
                          <button onClick={() => onEdit(sub)} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors" title="Modifier">
                            <Pencil size={14} className="text-gray-400" />
                          </button>
                          <button onClick={() => { if (confirm('Desactiver cette sous-categorie ?')) onDelete(subId); }}
                            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors" title="Desactiver">
                            <Trash2 size={14} className="text-red-400" />
                          </button>
                        </div>
                      </div>
                      {/* Level 3 types under this subcategory */}
                      {!subCollapsed && children3.map((type) => (
                        <EntryRow key={String(type.id)} entry={type} onEdit={onEdit}
                          onDelete={onDelete} onReactivate={onReactivate} isNative={isNative} indent={2} />
                      ))}
                    </div>
                  );
                })}

                {/* Level 3 types directly under level 1 (no subcategory) */}
                {directChildren3.map((type) => (
                  <EntryRow key={String(type.id)} entry={type} onEdit={onEdit}
                    onDelete={onDelete} onReactivate={onReactivate} isNative={isNative} indent={1} />
                ))}
              </div>
            )}

            {!isCollapsed && children2.length === 0 && directChildren3.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">Aucun element — cliquez + pour ajouter</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============ SINGLE ENTRY ROW ============ */

function EntryRow({
  entry, onEdit, onDelete, onReactivate, isNative, indent,
}: {
  entry: Record<string, any>;
  onEdit: (e: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
  isNative: boolean;
  indent: number;
}) {
  const inactive = entry.is_active === false;
  const paddingLeft = indent === 0 ? 'pl-5' : indent === 1 ? 'pl-10' : 'pl-14';

  return (
    <div className={`flex items-center justify-between py-3.5 pr-4 ${paddingLeft} ${
      inactive ? 'opacity-50 bg-gray-50/80' : 'hover:bg-indigo-50/30'
    } transition-colors group`}>
      <div className="flex items-center gap-3 min-w-0">
        {entry.color ? (
          <div className="w-4 h-4 rounded-md flex-shrink-0 ring-2 ring-white shadow-sm" style={{ backgroundColor: String(entry.color) }} />
        ) : (
          <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-gray-800">{String(entry.label)}</span>
        {Boolean(entry.code) && (
          <span className="text-[11px] font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md">
            {String(entry.code)}
          </span>
        )}
        {inactive && (
          <span className="text-[10px] font-semibold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">Inactif</span>
        )}
        {Boolean(entry._requires_po) && (
          <span className="text-[10px] font-semibold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">BC requis</span>
        )}
        {Boolean(entry.description) && (
          <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[250px]">{String(entry.description)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
        {inactive ? (
          <button onClick={() => onReactivate(String(entry.id))}
            className="p-2 hover:bg-green-100 rounded-lg transition-colors" title="Reactiver">
            <RotateCw size={15} className="text-green-600" />
          </button>
        ) : (
          <>
            <button onClick={() => onEdit(entry)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Modifier">
              <Pencil size={15} className="text-gray-400" />
            </button>
            <button onClick={() => {
              if (confirm('Desactiver cette entree ?'))
                onDelete(String(entry.id));
            }} className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Desactiver">
              <Trash2 size={15} className="text-red-400" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ PRODUCTION CHARGES TAB ============ */

function PriceRoundingTab() {
  const { settings, updateSettings } = useSettings();
  const [strategie, setStrategie] = useState<'aucun' | 'au_dh' | 'au_demi_dh' | 'au_5dh'>(settings.prixArrondiStrategie || 'aucun');
  const [sens, setSens] = useState<'inferieur' | 'superieur' | 'naturel'>(settings.prixArrondiSens || 'superieur');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStrategie(settings.prixArrondiStrategie || 'aucun');
    setSens(settings.prixArrondiSens || 'superieur');
  }, [settings.prixArrondiStrategie, settings.prixArrondiSens]);

  const hasChanges = strategie !== (settings.prixArrondiStrategie || 'aucun')
    || sens !== (settings.prixArrondiSens || 'superieur');

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({ prixArrondiStrategie: strategie, prixArrondiSens: sens });
      notify.success('Strategie d\'arrondi enregistree');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // Aperçu sur un prix de réf : 47.32 DH
  const previewBrut = 47.32;
  const applyRounding = (p: number) => {
    if (strategie === 'aucun') return p;
    const pas = strategie === 'au_dh' ? 1 : strategie === 'au_demi_dh' ? 0.5 : 5;
    if (sens === 'inferieur') return Math.floor(p / pas) * pas;
    if (sens === 'superieur') return Math.ceil(p / pas) * pas;
    return Math.round(p / pas) * pas;
  };
  const previewArrondi = applyRounding(previewBrut);

  return (
    <SettingsSection
      title="Arrondi des prix de vente"
      description="Strategie appliquee au prix calcule (cout × marge) pour les recettes et formats. Le POS continue d'afficher avec 2 decimales."
    >
      <SettingItem title="Strategie" description="Pas de l'arrondi">
        <select value={strategie} onChange={e => setStrategie(e.target.value as typeof strategie)} className="input w-56">
          <option value="aucun">Aucun (decimales brutes)</option>
          <option value="au_demi_dh">Au 0.5 DH</option>
          <option value="au_dh">Au DH (entier)</option>
          <option value="au_5dh">Au 5 DH</option>
        </select>
      </SettingItem>
      <SettingItem title="Sens" description="Comment arrondir">
        <select value={sens} onChange={e => setSens(e.target.value as typeof sens)} className="input w-56" disabled={strategie === 'aucun'}>
          <option value="superieur">Vers le haut (protege la marge)</option>
          <option value="inferieur">Vers le bas</option>
          <option value="naturel">Naturel (0.5 -&gt; haut)</option>
        </select>
      </SettingItem>
      <SettingItem title="Aperçu" description={`Prix brut : ${previewBrut.toFixed(2)} DH`}>
        <div className="text-sm">
          <span className="text-gray-500">Apres arrondi : </span>
          <strong className="text-amber-700 text-base">{previewArrondi.toFixed(2)} DH</strong>
        </div>
      </SettingItem>
      <div className="sm:col-span-2 pt-4">
        <button onClick={handleSave} disabled={saving || !hasChanges}
          className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60">
          <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer l\'arrondi'}
        </button>
      </div>
    </SettingsSection>
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

function ProductionChargesTab() {
  const { settings, updateSettings } = useSettings();
  const [loyer, setLoyer] = useState(String(settings.productionChargeLoyer || 0));
  const [energie, setEnergie] = useState(String(settings.productionChargeEnergie || 0));
  const [autres, setAutres] = useState(String(settings.productionChargeAutres || 0));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        productionChargeLoyer: parseFloat(loyer) || 0,
        productionChargeEnergie: parseFloat(energie) || 0,
        productionChargeAutres: parseFloat(autres) || 0,
      });
      notify.success('Charges fixes enregistrees');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    parseFloat(loyer || '0') !== (settings.productionChargeLoyer || 0) ||
    parseFloat(energie || '0') !== (settings.productionChargeEnergie || 0) ||
    parseFloat(autres || '0') !== (settings.productionChargeAutres || 0);

  const moneyInput = (value: string, onChange: (v: string) => void) => (
    <div className="relative w-44">
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        className="input w-full pr-10" min="0" step="0.01" />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">DH</span>
    </div>
  );

  return (
    <SettingsSection
      title="Charges fixes mensuelles"
      description="Reparties proportionnellement sur chaque plan de production du mois pour calculer le cout de revient."
    >
      <SettingItem title="Loyer mensuel" description="Montant du loyer de l'atelier de production">
        {moneyInput(loyer, setLoyer)}
      </SettingItem>
      <SettingItem title="Energie mensuelle" description="Electricite, gaz, eau">
        {moneyInput(energie, setEnergie)}
      </SettingItem>
      <SettingItem title="Autres charges" description="Assurances, maintenance, divers">
        {moneyInput(autres, setAutres)}
      </SettingItem>
      <div className="sm:col-span-2 pt-4">
        <button onClick={handleSave} disabled={saving || !hasChanges}
          className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60">
          <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer les charges'}
        </button>
      </div>
    </SettingsSection>
  );
}
