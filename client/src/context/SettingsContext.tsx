import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi, type CompanySettings } from '../api/settings.api';

interface SettingsContextType {
  settings: CompanySettings;
  isLoading: boolean;
  updateSettings: (data: Partial<CompanySettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const CACHE_KEY = 'ofauria_theme';

const defaults: CompanySettings = {
  companyName: 'OFAURIA',
  subtitle: 'Boulangerie - Patisserie',
  primaryColor: '#714B67',
  secondaryColor: '#5f3d57',
  logoUrl: null,
  receiptHeader: '',
  receiptFooter: 'Merci pour votre visite !',
  receiptShowLogo: true,
  receiptLogoSize: 40,
  receiptFontSize: 12,
  receiptPaperWidth: 80,
  receiptShowCashier: true,
  receiptShowDate: true,
  receiptShowPaymentDetail: true,
  receiptExtraLines: '',
  receiptAutoPrint: false,
  receiptOpenDrawer: false,
  receiptNumCopies: 1,
  staffDiscountPercent: 10,
  // Theme / Appearance
  themeBgPage: '#FAF6F1',
  themeBgCard: '#FFFDF9',
  themeBgSecondary: '#F3ECE2',
  themeBgSeparator: '#E8DDD0',
  themeTextStrong: '#2D1810',
  themeTextBody: '#5C3D2E',
  themeTextMuted: '#8B7355',
  themeAccent: '#C4872B',
  themeAccentHover: '#A8721F',
  themeAccentLight: '#F5E6CC',
  themeCtaColor: '#C4872B',
  themeCtaText: '#FFFFFF',
};

function loadCachedSettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* ignore corrupt cache */ }
  return defaults;
}

function cacheSettings(s: CompanySettings) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

const SettingsContext = createContext<SettingsContextType>({
  settings: defaults,
  isLoading: true,
  updateSettings: async () => {},
  refreshSettings: async () => {},
});

function applyTheme(s: CompanySettings) {
  const root = document.documentElement.style;
  root.setProperty('--color-primary', s.primaryColor);
  root.setProperty('--color-primary-hover', s.secondaryColor);
  // Theme / Appearance variables
  root.setProperty('--theme-bg-page', s.themeBgPage);
  root.setProperty('--theme-bg-card', s.themeBgCard);
  root.setProperty('--theme-bg-secondary', s.themeBgSecondary);
  root.setProperty('--theme-bg-separator', s.themeBgSeparator);
  root.setProperty('--theme-text-strong', s.themeTextStrong);
  root.setProperty('--theme-text-body', s.themeTextBody);
  root.setProperty('--theme-text-muted', s.themeTextMuted);
  root.setProperty('--theme-accent', s.themeAccent);
  root.setProperty('--theme-accent-hover', s.themeAccentHover);
  root.setProperty('--theme-accent-light', s.themeAccentLight);
  root.setProperty('--theme-cta-color', s.themeCtaColor);
  root.setProperty('--theme-cta-text', s.themeCtaText);
}

// Apply cached theme immediately on module load (before React renders)
const cachedSettings = loadCachedSettings();
applyTheme(cachedSettings);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings>(cachedSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    settingsApi.get()
      .then((s) => {
        const merged = { ...defaults, ...s };
        setSettings(merged);
        applyTheme(merged);
        cacheSettings(merged);
      })
      .catch(() => { applyTheme(cachedSettings); })
      .finally(() => setIsLoading(false));
  }, []);

  const updateSettings = useCallback(async (data: Partial<CompanySettings>) => {
    const updated = await settingsApi.update(data);
    const merged = { ...defaults, ...updated };
    setSettings(merged);
    applyTheme(merged);
    cacheSettings(merged);
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await settingsApi.get();
      const merged = { ...defaults, ...s };
      setSettings(merged);
      applyTheme(merged);
      cacheSettings(merged);
    } catch {
      // Keep current settings if refresh fails
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, isLoading, updateSettings, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
