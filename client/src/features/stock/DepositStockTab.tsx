import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PackagePlus, PackageMinus, Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { customersApi } from '../../api/customers.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, EmptyState, FormField, FormFooter, FormSection, LoadingState, Modal, TableFooter } from '../../components/ds';

/**
 * Stock › Déposants (mig 719 ; maquette « Stock-Transport-Mouvement »). Marchandise détenue
 * pour le compte de clients : registre séparé, hors inventaire, valeur et consommation.
 */
type Article = { id: string; customer_id: string; customer_name: string; code: string; label: string; unit: string; quantity: number };
type StockRow = { article_id: string; customer_name: string; code: string; label: string; unit: string; lot_number: string | null; expiration_date: string | null; quantity: number };
type Move = { id: string; kind: 'in' | 'out'; quantity: number; code: string; label: string; unit: string; lot_number: string | null; reference: string | null; customer_name: string; moved_at: string };
type Line = { articleId: string; quantity: string; lotNumber: string; expirationDate: string };

const dep = {
  articles: (customerId?: string): Promise<Article[]> => api.get('/deposit-stock/articles', { params: customerId ? { customerId } : {} }).then(r => r.data.data),
  stock: (customerId?: string): Promise<StockRow[]> => api.get('/deposit-stock/stock', { params: customerId ? { customerId } : {} }).then(r => r.data.data),
  movements: (customerId?: string): Promise<Move[]> => api.get('/deposit-stock/movements', { params: customerId ? { customerId } : {} }).then(r => r.data.data),
  createArticle: (a: { customerId: string; code: string; label: string; unit: string }) => api.post('/deposit-stock/articles', a).then(r => r.data.data),
  move: (kind: 'receive' | 'ship', d: { reference: string; lines: { articleId: string; quantity: number; lotNumber: string | null; expirationDate: string | null }[] }) =>
    api.post(`/deposit-stock/${kind}`, d).then(r => r.data.data),
};

const qty = (n: number, unit: string) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${unit}`;
const arr = <T,>(resp: unknown): T[] => (Array.isArray(resp) ? resp as T[] : ((resp as { data?: T[] })?.data ?? []));

export default function DepositStockTab() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list() });
  const customers = arr<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>(customersRaw);
  const name = (c: { company_name: string | null; first_name: string | null; last_name: string | null }) => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
  const cid = customerId || undefined;
  const articles = useQuery({ queryKey: ['deposit', 'articles', cid], queryFn: () => dep.articles(cid) });
  const stock = useQuery({ queryKey: ['deposit', 'stock', cid], queryFn: () => dep.stock(cid) });
  const moves = useQuery({ queryKey: ['deposit', 'moves', cid], queryFn: () => dep.movements(cid) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['deposit'] });
  const [form, setForm] = useState<null | 'receive' | 'ship' | 'article'>(null);

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
        <FormField label="Client déposant">
          <SearchSelect value={customerId} onChange={setCustomerId} placeholder="Tous les déposants" width={280} size="md" ariaLabel="Client déposant"
            options={[{ id: '', label: 'Tous les déposants' }, ...customers.map(c => ({ id: String(c.id), label: name(c) }))]} />
        </FormField>
        <span style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-secondary" onClick={() => setForm('article')}><Plus size={14} /> Article</button>
        <button type="button" className="odoo-btn-secondary" onClick={() => setForm('ship')} disabled={!stock.data?.length}><PackageMinus size={14} /> Expédier</button>
        <button type="button" className="odoo-btn-primary" onClick={() => setForm('receive')} disabled={!articles.data?.length}><PackagePlus size={14} /> Réceptionner</button>
      </div>
      <p className="prj-note">Cette marchandise appartient aux clients : elle n'entre ni dans le stock, ni dans la valeur, ni dans la consommation de la société.</p>

      {stock.isLoading ? <LoadingState label="Chargement du stock des déposants…" /> : !stock.data?.length ? (
        <EmptyState icon={Boxes} title="Aucun stock en dépôt" text="Créez les articles d'un client, puis enregistrez sa réception à quai." />
      ) : (
        <DataPanel label="Stock par lot" footer={<TableFooter note={`${stock.data.length} ligne${stock.data.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Client</th><th>Article</th><th>Lot</th><th>Péremption</th><th className="ds-num">Quantité</th></tr></thead>
            <tbody>{stock.data.map((r, i) => (
              <tr key={`${r.article_id}-${r.lot_number ?? ''}-${i}`}>
                <td>{r.customer_name}</td><td><span className="ds-strong">{r.code}</span> {r.label}</td><td>{r.lot_number ?? '—'}</td>
                <td>{r.expiration_date ? new Date(r.expiration_date).toLocaleDateString('fr-FR') : '—'}</td>
                <td className="ds-num ds-strong">{qty(r.quantity, r.unit)}</td>
              </tr>))}</tbody>
          </table>
        </DataPanel>
      )}

      {!!moves.data?.length && (
        <DataPanel label="Derniers mouvements">
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Sens</th><th>Client</th><th>Article</th><th>Lot</th><th>Référence</th><th className="ds-num">Quantité</th></tr></thead>
            <tbody>{moves.data.slice(0, 30).map(m => (
              <tr key={m.id}>
                <td>{new Date(m.moved_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{m.kind === 'in' ? 'Réception' : 'Expédition'}</td><td>{m.customer_name}</td>
                <td>{m.code} {m.label}</td><td>{m.lot_number ?? '—'}</td><td>{m.reference ?? '—'}</td>
                <td className="ds-num">{m.kind === 'in' ? '+' : '−'} {qty(m.quantity, m.unit)}</td>
              </tr>))}</tbody>
          </table>
        </DataPanel>
      )}

      {form === 'article' && <ArticleForm customers={customers.map(c => ({ id: String(c.id), label: name(c) }))} initialCustomer={customerId}
        onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
      {(form === 'receive' || form === 'ship') && <MoveForm kind={form} articles={articles.data ?? []} stock={stock.data ?? []}
        onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
    </>
  );
}

function ArticleForm({ customers, initialCustomer, onClose, onSaved }: { customers: { id: string; label: string }[]; initialCustomer: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ customerId: initialCustomer, code: '', label: '', unit: 'colis' });
  const save = useMutation({ mutationFn: () => dep.createArticle(f), onSuccess: () => { notify.success('Article créé'); onSaved(); }, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <Modal title="Nouvel article d'un déposant" onClose={onClose} width={520} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} submitLabel="Créer" disabled={!f.customerId || !f.code.trim() || !f.label.trim()} busy={save.isPending} />}>
      <FormField label="Client déposant" required>
        <SearchSelect value={f.customerId} onChange={v => setF({ ...f, customerId: v })} placeholder="Client…" width="100%" size="md" ariaLabel="Client déposant" options={customers} />
      </FormField>
      <div className="ds-form-grid">
        <FormField label="Code" htmlFor="dep-code" required><input id="dep-code" className="ds-input" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></FormField>
        <FormField label="Unité" htmlFor="dep-unit"><input id="dep-unit" className="ds-input" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></FormField>
      </div>
      <FormField label="Désignation" htmlFor="dep-label" required><input id="dep-label" className="ds-input" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></FormField>
    </Modal>
  );
}

function MoveForm({ kind, articles, stock, onClose, onSaved }: { kind: 'receive' | 'ship'; articles: Article[]; stock: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([{ articleId: '', quantity: '', lotNumber: '', expirationDate: '' }]);
  const options = useMemo(() => (kind === 'receive' ? articles : articles.filter(a => a.quantity > 0))
    .map(a => ({ id: a.id, label: `${a.customer_name} · ${a.code} ${a.label}` })), [kind, articles]);
  const lotsOf = (articleId: string) => stock.filter(s => s.article_id === articleId);
  const save = useMutation({
    mutationFn: () => dep.move(kind, { reference, lines: lines.filter(l => l.articleId).map(l => ({ articleId: l.articleId, quantity: Number(l.quantity), lotNumber: l.lotNumber || null, expirationDate: l.expirationDate || null })) }),
    onSuccess: () => { notify.success(kind === 'receive' ? 'Réception enregistrée' : 'Expédition enregistrée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  // Expédition : le premier lot disponible est proposé dès que l'article est choisi.
  const pickArticle = (i: number, v: string) => set(i, { articleId: v, lotNumber: kind === 'ship' ? (lotsOf(v)[0]?.lot_number ?? '') : '' });
  const valid = lines.some(l => l.articleId) && lines.filter(l => l.articleId).every(l => Number(l.quantity) > 0);
  return (
    <Modal title={kind === 'receive' ? 'Réception à quai' : 'Expédition pour le client'} onClose={onClose} width={760} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} submitLabel="Enregistrer" disabled={!valid} busy={save.isPending} />}>
      <FormField label={kind === 'receive' ? 'Référence (lettre de voiture, bon du client)' : 'Référence (bon de livraison)'} htmlFor="dep-ref">
        <input id="dep-ref" className="ds-input" value={reference} onChange={e => setReference(e.target.value)} />
      </FormField>
      <FormSection title="Lignes">
        <table className="odoo-table">
          <thead><tr><th>Article</th><th>Lot</th>{kind === 'receive' && <th>Péremption</th>}<th>Quantité</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td style={{ minWidth: 240 }}><SearchSelect value={l.articleId} onChange={v => pickArticle(i, v)} placeholder="Article…" width="100%" size="md" ariaLabel={`Article, ligne ${i + 1}`} options={options} /></td>
              <td>{kind === 'ship'
                ? <select className="ds-input sm" aria-label={`Lot, ligne ${i + 1}`} value={l.lotNumber} onChange={e => set(i, { lotNumber: e.target.value })}>
                    {lotsOf(l.articleId).map(s => <option key={s.lot_number ?? ''} value={s.lot_number ?? ''}>{s.lot_number ?? 'Sans lot'} ({qty(s.quantity, s.unit)})</option>)}
                  </select>
                : <input className="ds-input sm" aria-label={`Lot, ligne ${i + 1}`} value={l.lotNumber} onChange={e => set(i, { lotNumber: e.target.value })} />}</td>
              {kind === 'receive' && <td><input className="ds-input sm" type="date" aria-label={`Péremption, ligne ${i + 1}`} value={l.expirationDate} onChange={e => set(i, { expirationDate: e.target.value })} /></td>}
              <td><input className="ds-input sm" type="number" min={0} aria-label={`Quantité, ligne ${i + 1}`} value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} style={{ width: 100 }} /></td>
              <td><button type="button" className="odoo-btn-secondary ds-btn-sm" aria-label={`Retirer la ligne ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
            </tr>))}</tbody>
        </table>
        <button type="button" className="odoo-btn-secondary ds-btn-sm" style={{ marginTop: 8 }} onClick={() => setLines([...lines, { articleId: '', quantity: '', lotNumber: '', expirationDate: '' }])}><Plus size={13} /> Ajouter une ligne</button>
      </FormSection>
    </Modal>
  );
}
