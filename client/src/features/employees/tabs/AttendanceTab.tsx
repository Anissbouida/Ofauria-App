import { currencySymbol } from '../../../utils/money';
import { useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, attendanceApi, leavesApi } from '../../../api/employees.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Users, CalendarOff, ChevronLeft, ChevronRight, Moon } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { SHIFT_SHORT_LABELS } from '@ofauria/shared';
import { useEmployeeRoleLabel } from '../../../hooks/useReferentiel';
import type { ShiftCode } from '@ofauria/shared';
import { ATTENDANCE_STATUS, MONTH_NAMES, LEAVE_TYPE_LABELS, shiftTag, amount } from '../shared';
import OvertimeQuotaPanel from './OvertimeQuotaPanel';
import { PromptDialog, EmptyPanel, LoadingPanel, Segmented, inputCls } from '../ui';
import { StatusTag } from '../../../components/ui/StatusTag';
import { Toolbar, SearchBar, DataPanel, TableFooter, SectionHeader, NoResultState, ErrorState } from '../../../components/ds';

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
  const { data: records = [], isLoading, isError, error, refetch } = useQuery({
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
  const { data: recap, isLoading: monthlyLoading, isError: monthlyError, error: recapError, refetch: refetchRecap } = useQuery({
    queryKey: ['attendance', 'recap', summaryMonth, summaryYear], // rafraîchi par chaque pointage enregistré
    queryFn: () => attendanceApi.monthlyRecap(summaryMonth, summaryYear),
    enabled: attView === 'monthly',
  });
  const EMPTY = { present: 0, late: 0, repos: 0, double: 0, absentMarked: 0, halfDay: 0, overtimeMin: 0, workedDays: 0, absentDays: 0, baseSalary: 0, dailyRate: 0, attendanceSalary: null as number | null };
  const getEmployeeMonthlySummary = (empId: string) => recap?.rows.find(r => r.employeeId === empId) ?? EMPTY;
  const baseDays = recap?.baseDays ?? 26;

  const fnLabel = useEmployeeRoleLabel();
  const role = (emp: Record<string, any>) => fnLabel(emp.role);
  const dim = (v: number) => (v > 0 ? undefined : 'var(--ds-muted)');
  // États communs aux deux vues : aucun salarié actif, ou recherche sans résultat.
  const listState = activeEmployees.length === 0 ? <EmptyPanel icon={Users}>Aucun employé actif</EmptyPanel>
    : filteredEmployees.length === 0 ? <NoResultState text={`Aucun employé trouvé pour « ${searchAtt} ».`} onReset={() => setSearchAtt('')} /> : null;

  return (
    <>
      {/* Barre d'outils : recherche, jour ou mois, puis bascule de vue à droite. */}
      <Toolbar>
        <SearchBar value={searchAtt} onChange={setSearchAtt} placeholder="Rechercher un employé…" />
        {attView === 'daily' ? (
          <div className="hr-tools">
            <button type="button" onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() - 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="ds-icon-btn" aria-label="Jour précédent"><ChevronLeft size={16} /></button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="odoo-filter-dropdown" aria-label="Jour" />
            <button type="button" onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1);
              setSelectedDate(format(d, 'yyyy-MM-dd'));
            }} className="ds-icon-btn" aria-label="Jour suivant"><ChevronRight size={16} /></button>
            <span className="hr-tools-label" style={{ marginLeft: 4 }}>
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE d MMMM yyyy', { locale: fr })}
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
        <Segmented label="Vue du pointage" value={attView} onChange={setAttView}
          options={[{ key: 'daily', label: 'Pointage journalier' }, { key: 'monthly', label: 'Récapitulatif mensuel' }]} />
      </Toolbar>

      {attView === 'monthly' && <OvertimeQuotaPanel year={summaryYear} />}

      {/* Récapitulatif mensuel */}
      {attView === 'monthly' && (
        monthlyLoading ? (
          <LoadingPanel />
        ) : monthlyError ? (
          <ErrorState error={recapError} title="Le récapitulatif n'a pas pu être chargé" onRetry={() => void refetchRecap()} />
        ) : listState ?? (
          <DataPanel label="Récapitulatif mensuel du pointage"
            footer={<TableFooter note={`${filteredEmployees.length} employé${filteredEmployees.length > 1 ? 's' : ''} · base ${baseDays} jours`} />}>
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Employé</th>
                  <th>Poste</th>
                  <th className="ds-num">Présent (j)</th>
                  <th className="ds-num">Retard (j)</th>
                  <th className="ds-num">Demi-journée</th>
                  <th className="ds-num">Absent (j)</th>
                  <th className="ds-num">Heures sup</th>
                  <th className="ds-num">Jours travaillés</th>
                  <th className="ds-num">Salaire de base ({currencySymbol()})</th>
                  <th className="ds-num">Taux par jour ({currencySymbol()})</th>
                  <th className="ds-num" title="Base − absences + shifts doubles, comme le bulletin (hors ancienneté, heures sup et primes)">Salaire au pointage ({currencySymbol()})</th>
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
                      <td className="ds-strong">{emp.first_name as string} {emp.last_name as string}</td>
                      <td>{role(emp)}</td>
                      <td className="ds-num" style={{ color: dim(s.present) }}>{s.present}</td>
                      <td className="ds-num" style={{ color: dim(s.late) }}>{s.late}</td>
                      <td className="ds-num" style={{ color: dim(s.halfDay) }}>{s.halfDay}</td>
                      <td className="ds-num" style={{ color: s.absentMarked > 0 ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: s.absentMarked > 0 ? 600 : undefined }}>{s.absentMarked}</td>
                      <td className="ds-num" style={{ color: dim(s.overtimeMin) }}>
                        {s.overtimeMin > 0 ? `${Math.floor(s.overtimeMin / 60)} h ${String(s.overtimeMin % 60).padStart(2, '0')}` : '0'}
                      </td>
                      <td className="ds-num"><span className="ds-strong">{s.workedDays}</span> <span style={{ color: 'var(--ds-muted)' }}>/ {baseDays}</span></td>
                      <td className="ds-num">{baseSalary > 0 ? amount(baseSalary) : '—'}</td>
                      <td className="ds-num">{baseSalary > 0 ? amount(dailyRate) : '—'}</td>
                      <td className="ds-num ds-strong" title={baseSalary > 0 && calculatedSalary < baseSalary ? 'Inférieur au salaire de base (absences)' : undefined}>
                        {baseSalary > 0 ? amount(calculatedSalary) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>Total</td>
                  <td className="ds-num">
                    {Math.round(filteredEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).workedDays, 0) * 100) / 100}
                  </td>
                  <td className="ds-num">
                    {amount(filteredEmployees.reduce((sum, emp) => sum + getEmployeeMonthlySummary(emp.id as string).baseSalary, 0))}
                  </td>
                  <td></td>
                  <td className="ds-num">
                    {amount(filteredEmployees.reduce((sum, emp) => sum + (getEmployeeMonthlySummary(emp.id as string).attendanceSalary ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>
        )
      )}

      {/* Pointage du jour */}
      {attView === 'daily' && (
        isLoading ? (
          <LoadingPanel />
        ) : isError ? (
          <ErrorState error={error} title="Le pointage n'a pas pu être chargé" onRetry={() => void refetch()} />
        ) : listState ?? (
        <>
        <SectionHeader title="Pointage du jour">
          <div className="hr-legend">
            <span><span className="odoo-tag odoo-tag-blue">Présent</span> prévu au planning, non pointé</span>
            <span><span className="odoo-tag odoo-tag-green">Présent</span> pointage confirmé</span>
          </div>
        </SectionHeader>
        <DataPanel label="Pointage du jour" footer={<TableFooter note={`${filteredEmployees.length} employé${filteredEmployees.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Employé</th>
                <th>Poste</th>
                <th>Prévu</th>
                <th>Pointage</th>
                <th>Statut</th>
                <th>Arrivée</th>
                <th>Départ</th>
                <th>Heures sup (h)</th>
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
                  <tr key={emp.id as string}>
                    <td className="ds-strong">{emp.first_name as string} {emp.last_name as string}</td>
                    <td>{role(emp)}</td>
                    <td>
                      {leave ? (
                        <span className={`odoo-tag ${isOnLeave ? 'odoo-tag-purple' : 'odoo-tag-orange'}`}
                          title={`${LEAVE_TYPE_LABELS[leave.type as string] ?? leave.type} ${isLeavePending ? '(en attente)' : ''} — du ${(leave.start_date as string).slice(0, 10)} au ${(leave.end_date as string).slice(0, 10)}`}>
                          <CalendarOff size={10} aria-hidden="true" style={{ marginRight: 3 }} />
                          {LEAVE_TYPE_LABELS[leave.type as string] ?? leave.type}{isLeavePending ? ' (en attente)' : ''}
                        </span>
                      ) : plannedShift ? (
                        <span className={`odoo-tag ${shiftTag(plannedShift)}`}>
                          {SHIFT_SHORT_LABELS[plannedShift]}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ds-muted)' }}>Non planifié</span>
                      )}
                    </td>
                    <td>
                      {isOnLeave ? <StatusTag tone="cancelled" icon={CalendarOff} label="En congé" />
                        : hasCheckIn ? <StatusTag tone="done" label="Pointé" />
                        : isExpected ? <StatusTag tone="todo" label="À pointer" />
                        : <StatusTag tone="draft" label="Non prévu" />}
                    </td>
                    <td>
                      {isOnLeave ? (
                        <span style={{ color: 'var(--ds-muted)' }}>—</span>
                      ) : (
                        <div role="group" aria-label="Statut du jour" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {ATTENDANCE_STATUS.map(s => {
                            const isActive = (rec as Record<string, any>)?.status === s.value;
                            const isExpectedPresent = isExpected && !hasCheckIn && s.value === 'present';
                            return (
                              <button key={s.value} type="button" aria-pressed={isActive}
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
                    <td>
                      {/* key inclut selectedDate : sans ca, defaultValue est
                          fige au 1er render et changer de jour affichait les
                          heures du jour precedent (risque d'ecraser le bon
                          jour au onBlur). */}
                      <input key={`ci-${emp.id}-${selectedDate}`} type="time" aria-label={`Heure d'arrivée de ${emp.first_name} ${emp.last_name}`} className={`${inputCls} sm`} style={{ width: 112 }}
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
                    <td>
                      <input key={`co-${emp.id}-${selectedDate}`} type="time" aria-label={`Heure de départ de ${emp.first_name} ${emp.last_name}`} className={`${inputCls} sm`} style={{ width: 112 }}
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
                    <td>
                      <input key={`ot-${emp.id}-${selectedDate}`} type="number" aria-label={`Heures supplémentaires de ${emp.first_name} ${emp.last_name}`} className={`${inputCls} sm`} style={{ width: 80 }} min="0" step="0.5"
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
                          <div style={{ fontSize: 12, color: 'var(--ds-muted)', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button type="button" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}
                              title="Part de nuit (21h-6h) des heures sup, calculée depuis l'arrivée et le départ. Cliquer pour corriger."
                              onClick={() => setNightEdit({ base, otMin, nightMin })}>
                              dont nuit {Math.round(nightMin / 60 * 100) / 100} h
                            </button>
                            <button type="button" onClick={() => upsertMutation.mutate({ ...base, isRestDay: !rest })} aria-pressed={!!rest}
                              className={`odoo-tag ${rest ? 'odoo-tag-purple' : 'odoo-tag-grey'}`} style={{ border: 'none', cursor: 'pointer' }}
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
        </DataPanel>
        </>
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
