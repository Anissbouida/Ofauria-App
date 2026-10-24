import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, ShoppingCart, CheckCircle } from 'lucide-react';
import { inventoryApi } from '../../api/inventory.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { fmtQty, type InventoryItem } from './types';

/**
 * Onglet « À commander » : ingredients sous le seuil minimum (GET /inventory/alerts),
 * a cote des ruptures des bons de sortie. Un clic ajoute a la liste d'attente d'achat
 * la quantite qui ramene le stock a deux fois le seuil (au moins un seuil).
 */
export function LowStockOrderList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ordered, setOrdered] = useState<Set<string>>(new Set());
  const { data: alerts = [], isLoading } = useQuery<InventoryItem[]>({ queryKey: ['inventory-alerts'], queryFn: inventoryApi.alerts });

  const orderMutation = useMutation({
    mutationFn: (item: InventoryItem) => {
      const current = parseFloat(item.current_quantity) || 0;
      const threshold = parseFloat(item.minimum_threshold) || 0;
      const quantity = Math.max(threshold, threshold * 2 - current);
      return purchaseRequestsApi.create({
        ingredientId: item.ingredient_id, quantity, unit: item.unit || 'kg',
        reason: 'stock_bas', note: `Stock bas : ${fmtQty(current)} ${item.unit} (seuil ${fmtQty(threshold)})`, supplierId: null,
      });
    },
    onSuccess: (_d, item) => {
      setOrdered(prev => new Set(prev).add(item.ingredient_id));
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success(`${item.ingredient_name} ajouté à la liste d'attente d'achat`);
    },
    onError: (e: unknown) => notify.error(apiErrorMessage(e, "Erreur ajout liste d'attente")),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
      </div>
    );
  }
  if (alerts.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <CheckCircle size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun ingrédient sous son seuil minimum.</p>
      </div>
    );
  }

  return (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <AlertTriangle size={12} /> Stock bas ({alerts.length})
        <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)', marginLeft: 6 }}>seuil minimum franchi, toutes zones confondues</span>
      </div>
      <table className="odoo-table">
        <thead>
          <tr>
            <th>Ingrédient</th>
            <th style={{ textAlign: 'right' }}>Stock</th>
            <th style={{ textAlign: 'right' }}>Seuil</th>
            <th style={{ textAlign: 'right' }}>À commander</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map(item => {
            const current = parseFloat(item.current_quantity) || 0;
            const threshold = parseFloat(item.minimum_threshold) || 0;
            const suggested = Math.max(threshold, threshold * 2 - current);
            const done = ordered.has(item.ingredient_id);
            const pending = orderMutation.isPending && orderMutation.variables?.ingredient_id === item.ingredient_id;
            return (
              <tr key={item.ingredient_id} className={current <= 0 ? 'row-danger' : 'row-warning'}
                onClick={() => navigate(`/stock/${item.ingredient_id}`)}>
                <td style={{ fontWeight: 500 }}>{item.ingredient_name}</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: current <= 0 ? '#dc3545' : '#b85d1a' }}>{fmtQty(current)} {item.unit}</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{fmtQty(threshold)} {item.unit}</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{fmtQty(suggested)} {item.unit}</td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  {done ? (
                    <span className="odoo-tag odoo-tag-green"><CheckCircle size={10} /> Commandé</span>
                  ) : (
                    <button type="button" className="odoo-btn-primary" disabled={pending} onClick={() => orderMutation.mutate(item)}
                      title={`Ajouter ${fmtQty(suggested)} ${item.unit} à la liste d'attente d'achat`}>
                      {pending ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />} Commander
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
