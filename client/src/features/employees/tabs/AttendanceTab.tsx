import { money } from '../../../utils/money';
import { useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi } from '../../../api/employees.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Users, CalendarOff, ChevronLeft, ChevronRight, Search, Moon } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { ROLE_LABELS, SHIFT_SHORT_LABELS } from '@ofauria/shared';
import type { ShiftCode } from '@ofauria/shared';
import { ATTENDANCE_STATUS, MONTH_NAMES, LEAVE_TYPE_LABELS, shiftTag } from '../shared';
import OvertimeQuotaPanel from './OvertimeQuotaPanel';
import { PromptDialog, EmptyState, LoadingPanel, Segmented, inputCls } from '../ui';
import { ListToolbar } from '../../sales/ListTemplate';

/* ═══════════════════════ ATTENDANCE TAB ═══════════════════════ */
export default function AttendanceTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [attView, setAttView] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [searchAtt, setSearchAtt] = useState('');
  // Correction de la part de nuit des heures sup (remplace window.prompt).
  const [nightEdit, setNightEdit] = useState<{ base: Record<string, any>; otMin: number; nightMin: number } | null>(null);

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
  const upsertMutation = useMutation({
    mutationFn: (data: Record<string, any>) => attendanceApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      notify.success('Pointage enregistré');
    },
    onError: () => notify.error('Erreur'),
  });

  const getRecord = (empId: string) => (records as Record<string, any>[]).find(r => r.employee_id === empId);

  // M8-05 : récapitulatif calculé au serveur, avec la même fonction que le bulletin
  // (pointage réel seulement, demi-journée = 0,5, shift double payé en plus, congés et fériés couverts).
  const { data: recap, isLoading: monthlyLoading } = useQuery({
    queryKey: ['attendance', 'recap', summaryMonth, summaryYear], // rafraîchi par chaque pointage enregistré
    queryFn: () => attendanceApi.monthlyRecap(summaryMonth, summaryYear),
    enabled: attView === 'monthly',
  });
  const EMPTY = { present: 0, late: 0, repos: 0, double: 0, absentMarked: 0, halfDay: 0, overtimeMin: 0, workedDays: 0, absentDays: 0, baseSalary: 0, dailyRate: 0, attendanceSalary: null as number | null };
  const getEmployeeMonthlySummary = (empId: string) => recap?.rows.find(r => r.employeeId === empId) ?? EMPTY;
  const baseDays = recap?.baseDays ?? 26;

  return (
    <>
      {/* Barre d'outils : recherche, jour ou mois, puis bascule de vue (contrôle segmenté) */}
      <ListToolbar search={searchAtt} onSearch={setSearchAtt} placeholder="Rechercher un employé...">
        {attView === 'daily' ? (
          <div className="hr-tools">
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() - 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn" aria-label="Jour précédent"><ChevronLeft size={14} /></button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="odoo-filter-dropdown" aria-label="Jour" />
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="odoo-pager-btn" aria-label="Jour suivant"><ChevronRight size={14} /></button>
            <span className="hr-tools-label" style={{ fontWeight: 500, marginLeft: 4 }}>
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE dd MMMM yyyy', { locale: fr })}
            </span>
          </div>
        ) : (
          <div className="hr-tools">
            <SearchSelect
              options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
              value={String(summaryMonth)}
              onChange={id => id && setSummaryMonth(parseInt(id))}
              placeholder="Mois"
              width={140}
            />
            <input type="number" value={summaryYear} onChange={e => setSummaryYear(parseInt(e.target.value))} className="odoo-filter-dropdown" style={{ width: 96 }} aria-label="Année" />
          </div>
        )}
        <span className="hr-spacer" />
        <Segmented label="Vue du pointage" value={attView} onChange={setAttView}
          options={[{ key: 'daily', label: 'Pointage journalier' }, { key: 'monthly', label: 'Récapitulatif mensuel' }]} />
      </ListToolbar>

      {attView === 'monthly' && <OvertimeQuotaPanel year={summaryYear} />}

      {/* Monthly summary view */}
      {attView === 'monthly' && (
        monthlyLoading ? (
          <LoadingPanel />
        ) : (
          <div className="prj-panel hr-plain"><div className="prj-scroll">
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Employé</th>
                  <th style={{ textAlign: 'center' }}>Présent</th>
                  <th style={{ textAlign: 'center' }}>Retard</th>
                  <th style={{ textAlign: 'center' }}>Demi-j.</th>
                  <th style={{ textAlign: 'center' }}>Absent</th>
                  <th style={{ textAlign: 'center' }}>H. Sup</th>
                  <th style={{ textAlign: 'center' }}>J. Travaillés</th>
                  <th style={{ textAlign: 'right' }}>Salaire base</th>
                  <th style={{ textAlign: 'right' }}>Taux/jour</th>
                  <th style={{ textAlign: 'right' }} title="Base − absences + shifts doubles, comme le bulletin (hors ancienneté, heures sup et primes)">Salaire au pointage</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp: Record<string, any>) => {
                  const s = getEmployeeMonthlySummary(emp.id as string);
                  const baseSalary = s.baseSalary;
                  const dailyRate = s.dailyRate;
                  const calculatedSalary = s.attendanceSalary ?? 0;
                  return (
                    <tr key={emp.id as string}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                          {emp.first_name as string} {emp.last_name as string}
                          <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: 'var(--prj-green)', fontWeight: 500 }}>{s.present}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.late > 0 ? 'var(--prj-orange)' : 'var(--odoo-text-light)' }}>{s.late}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.halfDay > 0 ? 'var(--theme-accent)' : 'var(--odoo-text-light)' }}>{s.halfDay}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ color: s.absentMarked > 0 ? 'var(--prj-red)' : 'var(--odoo-text-light)' }}>{s.absentMarked}</span></td>
                      <td style={{ textAlign: 'center', color: s.overtimeMin > 0 ? 'var(--odoo-text)' : 'var(--odoo-text-light)' }}>
                        {s.overtimeMin > 0 ? `${Math.floor(s.overtimeMin / 60)}h${String(s.overtimeMin % 60).padStart(2, '0')}` : '0'}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>
                        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--prj-green)' }}>{s.workedDays}</span>
                        <span style={{ color: 'var(--odoo-text-light)', fontSize: '0.6875rem' }}> / {baseDays}</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                        {baseSalary > 0 ? money(baseSalary) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                        {baseSalary > 0 ? money(dailyRate) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {baseSalary > 0 ? (
                          <span style={{ fontWeight: 700, color: calculatedSalary < baseSalary ? 'var(--prj-red)' : 'var(--prj-green)' }}>
                            {money(calculatedSalary)}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700, padding: '0.5rem 0.75rem' }} colSpan={6}>Total</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, padding: '0.5rem 0.75rem' }}>
                    {Math.round(filteredEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).workedDays, 0) * 100) / 100}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '0.5rem 0.75rem' }}>
                    {money(filteredEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).baseSalary, 0))}
                  </td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '0.5rem 0.75rem' }}>
                    {money(filteredEmployees.reduce((sum, emp) => sum + (getEmployeeMonthlySummary(emp.id as string).attendanceSalary ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div></div>
        )
      )}

      {/* Daily view */}
      {attView === 'daily' && (
        isLoading ? (
          <LoadingPanel />
        ) : (
        <section className="prj-panel hr-plain">
        <div className="prj-panel-head hr-panel-head">
          <span>Pointage du jour</span>
          <div className="hr-legend">
            <span><i style={{ background: '#93c5fd' }} />présence prévue (planning)</span>
            <span><i style={{ background: 'var(--prj-green)' }} />pointage confirmé</span>
            <span><i style={{ background: '#8b5cf6' }} />en congé</span>
          </div>
        </div>
        <div className="prj-scroll">
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
                      {(() => {
                        const dotLabel = isOnLeave ? 'En congé' : hasCheckIn ? 'Pointage enregistré' : isExpected ? 'Présence prévue, non pointé' : 'Non prévu, non pointé';
                        return <span className={`odoo-status-dot ${isOnLeave ? 'neutral' : hasCheckIn ? 'ok' : (isExpected ? 'warning' : 'neutral')}`} title={dotLabel} aria-label={dotLabel} role="img" />;
                      })()}
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
                        <span className={`odoo-tag ${shiftTag(plannedShift)}`}>
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
                                className={isActive ? `odoo-tag ${isExpectedPresent ? 'odoo-tag-blue' : s.color}` : 'odoo-tag odoo-tag-grey'}
                                style={{ cursor: 'pointer', border: 'none' }}>
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {/* key inclut selectedDate : sans ca, defaultValue est
                          fige au 1er render et changer de jour affichait les
                          heures du jour precedent (risque d'ecraser le bon
                          jour au onBlur). */}
                      <input key={`ci-${emp.id}-${selectedDate}`} type="time" className={`${inputCls} text-center disabled:bg-gray-100 disabled:cursor-not-allowed`} style={{ width: 112, margin: '0 auto' }}
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
                    <td style={{ textAlign: 'center' }}>
                      <input key={`co-${emp.id}-${selectedDate}`} type="time" className={`${inputCls} text-center disabled:bg-gray-100 disabled:cursor-not-allowed`} style={{ width: 112, margin: '0 auto' }}
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
                    <td style={{ textAlign: 'center' }}>
                      <input key={`ot-${emp.id}-${selectedDate}`} type="number" className={`${inputCls} text-center disabled:bg-gray-100 disabled:cursor-not-allowed`} style={{ width: 80, margin: '0 auto' }} min="0" step="0.5"
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
                              onClick={() => setNightEdit({ base, otMin, nightMin })}>
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
          {activeEmployees.length === 0 && <EmptyState icon={Users}>Aucun employé actif</EmptyState>}
          {activeEmployees.length > 0 && filteredEmployees.length === 0 && searchAtt && (
            <EmptyState icon={Search}>Aucun employé trouvé pour « {searchAtt} »</EmptyState>
          )}
        </div>
        </section>
        )
      )}

      {nightEdit && (
        <PromptDialog icon={Moon} crumb="Pointage" title="Heures de nuit" type="number"
          label="Heures de nuit (21h-6h) parmi les heures supplémentaires"
          initial={String(Math.round(nightEdit.nightMin / 60 * 100) / 100)}
          onCancel={() => setNightEdit(null)}
          onConfirm={v => {
            const { base, otMin } = nightEdit;
            setNightEdit(null);
            upsertMutation.mutate({ ...base, overtimeNightMinutes: Math.min(otMin, Math.round((parseFloat(v.replace(',', '.')) || 0) * 60)) });
          }} />
      )}
    </>
  );
}
