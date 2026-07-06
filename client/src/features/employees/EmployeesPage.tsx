import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi, payrollApi, schedulesApi, shiftsApi, weeklyPayrollApi, advancesApi } from '../../api/employees.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import { format, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, UserCog, Users, Clock, CalendarOff, Banknote, CalendarDays,
  Check, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, Download, Search,
  ArrowUpDown, ArrowUp, ArrowDown, FileText, Trash2, RotateCcw, AlertOctagon,
  Copy, Eraser, Save, Sparkles, Printer, HandCoins,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { notify } from '../../components/ui/InlineNotification';
import { ROLE_LABELS, SHIFT_BADGE_COLORS, SHIFT_SHORT_LABELS, SHIFT_HOURS } from '@ofauria/shared';
import type { ShiftCode } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';

type HrTab = 'employees' | 'attendance' | 'leaves' | 'payroll' | 'advances' | 'schedule';

const LEAVE_STATUS_COLORS: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
const ATTENDANCE_STATUS: { value: string; label: string; color: string }[] = [
  { value: 'present', label: 'Présent', color: 'bg-green-100 text-green-700' },
  { value: 'absent', label: 'Absent', color: 'bg-red-100 text-red-700' },
  { value: 'late', label: 'Retard', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'half_day', label: 'Demi-journée', color: 'bg-blue-100 text-blue-700' },
  // Repos hebdomadaire paye (comptabilise comme jour travaille pour la paie).
  { value: 'repos', label: 'Repos', color: 'bg-purple-100 text-purple-700' },
];
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

/**
 * Extrait YYYY-MM-DD d'une date colonne PG sans passer par new Date().
 * pg renvoie DATE comme Date object → JSON donne "YYYY-MM-DDT00:00:00.000Z"
 * → `<input type="date">` n'accepte que "YYYY-MM-DD" pur, sinon affiche vide.
 * Idem pour eviter les shifts timezone +/- 1 jour.
 */
function isoDate(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HrTab>('employees');

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
          <span>Ressources Humaines</span>
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

/* ═══════════════════════ EMPLOYEES TAB ═══════════════════════ */
function EmployeesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [viewDetail, setViewDetail] = useState<Record<string, any> | null>(null);
  const [searchEmp, setSearchEmp] = useState('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { entries: roles, getLabel: getRoleLabel, getColor: getRoleColor } = useReferentiel('employee_roles');
  const { entries: contractTypes, getLabel: getContractLabel } = useReferentiel('contract_types');
  const { data: shifts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['shifts'],
    queryFn: shiftsApi.list as () => Promise<Record<string, any>[]>,
  });
  // Suppression/reactivation employes : backend reserve admin. On masque les
  // boutons aux non-admins pour eviter d'afficher une action qui retournerait 403.
  const { user } = useAuth();
  const canDeleteEmployee = user?.role === 'admin';

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      editing ? employeesApi.update(editing.id as string, data) : employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success(editing ? 'Employé mis à jour' : 'Employé ajouté');
      setShowForm(false); setEditing(null);
    },
    onError: () => notify.error('Erreur'),
  });

  /**
   * Suppression employe = soft delete (UPDATE is_active=false cote backend).
   * On preserve l'historique attendance/paie/paiements lies via FK qui sont
   * sans CASCADE — un DELETE physique echouerait de toute facon. L'employe
   * peut etre reactive ulterieurement.
   */
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success('Employé désactivé — historique préservé');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la désactivation');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.update(id, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success('Employé réactivé');
    },
    onError: () => notify.error('Erreur lors de la réactivation'),
  });

  /**
   * Hard delete : suppression PHYSIQUE de l'employe + cascade sur attendance,
   * paie, conges, paiements, etc. Irreversible.
   *
   * Flow : preview (compte les references) -> confirm avec details -> delete.
   */
  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.hardDelete(id),
    onSuccess: (result: Record<string, number>) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      const totalLinked = (result.payments || 0) + (result.payroll || 0)
        + (result.leaves || 0) + (result.attendance || 0)
        + (result.schedules || 0) + (result.productionCoutReel || 0);
      notify.success(`Employé supprimé définitivement${totalLinked > 0 ? ` (+ ${totalLinked} enregistrement(s) lié(s))` : ''}`);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la suppression définitive');
    },
  });

  /**
   * Trigger hard delete avec preview + double confirmation.
   */
  async function handleHardDelete(emp: Record<string, any>) {
    const fullName = `${emp.first_name} ${emp.last_name}`;

    if (!confirm(
      `⚠️ SUPPRESSION DÉFINITIVE\n\n` +
      `Vous êtes sur le point d'effacer ${fullName} DE LA BASE DE DONNÉES.\n\n` +
      `Cette action est IRRÉVERSIBLE. Toutes les références (paie, présence,\n` +
      `congés, paiements) seront aussi supprimées.\n\n` +
      `Si vous voulez juste masquer l'employé en gardant l'historique,\n` +
      `utilisez plutôt le bouton "Désactiver".\n\n` +
      `Continuer vers le détail des données qui seront supprimées ?`
    )) return;

    // Fetch counts pour montrer ce qui sera detruit
    let counts: Record<string, number>;
    try {
      counts = await employeesApi.dependencies(emp.id as string);
    } catch {
      notify.error('Impossible de prévisualiser les données liées');
      return;
    }

    const deleteLines: string[] = [];
    if (counts.payroll) deleteLines.push(`• ${counts.payroll} fiche(s) de paie`);
    if (counts.attendance) deleteLines.push(`• ${counts.attendance} pointage(s) / présence(s)`);
    if (counts.leaves) deleteLines.push(`• ${counts.leaves} congé(s)`);
    if (counts.schedules) deleteLines.push(`• ${counts.schedules} planning(s)`);
    if (counts.payments) deleteLines.push(`• ${counts.payments} paiement(s) lié(s)`);
    if (counts.productionTempsTravail) deleteLines.push(`• ${counts.productionTempsTravail} temps de production`);

    // Ventes : preservees (NULL employee_id) — historique chiffre d'affaires garde
    const salesNote = counts.sales
      ? `\nVentes liées (${counts.sales}) : préservées — l'employé sera juste détaché des ventes.\n`
      : '';

    const details = deleteLines.length > 0
      ? `Données qui seront EFFACÉES en cascade :\n${deleteLines.join('\n')}\n${salesNote}\n`
      : `Aucune donnée liée à effacer.${salesNote}\n`;

    if (!confirm(
      `${details}` +
      `Confirmer la suppression DÉFINITIVE de ${fullName} ?\n\n` +
      `OK = supprimer (action irréversible)\n` +
      `Annuler = abandonner`
    )) return;

    hardDeleteMutation.mutate(emp.id as string);
  }

  const activeCount = employees.filter((e: Record<string, any>) => e.is_active).length;

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown size={13} className="text-gray-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ArrowUp size={13} className="text-teal-600 ml-1 inline" />
      : <ArrowDown size={13} className="text-teal-600 ml-1 inline" />;
  };

  const filteredEmp = employees.filter((e: Record<string, any>) => {
    if (!searchEmp) return true;
    const s = searchEmp.toLowerCase();
    return (e.first_name as string).toLowerCase().includes(s) || (e.last_name as string).toLowerCase().includes(s) || (e.cin as string || '').toLowerCase().includes(s);
  });

  const sortedEmp = [...filteredEmp].sort((a: Record<string, any>, b: Record<string, any>) => {
    let va: string | number = '';
    let vb: string | number = '';
    switch (sortKey) {
      case 'name':
        va = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        vb = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        break;
      case 'role':
        va = getRoleLabel(a.role as string).toLowerCase();
        vb = getRoleLabel(b.role as string).toLowerCase();
        break;
      case 'contract':
        va = getContractLabel(a.contract_type as string || 'cdi').toLowerCase();
        vb = getContractLabel(b.contract_type as string || 'cdi').toLowerCase();
        break;
      case 'salary':
        va = parseFloat(a.monthly_salary as string) || 0;
        vb = parseFloat(b.monthly_salary as string) || 0;
        break;
      case 'status':
        va = a.is_active ? 1 : 0;
        vb = b.is_active ? 1 : 0;
        break;
      default:
        return 0;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    baker: 'bg-amber-100 text-amber-700',
    pastry_chef: 'bg-pink-100 text-pink-700',
    cashier: 'bg-blue-100 text-blue-700',
    viennoiserie: 'bg-orange-100 text-orange-700',
    beldi_sale: 'bg-teal-100 text-teal-700',
    manager: 'bg-indigo-100 text-indigo-700',
  };

  return (
    <>
      {/* Stat tiles - style Odoo */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Total employés</div>
          <div className="odoo-stat-card-value">{employees.length}</div>
          <div className="odoo-stat-card-sub">référencés</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Actifs</div>
          <div className="odoo-stat-card-value" style={{ color: activeCount > 0 ? '#28a745' : undefined }}>{activeCount}</div>
          <div className="odoo-stat-card-sub">en activité</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><X size={11} style={{ display: 'inline', marginRight: 4 }} />Inactifs</div>
          <div className="odoo-stat-card-value" style={{ color: '#adb5bd' }}>{employees.length - activeCount}</div>
          <div className="odoo-stat-card-sub">archivés</div>
        </div>
      </div>

      {/* Search panel + action */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--odoo-text-muted)' }} />
        <input type="text" placeholder="Rechercher employé, CIN..." value={searchEmp} onChange={(e) => setSearchEmp(e.target.value)}
          className="odoo-search-input" style={{ flex: 1 }} />
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvel employé
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des employés...</p>
        </div>
      ) : sortedEmp.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Users size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun employé trouvé</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Employé <SortIcon col="name" /></th>
                <th onClick={() => toggleSort('role')} style={{ cursor: 'pointer' }}>Rôle <SortIcon col="role" /></th>
                <th onClick={() => toggleSort('contract')} style={{ cursor: 'pointer' }}>Contrat <SortIcon col="contract" /></th>
                <th>Téléphone</th>
                <th onClick={() => toggleSort('salary')} style={{ cursor: 'pointer', textAlign: 'right' }}>Salaire <SortIcon col="salary" /></th>
                <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>Statut <SortIcon col="status" /></th>
                <th style={{ textAlign: 'right', width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmp.map((e: Record<string, any>) => (
                <tr key={e.id as string} onClick={() => setViewDetail(e)} style={{ cursor: 'pointer' }}>
                  <td><span className={`odoo-status-dot ${e.is_active ? 'ok' : 'neutral'}`} /></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {e.first_name as string} {e.last_name as string}
                      {e.cin ? <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', fontFamily: 'ui-monospace, monospace' }}>· {e.cin as string}</span> : null}
                    </span>
                  </td>
                  <td>
                    <span className="odoo-tag odoo-tag-purple"
                      style={getRoleColor(e.role as string) ? { backgroundColor: getRoleColor(e.role as string) + '22', color: getRoleColor(e.role as string) } : undefined}>
                      {getRoleLabel(e.role as string)}
                    </span>
                  </td>
                  <td><span className="odoo-tag odoo-tag-grey">{getContractLabel(e.contract_type as string || 'cdi')}</span></td>
                  <td style={{ color: 'var(--odoo-text-muted)' }}>{e.phone as string || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {e.monthly_salary ? (
                      <span style={{ fontWeight: 600 }}>{parseFloat(e.monthly_salary as string).toFixed(0)} <span style={{ color: 'var(--odoo-text-muted)', fontWeight: 400, fontSize: '0.6875rem' }}>DH</span></span>
                    ) : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>}
                  </td>
                  <td>
                    <span className={`odoo-tag ${e.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>
                      {e.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => setViewDetail(e)} className="odoo-pager-btn" title="Détails">
                        <UserCog size={13} />
                      </button>
                      <button onClick={() => { setEditing(e); setShowForm(true); }} className="odoo-pager-btn" title="Modifier">
                        <Pencil size={13} />
                      </button>
                      {e.is_active && canDeleteEmployee && (
                        <button
                          onClick={() => {
                            const fullName = `${e.first_name} ${e.last_name}`;
                            if (confirm(`Désactiver ${fullName} ?\n\nL'employé sera masqué des listes actives.\nSon historique (paie, présence, paiements) reste préservé.\nVous pourrez le réactiver à tout moment.`)) {
                              deactivateMutation.mutate(e.id as string);
                            }
                          }}
                          disabled={deactivateMutation.isPending}
                          className="odoo-pager-btn" title="Désactiver" style={{ color: '#dc3545' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                      {canDeleteEmployee && (
                        <button
                          onClick={() => handleHardDelete(e)}
                          disabled={hardDeleteMutation.isPending}
                          className="odoo-pager-btn" title="Supprimer définitivement" style={{ color: '#7a0c12' }}>
                          <AlertOctagon size={13} />
                        </button>
                      )}
                      {!e.is_active && canDeleteEmployee && (
                        <button
                          onClick={() => {
                            const fullName = `${e.first_name} ${e.last_name}`;
                            if (confirm(`Réactiver ${fullName} ? Il réapparaitra dans les listes actives.`)) {
                              reactivateMutation.mutate(e.id as string);
                            }
                          }}
                          disabled={reactivateMutation.isPending}
                          className="odoo-pager-btn" title="Réactiver" style={{ color: '#28a745' }}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal — redesigned */}
      {viewDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[88vh] overflow-y-auto shadow-2xl" onClick={ev => ev.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-50 to-cyan-50 p-6 border-b border-teal-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-lg font-bold border-2 border-teal-200">
                    {(viewDetail.first_name as string).charAt(0)}{(viewDetail.last_name as string).charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{viewDetail.first_name as string} {viewDetail.last_name as string}</h2>
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[viewDetail.role as string] || 'bg-gray-100 text-gray-600'}`}
                      style={getRoleColor(viewDetail.role as string) && !ROLE_COLORS[viewDetail.role as string] ? { backgroundColor: getRoleColor(viewDetail.role as string) + '20', color: getRoleColor(viewDetail.role as string) } : undefined}>
                      {getRoleLabel(viewDetail.role as string)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setViewDetail(null); setEditing(viewDetail); setShowForm(true); }}
                    className="px-3 py-2 bg-white/70 hover:bg-white rounded-lg text-sm font-medium text-gray-600 transition-colors flex items-center gap-1.5">
                    <Pencil size={14} /> Modifier
                  </button>
                  <button onClick={() => setViewDetail(null)} className="w-9 h-9 bg-white/70 hover:bg-white rounded-lg flex items-center justify-center transition-colors">
                    <X size={18} className="text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
            {/* Details */}
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {([
                  ['CIN', viewDetail.cin], ['Téléphone', viewDetail.phone],
                  ['Date de naissance', (() => { const s = isoDate(viewDetail.birth_date); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
                  ['Adresse', viewDetail.address], ['Ville', viewDetail.city],
                  ['N° CNSS', viewDetail.cnss_number],
                  ['Type de contrat', getContractLabel(viewDetail.contract_type as string || 'cdi')],
                  ['Début contrat', (() => { const s = isoDate(viewDetail.contract_start); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
                  ['Fin contrat', (() => { const s = isoDate(viewDetail.contract_end); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
                  ['Date d\'embauche', (() => { const s = isoDate(viewDetail.hire_date); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
                  ['Salaire mensuel', viewDetail.monthly_salary ? `${parseFloat(viewDetail.monthly_salary as string).toFixed(2)} DH` : null],
                  ['Contact urgence', viewDetail.emergency_contact_name],
                  ['Tel. urgence', viewDetail.emergency_contact_phone],
                ] as [string, unknown][]).map(([label, val]) => val ? (
                  <div key={label} className="bg-gray-50 rounded-xl p-3.5">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className="font-semibold text-gray-800">{val as string}</p>
                  </div>
                ) : null)}
              </div>
              {viewDetail.notes && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                  <p className="text-[11px] text-amber-600 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-amber-800">{viewDetail.notes as string}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier l\'employé' : 'Nouvel employé'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, any> = Object.fromEntries(fd);
              if (data.monthlySalary) data.monthlySalary = parseFloat(data.monthlySalary as string);
              if (data.weeklySalary) data.weeklySalary = parseFloat(data.weeklySalary as string);
              if (data.seniorityYears) data.seniorityYears = parseInt(data.seniorityYears as string);
              if (data.nbDependents) data.nbDependents = parseInt(data.nbDependents as string);
              if (data.cimrRate) data.cimrRate = parseFloat(data.cimrRate as string);
              if (data.defaultShiftCode === '') data.defaultShiftCode = null;
              saveMutation.mutate(data);
            }} className="space-y-4">
              <p className="text-sm font-medium text-gray-500 border-b pb-1">Informations personnelles</p>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Prénom *</label><input name="firstName" defaultValue={editing?.first_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Nom *</label><input name="lastName" defaultValue={editing?.last_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">CIN</label><input name="cin" defaultValue={editing?.cin as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Téléphone</label><input name="phone" defaultValue={editing?.phone as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Date de naissance</label><input name="birthDate" type="date" defaultValue={isoDate(editing?.birth_date)} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Ville</label><input name="city" defaultValue={editing?.city as string} className="input" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Adresse</label><input name="address" defaultValue={editing?.address as string} className="input" /></div>

              <p className="text-sm font-medium text-gray-500 border-b pb-1 pt-2">Contrat & Salaire</p>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Rôle *</label>
                  <select name="role" defaultValue={editing?.role as string || ''} className="input" required>
                    <option value="" disabled>Choisir un rôle</option>
                    {roles.map((r) => (
                      <option key={r.code as string} value={r.code as string}>{r.label as string}</option>
                    ))}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type de contrat</label>
                  <select name="contractType" defaultValue={editing?.contract_type as string || 'cdi'} className="input">
                    {contractTypes.map((ct) => (
                      <option key={ct.code} value={ct.code}>{ct.label}</option>
                    ))}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Salaire mensuel (DH)</label>
                  <input name="monthlySalary" type="number" step="0.01" defaultValue={editing?.monthly_salary as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Fréquence de paie</label>
                  <select name="payFrequency" defaultValue={(editing?.pay_frequency as string) || 'monthly'} className="input">
                    <option value="monthly">Mensuelle (fin de mois)</option>
                    <option value="weekly">Hebdomadaire (lundi pour S-1)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Salaire hebdomadaire (DH)</label>
                  <input name="weeklySalary" type="number" step="0.01" defaultValue={editing?.weekly_salary as string} className="input" placeholder="Requis si fréquence = hebdo" />
                  <p className="text-xs text-gray-500 mt-1">Base divisée par 6 jours pour le calcul jour.</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Shift par défaut</label>
                <select name="defaultShiftCode" defaultValue={(editing?.default_shift_code as string) || ''} className="input">
                  <option value="">— Aucun (à choisir manuellement dans le planning) —</option>
                  {(shifts as Record<string, any>[]).map(s => (
                    <option key={s.code as string} value={s.code as string}>{s.label as string}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Utilisé par le bouton « Appliquer défaut » dans l'onglet Planning hebdomadaire.</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Date d'embauche *</label><input name="hireDate" type="date" defaultValue={isoDate(editing?.hire_date)} className="input" required={!editing} /></div>
                <div><label className="block text-sm font-medium mb-1">Début contrat</label><input name="contractStart" type="date" defaultValue={isoDate(editing?.contract_start)} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Fin contrat</label><input name="contractEnd" type="date" defaultValue={isoDate(editing?.contract_end)} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">N° CNSS</label><input name="cnssNumber" defaultValue={editing?.cnss_number as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Taux CIMR (%)</label><input name="cimrRate" type="number" min="0" max="10" step="0.5" defaultValue={editing?.cimr_rate as string || '0'} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Anciennete (annees)</label><input name="seniorityYears" type="number" min="0" defaultValue={editing?.seniority_years as string || '0'} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Personnes a charge</label><input name="nbDependents" type="number" min="0" max="6" defaultValue={editing?.nb_dependents as string || '0'} className="input" /></div>
              </div>

              <p className="text-sm font-medium text-gray-500 border-b pb-1 pt-2">Contact d'urgence</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Nom</label><input name="emergencyContactName" defaultValue={editing?.emergency_contact_name as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Téléphone</label><input name="emergencyContactPhone" defaultValue={editing?.emergency_contact_phone as string} className="input" /></div>
              </div>

              <div><label className="block text-sm font-medium mb-1">Notes</label><textarea name="notes" rows={2} defaultValue={editing?.notes as string} className="input" /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ ATTENDANCE TAB ═══════════════════════ */
function AttendanceTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [attView, setAttView] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const activeEmployees = (employees as Record<string, any>[]).filter(e => e.is_active);

  // Daily records
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['attendance', selectedDate],
    queryFn: () => attendanceApi.list(selectedDate, selectedDate),
    enabled: attView === 'daily',
  });

  // Conges actifs ce jour-la (approved + pending). On les fusionne avec les
  // employes pour afficher un badge "Conge X" a la place de "Non planifie"
  // et desactiver les boutons de statut.
  const { data: dailyLeaves = [] } = useQuery({
    queryKey: ['leaves', 'activeOn', selectedDate],
    queryFn: () => leavesApi.list({ activeOn: selectedDate }),
    enabled: attView === 'daily',
  });
  const getLeaveFor = (empId: string): Record<string, any> | null => {
    const list = dailyLeaves as Record<string, any>[];
    // Conge approuve prime sur pending si les deux existent (peu probable)
    const approved = list.find(l => l.employee_id === empId && l.status === 'approved');
    if (approved) return approved;
    return list.find(l => l.employee_id === empId && l.status === 'pending') || null;
  };

  // Monthly records - get all records for the month
  const monthStart = `${summaryYear}-${String(summaryMonth).padStart(2, '0')}-01`;
  const monthEndDate = new Date(summaryYear, summaryMonth, 0);
  const monthEnd = `${summaryYear}-${String(summaryMonth).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

  const { data: monthlyRecords = [], isLoading: monthlyLoading } = useQuery({
    queryKey: ['attendance-monthly', summaryMonth, summaryYear],
    queryFn: () => attendanceApi.list(monthStart, monthEnd),
    enabled: attView === 'monthly',
  });

  const upsertMutation = useMutation({
    mutationFn: (data: Record<string, any>) => attendanceApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      notify.success('Pointage enregistré');
    },
    onError: () => notify.error('Erreur'),
  });

  const getRecord = (empId: string) => (records as Record<string, any>[]).find(r => r.employee_id === empId);

  // Calculate monthly summary per employee
  const getEmployeeMonthlySummary = (empId: string) => {
    const empRecords = (monthlyRecords as Record<string, any>[]).filter(r => r.employee_id === empId);
    const present = empRecords.filter(r => r.status === 'present').length;
    const late = empRecords.filter(r => r.status === 'late').length;
    const absent = empRecords.filter(r => r.status === 'absent').length;
    const halfDay = empRecords.filter(r => r.status === 'half_day').length;
    const overtimeMin = empRecords.reduce((s, r) => s + (parseInt(r.overtime_minutes as string) || 0), 0);
    const workedDays = present + late + Math.floor(halfDay / 2);
    return { present, late, absent, halfDay, overtimeMin, workedDays };
  };

  return (
    <>
      {/* View toggle */}
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setAttView('daily')} className={attView === 'daily' ? 'active' : ''}>
            Pointage journalier
          </button>
          <button onClick={() => setAttView('monthly')} className={attView === 'monthly' ? 'active' : ''}>
            Récapitulatif mensuel
          </button>
        </div>

        {attView === 'daily' ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => {
              const d = new Date(selectedDate); d.setDate(d.getDate() - 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn"><ChevronLeft size={14} /></button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="input" style={{ width: 'auto' }} />
            <button onClick={() => {
              const d = new Date(selectedDate); d.setDate(d.getDate() + 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn"><ChevronRight size={14} /></button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', fontWeight: 500, marginLeft: 4 }}>
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE dd MMMM yyyy', { locale: fr })}
            </span>
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <select value={summaryMonth} onChange={e => setSummaryMonth(parseInt(e.target.value))} className="input" style={{ width: 'auto' }}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" value={summaryYear} onChange={e => setSummaryYear(parseInt(e.target.value))} className="input" style={{ width: 96 }} />
          </div>
        )}
      </div>

      {/* Monthly summary view */}
      {attView === 'monthly' && (
        monthlyLoading ? <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Employé</th>
                  <th style={{ textAlign: 'center' }}>Présent</th>
                  <th style={{ textAlign: 'center' }}>Retard</th>
                  <th style={{ textAlign: 'center' }}>Demi-j.</th>
                  <th style={{ textAlign: 'center' }}>Absent</th>
                  <th style={{ textAlign: 'center' }}>H. Sup</th>
                  <th style={{ textAlign: 'center', background: '#eafaf1', color: '#155724' }}>J. Travaillés</th>
                  <th style={{ textAlign: 'right' }}>Salaire base</th>
                  <th style={{ textAlign: 'right' }}>Taux/jour</th>
                  <th style={{ textAlign: 'right', background: '#eafaf1', color: '#155724' }}>Salaire calculé</th>
                </tr>
              </thead>
              <tbody>
                {activeEmployees.map((emp: Record<string, any>) => {
                  const s = getEmployeeMonthlySummary(emp.id as string);
                  const baseSalary = emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0;
                  const dailyRate = baseSalary / 26;
                  const calculatedSalary = dailyRate * s.workedDays;
                  return (
                    <tr key={emp.id as string}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                          {emp.first_name as string} {emp.last_name as string}
                          <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: '#28a745', fontWeight: 500 }}>{s.present}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.late > 0 ? '#b08504' : 'var(--odoo-text-light)' }}>{s.late}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.halfDay > 0 ? '#1f6391' : 'var(--odoo-text-light)' }}>{s.halfDay}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.absent > 0 ? '#dc3545' : 'var(--odoo-text-light)' }}>{s.absent}</span></td>
                      <td style={{ textAlign: 'center', color: s.overtimeMin > 0 ? 'var(--odoo-text)' : 'var(--odoo-text-light)' }}>
                        {s.overtimeMin > 0 ? `${Math.floor(s.overtimeMin / 60)}h${String(s.overtimeMin % 60).padStart(2, '0')}` : '0'}
                      </td>
                      <td style={{ textAlign: 'center', background: '#eafaf1' }}>
                        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#155724' }}>{s.workedDays}</span>
                        <span style={{ color: 'var(--odoo-text-light)', fontSize: '0.6875rem' }}> / 26</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                        {baseSalary > 0 ? `${baseSalary.toFixed(2)} DH` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                        {baseSalary > 0 ? `${dailyRate.toFixed(2)} DH` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', background: '#eafaf1' }}>
                        {baseSalary > 0 ? (
                          <span style={{ fontWeight: 700, color: calculatedSalary < baseSalary ? '#dc3545' : '#155724' }}>
                            {calculatedSalary.toFixed(2)} DH
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot style={{ background: 'var(--odoo-bg-alt)', borderTop: '2px solid var(--odoo-border)' }}>
                <tr>
                  <td style={{ fontWeight: 700, padding: '0.5rem 0.75rem' }} colSpan={6}>Total</td>
                  <td style={{ textAlign: 'center', background: '#eafaf1', fontWeight: 700, color: '#155724', padding: '0.5rem 0.75rem' }}>
                    {activeEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).workedDays, 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '0.5rem 0.75rem' }}>
                    {activeEmployees.reduce((sum, emp) => sum + (emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0), 0).toFixed(2)} DH
                  </td>
                  <td></td>
                  <td style={{ textAlign: 'right', background: '#eafaf1', fontWeight: 700, color: '#155724', padding: '0.5rem 0.75rem' }}>
                    {activeEmployees.reduce((sum, emp) => {
                      const s = getEmployeeMonthlySummary(emp.id as string);
                      const base = emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0;
                      return sum + (base / 26) * s.workedDays;
                    }, 0).toFixed(2)} DH
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Daily view */}
      {attView === 'daily' && (
        isLoading ? <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#93c5fd', marginRight: 4, verticalAlign: 'middle' }} /> présence prévue (planning)</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#28a745', marginRight: 4, verticalAlign: 'middle' }} /> pointage confirmé</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', marginRight: 4, verticalAlign: 'middle' }} /> en congé</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Employé</th>
                <th>Prévu</th>
                <th style={{ textAlign: 'center' }}>Statut</th>
                <th style={{ textAlign: 'center' }}>Arrivée</th>
                <th style={{ textAlign: 'center' }}>Départ</th>
                <th style={{ textAlign: 'center' }}>H. Sup (min)</th>
              </tr>
            </thead>
            <tbody>
              {activeEmployees.map((emp: Record<string, any>) => {
                const rec = getRecord(emp.id as string);
                const plannedShift = rec?.planned_shift_code as ShiftCode | undefined;
                const isExpected = (rec as Record<string, any>)?.is_expected === true;
                const hasCheckIn = !!(rec as Record<string, any>)?.check_in;
                const leave = getLeaveFor(emp.id as string);
                const isOnLeave = leave?.status === 'approved';
                const isLeavePending = leave?.status === 'pending';
                return (
                  <tr key={emp.id as string} className={isOnLeave ? 'row-warning' : ''}>
                    <td>
                      <span className={`odoo-status-dot ${isOnLeave ? 'neutral' : hasCheckIn ? 'ok' : (isExpected ? 'warning' : 'neutral')}`} />
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                        {emp.first_name as string} {emp.last_name as string}
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}</span>
                      </span>
                    </td>
                    <td>
                      {leave ? (
                        <span className={`odoo-tag ${isOnLeave ? 'odoo-tag-purple' : 'odoo-tag-orange'}`}
                          title={`${LEAVE_TYPE_LABELS[leave.type as string] ?? leave.type} ${isLeavePending ? '(en attente)' : ''} — du ${(leave.start_date as string).slice(0, 10)} au ${(leave.end_date as string).slice(0, 10)}`}>
                          <CalendarOff size={10} style={{ marginRight: 3 }} />
                          {LEAVE_TYPE_LABELS[leave.type as string] ?? leave.type}{isLeavePending ? ' (en attente)' : ''}
                        </span>
                      ) : plannedShift ? (
                        <span className={`odoo-tag ${SHIFT_BADGE_COLORS[plannedShift]}`}>
                          {SHIFT_SHORT_LABELS[plannedShift]}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--odoo-text-light)', fontSize: '0.6875rem' }}>— Non planifié —</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isOnLeave ? (
                        <span className="odoo-tag odoo-tag-purple">
                          <CalendarOff size={10} style={{ marginRight: 3 }} /> En congé
                        </span>
                      ) : (
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {ATTENDANCE_STATUS.map(s => {
                            const isActive = (rec as Record<string, any>)?.status === s.value;
                            const isExpectedPresent = isExpected && !hasCheckIn && s.value === 'present';
                            return (
                              <button key={s.value}
                                onClick={() => upsertMutation.mutate({
                                  employeeId: emp.id, date: selectedDate, status: s.value,
                                  checkIn: (rec as Record<string, any>)?.check_in || undefined,
                                  checkOut: (rec as Record<string, any>)?.check_out || undefined,
                                })}
                                className={isActive ? `odoo-tag ${
                                  isExpectedPresent ? 'odoo-tag-blue' :
                                  s.value === 'present' ? 'odoo-tag-green' :
                                  s.value === 'absent' ? 'odoo-tag-red' :
                                  s.value === 'late' ? 'odoo-tag-yellow' :
                                  'odoo-tag-blue'
                                }` : 'odoo-tag odoo-tag-grey'}
                                style={{ cursor: 'pointer', border: 'none' }}>
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="time" className="input text-center text-sm w-28 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed"
                        disabled={isOnLeave}
                        defaultValue={(rec as Record<string, any>)?.check_in as string || ''}
                        onBlur={e => {
                          if (e.target.value) upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, any>)?.status || 'present',
                            checkIn: e.target.value,
                            checkOut: (rec as Record<string, any>)?.check_out || undefined,
                          });
                        }} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="time" className="input text-center text-sm w-28 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed"
                        disabled={isOnLeave}
                        defaultValue={(rec as Record<string, any>)?.check_out as string || ''}
                        onBlur={e => {
                          if (e.target.value) upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, any>)?.status || 'present',
                            checkIn: (rec as Record<string, any>)?.check_in || undefined,
                            checkOut: e.target.value,
                          });
                        }} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="input text-center text-sm w-20 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed" min="0"
                        disabled={isOnLeave}
                        defaultValue={(rec as Record<string, any>)?.overtime_minutes as number || 0}
                        onBlur={e => {
                          upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, any>)?.status || 'present',
                            checkIn: (rec as Record<string, any>)?.check_in || undefined,
                            checkOut: (rec as Record<string, any>)?.check_out || undefined,
                            overtimeMinutes: parseInt(e.target.value) || 0,
                          });
                        }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeEmployees.length === 0 && <p className="text-center py-8 text-gray-400">Aucun employé actif</p>}
        </div>
        </div>
        )
      )}
    </>
  );
}

/* ═══════════════════════ LEAVES TAB ═══════════════════════ */
function LeavesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const currentYear = new Date().getFullYear();
  const { entries: leaveTypes, getLabel: getLeaveLabel } = useReferentiel('leave_types');

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leaves', currentYear],
    queryFn: () => leavesApi.list({ year: String(currentYear) }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => leavesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé ajouté'); setShowForm(false); },
    onError: () => notify.error('Erreur'),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => leavesApi.approve(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé approuvé'); },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => leavesApi.reject(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé refusé'); },
  });

  const leavesList = leaves as Record<string, any>[];
  const pendingCount = leavesList.filter(l => l.status === 'pending').length;
  const approvedCount = leavesList.filter(l => l.status === 'approved').length;

  return (
    <>
      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><CalendarOff size={11} style={{ display: 'inline', marginRight: 4 }} />Demandes {currentYear}</div>
          <div className="odoo-stat-card-value">{leavesList.length}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />En attente</div>
          <div className="odoo-stat-card-value" style={{ color: pendingCount > 0 ? '#b08504' : undefined }}>{pendingCount}</div>
          <div className="odoo-stat-card-sub">à valider</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Approuvés</div>
          <div className="odoo-stat-card-value" style={{ color: approvedCount > 0 ? '#28a745' : undefined }}>{approvedCount}</div>
        </div>
      </div>

      <div className="odoo-search-panel">
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle demande
        </button>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : leavesList.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <CalendarOff size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun congé pour cette année</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Employé</th>
                <th>Type</th>
                <th>Période</th>
                <th style={{ textAlign: 'center' }}>Jours</th>
                <th>Motif</th>
                <th>Statut</th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leavesList.map(l => (
                <tr key={l.id as string} className={l.status === 'pending' ? 'row-warning' : ''}>
                  <td>
                    <span className={`odoo-status-dot ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'danger' : 'warning'}`} />
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {l.first_name as string} {l.last_name as string}
                    </span>
                  </td>
                  <td>{getLeaveLabel(l.type as string)}</td>
                  <td style={{ color: 'var(--odoo-text-muted)' }}>
                    {format(new Date(l.start_date as string), 'dd/MM/yyyy')} — {format(new Date(l.end_date as string), 'dd/MM/yyyy')}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{l.days as number}</td>
                  <td style={{ color: 'var(--odoo-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.reason as string || '—'}
                  </td>
                  <td>
                    <span className={`odoo-tag ${
                      l.status === 'approved' ? 'odoo-tag-green' :
                      l.status === 'rejected' ? 'odoo-tag-red' :
                      'odoo-tag-yellow'
                    }`}>
                      {l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvé' : 'Refusé'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {l.status === 'pending' && (
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        <button onClick={() => approveMutation.mutate(l.id as string)}
                          className="odoo-pager-btn" title="Approuver" style={{ color: '#28a745' }}>
                          <Check size={14} />
                        </button>
                        <button onClick={() => rejectMutation.mutate(l.id as string)}
                          className="odoo-pager-btn" title="Refuser" style={{ color: '#dc3545' }}>
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle demande de congé</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data = Object.fromEntries(fd) as Record<string, any>;
              const start = new Date(data.startDate as string);
              const end = new Date(data.endDate as string);
              const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              data.days = diffDays > 0 ? diffDays : 1;
              createMutation.mutate(data);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Employé *</label>
                <select name="employeeId" className="input" required>
                  <option value="">Choisir...</option>
                  {(employees as Record<string, any>[]).filter(e => e.is_active).map(e => (
                    <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                  ))}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Type *</label>
                <select name="type" className="input" required>
                  {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Du *</label><input name="startDate" type="date" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Au *</label><input name="endDate" type="date" className="input" required /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Motif</label><textarea name="reason" rows={2} className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ PAYROLL TAB ═══════════════════════ */
function PayrollTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [payView, setPayView] = useState<'monthly' | 'weekly'>('monthly');

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'flex-start' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setPayView('monthly')} className={payView === 'monthly' ? 'active' : ''}>
            Paie mensuelle
          </button>
          <button onClick={() => setPayView('weekly')} className={payView === 'weekly' ? 'active' : ''}>
            Paie hebdomadaire
          </button>
        </div>
      </div>
      {payView === 'monthly' ? <MonthlyPayrollView queryClient={queryClient} /> : <WeeklyPayrollView queryClient={queryClient} />}
    </>
  );
}

function MonthlyPayrollView({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [detailPayroll, setDetailPayroll] = useState<Record<string, any> | null>(null);
  const [payTarget, setPayTarget] = useState<Record<string, any> | null>(null);
  const [paySortKey, setPaySortKey] = useState<string>('name');
  const [paySortDir, setPaySortDir] = useState<'asc' | 'desc'>('asc');
  const { getLabel: getRoleLabel } = useReferentiel('employee_roles');

  const togglePaySort = (key: string) => {
    if (paySortKey === key) setPaySortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setPaySortKey(key); setPaySortDir('asc'); }
  };
  const PaySortIcon = ({ col }: { col: string }) => {
    if (paySortKey !== col) return <ArrowUpDown size={13} className="text-gray-300 ml-1 inline" />;
    return paySortDir === 'asc' ? <ArrowUp size={13} className="text-teal-600 ml-1 inline" /> : <ArrowDown size={13} className="text-teal-600 ml-1 inline" />;
  };

  const { data: payrolls = [], isLoading } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => payrollApi.list({ month: String(month), year: String(year) }),
  });

  // Soldes d'avances en cours par employe (pour proposer la retenue au paiement)
  const { data: outstandingRows = [] } = useQuery({
    queryKey: ['advances-outstanding'],
    queryFn: () => advancesApi.outstanding(),
  });
  // outstanding = solde total ; suggested = retenue proposee (plan d'etalement
  // monthly_deduction si defini, sinon tout le solde).
  const { outstandingByEmp, suggestedByEmp } = useMemo(() => {
    const o = new Map<string, number>();
    const s = new Map<string, number>();
    (outstandingRows as Record<string, any>[]).forEach(r => {
      o.set(r.employee_id as string, parseFloat(r.outstanding as string) || 0);
      s.set(r.employee_id as string, parseFloat(r.suggested as string) || 0);
    });
    return { outstandingByEmp: o, suggestedByEmp: s };
  }, [outstandingRows]);

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generate(month, year),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); notify.success('Bulletins generes'); },
    onError: () => notify.error('Erreur lors de la generation'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method, deduction }: { id: string; method: string; deduction: number }) =>
      payrollApi.markPaid(id, method, deduction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Paiement enregistre');
      setPayTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors du paiement');
    },
  });

  const pf = (v: unknown) => parseFloat(v as string || '0').toFixed(2);
  const pn = (v: unknown) => parseFloat(v as string || '0');

  const totalNet = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.net_salary), 0);
  const totalGross = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.gross_salary), 0);
  const totalIR = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.ir_net), 0);
  const totalCNSS = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.cnss_employee), 0);
  const totalAMO = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.amo_employee), 0);
  const totalChargesPatron = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.total_charges_patron), 0);
  const totalPaid = (payrolls as Record<string, any>[]).filter(p => p.paid).length;

  const exportPayroll = () => {
    const BOM = '\uFEFF';
    const headers = ['Employe', 'Fonction', 'Salaire Base', 'Brut', 'CNSS Sal.', 'AMO Sal.', 'IR', 'Net a payer', 'Charges Patron', 'Paye'];
    const rows = (payrolls as Record<string, any>[]).map(p => [
      `${p.first_name} ${p.last_name}`,
      getRoleLabel(p.employee_role as string),
      pf(p.base_salary), pf(p.gross_salary), pf(p.cnss_employee), pf(p.amo_employee),
      pf(p.ir_net), pf(p.net_salary), pf(p.total_charges_patron),
      p.paid ? 'Oui' : 'Non',
    ]);
    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `paie_${MONTH_NAMES[month - 1]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Sort payrolls ───
  const sortedPayrolls = [...(payrolls as Record<string, any>[])].sort((a, b) => {
    let cmp = 0;
    switch (paySortKey) {
      case 'name': cmp = (`${a.first_name} ${a.last_name}` as string).localeCompare(`${b.first_name} ${b.last_name}` as string); break;
      case 'role': cmp = getRoleLabel(a.employee_role as string).localeCompare(getRoleLabel(b.employee_role as string)); break;
      case 'base': cmp = pn(a.base_salary) - pn(b.base_salary); break;
      case 'gross': cmp = pn(a.gross_salary) - pn(b.gross_salary); break;
      case 'cnss': cmp = pn(a.cnss_employee) - pn(b.cnss_employee); break;
      case 'amo': cmp = pn(a.amo_employee) - pn(b.amo_employee); break;
      case 'ir': cmp = pn(a.ir_net) - pn(b.ir_net); break;
      case 'net': cmp = pn(a.net_salary) - pn(b.net_salary); break;
      case 'status': cmp = (a.paid ? 1 : 0) - (b.paid ? 1 : 0); break;
    }
    return paySortDir === 'asc' ? cmp : -cmp;
  });

  // ─── PDF bulletin generation ───
  const generatePDF = (p: Record<string, any>) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const mg = 15; // margin
    let y = 15;

    const addLine = (label: string, value: string, x1 = mg, x2 = W - mg) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(label, x1, y);
      doc.setFont('helvetica', 'bold');
      doc.text(value, x2, y, { align: 'right' });
      y += 5;
    };

    const addSection = (title: string, color: [number, number, number]) => {
      y += 3;
      doc.setFillColor(...color);
      doc.rect(mg, y - 4, W - 2 * mg, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(title, mg + 3, y);
      doc.setTextColor(0, 0, 0);
      y += 7;
    };

    const addSeparator = () => {
      doc.setDrawColor(200, 200, 200);
      doc.line(mg, y, W - mg, y);
      y += 3;
    };

    // ═══ Header ═══
    doc.setFillColor(13, 148, 136); // teal-600
    doc.rect(0, 0, W, 38, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('BULLETIN DE PAIE', W / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`${MONTH_NAMES[month - 1]} ${year}`, W / 2, 23, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Ofauria', W / 2, 31, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    y = 48;

    // ═══ Employee info ═══
    doc.setFillColor(245, 245, 245);
    doc.rect(mg, y - 5, W - 2 * mg, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${p.first_name} ${p.last_name}`, mg + 5, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Fonction : ${getRoleLabel(p.employee_role as string)}`, mg + 5, y + 6);
    doc.text(`Jours trav. : ${p.worked_days}    |    Absences : ${p.absent_days}    |    H. Sup : ${pn(p.overtime_hours).toFixed(1)}h`, mg + 5, y + 11);
    y += 20;

    // ═══ Remuneration ═══
    addSection('REMUNERATION', [59, 130, 246]); // blue
    addLine('Salaire de base', `${pf(p.base_salary)} DH`);
    if (pn(p.seniority_bonus) > 0) addLine("Prime d'anciennete", `${pf(p.seniority_bonus)} DH`);
    if (pn(p.overtime_amount) > 0) addLine('Heures supplementaires', `${pf(p.overtime_amount)} DH`);
    if (pn(p.deductions) > 0) addLine('Retenue absences', `- ${pf(p.deductions)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Salaire brut', `${pf(p.gross_salary)} DH`);

    // ═══ Cotisations salariales ═══
    addSection('COTISATIONS SALARIALES', [234, 88, 12]); // orange
    addLine('CNSS (4.48% plaf. 6 000)', `- ${pf(p.cnss_employee)} DH`);
    addLine('AMO (2.26%)', `- ${pf(p.amo_employee)} DH`);
    if (pn(p.cimr_employee) > 0) addLine('CIMR', `- ${pf(p.cimr_employee)} DH`);
    addSeparator();
    const sni = pn(p.gross_salary) - pn(p.cnss_employee) - pn(p.amo_employee) - pn(p.cimr_employee);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Salaire net imposable', `${sni.toFixed(2)} DH`);

    // ═══ IR ═══
    addSection("IMPOT SUR LE REVENU", [220, 38, 38]); // red
    addLine('Frais professionnels (20%)', `- ${pf(p.frais_pro)} DH`);
    addLine('IR brut (bareme)', `${pf(p.ir_gross)} DH`);
    if (pn(p.family_deduction) > 0) addLine(`Deduction familiale (${p.nb_dependents} pers.)`, `- ${pf(p.family_deduction)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('IR net', `- ${pf(p.ir_net)} DH`);

    // ═══ Net a payer ═══
    y += 5;
    doc.setFillColor(22, 163, 74); // green-600
    doc.rect(mg, y - 5, W - 2 * mg, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('NET A PAYER', mg + 5, y + 3);
    doc.text(`${pf(p.net_salary)} DH`, W - mg - 5, y + 3, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 16;

    // ═══ Charges patronales ═══
    addSection('CHARGES PATRONALES', [147, 51, 234]); // purple
    addLine('CNSS patronale (8.98%)', `${pf(p.cnss_employer)} DH`);
    addLine('AMO patronale (4.11%)', `${pf(p.amo_employer)} DH`);
    if (pn(p.cimr_employer) > 0) addLine('CIMR patronale', `${pf(p.cimr_employer)} DH`);
    addLine('Allocations familiales (6.40%)', `${pf(p.alloc_familiales)} DH`);
    addLine('Taxe form. prof. (1.60%)', `${pf(p.taxe_fp)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Total charges patronales', `${pf(p.total_charges_patron)} DH`);

    // ═══ Footer ═══
    y = 275;
    doc.setDrawColor(200, 200, 200);
    doc.line(mg, y, W - mg, y);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Bulletin genere le ${format(new Date(), 'dd/MM/yyyy')} — Ofauria`, W / 2, y + 5, { align: 'center' });

    doc.save(`bulletin_${(p.first_name as string).toLowerCase()}_${(p.last_name as string).toLowerCase()}_${MONTH_NAMES[month - 1].toLowerCase()}_${year}.pdf`);
  };

  const generateAllPDF = () => {
    sortedPayrolls.forEach(p => generatePDF(p));
    notify.success(`${sortedPayrolls.length} bulletins PDF generes`);
  };

  return (
    <>
      {/* Toolbar */}
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input" style={{ width: 'auto' }}>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input" style={{ width: 96 }} />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={generateAllPDF} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileText size={13} /> PDF tous
          </button>
          <button onClick={exportPayroll} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Download size={13} /> CSV
          </button>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> Générer les bulletins
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      {(payrolls as Record<string, any>[]).length > 0 && (
        <div className="odoo-stat-grid">
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Masse salariale brute</div>
            <div className="odoo-stat-card-value">{totalGross.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Total net à payer</div>
            <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{totalNet.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">CNSS + AMO + IR (sal.)</div>
            <div className="odoo-stat-card-value" style={{ color: '#b85d1a' }}>{(totalCNSS + totalAMO + totalIR).toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Charges patronales</div>
            <div className="odoo-stat-card-value" style={{ color: 'var(--theme-accent)' }}>{totalChargesPatron.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : sortedPayrolls.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Banknote size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun bulletin pour cette période. Cliquez sur « Générer les bulletins ».</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th onClick={() => togglePaySort('name')} style={{ cursor: 'pointer' }}>Employé <PaySortIcon col="name" /></th>
                <th onClick={() => togglePaySort('base')} style={{ cursor: 'pointer', textAlign: 'right' }}>Base <PaySortIcon col="base" /></th>
                <th onClick={() => togglePaySort('gross')} style={{ cursor: 'pointer', textAlign: 'right' }}>Brut <PaySortIcon col="gross" /></th>
                <th onClick={() => togglePaySort('cnss')} style={{ cursor: 'pointer', textAlign: 'right' }}>CNSS <PaySortIcon col="cnss" /></th>
                <th onClick={() => togglePaySort('amo')} style={{ cursor: 'pointer', textAlign: 'right' }}>AMO <PaySortIcon col="amo" /></th>
                <th onClick={() => togglePaySort('ir')} style={{ cursor: 'pointer', textAlign: 'right' }}>IR <PaySortIcon col="ir" /></th>
                <th onClick={() => togglePaySort('net')} style={{ cursor: 'pointer', textAlign: 'right', background: '#eafaf1', color: '#155724' }}>Net <PaySortIcon col="net" /></th>
                <th style={{ textAlign: 'right' }}>Avance</th>
                <th onClick={() => togglePaySort('status')} style={{ cursor: 'pointer', textAlign: 'center' }}>Statut <PaySortIcon col="status" /></th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayrolls.map(p => (
                <tr key={p.id as string}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {p.first_name as string} {p.last_name as string}
                      <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {getRoleLabel(p.employee_role as string)}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{pf(p.base_salary)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{pf(p.gross_salary)}</td>
                  <td style={{ textAlign: 'right', color: '#b85d1a' }}>{pf(p.cnss_employee)}</td>
                  <td style={{ textAlign: 'right', color: '#b85d1a' }}>{pf(p.amo_employee)}</td>
                  <td style={{ textAlign: 'right', color: '#dc3545' }}>{pf(p.ir_net)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#155724', background: '#eafaf1' }}>{pf(p.net_salary)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.paid ? (
                      pn(p.advance_deduction) > 0
                        ? <span style={{ color: '#b85d1a', fontWeight: 500 }}>− {pf(p.advance_deduction)}</span>
                        : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                    ) : (outstandingByEmp.get(p.employee_id as string) || 0) > 0 ? (
                      <span className="odoo-tag odoo-tag-orange" title="Solde d'avances à récupérer">
                        {(outstandingByEmp.get(p.employee_id as string) || 0).toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {p.paid ? (
                      <span className="odoo-tag odoo-tag-green">Payé</span>
                    ) : (
                      <button onClick={() => setPayTarget(p)}
                        className="odoo-tag odoo-tag-purple" style={{ cursor: 'pointer', border: 'none' }}>
                        Payer
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => setDetailPayroll(p)} className="odoo-pager-btn" title="Voir le détail">
                        <UserCog size={13} />
                      </button>
                      <button onClick={() => generatePDF(p)} className="odoo-pager-btn" title="Télécharger PDF" style={{ color: '#dc3545' }}>
                        <FileText size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Dialogue de paiement (mode + retenue avance) ─── */}
      {payTarget && (
        <PayrollPayDialog
          employeeName={`${payTarget.first_name} ${payTarget.last_name}`}
          periodLabel={`${MONTH_NAMES[month - 1]} ${year}`}
          net={pn(payTarget.net_salary)}
          outstanding={outstandingByEmp.get(payTarget.employee_id as string) || 0}
          suggested={suggestedByEmp.get(payTarget.employee_id as string) ?? (outstandingByEmp.get(payTarget.employee_id as string) || 0)}
          defaultMethod="cash"
          pending={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(method, deduction) => payMutation.mutate({ id: payTarget.id as string, method, deduction })}
        />
      )}

      {/* ─── Bulletin de paie detail modal ─── */}
      {detailPayroll && (() => {
        const p = detailPayroll;
        const line = (label: string, value: string, color = 'text-gray-800', bold = false) => (
          <div className="flex justify-between py-1.5 px-3">
            <span className="text-gray-500 text-sm">{label}</span>
            <span className={`text-sm ${color} ${bold ? 'font-bold' : 'font-medium'}`}>{value} DH</span>
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailPayroll(null)}>
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={ev => ev.stopPropagation()}>
              {/* Header */}
              <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">{p.first_name as string} {p.last_name as string}</h2>
                    <p className="text-teal-100 text-sm">{getRoleLabel(p.employee_role as string)} — {MONTH_NAMES[month - 1]} {year}</p>
                  </div>
                  <button onClick={() => setDetailPayroll(null)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Presence */}
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Presence</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><p className="text-gray-500">Jours trav.</p><p className="font-bold">{p.worked_days as number}</p></div>
                    <div><p className="text-gray-500">Absences</p><p className="font-bold text-red-600">{p.absent_days as number}</p></div>
                    <div><p className="text-gray-500">H. Sup</p><p className="font-bold">{pn(p.overtime_hours).toFixed(1)}h</p></div>
                  </div>
                </div>

                {/* Remuneration */}
                <div className="bg-blue-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-blue-600 uppercase px-3 pt-3 pb-1">Remuneration</p>
                  {line('Salaire de base', pf(p.base_salary))}
                  {pn(p.seniority_bonus) > 0 && line('Prime d\'anciennete', pf(p.seniority_bonus))}
                  {pn(p.overtime_amount) > 0 && line('Heures supplementaires', pf(p.overtime_amount))}
                  {pn(p.deductions) > 0 && line('Retenue absences', '-' + pf(p.deductions), 'text-red-600')}
                  <div className="border-t border-blue-200 mt-1">
                    {line('Salaire brut', pf(p.gross_salary), 'text-blue-700', true)}
                  </div>
                </div>

                {/* Cotisations salariales */}
                <div className="bg-orange-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-orange-600 uppercase px-3 pt-3 pb-1">Cotisations salariales</p>
                  {line('CNSS (4.48% plaf. 6 000)', '-' + pf(p.cnss_employee), 'text-orange-700')}
                  {line('AMO (2.26%)', '-' + pf(p.amo_employee), 'text-orange-700')}
                  {pn(p.cimr_employee) > 0 && line('CIMR', '-' + pf(p.cimr_employee), 'text-orange-700')}
                  <div className="border-t border-orange-200 mt-1">
                    {line('= Salaire net imposable', pf(pn(p.gross_salary) - pn(p.cnss_employee) - pn(p.amo_employee) - pn(p.cimr_employee)), 'text-orange-800', true)}
                  </div>
                </div>

                {/* IR */}
                <div className="bg-red-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-red-600 uppercase px-3 pt-3 pb-1">Impot sur le revenu</p>
                  {line('Frais professionnels (20%)', '-' + pf(p.frais_pro))}
                  {line('IR brut (bareme)', pf(p.ir_gross))}
                  {pn(p.family_deduction) > 0 && line(`Deduction familiale (${p.nb_dependents} pers.)`, '-' + pf(p.family_deduction))}
                  <div className="border-t border-red-200 mt-1">
                    {line('IR net', '-' + pf(p.ir_net), 'text-red-700', true)}
                  </div>
                </div>

                {/* Net */}
                <div className="bg-green-100 rounded-xl p-4 text-center">
                  <p className="text-xs text-green-600 uppercase font-semibold mb-1">Net a payer</p>
                  <p className="text-3xl font-bold text-green-700">{pf(p.net_salary)} <span className="text-base">DH</span></p>
                </div>

                {/* Charges patronales */}
                <details className="bg-purple-50 rounded-xl overflow-hidden">
                  <summary className="text-xs font-semibold text-purple-600 uppercase px-3 py-3 cursor-pointer hover:bg-purple-100 transition-colors">
                    Charges patronales — {pf(p.total_charges_patron)} DH
                  </summary>
                  <div className="pb-2">
                    {line('CNSS patronale (8.98%)', pf(p.cnss_employer), 'text-purple-700')}
                    {line('AMO patronale (4.11%)', pf(p.amo_employer), 'text-purple-700')}
                    {pn(p.cimr_employer) > 0 && line('CIMR patronale', pf(p.cimr_employer), 'text-purple-700')}
                    {line('Allocations familiales (6.40%)', pf(p.alloc_familiales), 'text-purple-700')}
                    {line('Taxe form. prof. (1.60%)', pf(p.taxe_fp), 'text-purple-700')}
                  </div>
                </details>

                {/* PDF download button */}
                <button onClick={() => { generatePDF(p); notify.success('Bulletin PDF telecharge'); }}
                  className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                  <FileText size={18} /> Telecharger le bulletin PDF
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* ═══════════════════════ WEEKLY PAYROLL VIEW ═══════════════════════ */
type WeeklyPayrollRow = {
  employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
  weekly_salary: string | null;
  payroll_id: string | null;
  base_amount: string | null;
  worked_days: number | null;
  absent_days: number | null;
  overtime_hours: string | null;
  overtime_amount: string | null;
  net_amount: string | null;
  paid: boolean | null;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
};

type WeeklyPayrollData = { weekStart: string; weekEnd: string; rows: WeeklyPayrollRow[] };

function WeeklyPayrollView({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  // Par defaut : semaine PRECEDENTE (Lun S-1 -> Dim S-1), conformement
  // au cas d'usage "lundi = jour de paie pour la semaine ecoulee".
  const [weekOffset, setWeekOffset] = useState(-1);
  const weekStartDate = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEndDate = endOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekStartStr = format(weekStartDate, 'yyyy-MM-dd');

  const { data: weekData, isLoading } = useQuery<WeeklyPayrollData>({
    queryKey: ['weekly-payroll', weekStartStr],
    queryFn: () => weeklyPayrollApi.list(weekStartStr) as Promise<WeeklyPayrollData>,
  });

  // Soldes d'avances en cours (pour proposer la retenue au paiement)
  const { data: outstandingRows = [] } = useQuery({
    queryKey: ['advances-outstanding'],
    queryFn: () => advancesApi.outstanding(),
  });
  const { outstandingByEmp, suggestedByEmp } = useMemo(() => {
    const o = new Map<string, number>();
    const s = new Map<string, number>();
    (outstandingRows as Record<string, any>[]).forEach(r => {
      o.set(r.employee_id as string, parseFloat(r.outstanding as string) || 0);
      s.set(r.employee_id as string, parseFloat(r.suggested as string) || 0);
    });
    return { outstandingByEmp: o, suggestedByEmp: s };
  }, [outstandingRows]);
  // Cible du dialogue de paiement (ouvert seulement si l'employe a une avance en cours)
  const [payTarget, setPayTarget] = useState<{ row: WeeklyPayrollRow; method: string } | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => weeklyPayrollApi.generate(weekStartStr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      notify.success('Paies hebdomadaires générées depuis le pointage');
    },
    onError: () => notify.error('Erreur lors de la génération'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method, deduction }: { id: string; method: string; deduction?: number }) =>
      weeklyPayrollApi.markPaid(id, method, deduction || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Marqué comme payé + écriture comptable créée');
      setPayTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur');
    },
  });

  /** Paiement direct si pas d'avance en cours, sinon dialogue avec retenue proposée. */
  const startPay = (row: WeeklyPayrollRow, method: string) => {
    const outstanding = outstandingByEmp.get(row.employee_id) || 0;
    if (outstanding > 0) setPayTarget({ row, method });
    else payMutation.mutate({ id: row.payroll_id as string, method });
  };

  const unpayMutation = useMutation({
    mutationFn: (id: string) => weeklyPayrollApi.unmarkPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      notify.success('Paiement annulé (l\'écriture comptable reste, à supprimer manuellement)');
    },
    onError: () => notify.error('Erreur'),
  });

  const rows = weekData?.rows ?? [];
  const generated = rows.filter(r => r.payroll_id);
  const ungenerated = rows.filter(r => !r.payroll_id);
  const paidCount = generated.filter(r => r.paid).length;
  const totalDue = generated.filter(r => !r.paid).reduce((s, r) => s + parseFloat(r.net_amount || '0'), 0);
  const totalPaid = generated.filter(r => r.paid).reduce((s, r) => s + parseFloat(r.net_amount || '0'), 0);

  const isCurrentWeek = weekOffset === 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setWeekOffset(w => w - 1)} className="odoo-pager-btn" aria-label="Semaine précédente"><ChevronLeft size={14} /></button>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            Semaine du {format(weekStartDate, 'dd MMM', { locale: fr })} au {format(weekEndDate, 'dd MMM yyyy', { locale: fr })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="odoo-pager-btn" aria-label="Semaine suivante"><ChevronRight size={14} /></button>
          <button onClick={() => setWeekOffset(-1)} style={{ fontSize: '0.6875rem', color: 'var(--odoo-purple)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 }}>
            Semaine précédente
          </button>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || rows.length === 0} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> {generateMutation.isPending ? 'Génération...' : 'Générer depuis pointage'}
          </button>
        </div>
      </div>

      {isCurrentWeek && (
        <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem' }}>
          <div style={{ fontSize: '0.75rem' }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
            Vous regardez la semaine en cours. La paie est habituellement faite le lundi pour la semaine précédente.
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Employés hebdo</div>
          <div className="odoo-stat-card-value">{rows.length}</div>
          <div className="odoo-stat-card-sub">à payer cette semaine</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Payés</div>
          <div className="odoo-stat-card-value" style={{ color: paidCount > 0 ? '#28a745' : undefined }}>{paidCount}</div>
          <div className="odoo-stat-card-sub">{totalPaid.toFixed(2)} DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Reste dû</div>
          <div className="odoo-stat-card-value" style={{ color: totalDue > 0 ? '#dc3545' : undefined }}>{totalDue.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />Non générés</div>
          <div className="odoo-stat-card-value" style={{ color: ungenerated.length > 0 ? '#b08504' : undefined }}>{ungenerated.length}</div>
          <div className="odoo-stat-card-sub">en attente du calcul</div>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Banknote size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun employé en fréquence hebdomadaire.</p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Passez un employé en « Fréquence de paie : Hebdomadaire » dans l'onglet Employés pour le voir ici.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Employé</th>
                <th style={{ textAlign: 'right' }}>Salaire hebdo</th>
                <th style={{ textAlign: 'center' }}>Jours trav.</th>
                <th style={{ textAlign: 'center' }} title="Repos hebdomadaire payé (automatique dès que la semaine a été travaillée)">Repos</th>
                <th style={{ textAlign: 'center' }}>Absents</th>
                <th style={{ textAlign: 'right' }}>Base</th>
                <th style={{ textAlign: 'right' }}>H. Sup</th>
                <th style={{ textAlign: 'right', background: '#eafaf1', color: '#155724' }}>Net</th>
                <th style={{ textAlign: 'center', width: 110 }}>Paiement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const generated = !!r.payroll_id;
                const paid = !!r.paid;
                return (
                  <tr key={r.employee_id} className={paid ? '' : generated ? 'row-warning' : ''}>
                    <td>
                      <span className={`odoo-status-dot ${paid ? 'ok' : generated ? 'warning' : 'neutral'}`} />
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                        {r.first_name} {r.last_name}
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                      {r.weekly_salary ? `${parseFloat(r.weekly_salary).toFixed(2)} DH` : <span style={{ color: '#dc3545' }}>Non défini</span>}
                    </td>
                    {generated ? (
                      <>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{r.worked_days}</td>
                        <td style={{ textAlign: 'center', color: (r.worked_days ?? 0) > 0 ? '#7c3aed' : 'var(--odoo-text-light)' }} title="Repos payé (1 jour, automatique)">
                          {(r.worked_days ?? 0) > 0 ? 1 : '—'}
                        </td>
                        <td style={{ textAlign: 'center', color: (r.absent_days ?? 0) > 0 ? '#dc3545' : 'var(--odoo-text-light)' }}>{r.absent_days}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(r.base_amount || '0').toFixed(2)}</td>
                        <td style={{ textAlign: 'right', color: parseFloat(r.overtime_amount || '0') > 0 ? '#b85d1a' : 'var(--odoo-text-light)' }}>
                          {parseFloat(r.overtime_amount || '0') > 0 ? `+${parseFloat(r.overtime_amount || '0').toFixed(2)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#155724', background: '#eafaf1' }}>
                          {parseFloat(r.net_amount || '0').toFixed(2)} DH
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {paid ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span className="odoo-tag odoo-tag-green">
                                <Check size={10} style={{ marginRight: 3 }} /> Payé
                              </span>
                              <button onClick={() => {
                                if (confirm(`Annuler le paiement de ${r.first_name} ${r.last_name} ?\n\nL'écriture comptable créée reste en place (à supprimer manuellement dans l'onglet Paiements si besoin).`)) {
                                  unpayMutation.mutate(r.payroll_id as string);
                                }
                              }} className="odoo-pager-btn" title="Annuler le paiement" style={{ color: '#dc3545' }}>
                                <RotateCcw size={12} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {(outstandingByEmp.get(r.employee_id) || 0) > 0 && (
                                <span className="odoo-tag odoo-tag-orange" title={`Avance en cours : ${(outstandingByEmp.get(r.employee_id) || 0).toFixed(2)} DH — retenue proposée au paiement`}>
                                  <HandCoins size={10} style={{ marginRight: 2 }} />
                                  {(outstandingByEmp.get(r.employee_id) || 0).toFixed(0)}
                                </span>
                              )}
                              <button onClick={() => startPay(r, 'cash')} className="odoo-btn-primary"
                                disabled={payMutation.isPending}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.25rem 0.5rem', fontSize: '0.6875rem' }}>
                                <Banknote size={11} /> Espèces
                              </button>
                              <button onClick={() => startPay(r, 'bank')} className="odoo-btn-secondary"
                                disabled={payMutation.isPending}
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.6875rem' }}>
                                Virement
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--odoo-text-light)', fontStyle: 'italic' }}>
                          — Cliquez « Générer depuis pointage » pour calculer —
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="odoo-tag odoo-tag-grey">Non généré</span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {generated.length > 0 && (
              <tfoot style={{ background: 'var(--odoo-bg-alt)', borderTop: '2px solid var(--odoo-border)' }}>
                <tr>
                  <td colSpan={6} style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>Total semaine</td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700 }}>
                    {generated.reduce((s, r) => s + parseFloat(r.base_amount || '0'), 0).toFixed(2)} DH
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700, color: '#b85d1a' }}>
                    {generated.reduce((s, r) => s + parseFloat(r.overtime_amount || '0'), 0).toFixed(2)} DH
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700, color: '#155724', background: '#eafaf1' }}>
                    {generated.reduce((s, r) => s + parseFloat(r.net_amount || '0'), 0).toFixed(2)} DH
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ─── Dialogue de paiement avec retenue d'avance ─── */}
      {payTarget && (
        <PayrollPayDialog
          employeeName={`${payTarget.row.first_name} ${payTarget.row.last_name}`}
          periodLabel={`Semaine du ${format(weekStartDate, 'dd MMM yyyy', { locale: fr })}`}
          net={parseFloat(payTarget.row.net_amount || '0')}
          outstanding={outstandingByEmp.get(payTarget.row.employee_id) || 0}
          suggested={suggestedByEmp.get(payTarget.row.employee_id) ?? (outstandingByEmp.get(payTarget.row.employee_id) || 0)}
          defaultMethod={payTarget.method}
          pending={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(method, deduction) => payMutation.mutate({ id: payTarget.row.payroll_id as string, method, deduction })}
        />
      )}

      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
        Le bouton « Générer depuis pointage » recalcule la paie à partir du pointage (jours présents/absents/retards et heures sup). Les lignes déjà payées ne sont jamais écrasées.
        Taux journalier = salaire / 7. Le repos hebdomadaire est payé automatiquement (« +R ») dès que l'employé a travaillé dans la semaine : 6 jours travaillés = salaire complet ; 7 jours travaillés (repos non pris) = salaire + 1 journée.
        Marquer payé crée automatiquement une écriture comptable « Salaires » sur la caisse correspondante.
        Si l'employé a une avance en cours, une retenue est proposée au moment du paiement.
      </div>
    </>
  );
}

/* ═══════════════════════ PAY DIALOG (méthode + retenue d'avance) ═══════════════════════ */
/**
 * Dialogue de paiement commun mensuel/hebdo : choix du mode de règlement +
 * proposition de retenue sur les avances en cours de l'employé.
 * `suggested` = retenue proposée : suit le plan d'étalement de chaque avance
 * (monthly_deduction) si défini, sinon tout le solde. Toujours plafonnée au
 * net dû, et modifiable librement au moment du paiement.
 */
function PayrollPayDialog({ employeeName, periodLabel, net, outstanding, suggested, defaultMethod, pending, onClose, onConfirm }: {
  employeeName: string;
  periodLabel: string;
  net: number;
  outstanding: number;
  suggested: number;
  defaultMethod: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (method: string, deduction: number) => void;
}) {
  const maxDeduction = Math.min(outstanding, net);
  const proposed = Math.min(suggested, maxDeduction);
  const hasPlan = suggested < outstanding - 0.005;
  const [method, setMethod] = useState(defaultMethod);
  const [deduction, setDeduction] = useState<string>(proposed > 0 ? proposed.toFixed(2) : '0');
  const ded = Math.max(0, parseFloat(deduction) || 0);
  const cashOut = Math.max(0, Math.round((net - ded) * 100) / 100);
  const invalid = ded > maxDeduction + 0.005;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
        <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Payer {employeeName}</h2>
            <p className="text-teal-100 text-sm">{periodLabel}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-500">Net dû</span>
            <span className="text-lg font-bold">{net.toFixed(2)} DH</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="cash">Espèces</option>
              <option value="bank">Virement</option>
              <option value="check">Chèque</option>
            </select>
          </div>

          {outstanding > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-sm text-amber-800">
                <HandCoins size={14} className="inline mr-1" />
                Avances en cours : <strong>{outstanding.toFixed(2)} DH</strong>
              </p>
              <label className="block text-xs font-medium text-amber-800">
                Retenue sur cette paie (max {maxDeduction.toFixed(2)} DH)
                {hasPlan && <span className="font-normal"> — plan d'étalement : {proposed.toFixed(2)} DH proposés</span>}
              </label>
              <input type="number" step="0.01" min="0" max={maxDeduction} value={deduction}
                onChange={e => setDeduction(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 ${invalid ? 'border-red-400 focus:ring-red-500' : 'border-amber-200 focus:ring-amber-500'}`} />
              {invalid && <p className="text-xs text-red-600">La retenue dépasse le solde d'avances ou le net dû.</p>}
              <p className="text-xs text-amber-700">Montant modifiable — mettre 0 pour ne rien retenir sur cette paie.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Aucune avance en cours pour cet employé.</p>
          )}

          <div className="bg-green-50 rounded-xl p-3 flex justify-between items-baseline">
            <span className="text-sm text-green-700">À verser ({method === 'cash' ? 'espèces' : method === 'bank' ? 'virement' : 'chèque'})</span>
            <span className="text-xl font-bold text-green-700">{cashOut.toFixed(2)} DH</span>
          </div>

          <button disabled={pending || invalid}
            onClick={() => onConfirm(method, Math.round(ded * 100) / 100)}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
            <Check size={16} /> {pending ? 'Enregistrement...' : 'Confirmer le paiement'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ ADVANCES TAB (avances sur salaire) ═══════════════════════ */
function AdvancesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  // Champs controles du formulaire d'octroi (pour l'apercu d'etalement en direct)
  const [formAmount, setFormAmount] = useState('');
  const [formMonthly, setFormMonthly] = useState('');
  // Modale de modification (admin) : montant/date/mode si aucune retenue, plan+notes toujours
  const [editingAdvance, setEditingAdvance] = useState<Record<string, any> | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMonthly, setEditMonthly] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editMethod, setEditMethod] = useState('cash');
  const [editNotes, setEditNotes] = useState('');
  const { getLabel: getRoleLabel } = useReferentiel('employee_roles');
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { user } = useAuth();

  const { data: advances = [], isLoading } = useQuery({
    queryKey: ['salary-advances', statusFilter],
    queryFn: () => advancesApi.list(statusFilter === 'open' ? { status: 'open' } : undefined),
  });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => advancesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance enregistrée (le décaissement apparaît en Caisse)');
      setShowForm(false);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => advancesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance modifiée');
      setEditingAdvance(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Modification impossible');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => advancesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance supprimée (décaissement annulé)');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Suppression impossible');
    },
  });

  const pn = (v: unknown) => parseFloat(v as string || '0');
  const rows = advances as Record<string, any>[];
  const totalOutstanding = rows.filter(a => a.status !== 'repaid').reduce((s, a) => s + pn(a.remaining_amount), 0);
  const employeesConcerned = new Set(rows.filter(a => a.status !== 'repaid' && pn(a.remaining_amount) > 0).map(a => a.employee_id)).size;
  const totalGranted = rows.reduce((s, a) => s + pn(a.amount), 0);
  const totalRepaid = rows.reduce((s, a) => s + pn(a.amount) - pn(a.remaining_amount), 0);

  const STATUS_META: Record<string, { label: string; cls: string }> = {
    open: { label: 'En cours', cls: 'odoo-tag-orange' },
    partial: { label: 'Partiel', cls: 'odoo-tag-purple' },
    repaid: { label: 'Soldée', cls: 'odoo-tag-green' },
  };

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const repaymentLabel = (r: Record<string, any>) => {
    if (r.payrollMonth) return `Paie ${MONTH_NAMES[(r.payrollMonth as number) - 1]} ${r.payrollYear}`;
    if (r.weekStart) return `Paie semaine du ${r.weekStart}`;
    return r.repaymentDate as string;
  };

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setStatusFilter('open')} className={statusFilter === 'open' ? 'active' : ''}>En cours</button>
          <button onClick={() => setStatusFilter('all')} className={statusFilter === 'all' ? 'active' : ''}>Toutes</button>
        </div>
        <button onClick={() => { setFormAmount(''); setFormMonthly(''); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Accorder une avance
        </button>
      </div>

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><HandCoins size={11} style={{ display: 'inline', marginRight: 4 }} />Avances en cours</div>
          <div className="odoo-stat-card-value" style={{ color: totalOutstanding > 0 ? '#b85d1a' : undefined }}>
            {totalOutstanding.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">à récupérer sur les paies</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Employés concernés</div>
          <div className="odoo-stat-card-value">{employeesConcerned}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Total accordé{statusFilter === 'open' ? ' (en cours)' : ''}</div>
          <div className="odoo-stat-card-value">{totalGranted.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Déjà remboursé</div>
          <div className="odoo-stat-card-value" style={{ color: totalRepaid > 0 ? '#28a745' : undefined }}>
            {totalRepaid.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <HandCoins size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {statusFilter === 'open' ? 'Aucune avance en cours.' : 'Aucune avance enregistrée.'}
          </p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>La retenue se fait automatiquement au moment de payer le salaire (onglet Paie).</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Employé</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>Remboursé</th>
                <th style={{ textAlign: 'right', background: '#fdf3e7', color: '#b85d1a' }}>Solde</th>
                <th style={{ textAlign: 'right' }} title="Plan d'étalement : retenue proposée à chaque paie">Retenue/mois</th>
                <th style={{ textAlign: 'center' }}>Statut</th>
                <th>Mode</th>
                <th style={{ textAlign: 'center', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const reps = (a.repayments || []) as Record<string, any>[];
                const isExpanded = expanded.has(a.id as string);
                const meta = STATUS_META[a.status as string] || STATUS_META.open;
                return (
                  <Fragment key={a.id as string}>
                    <tr onClick={() => reps.length > 0 && toggleExpand(a.id as string)} style={{ cursor: reps.length > 0 ? 'pointer' : 'default' }}>
                      <td>{reps.length > 0 && (isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                          {a.first_name as string} {a.last_name as string}
                          <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {getRoleLabel(a.employee_role as string)}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--odoo-text-muted)' }}>{isoDate(a.advance_date) ? format(new Date(isoDate(a.advance_date)), 'dd/MM/yyyy') : ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{pn(a.amount).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: '#28a745' }}>{(pn(a.amount) - pn(a.remaining_amount)).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#b85d1a', background: '#fdf3e7' }}>{pn(a.remaining_amount).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {pn(a.monthly_deduction) > 0 ? (
                          <span title={pn(a.remaining_amount) > 0 ? `≈ ${Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paie(s) restante(s)` : 'Plan soldé'}>
                            {pn(a.monthly_deduction).toFixed(2)}
                            {pn(a.remaining_amount) > 0 && (
                              <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}> · {Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paies</span>
                            )}
                          </span>
                        ) : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}><span className={`odoo-tag ${meta.cls}`}>{meta.label}</span></td>
                      <td style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>{getPaymentLabel(a.payment_method as string)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {user?.role === 'admin' && (
                          <div style={{ display: 'inline-flex', gap: 2 }}>
                            <button onClick={ev => {
                              ev.stopPropagation();
                              setEditingAdvance(a);
                              setEditAmount(pn(a.amount).toFixed(2));
                              setEditMonthly(pn(a.monthly_deduction) > 0 ? pn(a.monthly_deduction).toFixed(2) : '');
                              setEditDate(isoDate(a.advance_date));
                              setEditMethod((a.payment_method as string) || 'cash');
                              setEditNotes((a.notes as string) || '');
                            }} className="odoo-pager-btn" title={reps.length > 0 ? 'Modifier le plan de retenue / notes' : 'Modifier l\'avance'}>
                              <Pencil size={12} />
                            </button>
                            {reps.length === 0 && (
                              <button onClick={ev => {
                                ev.stopPropagation();
                                if (confirm(`Supprimer l'avance de ${pn(a.amount).toFixed(2)} DH pour ${a.first_name} ${a.last_name} ?\n\nLe décaissement lié sera annulé (écriture comptable reversée).`)) {
                                  deleteMutation.mutate(a.id as string);
                                }
                              }} className="odoo-pager-btn" title="Supprimer (aucun remboursement)" style={{ color: '#dc3545' }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && reps.map(r => (
                      <tr key={r.id as string} style={{ background: 'var(--odoo-bg-alt)' }}>
                        <td></td>
                        <td colSpan={3} style={{ paddingLeft: 28, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                          <RotateCcw size={10} style={{ display: 'inline', marginRight: 4 }} />
                          {repaymentLabel(r)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '0.75rem', color: '#28a745' }}>+ {pn(r.amount).toFixed(2)}</td>
                        <td colSpan={5} style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-light)' }}>{r.repaymentDate as string}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
        L'avance sort de la caisse au moment de l'octroi (visible dans Caisse et la trésorerie) mais n'est pas une charge :
        c'est une créance sur l'employé (compte 3431). La charge salaire est reconnue au fil des retenues, proposées automatiquement au paiement de la paie.
      </div>

      {/* ─── Grant advance modal ─── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
            <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
              <h2 className="text-lg font-bold">Accorder une avance</h2>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              if (!fd.employeeId) { notify.error('Sélectionnez un employé'); return; }
              const amount = parseFloat(fd.amount as string);
              if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
              const monthly = parseFloat(formMonthly) || 0;
              if (formMonthly && (monthly <= 0 || monthly > amount)) {
                notify.error('La retenue par mois doit être comprise entre 0 et le montant de l\'avance');
                return;
              }
              createMutation.mutate({
                employeeId: fd.employeeId, amount,
                paymentMethod: fd.paymentMethod || 'cash',
                advanceDate: fd.advanceDate || undefined,
                notes: fd.notes || undefined,
                monthlyDeduction: monthly > 0 ? monthly : undefined,
              });
            }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Employé *</label>
                <select name="employeeId" required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Sélectionner...</option>
                  {(employees as Record<string, any>[]).filter(e2 => e2.is_active).map(e2 => (
                    <option key={e2.id as string} value={e2.id as string}>{e2.first_name as string} {e2.last_name as string}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant (DH) *</label>
                  <input name="amount" type="number" step="0.01" min="0.01" required
                    value={formAmount} onChange={e => setFormAmount(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="advanceDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
                <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {paymentMethods.length > 0
                    ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                    : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Retenue par mois (optionnel)
                </label>
                <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                  value={formMonthly} onChange={e => setFormMonthly(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {(() => {
                  const amountNum = parseFloat(formAmount) || 0;
                  const monthlyNum = parseFloat(formMonthly) || 0;
                  if (amountNum <= 0 || monthlyNum <= 0) return (
                    <p className="text-xs text-gray-400 mt-1">Le système proposera ce montant à chaque paie jusqu'au solde de l'avance (modifiable au moment du paiement).</p>
                  );
                  if (monthlyNum > amountNum) return (
                    <p className="text-xs text-red-600 mt-1">La retenue par mois dépasse le montant de l'avance.</p>
                  );
                  const nbMonths = Math.ceil(amountNum / monthlyNum);
                  const lastAmount = Math.round((amountNum - monthlyNum * (nbMonths - 1)) * 100) / 100;
                  return (
                    <p className="text-xs text-teal-700 mt-1">
                      Étalement : {nbMonths} paie{nbMonths > 1 ? 's' : ''} — {nbMonths > 1 ? `${nbMonths - 1} × ${monthlyNum.toFixed(2)} DH` : `${monthlyNum.toFixed(2)} DH`}
                      {lastAmount !== monthlyNum && nbMonths > 1 ? ` + 1 × ${lastAmount.toFixed(2)} DH` : ''}
                    </p>
                  );
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <input name="notes" type="text" placeholder="Motif, accord de remboursement..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <button type="submit" disabled={createMutation.isPending}
                className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                <HandCoins size={16} /> {createMutation.isPending ? 'Enregistrement...' : 'Accorder l\'avance'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit advance modal (admin) ─── */}
      {editingAdvance && (() => {
        const hasReps = ((editingAdvance.repayments || []) as Record<string, any>[]).length > 0;
        const remaining = pn(editingAdvance.remaining_amount);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingAdvance(null)}>
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Modifier l'avance</h2>
                  <p className="text-blue-100 text-sm">{editingAdvance.first_name as string} {editingAdvance.last_name as string}</p>
                </div>
                <button onClick={() => setEditingAdvance(null)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={e => {
                e.preventDefault();
                const amount = parseFloat(editAmount) || 0;
                const monthly = parseFloat(editMonthly) || 0;
                if (!hasReps && amount <= 0) { notify.error('Montant invalide'); return; }
                const refAmount = hasReps ? pn(editingAdvance.amount) : amount;
                if (editMonthly && (monthly <= 0 || monthly > refAmount)) {
                  notify.error('La retenue par mois doit être comprise entre 0 et le montant de l\'avance');
                  return;
                }
                const data: Record<string, any> = {
                  monthlyDeduction: monthly > 0 ? monthly : null,
                  notes: editNotes,
                };
                if (!hasReps) {
                  data.amount = amount;
                  data.paymentMethod = editMethod;
                  data.advanceDate = editDate || undefined;
                }
                updateMutation.mutate({ id: editingAdvance.id as string, data });
              }} className="p-5 space-y-4">
                {hasReps && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                    Des retenues ont déjà été imputées sur cette avance : le montant, la date et le mode ne sont plus modifiables.
                    Le plan de retenue et les notes restent ajustables — les prochaines paies suivront le nouveau plan.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant (DH) *</label>
                    <input type="number" step="0.01" min="0.01" required disabled={hasReps}
                      value={editAmount} onChange={e => setEditAmount(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
                    <input type="date" disabled={hasReps} value={editDate} onChange={e => setEditDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
                  <select disabled={hasReps} value={editMethod} onChange={e => setEditMethod(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                    {paymentMethods.length > 0
                      ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                      : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Retenue par mois (vide = tout à la prochaine paie)</label>
                  <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                    value={editMonthly} onChange={e => setEditMonthly(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {(() => {
                    const monthlyNum = parseFloat(editMonthly) || 0;
                    if (monthlyNum <= 0) return (
                      <p className="text-xs text-gray-400 mt-1">Sans plan, tout le solde ({remaining.toFixed(2)} DH) sera proposé à la prochaine paie.</p>
                    );
                    const refAmount = hasReps ? pn(editingAdvance.amount) : (parseFloat(editAmount) || 0);
                    if (monthlyNum > refAmount) return (
                      <p className="text-xs text-red-600 mt-1">La retenue par mois dépasse le montant de l'avance.</p>
                    );
                    if (remaining <= 0) return null;
                    const nbLeft = Math.ceil(remaining / monthlyNum);
                    return (
                      <p className="text-xs text-blue-700 mt-1">
                        Solde restant {remaining.toFixed(2)} DH → {nbLeft} paie{nbLeft > 1 ? 's' : ''} de {monthlyNum.toFixed(2)} DH max.
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                  <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    placeholder="Motif, accord de remboursement..."
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button type="submit" disabled={updateMutation.isPending}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                  <Check size={16} /> {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* ═══════════════════════ SCHEDULE TAB (planning hebdomadaire) ═══════════════════════ */
type LeaveInfoUI = { type: string; status: 'approved' | 'pending'; startDate: string; endDate: string };
type WeekRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  role: string;
  defaultShiftCode: ShiftCode | null;
  assignments: Record<string, ShiftCode | null>;
  onLeaveDays: string[];
  leaveDays: Record<string, LeaveInfoUI>;
};

type WeekData = { weekStart: string; weekEnd: string; rows: WeekRow[] };

const REPOS = '__REPOS__';

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'congé annuel',
  sick: 'congé maladie',
  unpaid: 'congé sans solde',
  maternity: 'congé maternité',
  other: 'congé',
};

function leaveLabel(info: LeaveInfoUI): string {
  const t = LEAVE_TYPE_LABELS[info.type] ?? info.type;
  return info.status === 'pending' ? `${t} (en attente)` : t;
}

function leaveTooltip(info: LeaveInfoUI): string {
  const period = info.startDate === info.endDate
    ? info.startDate
    : `du ${info.startDate} au ${info.endDate}`;
  return `${leaveLabel(info)} — ${period}`;
}

function ScheduleTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const prevWeekStr = format(startOfWeek(subWeeks(weekStart, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: week } = useQuery<WeekData>({
    queryKey: ['schedules', 'week', weekStartStr],
    queryFn: () => schedulesApi.getWeek(weekStartStr) as Promise<WeekData>,
  });

  const { data: shifts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['shifts'],
    queryFn: shiftsApi.list as () => Promise<Record<string, any>[]>,
  });

  // Etat local : matrice editable indexee par employeeId -> dateStr -> ShiftCode|null
  // null = repos, undefined = inchange depuis la base
  const [draft, setDraft] = useState<Record<string, Record<string, ShiftCode | null>>>({});
  useEffect(() => { setDraft({}); }, [weekStartStr]);

  const rows = useMemo<WeekRow[]>(() => {
    const base = week?.rows ?? [];
    if (roleFilter === 'all') return base;
    return base.filter(r => r.role === roleFilter);
  }, [week, roleFilter]);

  const allRoles = useMemo(() => {
    const set = new Set<string>();
    (week?.rows ?? []).forEach(r => set.add(r.role));
    return Array.from(set);
  }, [week]);

  // Regroupement par profil (role) pour faciliter la planification.
  // Les groupes sont tries alphabetiquement par libelle.
  // Cas particulier : Caissier(e) + Vendeuse sont fusionnes en un seul groupe
  // "Caissière & Vendeuse" pour la vue planning (les roles restent distincts
  // dans la base et dans le reste de l'app — c'est juste un regroupement
  // visuel pour la planification de la salle).
  const groupedRows = useMemo(() => {
    const planningGroup = (role: string): { key: string; label: string } => {
      if (role === 'cashier' || role === 'saleswoman') {
        return { key: 'sales_floor', label: 'Caissière & Vendeuse' };
      }
      return { key: role, label: ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role };
    };
    const map = new Map<string, { label: string; rows: WeekRow[] }>();
    for (const r of rows) {
      const { key, label } = planningGroup(r.role);
      const bucket = map.get(key) ?? { label, rows: [] };
      bucket.rows.push(r);
      map.set(key, bucket);
    }
    return Array.from(map.entries())
      .map(([key, { label, rows: list }]) => ({ role: key, label, rows: list }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [rows]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (role: string) =>
    setCollapsedGroups(g => ({ ...g, [role]: !g[role] }));

  const getCell = (empId: string, dateStr: string): ShiftCode | null => {
    const local = draft[empId]?.[dateStr];
    if (local !== undefined) return local;
    return (week?.rows.find(r => r.employeeId === empId)?.assignments[dateStr] ?? null);
  };

  const setCell = (empId: string, dateStr: string, value: ShiftCode | null) => {
    setDraft(d => ({ ...d, [empId]: { ...(d[empId] ?? {}), [dateStr]: value } }));
  };

  const getLeaveInfo = (row: WeekRow, dateStr: string): LeaveInfoUI | null =>
    row.leaveDays?.[dateStr] ?? null;
  // Un conge approuve bloque l'edition. Un conge en attente est juste un
  // avertissement (verrouille soft : l'admin peut encore changer s'il sait
  // que le conge sera refuse).
  const isLeaveLocked = (row: WeekRow, dateStr: string) => {
    const info = getLeaveInfo(row, dateStr);
    return info?.status === 'approved';
  };

  // Bannière récap des employés en congé cette semaine — visible en haut
  const weekLeaveSummary = useMemo(() => {
    const out: Array<{ employeeId: string; name: string; days: string[]; status: 'approved' | 'pending'; type: string }> = [];
    for (const row of (week?.rows ?? [])) {
      const entries = Object.entries(row.leaveDays ?? {});
      if (entries.length === 0) continue;
      // Group by leave type+status
      const byKey = new Map<string, string[]>();
      const keyMeta = new Map<string, { type: string; status: 'approved' | 'pending' }>();
      for (const [day, info] of entries) {
        const k = `${info.type}|${info.status}`;
        keyMeta.set(k, { type: info.type, status: info.status });
        const arr = byKey.get(k) ?? [];
        arr.push(day);
        byKey.set(k, arr);
      }
      for (const [k, days] of byKey) {
        const m = keyMeta.get(k)!;
        out.push({
          employeeId: row.employeeId,
          name: `${row.firstName} ${row.lastName}`,
          days: days.sort(),
          status: m.status,
          type: m.type,
        });
      }
    }
    return out;
  }, [week]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const assignments: Array<{ employeeId: string; date: string; shiftCode: string | null }> = [];
      const allRows = week?.rows ?? [];
      for (const row of allRows) {
        const localChanges = draft[row.employeeId];
        if (!localChanges) continue;
        for (const [date, code] of Object.entries(localChanges)) {
          assignments.push({ employeeId: row.employeeId, date, shiftCode: code });
        }
      }
      if (assignments.length === 0) return { updated: 0, deleted: 0 };
      return schedulesApi.saveWeek(weekStartStr, assignments);
    },
    onSuccess: (res: { updated?: number; deleted?: number }) => {
      const u = res?.updated ?? 0;
      const d = res?.deleted ?? 0;
      if (u + d === 0) {
        notify.warning('Aucune modification a sauvegarder');
      } else {
        notify.success(`Planning sauvegarde (${u} assigne, ${d} repos)`);
      }
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ['schedules', 'week', weekStartStr] });
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        const n = err.response.data?.error?.conflicts?.length ?? 0;
        notify.error(`Conflit conge : ${n} assignation(s) impossibles. Retire-les avant de sauvegarder.`);
      } else if (err?.response?.status === 413) {
        notify.error('Planning trop volumineux pour une seule sauvegarde. Sauvegarde par etapes.');
      } else {
        notify.error('Erreur a la sauvegarde');
      }
    },
  });

  const applyDefaults = () => {
    const next: typeof draft = { ...draft };
    let skippedLeaves = 0;
    for (const row of rows) {
      if (!row.defaultShiftCode) continue;
      const empMap = { ...(next[row.employeeId] ?? {}) };
      for (const d of days) {
        const dateStr = format(d, 'yyyy-MM-dd');
        if (row.onLeaveDays.includes(dateStr)) { skippedLeaves++; continue; }
        if (getCell(row.employeeId, dateStr) !== null) continue;
        empMap[dateStr] = row.defaultShiftCode;
      }
      next[row.employeeId] = empMap;
    }
    setDraft(next);
    if (skippedLeaves > 0) {
      notify.warning(`Shifts par défaut appliqués. ${skippedLeaves} jour(s) ignoré(s) car employé en congé.`);
    } else {
      notify.success('Shifts par défaut appliqués sur les cellules vides');
    }
  };

  const clearWeek = () => {
    if (!confirm('Vider toute la semaine affichee ? (sera sauvegardable apres validation)')) return;
    const next: typeof draft = { ...draft };
    for (const row of rows) {
      const empMap = { ...(next[row.employeeId] ?? {}) };
      for (const d of days) {
        const dateStr = format(d, 'yyyy-MM-dd');
        empMap[dateStr] = null;
      }
      next[row.employeeId] = empMap;
    }
    setDraft(next);
  };

  const duplicatePreviousWeek = async () => {
    try {
      const prev = await schedulesApi.getWeek(prevWeekStr) as WeekData;
      const next: typeof draft = { ...draft };
      let skippedLeaves = 0;
      for (const row of rows) {
        const prevRow = prev.rows.find(r => r.employeeId === row.employeeId);
        if (!prevRow) continue;
        const empMap = { ...(next[row.employeeId] ?? {}) };
        const prevDays = Object.keys(prevRow.assignments).sort();
        days.forEach((d, idx) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          if (row.onLeaveDays.includes(dateStr)) { skippedLeaves++; return; }
          const srcDate = prevDays[idx]; // mapping ordinal Lun->Lun, etc.
          const srcCode = srcDate ? prevRow.assignments[srcDate] : null;
          empMap[dateStr] = srcCode ?? null;
        });
        next[row.employeeId] = empMap;
      }
      setDraft(next);
      if (skippedLeaves > 0) {
        notify.warning(`Semaine précédente copiée. ${skippedLeaves} jour(s) ignoré(s) car employé en congé.`);
      } else {
        notify.success('Semaine précédente copiée dans le brouillon');
      }
    } catch {
      notify.error('Impossible de charger la semaine precedente');
    }
  };

  const hasChanges = Object.values(draft).some(m => Object.keys(m).length > 0);

  // Impression : ouvre une fenetre A4 paysage avec le planning courant
  // (affecte une fois la sauvegarde validee — on imprime y compris le brouillon).
  // Les `<select>` ne s'imprimant pas correctement, on regenere une table HTML
  // plate (libelle de shift + horaires, ou Conge/Repos).
  const printSchedule = () => {
    if (hasChanges) {
      const ok = confirm('Vous avez des modifications non sauvegardees. Imprimer quand meme (le brouillon sera inclus) ?');
      if (!ok) return;
    }
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const headerCells = days
      .map(d => `<th>${escapeHtml(format(d, 'EEE dd/MM', { locale: fr }))}</th>`)
      .join('');

    const bodyHtml = groupedRows.map(group => {
      const groupHeader = `<tr class="group"><td colspan="${days.length + 1}">${escapeHtml(group.label)} (${group.rows.length})</td></tr>`;
      const rowsHtml = group.rows.map(row => {
        const empCell = `<td class="emp"><div class="name">${escapeHtml(row.firstName)} ${escapeHtml(row.lastName)}</div><div class="role">${escapeHtml(ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role)}</div></td>`;
        const cells = days.map(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const leave = row.leaveDays?.[dateStr];
          const code = getCell(row.employeeId, dateStr);
          if (leave?.status === 'approved') {
            return `<td class="leave"><div class="big">Congé</div><div class="small">${escapeHtml(LEAVE_TYPE_LABELS[leave.type] ?? leave.type)}</div></td>`;
          }
          if (leave?.status === 'pending' && !code) {
            return `<td class="leave-pending"><div class="big">Congé</div><div class="small">en attente</div></td>`;
          }
          if (!code) {
            return `<td class="repos"><div class="big">—</div><div class="small">Repos</div></td>`;
          }
          const label = SHIFT_SHORT_LABELS[code] ?? code;
          const h = SHIFT_HOURS[code];
          return `<td class="shift"><div class="big">${escapeHtml(label)}</div><div class="small">${escapeHtml(h.start)}-${escapeHtml(h.end)}</div></td>`;
        }).join('');
        return `<tr>${empCell}${cells}</tr>`;
      }).join('');
      return groupHeader + rowsHtml;
    }).join('');

    const subtitle = `${format(weekStart, 'dd MMM yyyy', { locale: fr })} — ${format(weekEnd, 'dd MMM yyyy', { locale: fr })}` +
      (roleFilter !== 'all' ? ` · Filtre : ${ROLE_LABELS[roleFilter as keyof typeof ROLE_LABELS] ?? roleFilter}` : '');

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Planning ${escapeHtml(format(weekStart, 'yyyy-MM-dd'))}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; padding: 8px; }
  h1 { font-size: 16px; margin: 0 0 2px 0; }
  .subtitle { font-size: 11px; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 3px 4px; text-align: center; vertical-align: middle; }
  th { background: #ececec; font-size: 10px; }
  th.emp-h { width: 18%; text-align: left; }
  td.emp { text-align: left; }
  td.emp .name { font-weight: bold; font-size: 11px; }
  td.emp .role { font-size: 9px; color: #666; }
  tr.group td { background: #e0e7ff; font-weight: bold; text-align: left; font-size: 11px; color: #1e3a8a; padding: 4px 6px; }
  td .big { font-weight: bold; font-size: 11px; }
  td .small { font-size: 9px; color: #555; }
  td.repos .big { color: #aaa; font-weight: normal; }
  td.repos .small { color: #999; }
  td.leave { background: #f3e8ff; color: #6b21a8; }
  td.leave-pending { background: #fff7ed; color: #c2410c; }
  td.shift { background: #fff; }
  .footer { margin-top: 12px; font-size: 9px; color: #666; }
  @media print { .no-print { display: none; } body { padding: 0; } }
  .toolbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 6px; }
  .toolbar button { font: inherit; padding: 6px 12px; cursor: pointer; border: 1px solid #999; background: #fff; border-radius: 4px; }
  .toolbar button.primary { background: #1e40af; color: #fff; border-color: #1e40af; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button id="btn-print" class="primary">Imprimer</button>
    <button id="btn-close">Fermer</button>
  </div>
  <h1>Planning hebdomadaire</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  <table>
    <thead>
      <tr>
        <th class="emp-h">Employé</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${days.length + 1}" style="text-align:center; padding: 20px; color: #999;">Aucun employé pour cette catégorie</td></tr>`}
    </tbody>
  </table>
  <div class="footer">Imprimé le ${escapeHtml(format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr }))}${hasChanges ? ' · ⚠ contient des modifications non sauvegardées' : ''}</div>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) {
      notify.error("Impossible d'ouvrir la fenêtre d'impression (popup bloqué ?)");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();

    // La CSP du parent (script-src 'self') s'applique au popup about:blank et
    // bloque tout JS inline. On pilote donc l'impression et les boutons depuis
    // la fenetre parente, hors contexte inline.
    const wireUp = () => {
      w.document.getElementById('btn-print')?.addEventListener('click', () => { w.focus(); w.print(); });
      w.document.getElementById('btn-close')?.addEventListener('click', () => w.close());
      setTimeout(() => { w.focus(); w.print(); }, 300);
    };
    if (w.document.readyState === 'complete') wireUp();
    else w.addEventListener('load', wireUp);
  };

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setWeekOffset(w => w - 1)} className="odoo-pager-btn" aria-label="Semaine précédente"><ChevronLeft size={14} /></button>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {format(weekStart, 'dd MMM', { locale: fr })} — {format(weekEnd, 'dd MMM yyyy', { locale: fr })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="odoo-pager-btn" aria-label="Semaine suivante"><ChevronRight size={14} /></button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} style={{ fontSize: '0.6875rem', color: 'var(--odoo-purple)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 }}>
              Cette semaine
            </button>
          )}
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input" style={{ width: 'auto' }}>
            <option value="all">Toutes catégories</option>
            {allRoles.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}</option>
            ))}
          </select>
          <button onClick={applyDefaults} className="odoo-btn-secondary" title="Pré-remplit les cellules vides avec le shift par défaut de chaque employé"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={13} /> Appliquer défaut
          </button>
          <button onClick={duplicatePreviousWeek} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Copy size={13} /> Dupliquer S-1
          </button>
          <button onClick={clearWeek} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Eraser size={13} /> Vider
          </button>
          <button onClick={printSchedule} className="odoo-btn-secondary"
            title="Ouvre une fenêtre A4 paysage prête à imprimer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Printer size={13} /> Imprimer
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Save size={13} /> {saveMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* Bannière récap des congés sur la semaine — style Odoo alert */}
      {weekLeaveSummary.length > 0 && (
        <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 600, marginBottom: 6 }}>
            <CalendarOff size={13} />
            Congés cette semaine ({weekLeaveSummary.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {weekLeaveSummary.map((l, i) => (
              <span
                key={i}
                className={`odoo-tag ${l.status === 'approved' ? 'odoo-tag-purple' : 'odoo-tag-orange'}`}
                title={`${l.name} • ${l.days.join(', ')} • ${LEAVE_TYPE_LABELS[l.type] ?? l.type}${l.status === 'pending' ? ' (en attente)' : ''}`}
              >
                <span style={{ fontWeight: 600 }}>{l.name}</span>
                <span style={{ opacity: 0.75, marginLeft: 4 }}>
                  {l.days.length === 1 ? `1 jour` : `${l.days.length} jours`}
                </span>
                {l.status === 'pending' && <AlertTriangle size={11} />}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ minWidth: 200, position: 'sticky', left: 0, background: 'var(--odoo-bg-alt)', zIndex: 5 }}>Employé</th>
              {days.map(d => (
                <th key={d.toISOString()} style={{ textAlign: 'center', minWidth: 130 }}>
                  <div>{format(d, 'EEE', { locale: fr })}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-light)', fontWeight: 400 }}>{format(d, 'dd/MM')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--odoo-text-muted)' }}>Aucun employé pour cette catégorie</td></tr>
            )}
            {groupedRows.map(group => {
              const collapsed = !!collapsedGroups[group.role];
              return (
              <Fragment key={group.role}>
                <tr
                  onClick={() => toggleGroup(group.role)}
                  style={{ cursor: 'pointer', background: 'var(--odoo-bg-alt)' }}
                >
                  <td
                    colSpan={8}
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: 'var(--odoo-bg-alt)',
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      color: 'var(--odoo-text)',
                      padding: '0.5rem 0.75rem',
                      borderTop: '1px solid var(--odoo-border)',
                      borderBottom: '1px solid var(--odoo-border)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <UserCog size={13} style={{ color: 'var(--theme-accent)' }} />
                      {group.label}
                      <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>
                        ({group.rows.length})
                      </span>
                    </span>
                  </td>
                </tr>
                {!collapsed && group.rows.map(row => (
              <tr key={row.employeeId}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--odoo-bg)', zIndex: 4 }}>
                  <div style={{ fontWeight: 500 }}>
                    <Users size={11} style={{ color: 'var(--theme-accent)', display: 'inline', marginRight: 4 }} />
                    {row.firstName} {row.lastName}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
                    {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}
                    {row.defaultShiftCode && (
                      <span style={{ marginLeft: 4, color: 'var(--odoo-text-light)' }}>• défaut: {SHIFT_SHORT_LABELS[row.defaultShiftCode]}</span>
                    )}
                  </div>
                </td>
                {days.map(d => {
                  const dateStr = format(d, 'yyyy-MM-dd');
                  const leaveInfo = getLeaveInfo(row, dateStr);
                  const current = getCell(row.employeeId, dateStr);
                  const dirty = draft[row.employeeId]?.[dateStr] !== undefined;
                  // Conge approuve = cellule verrouillee (interaction impossible)
                  if (leaveInfo?.status === 'approved') {
                    return (
                      <td key={dateStr} className="px-1 py-1 text-center">
                        <div
                          className="bg-purple-100 text-purple-800 border border-purple-300 rounded-lg px-2 py-2 text-xs font-medium cursor-not-allowed"
                          title={leaveTooltip(leaveInfo)}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <CalendarOff size={11} />
                            <span>Congé</span>
                          </div>
                          <div className="text-[9px] font-normal opacity-80 mt-0.5 capitalize">
                            {LEAVE_TYPE_LABELS[leaveInfo.type] ?? leaveInfo.type}
                          </div>
                        </div>
                      </td>
                    );
                  }
                  // Conge en attente = avertissement, mais cellule editable (l'admin peut
                  // assumer que le conge sera refuse). On confirme avant d'affecter.
                  if (leaveInfo?.status === 'pending') {
                    return (
                      <td key={dateStr} className={`px-1 py-1 text-center ${dirty ? 'bg-yellow-50' : ''}`}>
                        <select
                          value={current ?? REPOS}
                          onChange={e => {
                            const v = e.target.value;
                            if (v !== REPOS) {
                              const ok = confirm(`⚠️ ${row.firstName} ${row.lastName} a une demande de ${LEAVE_TYPE_LABELS[leaveInfo.type] ?? 'congé'} EN ATTENTE pour ce jour (${leaveTooltip(leaveInfo)}).\n\nAffecter quand même un shift ?`);
                              if (!ok) return;
                            }
                            setCell(row.employeeId, dateStr, v === REPOS ? null : (v as ShiftCode));
                          }}
                          className={`w-full text-xs rounded-lg border-2 px-2 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                            current
                              ? (SHIFT_BADGE_COLORS[current] + ' font-medium border-amber-400')
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          }`}
                          title={`⚠ ${leaveTooltip(leaveInfo)}`}
                        >
                          <option value={REPOS}>Congé (en attente)</option>
                          {(shifts as Record<string, any>[]).map(s => (
                            <option key={s.code as string} value={s.code as string}>
                              {SHIFT_SHORT_LABELS[s.code as ShiftCode] ?? s.label as string}
                            </option>
                          ))}
                        </select>
                        {current && (
                          <div className="text-[10px] text-amber-700 mt-0.5">
                            ⚠ {SHIFT_HOURS[current].start}-{SHIFT_HOURS[current].end}
                          </div>
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={dateStr} className={`px-1 py-1 text-center ${dirty ? 'bg-yellow-50' : ''}`}>
                      <select
                        value={current ?? REPOS}
                        onChange={e => {
                          const v = e.target.value;
                          setCell(row.employeeId, dateStr, v === REPOS ? null : (v as ShiftCode));
                        }}
                        className={`w-full text-xs rounded-lg border px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 ${
                          current ? (SHIFT_BADGE_COLORS[current] + ' font-medium') : 'bg-white text-gray-400 border-gray-200'
                        }`}
                      >
                        <option value={REPOS}>Repos</option>
                        {(shifts as Record<string, any>[]).map(s => (
                          <option key={s.code as string} value={s.code as string}>
                            {SHIFT_SHORT_LABELS[s.code as ShiftCode] ?? s.label as string}
                          </option>
                        ))}
                      </select>
                      {current && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {SHIFT_HOURS[current].start}-{SHIFT_HOURS[current].end}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fff8e8', border: '1px solid #ffeeba', marginRight: 4, verticalAlign: 'middle' }} /> cellule modifiée (non sauvegardée)</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--theme-accent-light)', border: '1px solid var(--theme-accent)', marginRight: 4, verticalAlign: 'middle' }} /> congé approuvé — affectation impossible</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffe5d0', border: '1px solid #ffb381', marginRight: 4, verticalAlign: 'middle' }} /> congé en attente — modification possible avec confirmation</span>
        <span style={{ color: 'var(--odoo-text-light)' }}>Sauvegarder pré-remplit aussi le pointage attendu.</span>
      </div>
    </>
  );
}
