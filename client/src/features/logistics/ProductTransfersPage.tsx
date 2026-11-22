import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2, Check } from 'lucide-react';
import { productTransfersApi, type ProductTransfer } from '../../api/product-transfers.api';
import { storesApi } from '../../api/stores.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { getApiErrorMessage } from '../../utils/api-error';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, ListPanel, ListToolbar } from '../sales/ListTemplate';
import { TableFooter, EmptyState, NoResultState } from '../../components/ds';

// Transferts de produits finis entre sites (phase 7.4) : une pièce, deux mouvements.
export default function ProductTransfersPage() {
  const qc = useQueryClient();
  const { data: transfers = [] } = useQuery({ queryKey: ['product-transfers'], queryFn: () => productTransfersApi.list() });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: productsResp } = useQuery({ queryKey: ['products', 'all'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: Record<string, any>[] = productsResp?.data ?? productsResp ?? [];

  const [search, setSearch] = useState('');
  const month = new Date().toISOString().slice(0, 7);
  const kpis = useMemo(() => {
    const ofMonth = transfers.filter(t => String(t.transfer_date).slice(0, 7) === month);
    const routes = new Map<string, number>();
    for (const t of ofMonth) { const k = `${t.from_store_name} → ${t.to_store_name}`; routes.set(k, (routes.get(k) || 0) + 1); }
    const top = [...routes.entries()].sort((x, y) => y[1] - x[1])[0];
    return { month: ofMonth.length, lines: ofMonth.reduce((n, t) => n + (Number(t.item_count) || 0), 0), top, last: transfers[0]?.transfer_date };
  }, [transfers, month]);
  const q = search.trim().toLowerCase();
  const shown = q ? transfers.filter(t => [t.number, t.from_store_name, t.to_store_name].some(v => (v ?? '').toLowerCase().includes(q))) : transfers;

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
    <SalesPageShell icon={ArrowLeftRight} title="Transferts de produits" parent="Ventes" list
      summary={`${kpis.month} ce mois`}
      actions={!form && <button className="odoo-btn-primary" onClick={newForm} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau transfert</button>}>

      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Transferts ce mois" value={String(kpis.month)} sub={`${transfers.length} au total`} />
        <ListKpi label="Lignes transférées" value={String(kpis.lines)} sub="articles déplacés ce mois" />
        <ListKpi label="Trajet le plus fréquent" value={kpis.top ? String(kpis.top[1]) : '—'} sub={kpis.top ? kpis.top[0] : 'aucun ce mois'} />
        <ListKpi label="Dernier transfert" value={kpis.last ? String(kpis.last).slice(0, 10).split('-').reverse().join('/') : '—'} sub="date de la pièce" />
      </section>

      {form && (
        <section className="prj-panel" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label><span style={lab}>Site source<span className="ds-req" aria-hidden="true"> *</span></span>
              <select style={field} value={form.fromStoreId} onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}>
                <option value="">— Choisir —</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
              </select></label>
            <label><span style={lab}>Site destination<span className="ds-req" aria-hidden="true"> *</span></span>
              <select style={field} value={form.toStoreId} onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}>
                <option value="">— Choisir —</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
              </select></label>
          </div>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 2 }}><span style={lab}>Article</span>
                <SearchSelect value={l.productId} onChange={(id) => { const lines = [...form.lines]; lines[i] = { ...l, productId: id }; setForm({ ...form, lines }); }}
                  placeholder="— Choisir —" width="100%" size="md" ariaLabel="Article"
                  options={products.map(p => ({ id: String(p.id), label: p.name as string }))} /></label>
              <label style={{ width: 120 }}><span style={lab}>Quantité</span>
                <input type="number" style={field} value={l.quantity} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, quantity: e.target.value }; setForm({ ...form, lines }); }} /></label>
              <button type="button" className="odoo-btn-secondary" aria-label="Retirer la ligne" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
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
        </section>
      )}

      <ListToolbar search={search} onSearch={setSearch} placeholder="N° de transfert, site…" />
      {!shown.length ? (
        transfers.length
          ? <NoResultState onReset={() => setSearch('')} text="Aucun transfert ne correspond à la recherche." />
          : <EmptyState icon={ArrowLeftRight} title="Aucun transfert" text="« Nouveau transfert » pour déplacer des produits finis d'un site à un autre." />
      ) : (
        <ListPanel footer={<TableFooter note={<>{shown.length} transfert{shown.length > 1 ? 's' : ''}</>} />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Date</th><th>Source</th><th>Destination</th><th className="ds-num">Articles</th></tr></thead>
            <tbody>
              {shown.map((t: ProductTransfer) => (
                <tr key={t.id} style={{ cursor: 'default' }}>
                  <td><span className="ds-ref">{t.number}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{String(t.transfer_date).slice(0, 10).split('-').reverse().join('/')}</td>
                  <td>{t.from_store_name}</td>
                  <td>{t.to_store_name}</td>
                  <td className="ds-num">{t.item_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>
      )}
    </SalesPageShell>
  );
}
