import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Handshake, Loader2, Plus, Lock } from 'lucide-react';
import { salesContractsApi, type SalesContract, type CreateContractInput } from '../../api/sales-contracts.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { StagePipeline, type StageDef, type StageStat } from '../../components/purchasing/ProcessBoard';

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

const money = (v: number | string) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const num = (v: number | string) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// Étapes du cycle d'un contrat-cadre pour la bande « Suivi » (gabarit page Commandes).
const CONTRACT_STAGES: StageDef[] = [
  { key: 'active', label: 'Actifs', hint: 'en cours', icon: Handshake },
  { key: 'closed', label: 'Clôturés', hint: 'terminés', icon: Lock },
];
const chipStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  backgroundColor: active ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
  color: active ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
  fontWeight: active ? 600 : 400,
});

export default function SalesContractsPage() {
  const qc = useQueryClient();
  const { data: contracts = [], isLoading } = useQuery({ queryKey: ['sales-contracts'], queryFn: () => salesContractsApi.list() });
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
  const stats = useMemo<Record<string, StageStat>>(() => {
    const acc: Record<string, number> = { active: 0, closed: 0 };
    for (const c of contracts) if (acc[c.status] !== undefined) acc[c.status] += 1;
    return { active: { count: acc.active, sub: '' }, closed: { count: acc.closed, sub: '' } };
  }, [contracts]);
  const filtered = view ? contracts.filter(c => c.status === view) : contracts;

  return (
    <SalesPageShell icon={Handshake} title="Contrats-cadres" parent="Ventes"
      actions={<button className="odoo-btn-primary" onClick={() => setForm(v => !v)}><Plus size={14} /> Nouveau contrat</button>}>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Engagement de volume ou de valeur, consommé par les commandes rattachées (appels).</p>

      {form && (
        <div className="odoo-card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 2 }}>Client
              <select className="odoo-input" value={f.customerId} onChange={e => setF({ ...f, customerId: e.target.value })}>
                <option value="">—</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 2 }}>Base
              <select className="odoo-input" value={f.basis} onChange={e => setF({ ...f, basis: e.target.value as 'quantity' | 'value' })}>
                <option value="value">Valeur (DH)</option>
                <option value="quantity">Volume (article)</option>
              </select>
            </label>
            {f.basis === 'quantity' ? (
              <>
                <label style={{ display: 'grid', gap: 2 }}>Article
                  <select className="odoo-input" value={f.productId ?? ''} onChange={e => setF({ ...f, productId: e.target.value })}>
                    <option value="">—</option>
                    {products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 2 }}>Quantité engagée
                  <input className="odoo-input" type="number" value={f.committedQuantity ?? ''} onChange={e => setF({ ...f, committedQuantity: Number(e.target.value) })} style={{ width: 130 }} />
                </label>
              </>
            ) : (
              <label style={{ display: 'grid', gap: 2 }}>Montant engagé (DH)
                <input className="odoo-input" type="number" value={f.committedValue ?? ''} onChange={e => setF({ ...f, committedValue: Number(e.target.value) })} style={{ width: 150 }} />
              </label>
            )}
            <label style={{ display: 'grid', gap: 2 }}>Début
              <input className="odoo-input" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 2 }}>Fin
              <input className="odoo-input" type="date" value={f.endDate ?? ''} onChange={e => setF({ ...f, endDate: e.target.value })} />
            </label>
          </div>
          <div>
            <button className="odoo-btn-primary" disabled={!f.customerId || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Créer
            </button>
          </div>
        </div>
      )}

      <StagePipeline
        title="Suivi des contrats-cadres"
        summary={`${contracts.length} contrat${contracts.length > 1 ? 's' : ''}`}
        stages={CONTRACT_STAGES}
        stats={stats}
        isActive={(k) => view === k}
        onPick={(k) => setView(view === k ? '' : (k as SalesContract['status']))}
      />
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap' }}>
        {([['active', 'Actifs', Handshake], ['closed', 'Clôturés', Lock], ['', 'Tous', Handshake]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setView(k)} className="odoo-filter-dropdown" style={chipStyle(view === k)}>
            <Icon size={11} /> {label}
            {k && stats[k].count > 0 && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 2 }}>{stats[k].count}</span>}
          </button>
        ))}
      </div>

      {isLoading ? <Loader2 className="spin" /> : (
        <table className="odoo-table">
          <thead><tr><th>Numéro</th><th>Client</th><th>Base</th><th>Engagé</th><th>Consommé</th><th>Restant</th><th>État</th><th /></tr></thead>
          <tbody>
            {filtered.map(c => {
              const pct = c.committed > 0 ? Math.min(100, Math.round((c.consumed / c.committed) * 100)) : 0;
              const fmt = c.basis === 'value' ? money : num;
              return (
                <tr key={c.id}>
                  <td>{c.number}</td>
                  <td>{custName(c)}</td>
                  <td>{c.basis === 'value' ? 'Valeur' : `Volume · ${c.product_name ?? ''}`}</td>
                  <td>{fmt(c.committed)}</td>
                  <td>
                    {fmt(c.consumed)}
                    <div style={{ height: 4, background: 'var(--odoo-border, #eee)', borderRadius: 2, marginTop: 2 }}>
                      <div style={{ height: 4, width: `${pct}%`, background: pct >= 100 ? '#b00020' : '#8E4A1F', borderRadius: 2 }} />
                    </div>
                  </td>
                  <td>{fmt(c.remaining)}</td>
                  <td>{c.status === 'active' ? 'Actif' : 'Clôturé'}</td>
                  <td>{c.status === 'active' && (
                    <button className="odoo-pager-btn" title="Clôturer" onClick={() => close.mutate(c.id)}><Lock size={13} /></button>
                  )}</td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={8} style={{ textAlign: 'center', opacity: 0.6 }}>Aucun contrat-cadre.</td></tr>}
          </tbody>
        </table>
      )}
    </SalesPageShell>
  );
}
