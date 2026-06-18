import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Download, Loader2, ChevronDown, ChevronRight, Factory, Trash2, Sliders,
  ShoppingCart, FileText, PackagePlus, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';
import { inventoryApi } from '../../api/inventory.api';

/**
 * Deux vues complementaires sur les matieres, basculables :
 *
 *  - SORTIES (consommation) : matieres physiquement sorties du stock
 *    (production/usage, pertes, ajustements), valorisees au cout courant.
 *    Source : inventory_transactions (quantity_change < 0).
 *
 *  - ENTREES (achats) : matiere premiere achetee/receptionnee via bon de
 *    commande ou achat direct, valorisee au prix de reception. Repond a
 *    "combien ai-je depense en matiere premiere sur la periode".
 *    Source : ingredient_lots (+ packaging_stock_transactions pour emballages).
 *
 * Periode : mois courant par defaut, ou plage personnalisee.
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

type PurchaseRow = {
  item_id: string;
  item_name: string;
  item_unit: string;
  category_label: string;
  kind: 'ingredient' | 'packaging';
  source: 'bon_commande' | 'achat_direct';
  lot_count: number;
  qty_received: string;
  unit_cost: string | null;
  amount: string;
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
  const [view, setView] = useState<'sorties' | 'entrees'>('entrees');
  const [periodMode, setPeriodMode] = useState<'mois' | 'custom'>('mois');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [customTo, setCustomTo] = useState(
    format(now, 'yyyy-MM-dd')
  );
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  // Plage effective selon le mode periode
  const { dateFrom, dateTo, periodLabel, fileSuffix } = useMemo(() => {
    if (periodMode === 'custom') {
      return {
        dateFrom: customFrom,
        dateTo: customTo,
        periodLabel: `du ${format(new Date(customFrom), 'dd/MM/yyyy')} au ${format(new Date(customTo), 'dd/MM/yyyy')}`,
        fileSuffix: `${customFrom}_${customTo}`,
      };
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
      dateTo: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      periodLabel: format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: fr }),
      fileSuffix: `${year}-${String(month).padStart(2, '0')}`,
    };
  }, [periodMode, customFrom, customTo, year, month]);

  // ─── Vue SORTIES (consommation) ────────────────────────────────────────
  const { data: consRows = [], isLoading: consLoading } = useQuery({
    queryKey: ['inventory-consumption', dateFrom, dateTo],
    queryFn: () => inventoryApi.consumption({ dateFrom, dateTo }),
    enabled: view === 'sorties',
  });
  const consData = consRows as ConsumptionRow[];

  const totalsByType = useMemo(() => {
    const acc: Record<string, { qty_count: number; cost: number }> = {
      production: { qty_count: 0, cost: 0 },
      waste: { qty_count: 0, cost: 0 },
      adjustment: { qty_count: 0, cost: 0 },
    };
    consData.forEach(r => {
      const key = r.movement_type === 'usage' ? 'production' : r.movement_type;
      if (!acc[key]) return;
      acc[key].qty_count += 1;
      acc[key].cost += parseFloat(r.cost_consumed) || 0;
    });
    return acc;
  }, [consData]);

  const consTotalAll = useMemo(
    () => Object.values(totalsByType).reduce((s, t) => s + t.cost, 0),
    [totalsByType]
  );

  const consByCategory = useMemo(() => {
    const ingMap = new Map<string, IngredientSummary>();
    consData.forEach(r => {
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
  }, [consData]);

  // ─── Vue ENTREES (achats) ──────────────────────────────────────────────
  const { data: purchRows = [], isLoading: purchLoading } = useQuery({
    queryKey: ['inventory-purchases', dateFrom, dateTo],
    queryFn: () => inventoryApi.purchases({ dateFrom, dateTo }),
    enabled: view === 'entrees',
  });
  const purchData = purchRows as PurchaseRow[];

  const purchTotals = useMemo(() => {
    const acc = { total: 0, bon_commande: 0, achat_direct: 0 };
    purchData.forEach(r => {
      const amt = parseFloat(r.amount) || 0;
      acc.total += amt;
      acc[r.source] += amt;
    });
    return acc;
  }, [purchData]);

  const purchByCategory = useMemo(() => {
    const itemMap = new Map<string, IngredientSummary>();
    purchData.forEach(r => {
      const qty = parseFloat(r.qty_received) || 0;
      const cost = parseFloat(r.amount) || 0;
      const existing = itemMap.get(r.item_id);
      if (existing) {
        existing.total_qty += qty;
        existing.total_cost += cost;
        if (!existing.byType[r.source]) existing.byType[r.source] = { qty: 0, cost: 0 };
        existing.byType[r.source].qty += qty;
        existing.byType[r.source].cost += cost;
        // cout unitaire moyen pondere
        existing.unit_cost = existing.total_qty > 0 ? existing.total_cost / existing.total_qty : 0;
      } else {
        itemMap.set(r.item_id, {
          ingredient_id: r.item_id,
          ingredient_name: r.item_name,
          ingredient_unit: r.item_unit,
          ingredient_category: r.category_label || 'autre',
          unit_cost: qty > 0 ? cost / qty : (parseFloat(r.unit_cost || '0') || 0),
          total_qty: qty,
          total_cost: cost,
          byType: { [r.source]: { qty, cost } },
        });
      }
    });

    const cats = new Map<string, { name: string; total: number; ingredients: IngredientSummary[] }>();
    for (const it of itemMap.values()) {
      const cat = it.ingredient_category;
      if (!cats.has(cat)) cats.set(cat, { name: cat, total: 0, ingredients: [] });
      const c = cats.get(cat)!;
      c.total += it.total_cost;
      c.ingredients.push(it);
    }
    for (const c of cats.values()) {
      c.ingredients.sort((a, b) => b.total_cost - a.total_cost);
    }
    return Array.from(cats.values()).sort((a, b) => b.total - a.total);
  }, [purchData]);

  // ─── Export CSV (selon vue) ────────────────────────────────────────────
  const handleExport = () => {
    if (view === 'entrees') {
      const headers = ['Categorie', 'Article', 'Unite', 'Qte recue', 'Cout unitaire moyen', 'Via bon de commande', 'Achat direct', 'Montant total'];
      const rowsCsv: string[][] = [];
      purchByCategory.forEach(cat => {
        cat.ingredients.forEach(it => {
          rowsCsv.push([
            it.ingredient_category,
            it.ingredient_name,
            it.ingredient_unit,
            it.total_qty.toFixed(3),
            it.unit_cost.toFixed(2),
            (it.byType.bon_commande?.cost || 0).toFixed(2),
            (it.byType.achat_direct?.cost || 0).toFixed(2),
            it.total_cost.toFixed(2),
          ]);
        });
      });
      exportCSV(`achats-matieres-${fileSuffix}.csv`, headers, rowsCsv);
      return;
    }
    const headers = ['Categorie', 'Ingredient', 'Unite', 'Qte sortie', 'Cout unitaire', 'Cout total', 'Production', 'Perte', 'Ajustement'];
    const rowsCsv: string[][] = [];
    consByCategory.forEach(cat => {
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
    exportCSV(`consommation-${fileSuffix}.csv`, headers, rowsCsv);
  };

  const isLoading = view === 'entrees' ? purchLoading : consLoading;
  const byCategory = view === 'entrees' ? purchByCategory : consByCategory;
  const grandTotal = view === 'entrees' ? purchTotals.total : consTotalAll;
  const rowCount = view === 'entrees' ? purchData.length : consData.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Bascule Sorties / Entrees */}
      <div style={{ display: 'inline-flex', gap: 0, border: '1px solid var(--theme-bg-separator)', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
        <button
          onClick={() => setView('entrees')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', cursor: 'pointer',
            fontSize: '0.8125rem', fontWeight: 600,
            background: view === 'entrees' ? 'var(--theme-accent)' : 'var(--theme-bg-card)',
            color: view === 'entrees' ? '#fff' : 'var(--theme-text)',
          }}>
          <ArrowDownToLine size={14} /> Entrées (achats)
        </button>
        <button
          onClick={() => setView('sorties')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', cursor: 'pointer',
            fontSize: '0.8125rem', fontWeight: 600, borderLeft: '1px solid var(--theme-bg-separator)',
            background: view === 'sorties' ? 'var(--theme-accent)' : 'var(--theme-bg-card)',
            color: view === 'sorties' ? '#fff' : 'var(--theme-text)',
          }}>
          <ArrowUpFromLine size={14} /> Sorties (consommation)
        </button>
      </div>

      {/* Header : selecteur periode + export */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={periodMode} onChange={e => setPeriodMode(e.target.value as 'mois' | 'custom')}
          className="odoo-input" style={{ width: 150 }}>
          <option value="mois">Par mois</option>
          <option value="custom">Période personnalisée</option>
        </select>
        {periodMode === 'mois' ? (
          <>
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
          </>
        ) : (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              className="odoo-input" style={{ width: 150 }} />
            <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
            <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)}
              className="odoo-input" style={{ width: 150 }} />
          </>
        )}
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          Période : <strong style={{ textTransform: 'capitalize' }}>{periodLabel}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} disabled={rowCount === 0}
          className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {/* Bandeau totaux */}
      {view === 'entrees' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ShoppingCart size={11} /> Total acheté
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--theme-accent)', marginTop: 4 }}>{n(purchTotals.total)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{purchData.length} ligne{purchData.length > 1 ? 's' : ''}</div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #cfe2ff', background: '#f0f6ff' }}>
            <div style={{ fontSize: '0.6875rem', color: '#0a58ca', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={11} /> Via bons de commande
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0a58ca', marginTop: 4 }}>{n(purchTotals.bon_commande)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {purchTotals.total > 0 ? Math.round((purchTotals.bon_commande / purchTotals.total) * 100) : 0}% du total
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #ffe5b4', background: '#fff8ec' }}>
            <div style={{ fontSize: '0.6875rem', color: '#b26a00', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <PackagePlus size={11} /> Achat direct
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b26a00', marginTop: 4 }}>{n(purchTotals.achat_direct)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {purchTotals.total > 0 ? Math.round((purchTotals.achat_direct / purchTotals.total) * 100) : 0}% du total
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total consommé</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--theme-accent)', marginTop: 4 }}>{n(consTotalAll)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{consData.length} mouvements</div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #d4edda', background: '#f0f9f4' }}>
            <div style={{ fontSize: '0.6875rem', color: '#0e7c3a', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Factory size={11} /> Production
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0e7c3a', marginTop: 4 }}>{n(totalsByType.production.cost)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {consTotalAll > 0 ? Math.round((totalsByType.production.cost / consTotalAll) * 100) : 0}% du total
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #f5c6cb', background: '#fff5f5' }}>
            <div style={{ fontSize: '0.6875rem', color: '#b71c1c', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={11} /> Pertes
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b71c1c', marginTop: 4 }}>{n(totalsByType.waste.cost)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {consTotalAll > 0 ? Math.round((totalsByType.waste.cost / consTotalAll) * 100) : 0}% du total
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 4, border: '1px solid #e9ecef', background: '#f8f9fa' }}>
            <div style={{ fontSize: '0.6875rem', color: '#6c757d', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Sliders size={11} /> Ajustements
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6c757d', marginTop: 4 }}>{n(totalsByType.adjustment.cost)} DH</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {consTotalAll > 0 ? Math.round((totalsByType.adjustment.cost / consTotalAll) * 100) : 0}% du total
            </div>
          </div>
        </div>
      )}

      {/* Note explicative */}
      {view === 'entrees' ? (
        <div className="odoo-alert" style={{ fontSize: '0.75rem' }}>
          <strong>Vue achats (entrées de stock) :</strong> matière première <strong>achetée et réceptionnée</strong> sur
          la période, via <strong>bon de commande</strong> ou <strong>achat direct</strong>, valorisée au <strong>prix de
          réception</strong>. Permet de connaître le montant réellement dépensé en matières par mois ou période.
          Les emballages n'apparaissent que pour les mouvements de stock saisis (la réception automatique d'emballages
          par bon de commande n'est pas encore branchée).
        </div>
      ) : (
        <div className="odoo-alert" style={{ fontSize: '0.75rem' }}>
          <strong>Vue stock (pas trésorerie) :</strong> cette vue montre les matières <strong>physiquement consommées</strong>
          (sorties de stock). Indépendante du paiement des fournisseurs. Utile pour comprendre où va ton budget
          matières, repérer tes pertes, optimiser tes achats. Le coût est calculé avec le prix unitaire courant de
          chaque ingrédient.
        </div>
      )}

      {/* Detail par categorie -> article */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }} /> Chargement...
        </div>
      ) : byCategory.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          {view === 'entrees'
            ? `Aucun achat de matière première enregistré pour ${periodLabel}.`
            : `Aucune consommation enregistrée pour ${periodLabel}.`}
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
                  <span style={{ color: 'var(--theme-text-muted)' }}>({cat.ingredients.length} article{cat.ingredients.length > 1 ? 's' : ''})</span>
                  <div style={{ flex: 1 }} />
                  <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(cat.total)} DH</strong>
                  <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
                    {grandTotal > 0 ? Math.round((cat.total / grandTotal) * 100) : 0}%
                  </span>
                </button>
                {isOpen && (view === 'entrees' ? (
                  <table className="odoo-table" style={{ margin: 0, borderTop: '1px solid var(--theme-bg-separator)' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }}>Article</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Qté reçue</th>
                        <th style={{ textAlign: 'right', width: 130 }}>Coût unitaire moy.</th>
                        <th style={{ textAlign: 'right', width: 130 }}>Via bon commande</th>
                        <th style={{ textAlign: 'right', width: 120 }}>Achat direct</th>
                        <th style={{ textAlign: 'right', width: 130 }}>Montant total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.ingredients.map(it => {
                        const bc = it.byType.bon_commande?.cost || 0;
                        const direct = it.byType.achat_direct?.cost || 0;
                        return (
                          <tr key={it.ingredient_id}>
                            <td>{it.ingredient_name}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                              {it.total_qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{it.ingredient_unit}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>
                              {n(it.unit_cost)}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: bc > 0 ? '#0a58ca' : 'var(--theme-text-muted)' }}>
                              {bc > 0 ? n(bc) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: direct > 0 ? '#b26a00' : 'var(--theme-text-muted)' }}>
                              {direct > 0 ? n(direct) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                              {n(it.total_cost)} DH
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
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
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
