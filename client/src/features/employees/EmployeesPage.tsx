import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  UserCog, Users, Clock, CalendarOff, Banknote, CalendarDays, AlertOctagon, HandCoins,
} from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import type { HrTab } from './shared';
import EmployeesTab from './tabs/EmployeesTab';
import AttendanceTab from './tabs/AttendanceTab';
import LeavesTab from './tabs/LeavesTab';
import PayrollTab from './payroll/PayrollTab';
import AdvancesTab from './tabs/AdvancesTab';
import ScheduleTab from './tabs/ScheduleTab';

export default function EmployeesPage() {
  const { hasModule, isLoading: permsLoading } = usePermissions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HrTab>('employees');

  // Guard cote client, miroir de authorizeModule('employees') cote serveur :
  // le droit « Personnel » (module employees) ouvre la page, quel que soit le
  // role. Evite les 403 en rafale et affiche un message explicite plutot que
  // la page vide + le "aucun employe trouve".
  if (permsLoading) return null;
  if (!hasModule('employees')) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--odoo-text-muted)' }}>
        <AlertOctagon size={32} style={{ margin: '0 auto 12px', color: '#dc3545' }} />
        <h2 className="text-lg font-semibold mb-2">Accès non autorisé</h2>
        <p className="text-sm">Vous n'avez pas le droit « Personnel ». Demandez-le à un administrateur.</p>
      </div>
    );
  }

  const tabs: { key: HrTab; label: string; icon: typeof Users }[] = [
    { key: 'employees', label: 'Employés', icon: Users },
    { key: 'attendance', label: 'Pointage', icon: Clock },
    { key: 'leaves', label: 'Congés', icon: CalendarOff },
    { key: 'payroll', label: 'Paie', icon: Banknote },
    { key: 'advances', label: 'Avances', icon: HandCoins },
    { key: 'schedule', label: 'Planning', icon: CalendarDays },
  ];
  const currentTab = tabs.find(t => t.key === tab);

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar - style Odoo : breadcrumb sticky */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <UserCog size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Personnel</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{currentTab?.label}</span>
        </div>
      </div>

      {/* Tabs - style Odoo : border-bottom + underline */}
      <div className="odoo-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'employees' && <EmployeesTab queryClient={queryClient} />}
        {tab === 'attendance' && <AttendanceTab queryClient={queryClient} />}
        {tab === 'leaves' && <LeavesTab queryClient={queryClient} />}
        {tab === 'payroll' && <PayrollTab queryClient={queryClient} />}
        {tab === 'advances' && <AdvancesTab queryClient={queryClient} />}
        {tab === 'schedule' && <ScheduleTab queryClient={queryClient} />}
      </div>
    </div>
  );
}
