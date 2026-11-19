import { money } from '../../utils/money';
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

const DOT = { danger: 'var(--prj-red)', warning: 'var(--prj-orange)', ok: 'var(--prj-green)', unknown: 'var(--theme-text-muted)' } as const;

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
    <section aria-label="Contrôle des ventes" className="klc-stack">
      <div className="klc-section-row">
        <h2 className="klc-section">Contrôle des ventes <small>{periodLabel(period, from, to)}</small></h2>
        <span className="klc-section-actions prj-toolbar">
          <PeriodFilter label="Période" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        </span>
      </div>
      <div className="prj-kpis">
        {isLoading && <div className="prj-kpi"><div className="prj-kpi-sub">Chargement…</div></div>}
        {items.map(i => (
          <button key={i.key} type="button" className="prj-kpi" onClick={() => open(i)}
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
            title={i.key === 'caisse_ecart' ? 'Ouvrir les sessions de caisse' : 'Ouvrir le rapport des écarts de ventes'}>
            <div className="prj-kpi-head">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={DOT[i.severity]} /> {i.label}</span> <ArrowRight size={13} />
            </div>
            <div className="prj-kpi-value">{i.count ?? '—'}</div>
            <div className="prj-kpi-sub">{i.value ? `${money(i.value)} · ` : ''}{i.hint}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
