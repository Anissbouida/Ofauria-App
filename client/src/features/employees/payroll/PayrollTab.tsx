import MonthlyPayrollView from './MonthlyPayrollView';
import WeeklyPayrollView from './WeeklyPayrollView';
import BiweeklyPayrollView from './BiweeklyPayrollView';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/* ═══════════════════════ PAYROLL TAB ═══════════════════════ */
export default function PayrollTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [payView, setPayView] = useState<'monthly' | 'biweekly' | 'weekly'>('monthly');

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'flex-start' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setPayView('monthly')} className={payView === 'monthly' ? 'active' : ''}>
            Paie mensuelle
          </button>
          <button onClick={() => setPayView('biweekly')} className={payView === 'biweekly' ? 'active' : ''}>
            Paie par quinzaine
          </button>
          <button onClick={() => setPayView('weekly')} className={payView === 'weekly' ? 'active' : ''}>
            Paie hebdomadaire
          </button>
        </div>
      </div>
      {payView === 'monthly' ? <MonthlyPayrollView queryClient={queryClient} />
        : payView === 'biweekly' ? <BiweeklyPayrollView queryClient={queryClient} />
        : <WeeklyPayrollView queryClient={queryClient} />}
    </>
  );
}
