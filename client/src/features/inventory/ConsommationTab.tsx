import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Download, Loader2, ChevronDown, ChevronRight, Factory, Trash2, Sliders,
} from 'lucide-react';
import { inventoryApi } from '../../api/inventory.api';

/**
 * Vue PHYSIQUE des matières sorties de stock pour la période.
 *
 * Source : inventory_transactions outflows (quantity_change < 0)
 *   - 'production' / 'usage' : utilisé en production
 *   - 'waste' : pertes / DLC / casse
 *   - 'adjustment' : ajustements manuels (inventaire physique négatif)
 *
 * Indépendant du flux cash : montre ce qui a quitté le stock physiquement,
 * peu importe que la facture fournisseur soit payée ou non. Décisions
 * d'achat, suivi pertes, optimisation conso → c'est ici, pas dans Compta.
 *
 * Affichage : 4 cartes totaux par type, puis tableau détaillé par
 * ingrédient groupé par catégorie. Tri par coût décroissant.
 */
type ConsumptionRow = {
  ingredient_id: string;
  ingredient_name: string;
  ingredient_unit: string;
  ingredient_category: string | null;
  unit_cost: string | null;
  movement_type: 'usage' | 'production' | 'waste' | 'adjustment';
  transaction_count: number;
  qty_consumed: string;
  cost_consumed: string;
};

type IngredientSummary = {
  ingredient_id: string;
  ingredient_name: string;
  ingredient_unit: string;
  ingredient_category: string;
  unit_cost: number;
  total_qty: number;
  total_cost: number;
  byType: Record<string, { qty: number; cost: number }>;
};

function n(v: number) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(escape).join(';')).join('\n');
  const bom = '﻿'; // Force UTF-8 BOM pour Excel
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ConsommationTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory-consumption', year, month],
    queryFn: () => inventoryApi.consumption({ dateFrom, dateTo }),
  });

  const data = rows as ConsumptionRow[];

  // Totaux par type de mouvement
  const totalsByType = useMemo(() => {
    const acc: Record<string, { qty_count: number; cost: number }> = {
      production: { qty_count: 0, cost: 0 },
      waste: { qty_count: 0, cost: 0 },
      adjustment: { qty_count: 0, cost: 0 },
    };
    data.forEach(r => {
      const key = r.movement_type === 'usage' ? 'production' : r.movement_type;
      if (!acc[key]) return;
      acc[key].qty_count += 1;
      acc[key].cost += parseFloat(r.cost_consumed) || 0;
    });
    return acc;
  }, [data]);

  const totalAll = useMemo(
    () => Object.values(totalsByType).reduce((s, t) => s + t.cost, 0),
    [totalsByType]
  );

  // Groupage par catégorie d'ingrédient, puis par ingrédient
  const byCategory = useMemo(() => {
    const ingMap = new Map<string, IngredientSummary>();
    data.forEach(r => {
      const existing = ingMap.get(r.ingredient_id);
      const qty = parseFloat(r.qty_consumed) || 0;
      const cost = parseFloat(r.cost_consumed) || 0;
      if (existing) {
        existing.total_qty += qty;
        existing.total_cost += cost;
        if (!existing.byType[r.movement_type]) existing.byType[r.movement_type] = { qty: 0, cost: 0 };
        existing.byType[r.movement_type].qty += qty;
        existing.byType[r.movement_type].cost += cost;
      } else {
        ingMap.set(r.ingredient_id, {
          ingredient_id: r.ingredient_id,
          ingredient_name: r.ingredient_name,
          ingredient_unit: r.ingredient_unit,
          ingredient_category: r.ingredient_category || 'autre',
          unit_cost: parseFloat(r.unit_cost || '0') || 0,
          total_qty: qty,
          total_cost: cost,
          byType: { [r.movement_type]: { qty, cost } },
        });
      }
    });

    const cats = new Map<string, { name: string; total: number; ingredients: IngredientSummary[] }>();
    for (const ing of ingMap.values()) {
      const cat = ing.ingredient_category;
      if (!cats.has(cat)) cats.set(cat, { name: cat, total: 0, ingredients: [] });
      const c = cats.get(cat)!;
      c.total += ing.total_cost;
      c.ingredients.push(ing);
    }
    for (const c of cats.values()) {
      c.ingredients.sort((a, b) => b.total_cost - a.total_cost);
    }
    return Array.from(cats.values()).sort((a, b) => b.total - a.total);
  }, [data]);

  const periodLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: fr });

  const handleExport = () => {
    const headers = ['Categorie', 'Ingredient', 'Unite', 'Qte sortie', 'Cout unitaire', 'Cout total', 'Production', 'Perte', 'Ajustement'];
    const rowsCsv: string[][] = [];
    byCategory.forEach(cat => {
      cat.ingredients.forEach(ing => {
        rowsCsv.push([
          ing.ingredient_category,
          ing.ingredient_name,
          ing.ingredient_unit,
          ing.total_qty.toFixed(3),
          ing.unit_cost.toFixed(2),
          ing.total_cost.toFixed(2),
          (ing.byType.production?.cost || ing.byType.usage?.cost || 0).toFixed(2),
          (ing.byType.waste?.cost || 0).toFixed(2),
          (ing.byType.adjustment?.cost || 0).toFixed(2),
        ]);
      });
    });
    exportCSV(`consommation-${year}-${String(month).padStart(2, '0')}.csv`, headers, rowsCsv);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header : selecteur periode + export */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
          className="odoo-input" style={{ width: 130 }}>
          {Array.from({ length: 12 }, (_, k) => k + 1).map(m => (
            <option key={m} value={m}>{format(new Date(2026, m - 1, 1), 'MMMM', { locale: fr })}</option>
          ))}
        </select>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="odoo-input" style={{ width: 90 }}>
          {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          Periode : <strong style={{ textTransform: 'capitalize' }}>{periodLabel}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} disabled={data.length === 0}
          className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {/* Bandeau totaux */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
          <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total consomme</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--theme-accent)', marginTop: 4 }}>{n(totalAll)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{data.length} mouvements</div>
        </div>
        <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #d4edda', background: '#f0f9f4' }}>
          <div style={{ fontSize: '0.6875rem', color: '#0e7c3a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Factory size={11} /> Production
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0e7c3a', marginTop: 4 }}>{n(totalsByType.production.cost)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            {totalAll > 0 ? Math.round((totalsByType.production.cost / totalAll) * 100) : 0}% du total
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #f5c6cb', background: '#fff5f5' }}>
          <div style={{ fontSize: '0.6875rem', color: '#b71c1c', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={11} /> Pertes
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b71c1c', marginTop: 4 }}>{n(totalsByType.waste.cost)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            {totalAll > 0 ? Math.round((totalsByType.waste.cost / totalAll) * 100) : 0}% du total
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #e9ecef', background: '#f8f9fa' }}>
          <div style={{ fontSize: '0.6875rem', color: '#6c757d', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sliders size={11} /> Ajustements
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6c757d', marginTop: 4 }}>{n(totalsByType.adjustment.cost)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            {totalAll > 0 ? Math.round((totalsByType.adjustment.cost / totalAll) * 100) : 0}% du total
          </div>
        </div>
      </div>

      {/* Note explicative */}
      <div className="odoo-alert" style={{ fontSize: '0.75rem' }}>
        <strong>Vue stock (pas trésorerie) :</strong> cette vue montre les matières <strong>physiquement consommées</strong>
        (sorties de stock). Indépendante du paiement des fournisseurs. Utile pour comprendre où va ton budget
        matières, repérer tes pertes, optimiser tes achats. Le coût est calculé avec le prix unitaire courant de
        chaque ingrédient.
      </div>

      {/* Detail par categorie -> ingredient */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }} /> Chargement...
        </div>
      ) : byCategory.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          Aucune consommation enregistrée pour {periodLabel}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {byCategory.map(cat => {
            const isOpen = expandedCats[cat.name] !== false;
            return (
              <div key={cat.name} style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden' }}>
                <button onClick={() => setExpandedCats(s => ({ ...s, [cat.name]: !isOpen }))}
                  style={{ width: '100%', padding: '10px 14px', background: 'var(--theme-bg-page)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <strong style={{ textTransform: 'capitalize' }}>{cat.name}</strong>
                  <span style={{ color: 'var(--theme-text-muted)' }}>({cat.ingredients.length} ingrédient{cat.ingredients.length > 1 ? 's' : ''})</span>
                  <div style={{ flex: 1 }} />
                  <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(cat.total)} DH</strong>
                  <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
                    {totalAll > 0 ? Math.round((cat.total / totalAll) * 100) : 0}%
                  </span>
                </button>
                {isOpen && (
                  <table className="odoo-table" style={{ margin: 0, borderTop: '1px solid var(--theme-bg-separator)' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }}>Ingrédient</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Qté sortie</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Coût unitaire</th>
                        <th style={{ textAlign: 'right', width: 120 }}>Production</th>
                        <th style={{ textAlign: 'right', width: 100 }}>Pertes</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Ajustements</th>
                        <th style={{ textAlign: 'right', width: 130 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.ingredients.map(ing => {
                        const prod = (ing.byType.production?.cost || 0) + (ing.byType.usage?.cost || 0);
                        const waste = ing.byType.waste?.cost || 0;
                        const adj = ing.byType.adjustment?.cost || 0;
                        return (
                          <tr key={ing.ingredient_id}>
                            <td>{ing.ingredient_name}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                              {ing.total_qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{ing.ingredient_unit}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>
                              {n(ing.unit_cost)}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: prod > 0 ? '#0e7c3a' : 'var(--theme-text-muted)' }}>
                              {prod > 0 ? n(prod) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: waste > 0 ? '#b71c1c' : 'var(--theme-text-muted)' }}>
                              {waste > 0 ? n(waste) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: adj > 0 ? '#6c757d' : 'var(--theme-text-muted)' }}>
                              {adj > 0 ? n(adj) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                              {n(ing.total_cost)} DH
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
