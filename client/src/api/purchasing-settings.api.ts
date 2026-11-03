import api from './client';

/** Paramètres du module Achats (table module_parameters, mig 306). */
export type ExpenseRequiresPo = { enabled: boolean; threshold: number; currency: string };

/** Séparation des tâches (lot L2 P2P) : règles et manquements journalisés. */
export type SodRule = { code: string; action: string; forbidden: string; label: string; is_active: boolean };
export type SodViolation = { rule_code: string; actor: string; occurrences: number; documents: number; last_at: string };

export const purchasingSettingsApi = {
  get: () => api.get('/purchasing-settings').then(r => r.data.data as { expenseRequiresPo: ExpenseRequiresPo }),
  setExpenseRequiresPo: (value: ExpenseRequiresPo) =>
    api.put('/purchasing-settings/expense-requires-po', value).then(r => r.data.data),
  getSod: () => api.get('/purchasing-settings/sod').then(r => r.data.data as { rules: SodRule[]; violations: SodViolation[] }),
};
