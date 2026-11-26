import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import api from '../../api/client';
import { referentielApi } from '../../api/referentiel.api';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, TableFooter } from '../../components/ds';

/**
 * Stock › Mouvements (refonte Stock, maquette « Mouvements — journal », mig 724) : tous les
 * mouvements du stock dans une seule liste, par pièce. Les types (et leurs libellés) viennent
 * du référentiel « Types de mouvement » ; un clic ouvre l'écran existant de la pièce (bon de
 * sortie, fiche article).
 */
type Movement = {
  type: string; id: string; reference: string | null; moved_at: string; subject: string | null; step: string;
  lines: number; quantity: number | null; unit: string | null; deviations: number; by_name: string | null; source_id: string | null;
};
type MovementType = { code: string; label: string; display_order: number };

/** Étapes du bon de sortie (mêmes libellés que la file du poste de pesée). */
const BS_STEP: Record<string, { label: string; tone: StatusTone }> = {
  genere: { label: 'Demande reçue', tone: 'todo' },
  preparation: { label: 'Préparation & pesée', tone: 'progress' },
  preparation_partielle: { label: 'Préparation & pesée', tone: 'progress' },
  pret: { label: 'Prêt à remettre', tone: 'draft' },
  prelevement: { label: 'Remis au chef', tone: 'done' },
  verifie: { label: 'Remis au chef', tone: 'done' },
  cloture: { label: 'Remis au chef', tone: 'done' },
};
const qty = (n: number | null, unit: string | null) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''} ${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`);
const when = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function MovementsTab() {
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory', 'movements'],
    queryFn: (): Promise<Movement[]> => api.get('/inventory/movements', { params: { days: 30 } }).then(r => r.data.data),
    refetchInterval: 30_000,
  });
  const { data: types = [] } = useQuery({
    queryKey: ['params', 'stock_movement_types'],
    queryFn: (): Promise<MovementType[]> => referentielApi.entries('stock_movement_types'),
    staleTime: 300_000,
  });
  const labelOf = useMemo(() => new Map(types.map(t => [t.code, t.label])), [types]);
  const today = new Date().toDateString();
  const kpi = useMemo(() => ({
    toPrepare: data.filter(m => m.type === 'bon_sortie' && ['genere', 'preparation', 'preparation_partielle'].includes(m.step)).length,
    ready: data.filter(m => m.type === 'bon_sortie' && m.step === 'pret').length,
    today: data.filter(m => new Date(m.moved_at).toDateString() === today).length,
    losses: data.filter(m => m.type === 'perte' && new Date(m.moved_at).toDateString() === today).length,
    deviations: data.reduce((s, m) => s + (m.deviations || 0), 0),
  }), [data, today]);
  const counts = useMemo(() => data.reduce<Record<string, number>>((a, m) => ({ ...a, [m.type]: (a[m.type] ?? 0) + 1 }), {}), [data]);
  const rows = type ? data.filter(m => m.type === type) : data;
  const open = (m: Movement) => {
    if (m.type === 'bon_sortie') navigate(`/stock?tab=bons&bon=${m.id}`);
    else if (m.type !== 'reception' && m.source_id) navigate(`/stock/${m.source_id}`);
  };

  if (isLoading) return <LoadingState label="Chargement des mouvements…" />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <KpiGrid label="Chiffres clés des mouvements">
        <KpiCard label="Bons de sortie à préparer" value={String(kpi.toPrepare)} sub="Demandes reçues et en pesée" tone={kpi.toPrepare ? 'orange' : undefined} onClick={() => setType('bon_sortie')} />
        <KpiCard label="Prêts à remettre" value={String(kpi.ready)} sub="Attente du chef" onClick={() => setType('bon_sortie')} />
        <KpiCard label="Mouvements aujourd'hui" value={String(kpi.today)} sub={kpi.losses ? `dont ${kpi.losses} perte${kpi.losses > 1 ? 's' : ''}` : 'sur 30 jours affichés'} />
        <KpiCard label="Écarts de pesée motivés" value={String(kpi.deviations)} sub="Sur les bons affichés" tone={kpi.deviations ? 'orange' : undefined} />
      </KpiGrid>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }} role="group" aria-label="Filtrer par type de mouvement">
        <button type="button" className={type === '' ? 'odoo-btn-primary ds-btn-sm' : 'odoo-btn-secondary ds-btn-sm'} aria-pressed={type === ''} onClick={() => setType('')}>Tous · {data.length}</button>
        {types.filter(t => counts[t.code]).map(t => (
          <button key={t.code} type="button" className={type === t.code ? 'odoo-btn-primary ds-btn-sm' : 'odoo-btn-secondary ds-btn-sm'} aria-pressed={type === t.code} onClick={() => setType(t.code)}>
            {t.label} · {counts[t.code]}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <EmptyState icon={ArrowLeftRight} title="Aucun mouvement sur 30 jours" text="Bons de sortie, réceptions, ouvertures de contenant, pertes et ajustements apparaissent ici." />
      ) : (
        <DataPanel label="Mouvements" footer={<TableFooter note={`${rows.length} mouvement${rows.length > 1 ? 's' : ''} · 30 derniers jours`} />}>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Pièce</th><th>Type</th><th>Pour</th><th className="ds-num">Lignes / quantité</th><th>Étape</th><th>Par</th></tr></thead>
            <tbody>{rows.map(m => {
              const step = m.type === 'bon_sortie' ? BS_STEP[m.step] ?? { label: m.step, tone: 'todo' as StatusTone } : { label: 'Fait', tone: 'done' as StatusTone };
              const clickable = m.type === 'bon_sortie' || (m.type !== 'reception' && !!m.source_id);
              return (
                <tr key={`${m.type}-${m.id}`} onClick={clickable ? () => open(m) : undefined} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(m.moved_at)}</td>
                  <td className="ds-strong">{m.reference ?? '—'}</td>
                  <td>{labelOf.get(m.type) ?? m.type}</td>
                  <td>{m.subject ?? '—'}</td>
                  <td className="ds-num">{m.quantity !== null ? qty(m.quantity, m.unit) : `${m.lines} ligne${m.lines > 1 ? 's' : ''}`}</td>
                  <td><StatusTag tone={step.tone} label={step.label} />{m.deviations > 0 && <span className="sal-sub">{m.deviations} écart{m.deviations > 1 ? 's' : ''}</span>}</td>
                  <td>{m.by_name ?? '—'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}
