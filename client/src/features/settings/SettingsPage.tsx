import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { settingsApi } from '../../api/settings.api';
import { storesApi } from '../../api/stores.api';
import {
  Save, Palette, Building2, RotateCcw, MapPin, Plus, Pencil, Trash2, Store,
  Printer, Upload, Image, Eye, Type, FileText, ToggleLeft, ToggleRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const PRESET_COLORS = [
  { name: 'Aubergine', primary: '#714B67', secondary: '#5f3d57' },
  { name: 'Bleu', primary: '#264653', secondary: '#1d3640' },
  { name: 'Vert', primary: '#2d6a4f', secondary: '#245740' },
  { name: 'Rouge', primary: '#9b2226', secondary: '#7d1b1e' },
  { name: 'Orange', primary: '#bc6c25', secondary: '#a05b1e' },
  { name: 'Marine', primary: '#003049', secondary: '#00253a' },
  { name: 'Indigo', primary: '#4338ca', secondary: '#3730a3' },
  { name: 'Rose', primary: '#be185d', secondary: '#9d174d' },
  { name: 'Marron', primary: '#6d4c41', secondary: '#5d4037' },
];

type SettingsTab = 'general' | 'print' | 'stores';

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [subtitle, setSubtitle] = useState(settings.subtitle);
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(settings.secondaryColor);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setSubtitle(settings.subtitle);
    setPrimaryColor(settings.primaryColor);
    setSecondaryColor(settings.secondaryColor);
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
      await updateSettings({ companyName, subtitle, primaryColor, secondaryColor });
      toast.success('Parametres enregistres');
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCompanyName(settings.companyName);
    setSubtitle(settings.subtitle);
    setPrimaryColor(settings.primaryColor);
    setSecondaryColor(settings.secondaryColor);
  };

  const hasChanges =
    companyName !== settings.companyName ||
    subtitle !== settings.subtitle ||
    primaryColor !== settings.primaryColor ||
    secondaryColor !== settings.secondaryColor;

  const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'General', icon: <Building2 size={18} /> },
    { key: 'print', label: 'Impression', icon: <Printer size={18} /> },
    { key: 'stores', label: 'Points de vente', icon: <Store size={18} /> },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Parametres</h1>
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

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((tab) => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-white shadow-sm text-gray-800'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && (
        <GeneralTab
          companyName={companyName} setCompanyName={setCompanyName}
          subtitle={subtitle} setSubtitle={setSubtitle}
          primaryColor={primaryColor} setPrimaryColor={setPrimaryColor}
          secondaryColor={secondaryColor} setSecondaryColor={setSecondaryColor}
        />
      )}

      {activeTab === 'print' && <PrintTab />}

      {activeTab === 'stores' && <StoresSection />}
    </div>
  );
}

/* ============ GENERAL TAB ============ */

function GeneralTab({
  companyName, setCompanyName, subtitle, setSubtitle,
  primaryColor, setPrimaryColor, secondaryColor, setSecondaryColor,
}: {
  companyName: string; setCompanyName: (v: string) => void;
  subtitle: string; setSubtitle: (v: string) => void;
  primaryColor: string; setPrimaryColor: (v: string) => void;
  secondaryColor: string; setSecondaryColor: (v: string) => void;
}) {
  return (
    <>
      {/* Company info */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Building2 size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Informations de l'entreprise</h2>
            <p className="text-sm text-gray-500">Nom et description affiches dans l'application</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'entreprise</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="input" placeholder="OFAURIA" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sous-titre</label>
            <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
              className="input" placeholder="Boulangerie & Patisserie" />
          </div>
        </div>
      </div>

      {/* Theme colors */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Palette size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Theme et couleurs</h2>
            <p className="text-sm text-gray-500">Personnalisez l'apparence de votre application</p>
          </div>
        </div>

        {/* Preset colors */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">Themes predefinis</label>
          <div className="flex flex-wrap gap-3">
            {PRESET_COLORS.map((preset) => (
              <button key={preset.name}
                onClick={() => { setPrimaryColor(preset.primary); setSecondaryColor(preset.secondary); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                  primaryColor === preset.primary
                    ? 'border-gray-800 shadow-md'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                <div className="w-6 h-6 rounded-full shadow-inner" style={{ backgroundColor: preset.primary }} />
                <span className="text-sm font-medium text-gray-700">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom colors */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Couleur principale</label>
            <div className="flex gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border border-gray-200" />
              <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                className="input flex-1 font-mono" placeholder="#714B67" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Couleur secondaire (hover)</label>
            <div className="flex gap-2">
              <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border border-gray-200" />
              <input type="text" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                className="input flex-1 font-mono" placeholder="#5f3d57" />
            </div>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Apercu</h2>
        <div className="rounded-xl overflow-hidden border">
          <div className="h-12 flex items-center px-4 text-white" style={{ backgroundColor: primaryColor }}>
            <span className="font-bold tracking-wide">{companyName || 'OFAURIA'}</span>
            <span className="text-white/50 text-sm ml-2">/ Module</span>
            <div className="flex-1" />
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AB</div>
          </div>
          <div className="p-6 bg-gray-50">
            <p className="text-gray-500 text-sm mb-3">{subtitle || 'Boulangerie & Patisserie'}</p>
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                style={{ backgroundColor: primaryColor }}>
                Bouton principal
              </button>
              <button className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                style={{ backgroundColor: secondaryColor }}>
                Bouton hover
              </button>
            </div>
          </div>
        </div>
      </div>
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
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Le fichier ne doit pas depasser 2 Mo');
      return;
    }
    setUploading(true);
    try {
      const result = await settingsApi.uploadLogo(file);
      setLogoUrl(result.url);
      toast.success('Logo telecharge');
    } catch {
      toast.error('Erreur lors du telechargement');
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
      toast.success('Parametres d\'impression enregistres');
    } catch {
      toast.error('Erreur lors de la sauvegarde');
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
    <>
      {/* Save button bar */}
      <div className="flex justify-end">
        <button onClick={handleSavePrint} disabled={saving || !hasChanges}
          className="btn-primary flex items-center gap-2">
          <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        {/* Settings panel */}
        <div className="space-y-6">
          {/* Logo */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <Image size={20} className="text-gray-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Logo</h2>
                <p className="text-sm text-gray-500">Logo affiche sur les recus et tickets (PNG, JPG, SVG - max 2 Mo)</p>
              </div>
            </div>

            <div className="flex items-start gap-6">
              {/* Logo preview */}
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

              <div className="flex-1 space-y-3">
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload} className="hidden" />
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

                <div className="flex items-center gap-4">
                  <ToggleSwitch label="Afficher le logo sur le recu" checked={receiptShowLogo}
                    onChange={setReceiptShowLogo} />
                </div>

                {receiptShowLogo && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Taille du logo (px) : {receiptLogoSize}
                    </label>
                    <input type="range" min="20" max="80" value={receiptLogoSize}
                      onChange={(e) => setReceiptLogoSize(parseInt(e.target.value))}
                      className="w-full accent-primary-600" />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>Petit</span><span>Grand</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Receipt content */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <FileText size={20} className="text-gray-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Contenu du recu</h2>
                <p className="text-sm text-gray-500">Textes et informations affiches sur les recus</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">En-tete supplementaire</label>
                <input type="text" value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)}
                  className="input" placeholder="Ex: Adresse, telephone, ICE..." />
                <p className="text-xs text-gray-400 mt-1">Affiche sous le sous-titre (adresse, tel, ICE...)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message de pied de page</label>
                <input type="text" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)}
                  className="input" placeholder="Merci pour votre visite !" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lignes supplementaires</label>
                <textarea value={receiptExtraLines} onChange={(e) => setReceiptExtraLines(e.target.value)}
                  className="input" rows={3}
                  placeholder="Ex: Horaires d'ouverture, conditions de retour..." />
                <p className="text-xs text-gray-400 mt-1">Chaque ligne sera affichee en bas du recu</p>
              </div>
            </div>
          </div>

          {/* Display options */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <Eye size={20} className="text-gray-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Options d'affichage</h2>
                <p className="text-sm text-gray-500">Choisissez les informations visibles sur le recu</p>
              </div>
            </div>

            <div className="space-y-4">
              <ToggleSwitch label="Afficher le nom du caissier" checked={receiptShowCashier}
                onChange={setReceiptShowCashier} />
              <ToggleSwitch label="Afficher la date et l'heure" checked={receiptShowDate}
                onChange={setReceiptShowDate} />
              <ToggleSwitch label="Afficher le detail du paiement (especes rendues)" checked={receiptShowPaymentDetail}
                onChange={setReceiptShowPaymentDetail} />
            </div>
          </div>

          {/* Thermal printer & automation */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <Printer size={20} className="text-gray-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Imprimante thermique</h2>
                <p className="text-sm text-gray-500">Configuration de l'imprimante et du tiroir-caisse</p>
              </div>
            </div>

            <div className="space-y-4">
              <ToggleSwitch
                label="Impression automatique apres chaque vente"
                checked={receiptAutoPrint}
                onChange={setReceiptAutoPrint}
              />
              <p className="text-xs text-gray-400 -mt-2 ml-1">
                Le recu s'imprime automatiquement apres chaque encaissement sans cliquer sur "Imprimer"
              </p>

              <ToggleSwitch
                label="Ouvrir le tiroir-caisse a chaque impression"
                checked={receiptOpenDrawer}
                onChange={setReceiptOpenDrawer}
              />
              <p className="text-xs text-gray-400 -mt-2 ml-1">
                Le tiroir-caisse s'ouvre automatiquement quand le recu est imprime (necessite un tiroir connecte a l'imprimante thermique)
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de copies</label>
                <select value={receiptNumCopies} onChange={(e) => setReceiptNumCopies(parseInt(e.target.value))}
                  className="input w-32">
                  <option value={1}>1 copie</option>
                  <option value={2}>2 copies</option>
                  <option value={3}>3 copies</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">Nombre de recus imprimes a chaque vente</p>
              </div>
            </div>

            {/* Info box */}
            <div className="mt-5 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">Configuration de l'imprimante</h4>
              <ul className="text-xs text-blue-700 space-y-1.5">
                <li>1. Connectez votre imprimante thermique (USB ou reseau)</li>
                <li>2. Installez le pilote de l'imprimante sur votre ordinateur</li>
                <li>3. Dans les parametres d'impression du navigateur, selectionnez votre imprimante thermique comme imprimante par defaut</li>
                <li>4. Desactivez les en-tetes et pieds de page du navigateur dans les parametres d'impression</li>
                <li>5. Le tiroir-caisse doit etre connecte au port RJ11/DK de l'imprimante</li>
              </ul>
            </div>
          </div>

          {/* Format */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <Type size={20} className="text-gray-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Format d'impression</h2>
                <p className="text-sm text-gray-500">Ajustez la taille du texte et du papier</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Taille de police : {receiptFontSize}px
                </label>
                <input type="range" min="9" max="16" value={receiptFontSize}
                  onChange={(e) => setReceiptFontSize(parseInt(e.target.value))}
                  className="w-full accent-primary-600" />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>9px</span><span>16px</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Largeur du papier</label>
                <select value={receiptPaperWidth} onChange={(e) => setReceiptPaperWidth(parseInt(e.target.value))}
                  className="input">
                  <option value={58}>58 mm (petit)</option>
                  <option value={80}>80 mm (standard)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Live receipt preview */}
        <div className="lg:sticky lg:top-6 h-fit">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Apercu du recu</h3>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 overflow-hidden" style={{ maxWidth: `${Math.min(receiptPaperWidth * 3.2, 280)}px`, margin: '0 auto' }}>
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
    </>
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
  const [editStore, setEditStore] = useState<Record<string, unknown> | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: storesApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => storesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => storesApi.update(id, data),
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

  const openEdit = (store: Record<string, unknown>) => {
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
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Store size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Points de vente</h2>
            <p className="text-sm text-gray-500">Gerez vos differents magasins et emplacements</p>
          </div>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} /> Ajouter
        </button>
      </div>

      {/* Store list */}
      <div className="space-y-3">
        {stores.map((store: Record<string, unknown>) => (
          <div key={store.id as string}
            className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <MapPin size={18} className="text-primary-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">{store.name as string}</p>
                <p className="text-sm text-gray-500">
                  {[store.city, store.address].filter(Boolean).join(' — ') || 'Aucune adresse'}
                  {store.phone && <span className="ml-2">| {store.phone as string}</span>}
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
