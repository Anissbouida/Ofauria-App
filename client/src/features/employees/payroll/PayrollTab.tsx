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
      <div className="odoo-search-panel" style={{ justifyContent: 'flex-start' }}>
        <div className="odoo-view-switcher" role="tablist" aria-label="Vue de paie">
          {VIEWS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={payView === key} onClick={() => setPayView(key)}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
                background: payView === key ? 'var(--odoo-purple-light)' : 'transparent',
                color: payView === key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                fontWeight: payView === key ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {payView === 'monthly' ? <MonthlyPayrollView queryClient={queryClient} />
        : payView === 'biweekly' ? <BiweeklyPayrollView queryClient={queryClient} />
        : payView === 'settings' ? <PayrollSettingsView />
        : payView === 'declarations' ? <DeclarationsView />
        : <WeeklyPayrollView queryClient={queryClient} />}
    </>
  );
}
