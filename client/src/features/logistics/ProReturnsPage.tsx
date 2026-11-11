import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2, Plus, Trash2, Check } from 'lucide-react';
import { proReturnsApi, type ProReturn } from '../../api/pro-returns.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import SalesPageShell from '../sales/SalesPageShell';

// Retours clients professionnels (phase 7.5) : décision remise en stock / rebut par ligne.
export default function ProReturnsPage() {
  const qc = useQueryClient();
  const { data: returns = [] } = useQuery({ queryKey: ['pro-returns'], queryFn: () => proReturnsApi.list() });
  const { data: customersResp } = useQuery({ queryKey: ['customers', 'pro'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers: Record<string, any>[] = customersResp?.data ?? customersResp ?? [];
  const { data: productsResp } = useQuery({ queryKey: ['products', 'all'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: Record<string, any>[] = productsResp?.data ?? productsResp ?? [];

  const [form, setForm] = useState<{ customerId: string; notes: string; lines: { productId: string; quantity: string; unitPrice: string; decision: 'restock' | 'scrap' }[] } | null>(null);

  const create = useMutation({
    mutationFn: () => proReturnsApi.create({
      customerId: form!.customerId, notes: form!.notes || undefined,
      items: form!.lines.filter(l => l.productId && Number(l.quantity) > 0).map(l => ({ productId: l.productId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) || 0, decision: l.decision })),
    }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['pro-returns'] }); setForm(null); notify.success(`Retour ${r.number} enregistré`); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec du retour')),
  });

  const field: React.CSSProperties = { padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', background: 'var(--odoo-bg)', width: '100%' };
  const lab: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'block', marginBottom: 2 };
  const newForm = () => setForm({ customerId: '', notes: '', lines: [{ productId: '', quantity: '', unitPrice: '', decision: 'restock' }] });

  return (
    <SalesPageShell icon={Undo2} title="Retours clients" parent="Ventes"
      actions={!form && <button className="odoo-btn-primary" onClick={newForm} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau retour</button>}>

      {form && (
        <div style={{ border: '1px solid var(--odoo-purple)', borderRadius: 6, padding: 14, marginBottom: 16, display: 'grid', gap: 10 }}>
          <label><span style={lab}>Client</span>
            <select style={field} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">— Choisir —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.company_name ? ` (${c.company_name})` : ''}</option>)}
            </select></label>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 2 }}><span style={lab}>Article</span>
                <select style={field} value={l.productId} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, productId: e.target.value }; setForm({ ...form, lines }); }}>
                  <option value="">— Choisir —</option>
                  {products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select></label>
              <label style={{ width: 90 }}><span style={lab}>Qté</span>
                <input type="number" style={field} value={l.quantity} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, quantity: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <label style={{ width: 100 }}><span style={lab}>PU</span>
                <input type="number" style={field} value={l.unitPrice} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, unitPrice: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <label style={{ width: 150 }}><span style={lab}>Décision</span>
                <select style={field} value={l.decision} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, decision: e.target.value as 'restock' | 'scrap' }; setForm({ ...form, lines }); }}>
                  <option value="restock">Remise en stock</option>
                  <option value="scrap">Rebut</option>
                </select></label>
              <button className="odoo-btn-secondary" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <button className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ ...form, lines: [...form.lines, { productId: '', quantity: '', unitPrice: '', decision: 'restock' }] })}><Plus size={12} /> Ligne</button>
          <label><span style={lab}>Notes</span><input style={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="odoo-btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              disabled={!form.customerId || !form.lines.some(l => l.productId && Number(l.quantity) > 0) || create.isPending}
              onClick={() => create.mutate()}><Check size={13} /> Enregistrer le retour</button>
          </div>
        </div>
      )}

      <table className="odoo-table" style={{ width: '100%' }}>
        <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Lignes</th><th>Avoir</th></tr></thead>
        <tbody>
          {returns.map((r: ProReturn) => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'ui-monospace, monospace' }}>{r.number}</td>
              <td>{r.return_date}</td>
              <td>{r.customer_name}</td>
              <td>{r.item_count}</td>
              <td>{r.credit_note_id ? 'oui' : '—'}</td>
            </tr>
          ))}
          {returns.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--odoo-text-muted)' }}>Aucun retour.</td></tr>}
        </tbody>
      </table>
    </SalesPageShell>
  );
}
