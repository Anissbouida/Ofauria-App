import MonthlyPayrollView from './MonthlyPayrollView';
import WeeklyPayrollView from './WeeklyPayrollView';
import BiweeklyPayrollView from './BiweeklyPayrollView';
import PayrollSettingsView from './PayrollSettingsView';
import DeclarationsView from './DeclarationsView';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type PayView = 'monthly' | 'biweekly' | 'weekly' | 'declarations' | 'settings';

const VIEWS: Array<[PayView, string]> = [
  ['monthly', 'Paie mensuelle'],
  ['biweekly', 'Paie par quinzaine'],
  ['weekly', 'Paie hebdomadaire'],
  ['declarations', 'Déclarations'],
  ['settings', 'Paramètres de paie'],
];

/* ═══════════════════════ PAYROLL TAB ═══════════════════════ */
export default function PayrollTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [payView, setPayView] = useState<PayView>('monthly');

  return (
    <>
      {/* Cinq vues : onglets fins (odoo-tabs), au-delà du contrôle segmenté (2 à 4 vues). */}
      <div className="odoo-tabs" role="tablist" aria-label="Vue de paie" style={{ padding: 0 }}>
        {VIEWS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={payView === key} onClick={() => setPayView(key)}
            className={`odoo-tab${payView === key ? ' active' : ''}`}>
            {label}
          </button>
        ))}
      </div>
      {payView === 'monthly' ? <MonthlyPayrollView queryClient={queryClient} />
        : payView === 'biweekly' ? <BiweeklyPayrollView queryClient={queryClient} />
        : payView === 'settings' ? <PayrollSettingsView />
        : payView === 'declarations' ? <DeclarationsView />
        : <WeeklyPayrollView queryClient={queryClient} />}
    </>
  );
}
