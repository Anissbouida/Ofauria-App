import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Clock, AlertTriangle, Search } from 'lucide-react';
import { inventoryApi, type StockAgingLot } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';

/**
 * Age du stock matiere (rapport, lot P1 ERPNext « stock aging »). Lit les lots
 * matiere encore actifs et les classe par anciennete depuis la reception, pour
 * reperer le stock dormant (immobilise depuis longtemps) et les lots proches de
 * leur DLC. Les quantites portent des unites differentes (kg, u, g) : seul le
 * RESUME par tranche agrege la valeur (DH), pas les quantites.
 */

const DH = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
const qty = (n: number, unit: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;

export default function StockAgingTab() {
  const { data, isLoading } = useQuery({ queryKey: ['stock-aging'], queryFn: inventoryApi.aging });
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
    return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Chargement…</div>;
  }

  const buckets = data?.buckets ?? [];
  const total = data?.totalValue ?? 0;

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Clock} title="Âge du stock matière">
        Les lots actifs classés par ancienneté depuis leur réception. Repérez le stock dormant (tranche « plus de 90 jours ») et les lots proches de leur date limite.
      </StatusBanner>

      {/* Résumé par tranche d'ancienneté (valeur immobilisée) */}
      <div className="odoo-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {buckets.map(b => {
          const danger = b.key === '90+';
          return (
            <div key={b.key} className="odoo-stat-card">
              <div className="odoo-stat-card-label">
                <Clock size={11} style={{ display: 'inline', marginRight: 4, color: danger ? '#dc3545' : 'var(--theme-accent)' }} />
                {b.label}
              </div>
              <div className="odoo-stat-card-value" style={{ color: danger && b.value > 0 ? '#dc3545' : undefined }}>{DH(b.value)}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{b.lots} lot{b.lots > 1 ? 's' : ''}</div>
            </div>
          );
        })}
        <div className="odoo-stat-card" style={{ background: 'var(--theme-bg-secondary)' }}>
          <div className="odoo-stat-card-label">Valeur totale en stock</div>
          <div className="odoo-stat-card-value">{DH(total)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{data?.lots.length ?? 0} lot{(data?.lots.length ?? 0) > 1 ? 's' : ''} actif{(data?.lots.length ?? 0) > 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="odoo-search-panel" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un article ou un n° de lot…"
            style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'inherit', font: 'inherit' }} />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.85rem', cursor: 'pointer', color: 'var(--theme-text-body)' }}>
          <input type="checkbox" checked={oldOnly} onChange={e => setOldOnly(e.target.checked)} style={{ accentColor: 'var(--theme-accent)' }} />
          Seulement plus de 90 jours
        </label>
      </div>

      {/* Détail des lots, du plus ancien au plus récent */}
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Article</th>
              <th>Lot</th>
              <th style={{ textAlign: 'right' }}>Quantité restante</th>
              <th style={{ textAlign: 'right' }}>Ancienneté</th>
              <th>Réception</th>
              <th>DLC</th>
              <th style={{ textAlign: 'right' }}>Valeur</th>
            </tr>
          </thead>
          <tbody>
            {lots.map(l => {
              const dormant = l.days_in_stock > 90;
              const dlcSoon = l.days_to_expiry != null && l.days_to_expiry <= 7;
              const dlcPast = l.days_to_expiry != null && l.days_to_expiry < 0;
              return (
                <tr key={l.id}>
                  <td style={{ fontWeight: 500 }}>{l.ingredient_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{l.lot_number}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{qty(l.quantity_remaining, l.unit)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <span className={`odoo-tag ${dormant ? 'odoo-tag-red' : l.days_in_stock > 60 ? 'odoo-tag-orange' : 'odoo-tag-grey'}`}>{l.days_in_stock} j</span>
                  </td>
                  <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{format(new Date(l.received_at), 'dd MMM yyyy', { locale: fr })}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {l.expiration_date ? (
                      <span style={{ color: dlcPast ? '#dc3545' : dlcSoon ? '#b85d1a' : 'var(--theme-text-muted)', fontWeight: dlcPast || dlcSoon ? 600 : 400 }}>
                        {dlcPast && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 3 }} />}
                        {format(new Date(l.expiration_date), 'dd MMM yyyy', { locale: fr })}
                      </span>
                    ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{DH(l.value)}</td>
                </tr>
              );
            })}
            {lots.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--theme-text-muted)' }}>Aucun lot ne correspond.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
