import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { productTransfersApi, type ProductTransfer } from '../../api/product-transfers.api';
import { storesApi } from '../../api/stores.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { getApiErrorMessage } from '../../utils/api-error';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, ListToolbar } from '../sales/ListTemplate';
import { TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

// Transferts de produits finis entre sites (phase 7.4) : une pièce, deux mouvements.
export default function ProductTransfersPage() {
  const qc = useQueryClient();
  const { data: transfers = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['product-transfers'], queryFn: () => productTransfersApi.list() });
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
        <Modal title="Nouveau transfert" onClose={() => setForm(null)} width={640} locked={create.isPending}
          footer={<FormFooter onCancel={() => setForm(null)} onSubmit={() => create.mutate()} submitLabel="Valider le transfert"
            disabled={!form.fromStoreId || !form.toStoreId || form.fromStoreId === form.toStoreId || !form.lines.some(l => l.productId && Number(l.quantity) > 0)} busy={create.isPending} />}>
          <FormSection title="Trajet">
            <div className="ds-form-grid">
              <FormField label="Site source" htmlFor="tr-from" required>
                <select id="tr-from" className="ds-input" value={form.fromStoreId} onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
                </select>
              </FormField>
              <FormField label="Site destination" htmlFor="tr-to" required
                error={form.toStoreId && form.fromStoreId === form.toStoreId ? 'La destination doit différer de la source.' : undefined}>
                <select id="tr-to" className="ds-input" value={form.toStoreId} onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}{s.kind === 'warehouse' ? ' (dépôt)' : ''}</option>)}
                </select>
              </FormField>
            </div>
          </FormSection>
          <FormSection title="Articles">
            <DataPanel label="Articles transférés">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Article</th><th className="ds-num" style={{ width: 120 }}>Quantité</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td><SearchSelect value={l.productId} onChange={(id) => { const lines = [...form.lines]; lines[i] = { ...l, productId: id }; setForm({ ...form, lines }); }}
                        placeholder="— Choisir —" width="100%" ariaLabel="Article"
                        options={products.map(p => ({ id: String(p.id), label: p.name as string }))} /></td>
                      <td><input type="number" aria-label="Quantité" className="ds-input sm" style={{ textAlign: 'right' }} value={l.quantity} onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, quantity: e.target.value }; setForm({ ...form, lines }); }} /></td>
                      <td><button type="button" className="odoo-pager-btn" aria-label="Retirer la ligne" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
            <button type="button" className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ ...form, lines: [...form.lines, { productId: '', quantity: '' }] })}><Plus size={12} /> Ligne</button>
          </FormSection>
          <FormField label="Notes" htmlFor="tr-notes">
            <input id="tr-notes" className="ds-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
        </Modal>
      )}

      <ListToolbar search={search} onSearch={setSearch} placeholder="N° de transfert, site…" />
      {isLoading ? <LoadingState label="Chargement des transferts…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !shown.length ? (
        transfers.length
          ? <NoResultState onReset={() => setSearch('')} text="Aucun transfert ne correspond à la recherche." />
          : <EmptyState icon={ArrowLeftRight} title="Aucun transfert" text="« Nouveau transfert » pour déplacer des produits finis d'un site à un autre." />
      ) : (
        <DataPanel label="Transferts" footer={<TableFooter note={<>{shown.length} transfert{shown.length > 1 ? 's' : ''}</>} />}>
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
        </DataPanel>
      )}
    </SalesPageShell>
  );
}
