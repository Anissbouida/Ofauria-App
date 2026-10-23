import api from './client';

/** Paramètres du module Achats (table module_parameters, mig 306). */
export type ExpenseRequiresPo = { enabled: boolean; threshold: number; currency: string };

export const purchasingSettingsApi = {
  get: () => api.get('/purchasing-settings').then(r => r.data.data as { expenseRequiresPo: ExpenseRequiresPo }),
  setExpenseRequiresPo: (value: ExpenseRequiresPo) =>
    api.put('/purchasing-settings/expense-requires-po', value).then(r => r.data.data),
};
