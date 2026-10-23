import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { controleApi, type ControlIndicator } from '../../api/controle.api';
import { PeriodFilter, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { Dot, n2 } from './shared';

/**
 * Indicateurs de contrôle des ventes (ex-onglet Ventes de Contrôle & Qualité,
 * retiré le 2026-10-20) : mêmes chiffres que la vue d'ensemble du Contrôle
 * (GET /controle/overview, domaine 'ventes'). Un écart négatif est un manque.
 */

const DOT = { danger: '#dc3545', warning: '#d9822b', ok: '#28a745', unknown: '#adb5bd' } as const;

export default function VentesIndicators({ onManquants }: { onManquants: () => void }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = useMemo(() => periodParams(period, from, to), [period, from, to]);
  // Même clé que la vue d'ensemble du Contrôle : cache partagé.
  const { data = [], isLoading } = useQuery<ControlIndicator[]>({
    queryKey: ['controle-overview', range],
    queryFn: () => controleApi.overview(range),
  });
  const items = data.filter(i => i.domain === 'ventes');
  const open = (i: ControlIndicator) => (i.key === 'caisse_ecart' ? navigate('/sales') : onManquants());

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 16px 0' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--odoo-text-muted)' }}>
          Contrôle des ventes · {periodLabel(period, from, to)}
        </span>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8 }}>
          <PeriodFilter label="Période" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        </span>
      </div>
      <div className="odoo-stat-grid" style={{ borderBottom: 'none' }}>
        {isLoading && <div className="odoo-stat-card" style={{ cursor: 'default' }}><div className="odoo-stat-card-sub">Chargement…</div></div>}
        {items.map(i => (
          <button key={i.key} type="button" className="odoo-stat-card" onClick={() => open(i)}
            title={i.key === 'caisse_ecart' ? 'Ouvrir les sessions de caisse' : 'Ouvrir le rapport des écarts de ventes'}>
            <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color={DOT[i.severity]} /> {i.label} <ArrowRight size={11} style={{ marginLeft: 'auto' }} />
            </div>
            <div className="odoo-stat-card-value">{i.count ?? '—'}</div>
            <div className="odoo-stat-card-sub">{i.value ? `${n2(i.value)} DH · ` : ''}{i.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
