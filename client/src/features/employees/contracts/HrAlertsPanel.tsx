import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';
import { StatusBanner } from '../../../components/ui/StatusBanner';

/**
 * Alertes RH a traiter : CDD echus ou proches de leur fin, fins de periode
 * d'essai, pieces expirees, dossiers incomplets. Clic = ouvre la fiche.
 */
export default function HrAlertsPanel({ onOpenEmployee }: { onOpenEmployee: (employeeId: string) => void }) {
  const { data: alerts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['hr-alerts'],
    queryFn: () => employeesApi.hrAlerts(30),
  });
  const urgent = alerts.filter(a => a.severity !== 'info');
  const incomplete = alerts.filter(a => a.severity === 'info');
  // Ouvert par defaut quand il y a des alertes urgentes (comme l'ancien <details open>).
  const [expanded, setExpanded] = useState(false);
  const hasUrgent = urgent.length > 0;
  useEffect(() => { setExpanded(hasUrgent); }, [hasUrgent]);
  if (!alerts.length) return null;

  const tone = urgent.some(a => a.severity === 'danger') ? 'danger' : urgent.length ? 'warning' : 'info';
  const color = (s: string) => (s === 'danger' ? '#dc3545' : s === 'warning' ? '#b08504' : 'var(--odoo-text-muted)');
  return (
    <StatusBanner tone={tone} icon={hasUrgent ? AlertTriangle : Bell}
      title={`${urgent.length} alerte(s) contrat / pièces à traiter${incomplete.length > 0 ? ` · ${incomplete.length} dossier(s) incomplet(s)` : ''}`}
      actions={
        <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.55rem', fontSize: '0.75rem' }}
          onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? 'Masquer' : 'Afficher'}
        </button>
      }>
      {expanded && (
        <ul style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[...urgent, ...incomplete].map((a, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: color(a.severity), flexShrink: 0, display: 'inline-block' }} />
              <button type="button" onClick={() => onOpenEmployee(a.employeeId)}
                style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}>
                {a.employeeName}
              </button>
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      )}
    </StatusBanner>
  );
}
