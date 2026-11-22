import { money as fmtMoney } from '../../../utils/money';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';
import { SectionTitle } from '../ui';

const FREQ_LABELS: Record<string, string> = { monthly: 'mensuelle', biweekly: 'quinzaine', weekly: 'hebdo' };

const money = (v: unknown) => (v === null || v === undefined ? "—" : fmtMoney(parseFloat(String(v))));

/**
 * Historique des changements de salaire / frequence de paie d'un employe
 * (table employee_salary_history alimentee par trigger, mig 239) :
 * qui a change quoi, quand. Lecture seule.
 */
export default function EmployeeSalaryHistory({ employeeId }: { employeeId: string }) {
  const { data: rows = [], isLoading } = useQuery<Record<string, any>[]>({
    queryKey: ['employee-salary-history', employeeId],
    queryFn: () => employeesApi.salaryHistory(employeeId),
  });

  return (
    <section className="prj-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px' }}>
      <SectionTitle icon={History}>Historique du salaire</SectionTitle>
      {isLoading ? (
        <p style={muted}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p style={muted}>Aucune modification enregistrée.</p>
      ) : (
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Changement</th>
              <th>Par</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(h => {
              const changes: string[] = [];
              if (h.old_monthly_salary !== h.new_monthly_salary) changes.push(`Mensuel ${money(h.old_monthly_salary)} → ${money(h.new_monthly_salary)}`);
              if (h.old_weekly_salary !== h.new_weekly_salary) changes.push(`Hebdo ${money(h.old_weekly_salary)} → ${money(h.new_weekly_salary)}`);
              if (h.old_pay_frequency !== h.new_pay_frequency) {
                changes.push(`Fréquence ${FREQ_LABELS[h.old_pay_frequency] ?? h.old_pay_frequency ?? '—'} → ${FREQ_LABELS[h.new_pay_frequency] ?? h.new_pay_frequency ?? '—'}`);
              }
              return (
                <tr key={h.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.changed_at).toLocaleDateString('fr-FR')}</td>
                  <td>{changes.join(' · ') || '—'}{h.reason ? <span style={{ color: 'var(--ds-muted)' }}> — {h.reason}</span> : null}</td>
                  <td>
                    {h.changed_by_first_name ? `${h.changed_by_first_name} ${h.changed_by_last_name ?? ''}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const muted = { fontSize: 14, color: 'var(--ds-muted)', margin: 0 } as const;
