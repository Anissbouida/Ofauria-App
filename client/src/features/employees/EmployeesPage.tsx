import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  UserCog, Users, Clock, CalendarOff, Banknote, CalendarDays, AlertOctagon, HandCoins, BarChart3, UserCircle,
} from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import type { HrTab } from './shared';
import EmployeesTab from './tabs/EmployeesTab';
import AttendanceTab from './tabs/AttendanceTab';
import LeavesTab from './tabs/LeavesTab';
import PayrollTab from './payroll/PayrollTab';
import AdvancesTab from './tabs/AdvancesTab';
import ScheduleTab from './tabs/ScheduleTab';
import HrAnalyticsTab from './tabs/HrAnalyticsTab';
import MySpace from './self/MySpace';
import { selfApi } from '../../api/employees.api';

export default function EmployeesPage() {
  const { hasModule, isLoading: permsLoading } = usePermissions();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<HrTab>(params.get('tab') === 'me' ? 'me' : 'employees');
  // Lien « Mon espace » de l'en-tete alors que la page est deja ouverte.
  useEffect(() => { if (params.get('tab') === 'me') setTab('me'); }, [params]);
  // Espace employe : le compte est-il lie a une fiche ? (404 sinon)
  const { data: self, isLoading: selfLoading } = useQuery({ queryKey: ['me'], queryFn: selfApi.profile, retry: false });
  const hasSelf = !!self;

  // Guard cote client, miroir de authorizeModule('employees') cote serveur :
  // le droit « Personnel » (module employees) ouvre la page, quel que soit le
  // role. Sans ce droit, un salarie lie a une fiche n'accede qu'a son espace.
  if (permsLoading || (!hasModule('employees') && selfLoading)) return null;
  if (!hasModule('employees') && hasSelf) {
    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <UserCircle size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">Mon espace</span>
          </div>
        </div>
        <div style={{ padding: '16px 20px' }}><MySpace /></div>
      </div>
    );
  }
  if (!hasModule('employees')) {
    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div style={{ padding: '16px 20px' }}>
          <StatusBanner tone="danger" icon={AlertOctagon} title="Accès non autorisé">
            Vous n'avez pas le droit « Personnel ». Demandez-le à un administrateur.
          </StatusBanner>
        </div>
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
    { key: 'analytics', label: 'Pilotage', icon: BarChart3 },
    ...(hasSelf ? [{ key: 'me' as HrTab, label: 'Mon espace', icon: UserCircle }] : []),
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
        {tab === 'analytics' && <HrAnalyticsTab />}
        {tab === 'me' && <MySpace />}
      </div>
    </div>
  );
}
