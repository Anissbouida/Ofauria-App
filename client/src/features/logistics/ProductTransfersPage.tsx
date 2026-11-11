import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2, Check } from 'lucide-react';
import { productTransfersApi, type ProductTransfer } from '../../api/product-transfers.api';
import { storesApi } from '../../api/stores.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';

// Transferts de produits finis entre sites (phase 7.4) : une pièce, deux mouvements.
export default function ProductTransfersPage() {
  const qc = useQueryClient();
  const { data: transfers = [] } = useQuery({ queryKey: ['product-transfers'], queryFn: () => productTransfersApi.list() });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: productsResp } = useQuery({ queryKey: ['products', 'all'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: Record<string, any>[] = productsResp?.data ?? productsResp ?? [];

  const [form, setForm] = useState<{ fromStoreId: string; toStoreId: string; notes: string; lines: { productId: string; quantity: string }[] } | null>(null);

  const create = useMutation({
    mutationFn: () => productTransfersApi.create({
      fromStoreId: form!.fromStoreId, toStoreId: form!.toStoreId, notes: form!.notes || undefined,
      items: form!.lines.filter(l => l.productId && Number(l.quantity) > 0).map(l => ({ productId: l.productId, quantity: Number(l.quantity) })),
    }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['product-transfers'] }); setForm(null); notify.success(`Transfert ${t.number} enregistré`); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec du transfert')),
  });

  const field: React.CSSProperties = { padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', background: 'var(--odoo-bg)', width: '100%' };
  const lab: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'block', marginBottom: 2 };
  const newForm = () => setForm({ fromStoreId: '', toStoreId: '', notes: '', lines: [{ productId: '', quantity: '' }] });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}><ArrowLeftRight size={18} /> Transferts de produits</h2>
        {!form && <button className="odoo-btn-primary" onClick={newForm} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau transfert</button>}
      </div>

      {form && (
        <div style={{ border: '1px solid var(--odoo-purple)', borderRadius: 6, padding: 14, marginBottom: 16, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label><span style={lab}>Site source</span>
              <select style={field} value={form.fromStoreId} onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}>
                <option value="">— Choisir —</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
              </select></label>
            <label><span style={lab}>Site destination</span>
              <select style={field} value={form.toStoreId} onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}>
                <option value="">— Choisir —</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
              </select></label>
          </div>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 2 }}><span style={lab}>Article</span>
                <select style={field} value={l.productId} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, productId: e.target.value }; setForm({ ...form, lines }); }}>
                  <option value="">— Choisir —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label style={{ width: 120 }}><span style={lab}>Quantité</span>
                <input type="number" style={field} value={l.quantity} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, quantity: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <button className="odoo-btn-secondary" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <button className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ ...form, lines: [...form.lines, { productId: '', quantity: '' }] })}><Plus size={12} /> Ligne</button>
          <label><span style={lab}>Notes</span><input style={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="odoo-btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              disabled={!form.fromStoreId || !form.toStoreId || form.fromStoreId === form.toStoreId || !form.lines.some(l => l.productId && Number(l.quantity) > 0) || create.isPending}
              onClick={() => create.mutate()}><Check size={13} /> Valider le transfert</button>
          </div>
        </div>
      )}

      <table className="odoo-table" style={{ width: '100%' }}>
        <thead><tr><th>N°</th><th>Date</th><th>Source</th><th>Destination</th><th>Articles</th></tr></thead>
        <tbody>
          {transfers.map((t: ProductTransfer) => (
            <tr key={t.id}>
              <td style={{ fontFamily: 'ui-monospace, monospace' }}>{t.number}</td>
              <td>{t.transfer_date}</td>
              <td>{t.from_store_name}</td>
              <td>{t.to_store_name}</td>
              <td>{t.item_count}</td>
            </tr>
          ))}
          {transfers.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--odoo-text-muted)' }}>Aucun transfert.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
