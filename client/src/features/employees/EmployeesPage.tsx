import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi, payrollApi, schedulesApi } from '../../api/employees.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import { format, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, UserCog, Users, Clock, CalendarOff, Banknote, CalendarDays,
  Check, X, ChevronLeft, ChevronRight, AlertTriangle, Download, Search,
  ArrowUpDown, ArrowUp, ArrowDown, FileText,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { notify } from '../../components/ui/InlineNotification';
import { ROLE_LABELS } from '@ofauria/shared';

type HrTab = 'employees' | 'attendance' | 'leaves' | 'payroll' | 'schedule';

const LEAVE_STATUS_COLORS: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
const ATTENDANCE_STATUS: { value: string; label: string; color: string }[] = [
  { value: 'present', label: 'Présent', color: 'bg-green-100 text-green-700' },
  { value: 'absent', label: 'Absent', color: 'bg-red-100 text-red-700' },
  { value: 'late', label: 'Retard', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'half_day', label: 'Demi-journée', color: 'bg-blue-100 text-blue-700' },
];
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HrTab>('employees');

  const tabs: { key: HrTab; label: string; icon: typeof Users; color: string }[] = [
    { key: 'employees', label: 'Employés', icon: Users, color: 'teal' },
    { key: 'attendance', label: 'Pointage', icon: Clock, color: 'blue' },
    { key: 'leaves', label: 'Congés', icon: CalendarOff, color: 'purple' },
    { key: 'payroll', label: 'Paie', icon: Banknote, color: 'green' },
    { key: 'schedule', label: 'Planning', icon: CalendarDays, color: 'amber' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ressources Humaines</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestion du personnel, pointage et paie</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
                isActive
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'employees' && <EmployeesTab queryClient={queryClient} />}
      {tab === 'attendance' && <AttendanceTab queryClient={queryClient} />}
      {tab === 'leaves' && <LeavesTab queryClient={queryClient} />}
      {tab === 'payroll' && <PayrollTab queryClient={queryClient} />}
      {tab === 'schedule' && <ScheduleTab queryClient={queryClient} />}
    </div>
  );
}

/* ═══════════════════════ EMPLOYEES TAB ═══════════════════════ */
function EmployeesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [viewDetail, setViewDetail] = useState<Record<string, unknown> | null>(null);
  const [searchEmp, setSearchEmp] = useState('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { entries: roles, getLabel: getRoleLabel, getColor: getRoleColor } = useReferentiel('employee_roles');
  const { entries: contractTypes, getLabel: getContractLabel } = useReferentiel('contract_types');

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? employeesApi.update(editing.id as string, data) : employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success(editing ? 'Employé mis à jour' : 'Employé ajouté');
      setShowForm(false); setEditing(null);
    },
    onError: () => notify.error('Erreur'),
  });

  const activeCount = employees.filter((e: Record<string, unknown>) => e.is_active).length;

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

  const filteredEmp = employees.filter((e: Record<string, unknown>) => {
    if (!searchEmp) return true;
    const s = searchEmp.toLowerCase();
    return (e.first_name as string).toLowerCase().includes(s) || (e.last_name as string).toLowerCase().includes(s) || (e.cin as string || '').toLowerCase().includes(s);
  });

  const sortedEmp = [...filteredEmp].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
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
      {/* Stats + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-2.5 shadow-sm">
            <Users size={18} className="text-teal-600" />
            <span className="text-sm"><strong className="text-gray-900">{activeCount}</strong> <span className="text-gray-500">actifs</span></span>
            <span className="text-gray-300 mx-1">|</span>
            <span className="text-sm"><strong className="text-gray-900">{employees.length}</strong> <span className="text-gray-500">total</span></span>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Rechercher..." value={searchEmp} onChange={(e) => setSearchEmp(e.target.value)}
              className="pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 w-64 shadow-sm" />
          </div>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2 shadow-md hover:shadow-lg transition-shadow">
          <Plus size={18} /> Nouvel employé
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto" style={{ maxHeight: 'calc(100vh - 18rem)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => toggleSort('name')}>Employé <SortIcon col="name" /></th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => toggleSort('role')}>Rôle <SortIcon col="role" /></th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => toggleSort('contract')}>Contrat <SortIcon col="contract" /></th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Téléphone</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => toggleSort('salary')}>Salaire <SortIcon col="salary" /></th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => toggleSort('status')}>Statut <SortIcon col="status" /></th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedEmp.map((e: Record<string, unknown>) => (
                <tr key={e.id as string} className="hover:bg-teal-50/30 transition-colors cursor-pointer" onClick={() => setViewDetail(e)}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-sm font-bold">
                        {(e.first_name as string).charAt(0)}{(e.last_name as string).charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-gray-900">{e.first_name as string} {e.last_name as string}</p>
                        {e.cin && <p className="text-xs text-gray-400">CIN: {e.cin as string}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[e.role as string] || 'bg-gray-100 text-gray-600'}`}
                      style={getRoleColor(e.role as string) && !ROLE_COLORS[e.role as string] ? { backgroundColor: getRoleColor(e.role as string) + '20', color: getRoleColor(e.role as string) } : undefined}>
                      {getRoleLabel(e.role as string)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">{getContractLabel(e.contract_type as string || 'cdi')}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">{e.phone as string || <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3 text-right">
                    {e.monthly_salary ? (
                      <>
                        <span className="text-sm font-bold text-gray-900">{parseFloat(e.monthly_salary as string).toFixed(0)}</span>
                        <span className="text-xs text-gray-400 ml-0.5">DH</span>
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${e.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {e.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewDetail(e)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Details">
                        <UserCog size={15} className="text-gray-400" />
                      </button>
                      <button onClick={() => { setEditing(e); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Modifier">
                        <Pencil size={15} className="text-gray-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedEmp.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Users size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucun employé trouvé</p>
            </div>
          )}
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
                  ['Date de naissance', viewDetail.birth_date ? format(new Date(viewDetail.birth_date as string), 'dd/MM/yyyy') : null],
                  ['Adresse', viewDetail.address], ['Ville', viewDetail.city],
                  ['N° CNSS', viewDetail.cnss_number],
                  ['Type de contrat', getContractLabel(viewDetail.contract_type as string || 'cdi')],
                  ['Début contrat', viewDetail.contract_start ? format(new Date(viewDetail.contract_start as string), 'dd/MM/yyyy') : null],
                  ['Fin contrat', viewDetail.contract_end ? format(new Date(viewDetail.contract_end as string), 'dd/MM/yyyy') : null],
                  ['Date d\'embauche', viewDetail.hire_date ? format(new Date(viewDetail.hire_date as string), 'dd/MM/yyyy') : null],
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
              const data: Record<string, unknown> = Object.fromEntries(fd);
              if (data.monthlySalary) data.monthlySalary = parseFloat(data.monthlySalary as string);
              if (data.seniorityYears) data.seniorityYears = parseInt(data.seniorityYears as string);
              if (data.nbDependents) data.nbDependents = parseInt(data.nbDependents as string);
              if (data.cimrRate) data.cimrRate = parseFloat(data.cimrRate as string);
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
                <div><label className="block text-sm font-medium mb-1">Date de naissance</label><input name="birthDate" type="date" defaultValue={editing?.birth_date as string} className="input" /></div>
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
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Date d'embauche *</label><input name="hireDate" type="date" defaultValue={editing?.hire_date as string} className="input" required={!editing} /></div>
                <div><label className="block text-sm font-medium mb-1">Début contrat</label><input name="contractStart" type="date" defaultValue={editing?.contract_start as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Fin contrat</label><input name="contractEnd" type="date" defaultValue={editing?.contract_end as string} className="input" /></div>
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
  const activeEmployees = (employees as Record<string, unknown>[]).filter(e => e.is_active);

  // Daily records
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['attendance', selectedDate],
    queryFn: () => attendanceApi.list(selectedDate, selectedDate),
    enabled: attView === 'daily',
  });

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
    mutationFn: (data: Record<string, unknown>) => attendanceApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      notify.success('Pointage enregistré');
    },
    onError: () => notify.error('Erreur'),
  });

  const getRecord = (empId: string) => (records as Record<string, unknown>[]).find(r => r.employee_id === empId);

  // Calculate monthly summary per employee
  const getEmployeeMonthlySummary = (empId: string) => {
    const empRecords = (monthlyRecords as Record<string, unknown>[]).filter(r => r.employee_id === empId);
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
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setAttView('daily')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${attView === 'daily' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            Pointage journalier
          </button>
          <button onClick={() => setAttView('monthly')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${attView === 'monthly' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            Récapitulatif mensuel
          </button>
        </div>

        {attView === 'daily' ? (
          <div className="flex items-center gap-3">
            <button onClick={() => {
              const d = new Date(selectedDate); d.setDate(d.getDate() - 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft size={18} /></button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="input w-auto" />
            <button onClick={() => {
              const d = new Date(selectedDate); d.setDate(d.getDate() + 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight size={18} /></button>
            <span className="text-sm text-gray-500 font-medium">
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE dd MMMM yyyy', { locale: fr })}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <select value={summaryMonth} onChange={e => setSummaryMonth(parseInt(e.target.value))} className="input w-auto">
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" value={summaryYear} onChange={e => setSummaryYear(parseInt(e.target.value))} className="input w-24" />
          </div>
        )}
      </div>

      {/* Monthly summary view */}
      {attView === 'monthly' && (
        monthlyLoading ? <p className="text-gray-500">Chargement...</p> : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employé</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Présent</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Retard</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Demi-j.</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Absent</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">H. Sup</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-green-600 bg-green-50">J. Travailles</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Salaire base</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Taux/jour</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-green-600 bg-green-50">Salaire calcule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activeEmployees.map((emp: Record<string, unknown>) => {
                  const s = getEmployeeMonthlySummary(emp.id as string);
                  const baseSalary = emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0;
                  const dailyRate = baseSalary / 26;
                  const calculatedSalary = dailyRate * s.workedDays;
                  return (
                    <tr key={emp.id as string} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">
                            {(emp.first_name as string).charAt(0)}{(emp.last_name as string).charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{emp.first_name as string} {emp.last_name as string}</p>
                            <p className="text-xs text-gray-400">{ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-medium text-green-600">{s.present}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${s.late > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{s.late}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${s.halfDay > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{s.halfDay}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${s.absent > 0 ? 'text-red-600' : 'text-gray-400'}`}>{s.absent}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm ${s.overtimeMin > 0 ? 'font-medium' : 'text-gray-400'}`}>
                          {s.overtimeMin > 0 ? `${Math.floor(s.overtimeMin / 60)}h${String(s.overtimeMin % 60).padStart(2, '0')}` : '0'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center bg-green-50">
                        <span className="text-lg font-bold text-green-700">{s.workedDays}</span>
                        <span className="text-xs text-gray-400"> / 26</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-500">
                        {baseSalary > 0 ? `${baseSalary.toFixed(2)} DH` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-500">
                        {baseSalary > 0 ? `${dailyRate.toFixed(2)} DH` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right bg-green-50">
                        {baseSalary > 0 ? (
                          <span className={`text-sm font-bold ${calculatedSalary < baseSalary ? 'text-red-600' : 'text-green-700'}`}>
                            {calculatedSalary.toFixed(2)} DH
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                <tr>
                  <td className="px-4 py-3 text-sm font-bold text-gray-700" colSpan={6}>Total</td>
                  <td className="px-4 py-3 text-center bg-green-50 font-bold text-green-700">
                    {activeEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).workedDays, 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold">
                    {activeEmployees.reduce((sum, emp) => sum + (emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0), 0).toFixed(2)} DH
                  </td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right bg-green-50 font-bold text-green-700">
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
        isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employé</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Arrivée</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Départ</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">H. Sup (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activeEmployees.map((emp: Record<string, unknown>) => {
                const rec = getRecord(emp.id as string);
                return (
                  <tr key={emp.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">
                          {(emp.first_name as string).charAt(0)}{(emp.last_name as string).charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{emp.first_name as string} {emp.last_name as string}</p>
                          <p className="text-xs text-gray-400">{ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-1">
                        {ATTENDANCE_STATUS.map(s => (
                          <button key={s.value}
                            onClick={() => upsertMutation.mutate({
                              employeeId: emp.id, date: selectedDate, status: s.value,
                              checkIn: (rec as Record<string, unknown>)?.check_in || undefined,
                              checkOut: (rec as Record<string, unknown>)?.check_out || undefined,
                            })}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              (rec as Record<string, unknown>)?.status === s.value ? s.color : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                            }`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="time" className="input text-center text-sm w-28 mx-auto"
                        defaultValue={(rec as Record<string, unknown>)?.check_in as string || ''}
                        onBlur={e => {
                          if (e.target.value) upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, unknown>)?.status || 'present',
                            checkIn: e.target.value,
                            checkOut: (rec as Record<string, unknown>)?.check_out || undefined,
                          });
                        }} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="time" className="input text-center text-sm w-28 mx-auto"
                        defaultValue={(rec as Record<string, unknown>)?.check_out as string || ''}
                        onBlur={e => {
                          if (e.target.value) upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, unknown>)?.status || 'present',
                            checkIn: (rec as Record<string, unknown>)?.check_in || undefined,
                            checkOut: e.target.value,
                          });
                        }} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="input text-center text-sm w-20 mx-auto" min="0"
                        defaultValue={(rec as Record<string, unknown>)?.overtime_minutes as number || 0}
                        onBlur={e => {
                          upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, unknown>)?.status || 'present',
                            checkIn: (rec as Record<string, unknown>)?.check_in || undefined,
                            checkOut: (rec as Record<string, unknown>)?.check_out || undefined,
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
    mutationFn: (data: Record<string, unknown>) => leavesApi.create(data),
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

  return (
    <>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouvelle demande
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employé</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Période</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Jours</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Motif</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(leaves as Record<string, unknown>[]).map(l => (
                <tr key={l.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{l.first_name as string} {l.last_name as string}</td>
                  <td className="px-4 py-3 text-sm">{getLeaveLabel(l.type as string)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {format(new Date(l.start_date as string), 'dd/MM/yyyy')} — {format(new Date(l.end_date as string), 'dd/MM/yyyy')}
                  </td>
                  <td className="px-4 py-3 text-center text-sm font-semibold">{l.days as number}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{l.reason as string || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEAVE_STATUS_COLORS[l.status as string]}`}>
                      {l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvé' : 'Refusé'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {l.status === 'pending' && (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => approveMutation.mutate(l.id as string)}
                          className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Approuver">
                          <Check size={16} />
                        </button>
                        <button onClick={() => rejectMutation.mutate(l.id as string)}
                          className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Refuser">
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(leaves as Record<string, unknown>[]).length === 0 && <p className="text-center py-8 text-gray-400">Aucun congé pour cette année</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle demande de congé</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data = Object.fromEntries(fd) as Record<string, unknown>;
              const start = new Date(data.startDate as string);
              const end = new Date(data.endDate as string);
              const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              data.days = diffDays > 0 ? diffDays : 1;
              createMutation.mutate(data);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Employé *</label>
                <select name="employeeId" className="input" required>
                  <option value="">Choisir...</option>
                  {(employees as Record<string, unknown>[]).filter(e => e.is_active).map(e => (
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
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [detailPayroll, setDetailPayroll] = useState<Record<string, unknown> | null>(null);
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

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generate(month, year),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); notify.success('Bulletins generes'); },
    onError: () => notify.error('Erreur lors de la generation'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) => payrollApi.markPaid(id, method),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); notify.success('Paiement enregistre'); },
  });

  const pf = (v: unknown) => parseFloat(v as string || '0').toFixed(2);
  const pn = (v: unknown) => parseFloat(v as string || '0');

  const totalNet = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.net_salary), 0);
  const totalGross = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.gross_salary), 0);
  const totalIR = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.ir_net), 0);
  const totalCNSS = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.cnss_employee), 0);
  const totalAMO = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.amo_employee), 0);
  const totalChargesPatron = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + pn(p.total_charges_patron), 0);
  const totalPaid = (payrolls as Record<string, unknown>[]).filter(p => p.paid).length;

  const exportPayroll = () => {
    const BOM = '\uFEFF';
    const headers = ['Employe', 'Fonction', 'Salaire Base', 'Brut', 'CNSS Sal.', 'AMO Sal.', 'IR', 'Net a payer', 'Charges Patron', 'Paye'];
    const rows = (payrolls as Record<string, unknown>[]).map(p => [
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
  const sortedPayrolls = [...(payrolls as Record<string, unknown>[])].sort((a, b) => {
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
  const generatePDF = (p: Record<string, unknown>) => {
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input w-24" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generateAllPDF} className="btn-secondary flex items-center gap-2" disabled={sortedPayrolls.length === 0}>
            <FileText size={16} /> PDF tous
          </button>
          <button onClick={exportPayroll} className="btn-secondary flex items-center gap-2" disabled={sortedPayrolls.length === 0}>
            <Download size={16} /> CSV
          </button>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <Banknote size={18} /> Generer les bulletins
          </button>
        </div>
      </div>

      {(payrolls as Record<string, unknown>[]).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">Masse salariale brute</p>
            <p className="text-xl font-bold text-gray-800">{totalGross.toFixed(2)} <span className="text-xs text-gray-400">DH</span></p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">Total net a payer</p>
            <p className="text-xl font-bold text-green-600">{totalNet.toFixed(2)} <span className="text-xs text-gray-400">DH</span></p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">CNSS + AMO + IR (sal.)</p>
            <p className="text-xl font-bold text-orange-600">{(totalCNSS + totalAMO + totalIR).toFixed(2)} <span className="text-xs text-gray-400">DH</span></p>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">Charges patronales</p>
            <p className="text-xl font-bold text-purple-600">{totalChargesPatron.toFixed(2)} <span className="text-xs text-gray-400">DH</span></p>
          </div>
        </div>
      )}

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('name')}>Employe <PaySortIcon col="name" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('base')}>Base <PaySortIcon col="base" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('gross')}>Brut <PaySortIcon col="gross" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('cnss')}>CNSS <PaySortIcon col="cnss" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('amo')}>AMO <PaySortIcon col="amo" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('ir')}>IR <PaySortIcon col="ir" /></th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 bg-green-50 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('net')}>Net <PaySortIcon col="net" /></th>
                <th className="text-center px-3 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-teal-600 transition-colors" onClick={() => togglePaySort('status')}>Statut <PaySortIcon col="status" /></th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedPayrolls.map(p => (
                <tr key={p.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.first_name as string} {p.last_name as string}</p>
                    <p className="text-xs text-gray-400">{getRoleLabel(p.employee_role as string)}</p>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-600">{pf(p.base_salary)}</td>
                  <td className="px-3 py-3 text-right font-medium">{pf(p.gross_salary)}</td>
                  <td className="px-3 py-3 text-right text-orange-600">{pf(p.cnss_employee)}</td>
                  <td className="px-3 py-3 text-right text-orange-600">{pf(p.amo_employee)}</td>
                  <td className="px-3 py-3 text-right text-red-600">{pf(p.ir_net)}</td>
                  <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-50/50">{pf(p.net_salary)}</td>
                  <td className="px-3 py-3 text-center">
                    {p.paid ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Paye</span>
                    ) : (
                      <button onClick={() => payMutation.mutate({ id: p.id as string, method: 'cash' })}
                        className="px-2 py-1 rounded text-xs font-medium bg-primary-50 text-primary-700 hover:bg-primary-100">
                        Payer
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setDetailPayroll(p)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Voir le detail">
                        <UserCog size={15} className="text-gray-400" />
                      </button>
                      <button onClick={() => generatePDF(p)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Telecharger PDF">
                        <FileText size={15} className="text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedPayrolls.length === 0 && (
            <p className="text-center py-8 text-gray-400">Aucun bulletin pour cette periode. Cliquez sur "Generer les bulletins".</p>
          )}
        </div>
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

/* ═══════════════════════ SCHEDULE TAB ═══════════════════════ */
function ScheduleTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState('');

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const activeEmployees = (employees as Record<string, unknown>[]).filter(e => e.is_active);

  const { data: schedules = [] } = useQuery({
    queryKey: ['schedules', format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')],
    queryFn: () => schedulesApi.list(format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => schedulesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); notify.success('Planning ajoute'); setShowForm(false); },
    onError: () => notify.error('Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); notify.success('Supprime'); },
  });

  const getSchedule = (empId: string, date: string) =>
    (schedules as Record<string, unknown>[]).find(s => s.employee_id === empId && s.date && (s.date as string).startsWith(date));

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium">
            {format(weekStart, 'dd MMM', { locale: fr })} — {format(weekEnd, 'dd MMM yyyy', { locale: fr })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight size={18} /></button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs text-primary-600 hover:underline">Aujourd'hui</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500 sticky left-0 bg-gray-50 min-w-[160px]">Employe</th>
              {days.map(d => (
                <th key={d.toISOString()} className="text-center px-3 py-3 font-medium text-gray-500 min-w-[100px]">
                  <div>{format(d, 'EEE', { locale: fr })}</div>
                  <div className="text-xs text-gray-400">{format(d, 'dd/MM')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {activeEmployees.map((emp: Record<string, unknown>) => (
              <tr key={emp.id as string}>
                <td className="px-4 py-2 sticky left-0 bg-white font-medium">
                  {emp.first_name as string} {(emp.last_name as string).charAt(0)}.
                </td>
                {days.map(d => {
                  const dateStr = format(d, 'yyyy-MM-dd');
                  const sched = getSchedule(emp.id as string, dateStr);
                  return (
                    <td key={dateStr} className="px-1 py-1 text-center">
                      {sched ? (
                        <div className="bg-primary-50 rounded-lg px-2 py-1 text-xs group relative">
                          <p className="font-medium text-primary-700">
                            {(sched.start_time as string)?.slice(0, 5)} - {(sched.end_time as string)?.slice(0, 5)}
                          </p>
                          <button onClick={() => deleteMutation.mutate(sched.id as string)}
                            className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 bg-red-500 text-white rounded-full items-center justify-center text-[10px]">
                            <X size={10} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setFormDate(dateStr); setShowForm(true); }}
                          className="w-full py-2 text-gray-300 hover:text-primary-400 hover:bg-primary-50 rounded-lg transition-colors">
                          <Plus size={14} className="mx-auto" />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-4">Ajouter un horaire — {format(new Date(formDate + 'T12:00:00'), 'EEEE dd MMM', { locale: fr })}</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createMutation.mutate({ ...Object.fromEntries(fd), date: formDate });
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Employé *</label>
                <select name="employeeId" className="input" required>
                  <option value="">Choisir...</option>
                  {activeEmployees.map(e => (
                    <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                  ))}
                </select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Debut *</label><input name="startTime" type="time" className="input" required defaultValue="08:00" /></div>
                <div><label className="block text-sm font-medium mb-1">Fin *</label><input name="endTime" type="time" className="input" required defaultValue="17:00" /></div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Ajouter</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
