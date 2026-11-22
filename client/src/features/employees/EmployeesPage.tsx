import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Clock, CalendarOff, Banknote, CalendarDays, AlertOctagon, HandCoins, BarChart3, UserCircle, Percent,
} from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModuleShell, ModulePage, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import '../projects/projects.css';
import '../sales/sales.css';
import './employees.css';
import type { HrTab } from './shared';
import { HrHeaderSlot } from './ui';
import EmployeesTab from './tabs/EmployeesTab';
import AttendanceTab from './tabs/AttendanceTab';
import LeavesTab from './tabs/LeavesTab';
import PayrollTab from './payroll/PayrollTab';
import AdvancesTab from './tabs/AdvancesTab';
import ScheduleTab from './tabs/ScheduleTab';
import HrAnalyticsTab from './tabs/HrAnalyticsTab';
import MySpace from './self/MySpace';
import CommissionsTab from './CommissionsTab';
import { selfApi } from '../../api/employees.api';
import SalesPageShell from '../sales/SalesPageShell';

/** Description d'une ligne sous le titre de chaque écran (gabarit de page du Design System). */
const PAGE_LEADS: Record<HrTab, string> = {
  analytics: 'Effectif, coût de main-d\'œuvre, absentéisme et heures de l\'année.',
  me: 'Vos bulletins, vos congés, vos avances et vos informations personnelles.',
  attendance: 'Présences, absences et heures supplémentaires, jour par jour.',
  schedule: 'Horaires de la semaine par salarié et par poste.',
  leaves: 'Demandes de congé, soldes des salariés et jours fériés.',
  advances: 'Avances sur salaire accordées et retenues sur les paies.',
  payroll: 'Paies hebdomadaires, par quinzaine et mensuelles, déclarations et réglages.',
  commissions: 'Barèmes des vendeurs et relevé des commissions par période.',
  employees: 'Fiches des salariés : contrat, rémunération et situation.',
};

export default function EmployeesPage() {
  // Emplacement des actions de l'écran actif, à droite du fil d'Ariane (HrHeaderActions).
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const { hasModule, isLoading: permsLoading } = usePermissions();
  const queryClient = useQueryClient();
  // Espace employe : le compte est-il lie a une fiche ? (404 sinon)
  const { data: self, isLoading: selfLoading } = useQuery({ queryKey: ['me'], queryFn: selfApi.profile, retry: false });
  const hasSelf = !!self;

  // Rubriques standard (ModuleShell) : le travail courant (pointage, planning, congés,
  // avances, paie) en Opérations, les fiches salariés en référentiel du module.
  // Le lien « Mon espace » de l'en-tête ouvre ?tab=me.
  const views: ModuleView<HrTab>[] = [
    { key: 'analytics', label: 'Pilotage', icon: BarChart3, section: 'dashboard' },
    { key: 'me', label: 'Mon espace', icon: UserCircle, section: 'dashboard', hidden: !hasSelf },
    { key: 'attendance', label: 'Pointage', icon: Clock, section: 'operations' },
    { key: 'schedule', label: 'Planning', icon: CalendarDays, section: 'operations' },
    { key: 'leaves', label: 'Congés', icon: CalendarOff, section: 'operations' },
    { key: 'advances', label: 'Avances', icon: HandCoins, section: 'operations' },
    { key: 'payroll', label: 'Paie', icon: Banknote, section: 'operations' },
    { key: 'commissions', label: 'Commissions', icon: Percent, section: 'operations' },
    { key: 'employees', label: 'Employés', icon: Users, section: 'setup' },
  ];
  const { current, select } = useModuleView(views);

  // Guard cote client, miroir de authorizeModule('employees') cote serveur :
  // le droit « Personnel » (module employees) ouvre la page, quel que soit le
  // role. Sans ce droit, un salarie lie a une fiche n'accede qu'a son espace.
  if (permsLoading || (!hasModule('employees') && selfLoading)) return null;
  if (!hasModule('employees') && hasSelf) {
    return (
      <SalesPageShell icon={UserCircle} title="Mon espace" summary={PAGE_LEADS.me}>
        <div className="prj hr-body"><MySpace /></div>
      </SalesPageShell>
    );
  }
  if (!hasModule('employees')) {
    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div className="kl-page">
          <StatusBanner tone="danger" icon={AlertOctagon} title="Espace indisponible">
            Votre compte n'est pas encore relié à une fiche salarié. Demandez à un administrateur
            de relier votre compte à votre fiche (Utilisateurs › votre compte › Fiche salarié) pour
            accéder à votre espace, ou d'activer le droit « Personnel ».
          </StatusBanner>
        </div>
      </div>
    );
  }

  const tab = current?.key;

  return (
    <ModuleShell title="Personnel" views={views} current={current} onSelect={select} flush
      actions={<div ref={setHeaderSlot} style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} />}>
      {/* Gabarit de page (Design System) : fil d'Ariane « Personnel › rubrique › page » + actions
          de l'écran à droite, puis titre et description d'une ligne, puis le contenu de l'écran. */}
      <HrHeaderSlot.Provider value={headerSlot}>
      <ModulePage title={current?.label} summary={tab ? PAGE_LEADS[tab] : undefined}>
      <div className="prj hr-body">
      {tab === 'employees' && <EmployeesTab queryClient={queryClient} />}
      {tab === 'attendance' && <AttendanceTab queryClient={queryClient} />}
      {tab === 'leaves' && <LeavesTab queryClient={queryClient} />}
      {tab === 'payroll' && <PayrollTab queryClient={queryClient} />}
      {tab === 'advances' && <AdvancesTab queryClient={queryClient} />}
      {tab === 'schedule' && <ScheduleTab queryClient={queryClient} />}
      {tab === 'analytics' && <HrAnalyticsTab />}
      {tab === 'commissions' && <CommissionsTab />}
      {tab === 'me' && <MySpace />}
      </div>
      </ModulePage>
      </HrHeaderSlot.Provider>
    </ModuleShell>
  );
}
