import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { attendanceApi } from '../../../api/employees.api';

/**
 * Contingent annuel d'heures supplementaires (decret d'application du Code du
 * travail, 100 h par defaut, reglable) : cumul par employe, alerte au-dela.
 */
export default function OvertimeQuotaPanel({ year }: { year: number }) {
  const { data } = useQuery<{ quotaHours: number; rows: Record<string, any>[] }>({
    queryKey: ['overtime-summary', year],
    queryFn: () => attendanceApi.overtimeSummary(year),
  });
  // Ouvert d'office quand un salarie depasse le contingent (comme l'ancien <details open>).
  const [toggled, setToggled] = useState<boolean | null>(null);
  const rows = (data?.rows ?? []).filter(r => r.hours > 0);
  if (!data || rows.length === 0) return null;
  const over = rows.filter(r => r.overQuota);
  const open = toggled ?? over.length > 0;
  return (
    <StatusBanner tone={over.length ? 'warning' : 'info'} icon={over.length ? AlertTriangle : Clock}
      title={`Heures supplémentaires ${year} : contingent ${data.quotaHours} h par salarié${over.length > 0 ? ` — ${over.length} dépassement(s)` : ''}`}
      actions={
        <button type="button" className="odoo-btn-secondary" onClick={() => setToggled(!open)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? 'Masquer le détail' : 'Voir le détail'}
        </button>
      }>
      {open && (
      <table className="odoo-table" style={{ marginTop: 8 }}>
        <thead><tr><th>Employé</th><th style={{ textAlign: 'right' }}>Heures sup</th><th style={{ textAlign: 'right' }}>dont nuit</th><th style={{ width: '40%' }}>Contingent</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.employeeId}>
              <td>{r.name}</td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: r.overQuota ? '#dc3545' : undefined }}>{r.hours} h</td>
              <td style={{ textAlign: 'right' }}>{r.nightHours} h</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--odoo-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, r.quotaUsedPct)}%`, height: '100%', background: r.overQuota ? '#dc3545' : r.quotaUsedPct > 80 ? '#b08504' : '#28a745' }} />
                  </div>
                  <span style={{ width: 44, textAlign: 'right' }}>{r.quotaUsedPct} %</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </StatusBanner>
  );
}
