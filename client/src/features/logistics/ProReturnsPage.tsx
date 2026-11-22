import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2, Plus, Trash2, Check } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { proReturnsApi, type ProReturn } from '../../api/pro-returns.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, ListPanel, ListToolbar, FilterChips } from '../sales/ListTemplate';
import { TableFooter, EmptyState, NoResultState } from '../../components/ds';

// Retours clients professionnels (phase 7.5) : décision remise en stock / rebut par ligne.
export default function ProReturnsPage() {
  const qc = useQueryClient();
  const { data: returns = [] } = useQuery({ queryKey: ['pro-returns'], queryFn: () => proReturnsApi.list() });
  const { data: customersResp } = useQuery({ queryKey: ['customers', 'pro'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers: Record<string, any>[] = customersResp?.data ?? customersResp ?? [];
  const { data: productsResp } = useQuery({ queryKey: ['products', 'all'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: Record<string, any>[] = productsResp?.data ?? productsResp ?? [];

  const [search, setSearch] = useState('');
  const [view, setView] = useState<'' | 'credited' | 'open'>('');
  const month = new Date().toISOString().slice(0, 7);
  const kpis = useMemo(() => ({
    month: returns.filter(r => String(r.return_date).slice(0, 7) === month).length,
    credited: returns.filter(r => r.credit_note_id).length,
    open: returns.filter(r => !r.credit_note_id).length,
    customers: new Set(returns.map(r => r.customer_id)).size,
    lines: returns.reduce((n, r) => n + (Number(r.item_count) || 0), 0),
  }), [returns, month]);
  const q = search.trim().toLowerCase();
  const shown = returns.filter(r => (!view || (view === 'credited' ? !!r.credit_note_id : !r.credit_note_id))
    && (!q || r.number.toLowerCase().includes(q) || (r.customer_name ?? '').toLowerCase().includes(q)));

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
    <SalesPageShell icon={Undo2} title="Retours clients" parent="Ventes" list
      summary={`${kpis.open} sans avoir`}
      actions={!form && <button className="odoo-btn-primary" onClick={newForm} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau retour</button>}>

      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Retours ce mois" value={String(kpis.month)} sub={`${returns.length} au total`} />
        <ListKpi label="Sans avoir" value={String(kpis.open)} sub="avoir à émettre" tone={kpis.open ? 'orange' : undefined} />
        <ListKpi label="Clients concernés" value={String(kpis.customers)} sub="au moins un retour" />
        <ListKpi label="Lignes retournées" value={String(kpis.lines)} sub="remises en stock ou rebutées" />
      </section>

      {form && (
        <section className="prj-panel" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <label><span style={lab}>Client<span className="ds-req" aria-hidden="true"> *</span></span>
            <SearchSelect value={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })}
              placeholder="— Choisir —" width="100%" size="md" ariaLabel="Client"
              options={customers.map(c => ({ id: String(c.id), label: `${c.first_name} ${c.last_name}${c.company_name ? ` (${c.company_name})` : ''}` }))} /></label>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 2 }}><span style={lab}>Article</span>
                <SearchSelect value={l.productId} onChange={(id) => { const lines = [...form.lines]; lines[i] = { ...l, productId: id }; setForm({ ...form, lines }); }}
                  placeholder="— Choisir —" width="100%" size="md" ariaLabel="Article"
                  options={products.map(pr => ({ id: String(pr.id), label: pr.name as string }))} /></label>
              <label style={{ width: 90 }}><span style={lab}>Qté</span>
                <input type="number" style={field} value={l.quantity} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, quantity: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <label style={{ width: 100 }}><span style={lab}>PU</span>
                <input type="number" style={field} value={l.unitPrice} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, unitPrice: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <label style={{ width: 150 }}><span style={lab}>Décision</span>
                <select style={field} value={l.decision} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, decision: e.target.value as 'restock' | 'scrap' }; setForm({ ...form, lines }); }}>
                  <option value="restock">Remise en stock</option>
                  <option value="scrap">Rebut</option>
                </select></label>
              <button type="button" className="odoo-btn-secondary" aria-label="Retirer la ligne" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
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
        </section>
      )}

      <FilterChips label="Filtrer les retours" value={view} onChange={k => setView(k as '' | 'credited' | 'open')} chips={[
        { key: '', label: 'Tous', count: returns.length },
        { key: 'open', label: 'Sans avoir', count: kpis.open },
        { key: 'credited', label: 'Avoir émis', count: kpis.credited },
      ]} />
      <ListToolbar search={search} onSearch={setSearch} placeholder="N° de retour, client…" />
      {!shown.length ? (
        returns.length
          ? <NoResultState onReset={() => { setView(''); setSearch(''); }} text="Aucun retour ne correspond aux filtres." />
          : <EmptyState icon={Undo2} title="Aucun retour client" text="« Nouveau retour » pour enregistrer une marchandise reprise à un client pro." />
      ) : (
        <ListPanel footer={<TableFooter note={<>{shown.length} retour{shown.length > 1 ? 's' : ''}</>} />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Date</th><th>Client</th><th className="ds-num">Lignes</th><th>Avoir</th></tr></thead>
            <tbody>
              {shown.map((r: ProReturn) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td><span className="ds-ref">{r.number}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{String(r.return_date).slice(0, 10).split('-').reverse().join('/')}</td>
                  <td className="ds-strong">{r.customer_name}</td>
                  <td className="ds-num">{r.item_count}</td>
                  <td>{r.credit_note_id ? <StatusTag tone="done" label="Émis" /> : <StatusTag tone="todo" label="À émettre" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>
      )}
    </SalesPageShell>
  );
}
