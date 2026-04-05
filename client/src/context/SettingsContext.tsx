import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi, type CompanySettings } from '../api/settings.api';

interface SettingsContextType {
  settings: CompanySettings;
  isLoading: boolean;
  updateSettings: (data: Partial<CompanySettings>) => Promise<void>;
}

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
};

const SettingsContext = createContext<SettingsContextType>({
  settings: defaults,
  isLoading: true,
  updateSettings: async () => {},
});

function applyTheme(s: CompanySettings) {
  const root = document.documentElement.style;
  root.setProperty('--color-primary', s.primaryColor);
  root.setProperty('--color-primary-hover', s.secondaryColor);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings>(defaults);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    settingsApi.get()
      .then((s) => { setSettings({ ...defaults, ...s }); applyTheme(s); })
      .catch(() => { applyTheme(defaults); })
      .finally(() => setIsLoading(false));
  }, []);

  const updateSettings = useCallback(async (data: Partial<CompanySettings>) => {
    const updated = await settingsApi.update(data);
    setSettings({ ...defaults, ...updated });
    applyTheme(updated);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, isLoading, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
