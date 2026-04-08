import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi, payrollApi, schedulesApi } from '../../api/employees.api';
import { format, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, UserCog, Users, Clock, CalendarOff, Banknote, CalendarDays,
  Check, X, ChevronLeft, ChevronRight, AlertTriangle, Download, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ROLE_LABELS } from '@ofauria/shared';

type HrTab = 'employees' | 'attendance' | 'leaves' | 'payroll' | 'schedule';

const CONTRACT_LABELS: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', interim: 'Interim' };
const LEAVE_TYPE_LABELS: Record<string, string> = { annual: 'Conge annuel', sick: 'Maladie', unpaid: 'Sans solde', maternity: 'Maternite', other: 'Autre' };
const LEAVE_STATUS_COLORS: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
const ATTENDANCE_STATUS: { value: string; label: string; color: string }[] = [
  { value: 'present', label: 'Present', color: 'bg-green-100 text-green-700' },
  { value: 'absent', label: 'Absent', color: 'bg-red-100 text-red-700' },
  { value: 'late', label: 'Retard', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'half_day', label: 'Demi-journee', color: 'bg-blue-100 text-blue-700' },
];
const MONTH_NAMES = ['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HrTab>('employees');

  const tabs: { key: HrTab; label: string; icon: typeof Users; color: string }[] = [
    { key: 'employees', label: 'Employes', icon: Users, color: 'teal' },
    { key: 'attendance', label: 'Pointage', icon: Clock, color: 'blue' },
    { key: 'leaves', label: 'Conges', icon: CalendarOff, color: 'purple' },
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
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-1.5 flex gap-1">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
                isActive
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
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

  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? employeesApi.update(editing.id as string, data) : employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(editing ? 'Employe mis a jour' : 'Employe ajoute');
      setShowForm(false); setEditing(null);
    },
    onError: () => toast.error('Erreur'),
  });

  const activeCount = employees.filter((e: Record<string, unknown>) => e.is_active).length;
  const filteredEmp = employees.filter((e: Record<string, unknown>) => {
    if (!searchEmp) return true;
    const s = searchEmp.toLowerCase();
    return (e.first_name as string).toLowerCase().includes(s) || (e.last_name as string).toLowerCase().includes(s) || (e.cin as string || '').toLowerCase().includes(s);
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
          <Plus size={18} /> Nouvel employe
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Employe</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contrat</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Telephone</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Salaire</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredEmp.map((e: Record<string, unknown>) => (
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
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[e.role as string] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] || e.role}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">{CONTRACT_LABELS[e.contract_type as string] || 'CDI'}</span>
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
          {filteredEmp.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Users size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucun employe trouve</p>
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
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[viewDetail.role as string] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[viewDetail.role as keyof typeof ROLE_LABELS] || viewDetail.role}
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
                  ['CIN', viewDetail.cin], ['Telephone', viewDetail.phone],
                  ['Date de naissance', viewDetail.birth_date ? format(new Date(viewDetail.birth_date as string), 'dd/MM/yyyy') : null],
                  ['Adresse', viewDetail.address], ['Ville', viewDetail.city],
                  ['N CNSS', viewDetail.cnss_number],
                  ['Type de contrat', CONTRACT_LABELS[viewDetail.contract_type as string]],
                  ['Debut contrat', viewDetail.contract_start ? format(new Date(viewDetail.contract_start as string), 'dd/MM/yyyy') : null],
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
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier l\'employe' : 'Nouvel employe'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, unknown> = Object.fromEntries(fd);
              if (data.monthlySalary) data.monthlySalary = parseFloat(data.monthlySalary as string);
              saveMutation.mutate(data);
            }} className="space-y-4">
              <p className="text-sm font-medium text-gray-500 border-b pb-1">Informations personnelles</p>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Prenom *</label><input name="firstName" defaultValue={editing?.first_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Nom *</label><input name="lastName" defaultValue={editing?.last_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">CIN</label><input name="cin" defaultValue={editing?.cin as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Telephone</label><input name="phone" defaultValue={editing?.phone as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Date de naissance</label><input name="birthDate" type="date" defaultValue={editing?.birth_date as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Ville</label><input name="city" defaultValue={editing?.city as string} className="input" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Adresse</label><input name="address" defaultValue={editing?.address as string} className="input" /></div>

              <p className="text-sm font-medium text-gray-500 border-b pb-1 pt-2">Contrat & Salaire</p>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Role *</label>
                  <select name="role" defaultValue={editing?.role as string || 'baker'} className="input">
                    <option value="admin">Administrateur</option><option value="manager">Gerant</option>
                    <option value="baker">Boulanger</option><option value="pastry_chef">Patissier</option>
                    <option value="viennoiserie">Viennoiserie</option><option value="beldi_sale">Beldi & Sale</option>
                    <option value="saleswoman">Vendeuse</option><option value="cashier">Caissier</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type de contrat</label>
                  <select name="contractType" defaultValue={editing?.contract_type as string || 'cdi'} className="input">
                    <option value="cdi">CDI</option><option value="cdd">CDD</option>
                    <option value="stage">Stage</option><option value="interim">Interim</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Salaire mensuel (DH)</label>
                  <input name="monthlySalary" type="number" step="0.01" defaultValue={editing?.monthly_salary as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Date d'embauche *</label><input name="hireDate" type="date" defaultValue={editing?.hire_date as string} className="input" required={!editing} /></div>
                <div><label className="block text-sm font-medium mb-1">Debut contrat</label><input name="contractStart" type="date" defaultValue={editing?.contract_start as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Fin contrat</label><input name="contractEnd" type="date" defaultValue={editing?.contract_end as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">N° CNSS</label><input name="cnssNumber" defaultValue={editing?.cnss_number as string} className="input" /></div>
              </div>

              <p className="text-sm font-medium text-gray-500 border-b pb-1 pt-2">Contact d'urgence</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Nom</label><input name="emergencyContactName" defaultValue={editing?.emergency_contact_name as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Telephone</label><input name="emergencyContactPhone" defaultValue={editing?.emergency_contact_phone as string} className="input" /></div>
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
      toast.success('Pointage enregistre');
    },
    onError: () => toast.error('Erreur'),
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
            Recapitulatif mensuel
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
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employe</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Present</th>
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
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employe</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Arrivee</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Depart</th>
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
          {activeEmployees.length === 0 && <p className="text-center py-8 text-gray-400">Aucun employe actif</p>}
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

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leaves', currentYear],
    queryFn: () => leavesApi.list({ year: String(currentYear) }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => leavesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); toast.success('Conge ajoute'); setShowForm(false); },
    onError: () => toast.error('Erreur'),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => leavesApi.approve(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); toast.success('Conge approuve'); },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => leavesApi.reject(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); toast.success('Conge refuse'); },
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
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Employe</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Periode</th>
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
                  <td className="px-4 py-3 text-sm">{LEAVE_TYPE_LABELS[l.type as string] || l.type}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {format(new Date(l.start_date as string), 'dd/MM/yyyy')} — {format(new Date(l.end_date as string), 'dd/MM/yyyy')}
                  </td>
                  <td className="px-4 py-3 text-center text-sm font-semibold">{l.days as number}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{l.reason as string || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEAVE_STATUS_COLORS[l.status as string]}`}>
                      {l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuve' : 'Refuse'}
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
          {(leaves as Record<string, unknown>[]).length === 0 && <p className="text-center py-8 text-gray-400">Aucun conge pour cette annee</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle demande de conge</h2>
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
              <div><label className="block text-sm font-medium mb-1">Employe *</label>
                <select name="employeeId" className="input" required>
                  <option value="">Choisir...</option>
                  {(employees as Record<string, unknown>[]).filter(e => e.is_active).map(e => (
                    <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                  ))}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Type *</label>
                <select name="type" className="input" required>
                  {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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

  const { data: payrolls = [], isLoading } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => payrollApi.list({ month: String(month), year: String(year) }),
  });

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generate(month, year),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); toast.success('Bulletins generes'); },
    onError: () => toast.error('Erreur lors de la generation'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) => payrollApi.markPaid(id, method),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); toast.success('Paiement enregistre'); },
  });

  const totalNet = (payrolls as Record<string, unknown>[]).reduce((s, p) => s + parseFloat(p.net_salary as string), 0);
  const totalPaid = (payrolls as Record<string, unknown>[]).filter(p => p.paid).length;

  const exportPayroll = () => {
    const BOM = '\uFEFF';
    const headers = ['Employe', 'Role', 'Salaire de base', 'Jours travailles', 'Jours absences', 'H. Sup', 'Primes', 'Deductions', 'CNSS', 'Salaire net', 'Paye'];
    const rows = (payrolls as Record<string, unknown>[]).map(p => [
      `${p.first_name} ${p.last_name}`,
      ROLE_LABELS[p.employee_role as keyof typeof ROLE_LABELS] || p.employee_role,
      parseFloat(p.base_salary as string).toFixed(2),
      p.worked_days, p.absent_days,
      parseFloat(p.overtime_hours as string).toFixed(1),
      parseFloat(p.bonuses as string).toFixed(2),
      parseFloat(p.deductions as string).toFixed(2),
      parseFloat(p.cnss_employee as string).toFixed(2),
      parseFloat(p.net_salary as string).toFixed(2),
      p.paid ? 'Oui' : 'Non',
    ]);
    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `paie_${MONTH_NAMES[month - 1]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
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
          <button onClick={exportPayroll} className="btn-secondary flex items-center gap-2" disabled={(payrolls as Record<string, unknown>[]).length === 0}>
            <Download size={16} /> Exporter
          </button>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <Banknote size={18} /> Generer les bulletins
          </button>
        </div>
      </div>

      {(payrolls as Record<string, unknown>[]).length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total masse salariale</p>
            <p className="text-2xl font-bold text-green-600">{totalNet.toFixed(2)} DH</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Bulletins</p>
            <p className="text-2xl font-bold">{(payrolls as Record<string, unknown>[]).length}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Payes</p>
            <p className="text-2xl font-bold text-primary-600">{totalPaid} / {(payrolls as Record<string, unknown>[]).length}</p>
          </div>
        </div>
      )}

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Employe</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Base</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">J. Trav.</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Abs.</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">H. Sup</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Primes</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Ded.</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">CNSS</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Net</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(payrolls as Record<string, unknown>[]).map(p => (
                <tr key={p.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.first_name as string} {p.last_name as string}</td>
                  <td className="px-4 py-3 text-right">{parseFloat(p.base_salary as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">{p.worked_days as number}</td>
                  <td className="px-4 py-3 text-center">
                    {(p.absent_days as number) > 0 ? (
                      <span className="text-red-600 font-medium flex items-center justify-center gap-1">
                        <AlertTriangle size={13} /> {p.absent_days as number}
                      </span>
                    ) : '0'}
                  </td>
                  <td className="px-4 py-3 text-right">{parseFloat(p.overtime_amount as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{parseFloat(p.bonuses as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{parseFloat(p.deductions as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{parseFloat(p.cnss_employee as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-700">{parseFloat(p.net_salary as string).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    {p.paid ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Paye</span>
                    ) : (
                      <button onClick={() => payMutation.mutate({ id: p.id as string, method: 'cash' })}
                        className="px-2 py-1 rounded text-xs font-medium bg-primary-50 text-primary-700 hover:bg-primary-100">
                        Payer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(payrolls as Record<string, unknown>[]).length === 0 && (
            <p className="text-center py-8 text-gray-400">Aucun bulletin pour cette periode. Cliquez sur "Generer les bulletins".</p>
          )}
        </div>
      )}
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); toast.success('Planning ajoute'); setShowForm(false); },
    onError: () => toast.error('Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); toast.success('Supprime'); },
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
              <div><label className="block text-sm font-medium mb-1">Employe *</label>
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
