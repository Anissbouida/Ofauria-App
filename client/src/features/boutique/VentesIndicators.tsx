import { money } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { controleApi, type ControlIndicator } from '../../api/controle.api';
import { PeriodFilter, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { KpiCard, KpiGrid, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Indicateurs de contrôle des ventes (ex-onglet Ventes de Contrôle & Qualité,
 * retiré le 2026-10-20) : mêmes chiffres que la vue d'ensemble du Contrôle
 * (GET /controle/overview, domaine 'ventes'). Un écart négatif est un manque.
 */

const TONE = { danger: 'red', warning: 'orange', ok: 'green', unknown: undefined } as const;

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
      <SectionHeader title="Contrôle des ventes" note={periodLabel(period, from, to)}>
        <span className="prj-toolbar">
          <PeriodFilter label="Période" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        </span>
      </SectionHeader>
      {isLoading ? <LoadingState bare label="Chargement des indicateurs…" /> : items.length > 0 && (
        <KpiGrid label="Contrôle des ventes">
          {items.map(i => (
            <KpiCard key={i.key} label={i.label} value={i.count ?? '—'} tone={TONE[i.severity]}
              sub={`${i.value ? `${money(i.value)} · ` : ''}${i.hint}`} onClick={() => open(i)} />
          ))}
        </KpiGrid>
      )}
    </section>
  );
}
