import MonthlyPayrollView from './MonthlyPayrollView';
import WeeklyPayrollView from './WeeklyPayrollView';
import BiweeklyPayrollView from './BiweeklyPayrollView';
import PayrollSettingsView from './PayrollSettingsView';
import DeclarationsView from './DeclarationsView';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs } from '../../../components/ds';

type PayView = 'monthly' | 'biweekly' | 'weekly' | 'declarations' | 'settings';

const VIEWS: Array<{ key: PayView; label: string }> = [
  { key: 'monthly', label: 'Paie mensuelle' },
  { key: 'biweekly', label: 'Paie par quinzaine' },
  { key: 'weekly', label: 'Paie hebdomadaire' },
  { key: 'declarations', label: 'Déclarations' },
  { key: 'settings', label: 'Paramètres de paie' },
];

/* ═══════════════════════ PAYROLL TAB ═══════════════════════ */
export default function PayrollTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [payView, setPayView] = useState<PayView>('monthly');

  return (
    <>
      {/* Cinq vues : onglets du Design System (au-delà de la bascule segmentée, 2 à 4 vues). */}
      <Tabs label="Vue de paie" value={payView} onChange={setPayView} tabs={VIEWS} />
      {payView === 'monthly' ? <MonthlyPayrollView queryClient={queryClient} />
        : payView === 'biweekly' ? <BiweeklyPayrollView queryClient={queryClient} />
        : payView === 'settings' ? <PayrollSettingsView />
        : payView === 'declarations' ? <DeclarationsView />
        : <WeeklyPayrollView queryClient={queryClient} />}
    </>
  );
}
