import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Save, Palette, Building2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

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

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();

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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Parametres</h1>
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
      </div>

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
          <label className="block text-sm font-medium text-gray-700 mb-3">Themes predéfinis</label>
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
          {/* Simulated header */}
          <div className="h-12 flex items-center px-4 text-white" style={{ backgroundColor: primaryColor }}>
            <span className="font-bold tracking-wide">{companyName || 'OFAURIA'}</span>
            <span className="text-white/50 text-sm ml-2">/ Module</span>
            <div className="flex-1" />
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AB</div>
          </div>
          {/* Simulated content */}
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
    </div>
  );
}
