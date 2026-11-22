import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Clock, AlertTriangle } from 'lucide-react';
import { inventoryApi, type StockAgingLot } from '../../api/inventory.api';
import { money } from '../../utils/money';
import { ListToolbar, ListKpi } from '../sales/ListTemplate';
import './stock.css';
import { DataPanel, EmptyState, ErrorState, KpiGrid, LoadingState, NoResultState, TableFooter } from '../../components/ds';

/**
 * Age du stock matiere (rapport, lot P1 ERPNext « stock aging »). Lit les lots
 * matiere encore actifs et les classe par anciennete depuis la reception, pour
 * reperer le stock dormant (immobilise depuis longtemps) et les lots proches de
 * leur DLC. Les quantites portent des unites differentes (kg, u, g) : seul le
 * RESUME par tranche agrege la valeur (DH), pas les quantites.
 */

const qty = (n: number, unit: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;

export default function StockAgingTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['stock-aging'], queryFn: inventoryApi.aging });
  const [search, setSearch] = useState('');
  const [oldOnly, setOldOnly] = useState(false);

  const lots = useMemo(() => {
    let rows: StockAgingLot[] = data?.lots ?? [];
    if (oldOnly) rows = rows.filter(l => l.days_in_stock > 90);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(l => l.ingredient_name.toLowerCase().includes(q) || l.lot_number.toLowerCase().includes(q));
    return rows;
  }, [data, search, oldOnly]);

  if (isLoading) {
    return <LoadingState label="Chargement des lots…" />;
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  const buckets = data?.buckets ?? [];
  const total = data?.totalValue ?? 0;

  return (
    <div className="stk-stack">
      {/* Résumé par tranche d'ancienneté (valeur immobilisée) */}
      <KpiGrid label="Valeur par tranche d'ancienneté">
        {buckets.map(b => (
          <ListKpi key={b.key} label={b.label} value={money(b.value)} sub={`${b.lots} lot${b.lots > 1 ? 's' : ''}`}
            tone={b.key === '90+' && b.value > 0 ? 'red' : undefined} />
        ))}
        <ListKpi label="Valeur totale en stock" value={money(total)}
          sub={`${data?.lots.length ?? 0} lot${(data?.lots.length ?? 0) > 1 ? 's' : ''} actif${(data?.lots.length ?? 0) > 1 ? 's' : ''}`} />
      </KpiGrid>

      {/* Barre d'outils */}
      <ListToolbar search={search} onSearch={setSearch} placeholder="Rechercher un article ou un n° de lot…">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.85rem', cursor: 'pointer', color: 'var(--theme-text-body)', border: 0 }}>
          <input type="checkbox" checked={oldOnly} onChange={e => setOldOnly(e.target.checked)} style={{ accentColor: 'var(--theme-accent)' }} />
          Seulement plus de 90 jours
        </label>
      </ListToolbar>

      {/* Détail des lots, du plus ancien au plus récent */}
      {lots.length === 0 ? (
        (search || oldOnly)
          ? <NoResultState text="Aucun lot ne correspond aux filtres." onReset={() => { setSearch(''); setOldOnly(false); }} />
          : <EmptyState icon={Clock} title="Aucun lot en stock" text="Les lots de matière encore en stock apparaîtront ici, du plus ancien au plus récent." />
      ) : (
      <DataPanel label="Lots par ancienneté" footer={<TableFooter note={`${lots.length} lot${lots.length > 1 ? 's' : ''} · du plus ancien au plus récent`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Article</th>
              <th>Lot</th>
              <th className="ds-num">Quantité restante</th>
              <th className="ds-num">Ancienneté (j)</th>
              <th>Réception</th>
              <th>DLC</th>
              <th className="ds-num">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {lots.map(l => {
              const dormant = l.days_in_stock > 90;
              const dlcSoon = l.days_to_expiry != null && l.days_to_expiry <= 7;
              const dlcPast = l.days_to_expiry != null && l.days_to_expiry < 0;
              return (
                <tr key={l.id}>
                  <td className="ds-strong">{l.ingredient_name}</td>
                  <td><span className="ds-ref">{l.lot_number}</span></td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{qty(l.quantity_remaining, l.unit)}</td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: dormant ? 'var(--ds-danger)' : l.days_in_stock > 60 ? 'var(--ds-warning)' : undefined, fontWeight: dormant || l.days_in_stock > 60 ? 600 : undefined }}
                      title={dormant ? 'Stock dormant : plus de 90 jours' : undefined}>{l.days_in_stock}</span>
                  </td>
                  <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{format(new Date(l.received_at), 'dd MMM yyyy', { locale: fr })}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {l.expiration_date ? (
                      <span style={{ color: dlcPast ? 'var(--ds-danger)' : dlcSoon ? 'var(--ds-warning)' : 'var(--theme-text-muted)', fontWeight: dlcPast || dlcSoon ? 600 : 400 }}>
                        {dlcPast && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 3 }} />}
                        {format(new Date(l.expiration_date), 'dd MMM yyyy', { locale: fr })}
                      </span>
                    ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                  </td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{money(l.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
      )}
    </div>
  );
}
