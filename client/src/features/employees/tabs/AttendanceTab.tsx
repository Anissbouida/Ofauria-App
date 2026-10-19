import { useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi } from '../../../api/employees.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Users, CalendarOff, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { ROLE_LABELS, SHIFT_BADGE_COLORS, SHIFT_SHORT_LABELS } from '@ofauria/shared';
import type { ShiftCode } from '@ofauria/shared';
import { ATTENDANCE_STATUS, MONTH_NAMES, LEAVE_TYPE_LABELS } from '../shared';
import OvertimeQuotaPanel from './OvertimeQuotaPanel';

/* ═══════════════════════ ATTENDANCE TAB ═══════════════════════ */
export default function AttendanceTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [attView, setAttView] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [searchAtt, setSearchAtt] = useState('');

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const activeEmployees = (employees as Record<string, any>[]).filter(e => e.is_active);
  const filteredEmployees = searchAtt
    ? activeEmployees.filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(searchAtt.toLowerCase()))
    : activeEmployees;

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

  // Recap mensuel — formule STRICTEMENT alignee sur payrollRepository.generate
  // cote serveur (employee.repository.ts:785-797). Sinon la colonne "Salaire
  // calcule" divergerait du bulletin reellement genere :
  //   * 'repos' est PAYE (jour de repos hebdo inclus dans le salaire mensuel)
  //     -> comptabilise avec present + late
  //   * 'double' = deux shifts le meme jour -> 2 jours travailles
  //   * 'half_day' -> 1 demi-jour (Math.floor(halfDay/2) = 0 si un seul, 1 si deux, etc.)
  //   * 'absent' -> deduction (non compte dans worked)
  const getEmployeeMonthlySummary = (empId: string) => {
    const empRecords = (monthlyRecords as Record<string, any>[]).filter(r => r.employee_id === empId);
    const present = empRecords.filter(r => r.status === 'present').length;
    const late = empRecords.filter(r => r.status === 'late').length;
    const repos = empRecords.filter(r => r.status === 'repos').length;
    const double = empRecords.filter(r => r.status === 'double').length;
    const absent = empRecords.filter(r => r.status === 'absent').length;
    const halfDay = empRecords.filter(r => r.status === 'half_day').length;
    const overtimeMin = empRecords.reduce((s, r) => s + (parseInt(r.overtime_minutes as string) || 0), 0);
    // Meme formule que server: present+late+repos comme "jours payes normaux",
    // double compte 2 jours, half_day/2 pour les demi-journees.
    const workedDays = present + late + repos + 2 * double + Math.floor(halfDay / 2);
    return { present, late, repos, double, absent, halfDay, overtimeMin, workedDays };
  };

  return (
    <>
      {/* View toggle */}
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <div className="odoo-view-switcher">
            <button onClick={() => setAttView('daily')} className={attView === 'daily' ? 'active' : ''}>
              Pointage journalier
            </button>
            <button onClick={() => setAttView('monthly')} className={attView === 'monthly' ? 'active' : ''}>
              Récapitulatif mensuel
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--odoo-text-muted)' }} />
            <input type="text" value={searchAtt} onChange={e => setSearchAtt(e.target.value)}
              placeholder="Chercher un employé…" className="input"
              style={{ paddingLeft: 28, width: 180, fontSize: '0.8125rem' }} />
          </div>
        </div>

        {attView === 'daily' ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() - 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn"><ChevronLeft size={14} /></button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="input" style={{ width: 'auto' }} />
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn"><ChevronRight size={14} /></button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', fontWeight: 500, marginLeft: 4 }}>
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE dd MMMM yyyy', { locale: fr })}
            </span>
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SearchSelect
              options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
              value={String(summaryMonth)}
              onChange={id => id && setSummaryMonth(parseInt(id))}
              placeholder="Mois"
              width={140}
            />
            <input type="number" value={summaryYear} onChange={e => setSummaryYear(parseInt(e.target.value))} className="input" style={{ width: 96 }} />
          </div>
        )}
      </div>

      {attView === 'monthly' && <OvertimeQuotaPanel year={summaryYear} />}

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
                {filteredEmployees.map((emp: Record<string, any>) => {
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
                    {filteredEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).workedDays, 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '0.5rem 0.75rem' }}>
                    {filteredEmployees.reduce((sum, emp) => sum + (emp.monthly_salary ? parseFloat(emp.monthly_salary as string) : 0), 0).toFixed(2)} DH
                  </td>
                  <td></td>
                  <td style={{ textAlign: 'right', background: '#eafaf1', fontWeight: 700, color: '#155724', padding: '0.5rem 0.75rem' }}>
                    {filteredEmployees.reduce((sum, emp) => {
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
                <th style={{ textAlign: 'center' }}>H. Sup</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((emp: Record<string, any>) => {
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
                      {/* key inclut selectedDate : sans ca, defaultValue est
                          fige au 1er render et changer de jour affichait les
                          heures du jour precedent (risque d'ecraser le bon
                          jour au onBlur). */}
                      <input key={`ci-${emp.id}-${selectedDate}`} type="time" className="input text-center text-sm w-28 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                      <input key={`co-${emp.id}-${selectedDate}`} type="time" className="input text-center text-sm w-28 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                      <input key={`ot-${emp.id}-${selectedDate}`} type="number" className="input text-center text-sm w-20 mx-auto disabled:bg-gray-100 disabled:cursor-not-allowed" min="0" step="0.5"
                        disabled={isOnLeave}
                        defaultValue={Math.round(((rec as Record<string, any>)?.overtime_minutes as number || 0) / 60 * 100) / 100 || 0}
                        onBlur={e => {
                          upsertMutation.mutate({
                            employeeId: emp.id, date: selectedDate,
                            status: (rec as Record<string, any>)?.status || 'present',
                            checkIn: (rec as Record<string, any>)?.check_in || undefined,
                            checkOut: (rec as Record<string, any>)?.check_out || undefined,
                            overtimeMinutes: Math.round((parseFloat(e.target.value) || 0) * 60),
                          });
                        }} />
                      {(() => {
                        // Ventilation des heures sup (majorations 25/50/100 %) : part de nuit
                        // calculee depuis les heures (corrigeable), jour de repos travaille.
                        const r = rec as Record<string, any> | undefined;
                        const otMin = parseInt(r?.overtime_minutes ?? '0', 10) || 0;
                        if (!r || otMin <= 0) return null;
                        const nightMin = parseInt(r.overtime_night_minutes ?? '0', 10) || 0;
                        const rest = r.is_rest_day ?? (new Date(`${selectedDate}T12:00:00`).getDay() === 0);
                        const base = { employeeId: emp.id, date: selectedDate, status: r.status || 'present', checkIn: r.check_in || undefined, checkOut: r.check_out || undefined };
                        return (
                          <div style={{ fontSize: '0.625rem', color: 'var(--odoo-text-muted)', marginTop: 3, display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                            <span style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                              title="Part de nuit (21h-6h) des heures sup, calculée depuis l'arrivée et le départ. Cliquer pour corriger."
                              onClick={() => {
                                const v = prompt('Heures de nuit (21h-6h) parmi les heures supplémentaires', String(Math.round(nightMin / 60 * 100) / 100));
                                if (v !== null) upsertMutation.mutate({ ...base, overtimeNightMinutes: Math.min(otMin, Math.round((parseFloat(v.replace(',', '.')) || 0) * 60)) });
                              }}>
                              dont nuit {Math.round(nightMin / 60 * 100) / 100} h
                            </span>
                            <button type="button" onClick={() => upsertMutation.mutate({ ...base, isRestDay: !rest })}
                              className={`odoo-tag ${rest ? 'odoo-tag-purple' : 'odoo-tag-grey'}`} style={{ border: 'none', cursor: 'pointer', fontSize: '0.5625rem' }}
                              title="Jour de repos hebdomadaire travaillé : majoration 50 % (jour) / 100 % (nuit)">
                              repos
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeEmployees.length === 0 && <p className="text-center py-8 text-gray-400">Aucun employé actif</p>}
          {activeEmployees.length > 0 && filteredEmployees.length === 0 && searchAtt && (
            <p className="text-center py-8 text-gray-400">Aucun employé trouvé pour « {searchAtt} »</p>
          )}
        </div>
        </div>
        )
      )}
    </>
  );
}
