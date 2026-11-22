import { money, currencySymbol } from '../../utils/money';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Handshake, Plus, Lock, Archive } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { salesContractsApi, type SalesContract, type CreateContractInput } from '../../api/sales-contracts.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { FilterChips, NextStep, ListKpi } from './ListTemplate';
import { TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/**
 * Ventes › Contrats-cadres (phase 11, D3-37). Engagement de volume (quantité
 * d'un article) ou de valeur (montant) sur une période, consommé par des appels
 * (commandes rattachées). La page crée les contrats et montre le consommé /
 * restant ; le rattachement d'une commande se fait par l'API.
 */
function arr<T>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[];
  const r = resp as { data?: T[]; items?: T[] };
  return r?.data ?? r?.items ?? [];
}

const num = (v: number | string) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export default function SalesContractsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: contracts = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['sales-contracts'], queryFn: () => salesContractsApi.list() });
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list() });
  const { data: productsRaw } = useQuery({ queryKey: ['products-min'], queryFn: () => productsApi.list() });
  const customers = arr<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>(customersRaw);
  const products = arr<{ id: string; name: string }>(productsRaw);

  const [form, setForm] = useState(false);
  const [f, setF] = useState<CreateContractInput>({ customerId: '', basis: 'value', startDate: new Date().toISOString().slice(0, 10) });

  const create = useMutation({
    mutationFn: () => salesContractsApi.create(f),
    onSuccess: () => { setForm(false); setF({ customerId: '', basis: 'value', startDate: new Date().toISOString().slice(0, 10) }); qc.invalidateQueries({ queryKey: ['sales-contracts'] }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const close = useMutation({
    mutationFn: (id: string) => salesContractsApi.close(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-contracts'] }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const custName = (c: SalesContract) => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';

  const [view, setView] = useState<'' | SalesContract['status']>('');
  const stats = useMemo(() => {
    const acc: Record<string, number> = { active: 0, closed: 0 };
    for (const c of contracts) if (acc[c.status] !== undefined) acc[c.status] += 1;
    return acc;
  }, [contracts]);
  const filtered = view ? contracts.filter(c => c.status === view) : contracts;
  const kpis = useMemo(() => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const k = { committed: 0, consumed: 0, ending: 0, nearlyUsed: 0 };
    for (const c of contracts) {
      if (c.status !== 'active') continue;
      if (c.basis === 'value') { k.committed += c.committed; k.consumed += c.consumed; }
      if (c.end_date && c.end_date.slice(0, 10) <= soon) k.ending++;
      if (c.committed > 0 && c.consumed / c.committed >= 0.85) k.nearlyUsed++;
    }
    return k;
  }, [contracts]);

  return (
    <SalesPageShell icon={Handshake} title="Contrats-cadres" parent="Ventes" list
      summary={`${stats.active} actif${stats.active > 1 ? 's' : ''}`}
      actions={<button className="odoo-btn-primary" onClick={() => setForm(v => !v)}><Plus size={14} /> Nouveau contrat</button>}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Engagé (valeur)" value={money(kpis.committed)} sub="contrats actifs en montant" />
        <ListKpi label="Consommé" value={money(kpis.consumed)} sub={kpis.committed > 0 ? `${Math.round((kpis.consumed / kpis.committed) * 100)} % de l'engagé` : '—'} />
        <ListKpi label="Presque épuisés" value={String(kpis.nearlyUsed)} sub="consommés à 85 % ou plus" tone={kpis.nearlyUsed ? 'orange' : undefined} />
        <ListKpi label="Échéance sous 30 j" value={String(kpis.ending)} sub="à renouveler ou clôturer" tone={kpis.ending ? 'orange' : undefined} />
      </section>
      <p className="prj-note">Engagement de volume ou de valeur sur une période, consommé par les commandes rattachées (appels).</p>

      <FilterChips label="Filtrer les contrats" value={view} onChange={k => setView(k as '' | SalesContract['status'])} chips={[
        { key: 'active', label: 'Actifs', count: stats.active },
        { key: 'closed', label: 'Clôturés', count: stats.closed },
        { key: '', label: 'Tous', count: contracts.length },
      ]} />

      {form && (
        <Modal title="Nouveau contrat-cadre" onClose={() => setForm(false)} width={640} locked={create.isPending}
          footer={<FormFooter onCancel={() => setForm(false)} onSubmit={() => create.mutate()} submitLabel="Créer le contrat" disabled={!f.customerId} busy={create.isPending} />}>
          <FormSection title="Client et engagement">
            <div className="ds-form-grid">
              <FormField label="Client" required>
                <SearchSelect value={f.customerId} onChange={v => setF({ ...f, customerId: v })}
                  placeholder="— Client —" width="100%" size="md" ariaLabel="Client"
                  options={customers.map(c => ({ id: String(c.id), label: c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() }))} />
              </FormField>
              <FormField label="Base" htmlFor="sc-basis">
                <select id="sc-basis" className="ds-input" value={f.basis} onChange={e => setF({ ...f, basis: e.target.value as 'quantity' | 'value' })}>
                  <option value="value">Valeur ({currencySymbol()})</option>
                  <option value="quantity">Volume (article)</option>
                </select>
              </FormField>
              {f.basis === 'quantity' ? (
                <>
                  <FormField label="Article">
                    <SearchSelect value={f.productId ?? ''} onChange={v => setF({ ...f, productId: v })}
                      placeholder="— Article —" width="100%" size="md" ariaLabel="Article"
                      options={products.map(pr => ({ id: String(pr.id), label: pr.name as string }))} />
                  </FormField>
                  <FormField label="Quantité engagée" htmlFor="sc-qty">
                    <input id="sc-qty" className="ds-input" type="number" value={f.committedQuantity ?? ''} onChange={e => setF({ ...f, committedQuantity: Number(e.target.value) })} />
                  </FormField>
                </>
              ) : (
                <FormField label={`Montant engagé (${currencySymbol()})`} htmlFor="sc-value">
                  <input id="sc-value" className="ds-input" type="number" value={f.committedValue ?? ''} onChange={e => setF({ ...f, committedValue: Number(e.target.value) })} />
                </FormField>
              )}
            </div>
          </FormSection>
          <FormSection title="Période">
            <div className="ds-form-grid">
              <FormField label="Début" htmlFor="sc-start">
                <input id="sc-start" className="ds-input" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
              </FormField>
              <FormField label="Fin" htmlFor="sc-end">
                <input id="sc-end" className="ds-input" type="date" value={f.endDate ?? ''} onChange={e => setF({ ...f, endDate: e.target.value })} />
              </FormField>
            </div>
          </FormSection>
        </Modal>
      )}

      {isLoading ? <LoadingState label="Chargement des contrats…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !filtered.length ? (
        contracts.length
          ? <NoResultState onReset={() => setView('')} text="Aucun contrat ne correspond au filtre." />
          : <EmptyState icon={Handshake} title="Aucun contrat-cadre" text="« Nouveau contrat » pour engager un client sur un volume ou un montant." />
      ) : (
        <DataPanel label="Contrats-cadres" footer={<TableFooter note={`${filtered.length} contrat${filtered.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Client</th><th>Base</th><th className="ds-num">Engagé</th><th>Consommé</th><th className="ds-num">Restant</th><th>État</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {filtered.map(c => {
                const pct = c.committed > 0 ? Math.min(100, Math.round((c.consumed / c.committed) * 100)) : 0;
                const fmt = c.basis === 'value' ? money : num;
                return (
                  <tr key={c.id} style={{ cursor: 'default' }}>
                    <td><span className="ds-ref">{c.number}</span></td>
                    <td className="ds-strong">{custName(c)}</td>
                    <td>{c.basis === 'value' ? 'Valeur' : <>Volume<span className="sal-sub">{c.product_name ?? ''}</span></>}</td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{fmt(c.committed)}</td>
                    <td style={{ minWidth: 150 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`prj-bar ${pct >= 100 ? 'red' : pct >= 85 ? 'orange' : ''}`} style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></span>
                        <span style={{ fontSize: '12px', color: 'var(--ds-muted)', fontVariantNumeric: 'tabular-nums' }}>{pct} %</span>
                      </div>
                      <span className="sal-sub">{fmt(c.consumed)}</span>
                    </td>
                    <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{fmt(c.remaining)}</td>
                    <td>{c.status === 'active' ? <StatusTag tone="done" label="Actif" /> : <StatusTag tone="cancelled" icon={Archive} label="Clôturé" />}</td>
                    <td className="ds-actions">{c.status === 'active' && (
                      <NextStep icon={Lock} label="Clôturer" disabled={close.isPending} onClick={async () => {
                        if (await confirm(`Clôturer le contrat ${c.number} ? Les commandes ne pourront plus y être rattachées.`, { title: 'Clôturer le contrat', confirmLabel: 'Clôturer' })) close.mutate(c.id);
                      }} />
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </SalesPageShell>
  );
}
