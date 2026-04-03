import api from './client';

export interface CompanySettings {
  companyName: string;
  subtitle: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
}

export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data.data) as Promise<CompanySettings>,
  update: (data: Partial<CompanySettings>) => api.put('/settings', data).then(r => r.data.data) as Promise<CompanySettings>,
};
