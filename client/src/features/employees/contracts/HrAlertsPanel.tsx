import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';

/**
 * Alertes RH a traiter : CDD echus ou proches de leur fin, fins de periode
 * d'essai, pieces expirees, dossiers incomplets. Clic = ouvre la fiche.
 */
export default function HrAlertsPanel({ onOpenEmployee }: { onOpenEmployee: (employeeId: string) => void }) {
  const { data: alerts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['hr-alerts'],
    queryFn: () => employeesApi.hrAlerts(30),
  });
  if (!alerts.length) return null;
  const urgent = alerts.filter(a => a.severity !== 'info');
  const incomplete = alerts.filter(a => a.severity === 'info');
  const color = (s: string) => (s === 'danger' ? '#dc3545' : s === 'warning' ? '#b08504' : 'var(--odoo-text-muted)');
  return (
    <details className={`odoo-alert ${urgent.some(a => a.severity === 'danger') ? 'danger' : urgent.length ? 'warning' : 'info'}`}
      style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }} open={urgent.length > 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {urgent.length > 0 ? <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} /> : <Bell size={12} style={{ display: 'inline', marginRight: 4 }} />}
        {urgent.length} alerte(s) contrat / pièces à traiter{incomplete.length > 0 && ` · ${incomplete.length} dossier(s) incomplet(s)`}
      </summary>
      <ul style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[...urgent, ...incomplete].map((a, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: color(a.severity), flexShrink: 0, display: 'inline-block' }} />
            <button type="button" onClick={() => onOpenEmployee(a.employeeId)}
              style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
              {a.employeeName}
            </button>
            <span>{a.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
