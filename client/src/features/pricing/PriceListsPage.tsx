import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Trash2, Check, TrendingUp, History } from 'lucide-react';
import { pricingApi, type PriceList } from '../../api/pricing.api';
import { salesChannelsApi } from '../../api/sales-channels.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import { getApiErrorMessage } from '../../utils/api-error';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi } from '../sales/ListTemplate';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { DataPanel, TableFooter, EmptyState } from '../../components/ds';
import { BASE_CURRENCY } from '../../api/currencies.api';

// Listes de prix (phase 6.1–6.3) : par canal, type/groupe de clients ou client précis,
// avec validité et devise ; lignes à paliers de quantité. Le prix applicable est résolu
// côté serveur (caisse, devis, commande, BL) selon la liste la plus spécifique en vigueur.

const CUSTOMER_TYPES = ['particulier', 'professionnel', 'revendeur', 'association'];

export default function PriceListsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: lists = [] } = useQuery({ queryKey: ['price-lists'], queryFn: pricingApi.list });
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: salesChannelsApi.list });
  const { data: detail } = useQuery({ queryKey: ['price-list', selectedId], queryFn: () => pricingApi.get(selectedId!), enabled: !!selectedId });
  const { data: productsResp } = useQuery({ queryKey: ['products', 'all'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: Record<string, any>[] = productsResp?.data ?? productsResp ?? [];

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['price-lists'] }); if (selectedId) qc.invalidateQueries({ queryKey: ['price-list', selectedId] }); };

  const createList = useMutation({
    mutationFn: () => pricingApi.create({ name: 'Nouvelle liste' }),
    onSuccess: (l) => { invalidate(); setSelectedId(l.id); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec')),
  });
  const updateList = useMutation({
    mutationFn: (data: Record<string, any>) => pricingApi.update(selectedId!, data),
    onSuccess: () => { invalidate(); notify.success('Liste enregistrée'); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec')),
  });
  const delList = useMutation({
    mutationFn: (id: string) => pricingApi.remove(id),
    onSuccess: () => { invalidate(); setSelectedId(null); notify.success('Liste supprimée'); },
  });
  const addItem = useMutation({
    mutationFn: (data: { productId: string; minQuantity: number; unitPrice: number }) => pricingApi.setItem(selectedId!, data),
    onSuccess: () => { invalidate(); notify.success('Ligne enregistrée'); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec')),
  });
  const delItem = useMutation({
    mutationFn: (itemId: string) => pricingApi.removeItem(selectedId!, itemId),
    onSuccess: invalidate,
  });

  const [itemForm, setItemForm] = useState({ productId: '', minQuantity: '0', unitPrice: '' });

  // Mise à jour en masse + historique (phase 6.5).
  const [bulk, setBulk] = useState<{ family: string; mode: 'increase_pct' | 'set'; value: string; reason: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { data: history = [] } = useQuery({ queryKey: ['price-history'], queryFn: () => pricingApi.history(), enabled: showHistory });
  const bulkMut = useMutation({
    mutationFn: () => pricingApi.bulkUpdate({ mode: bulk!.mode, value: Number(bulk!.value), reason: bulk!.reason, family: bulk!.family }),
    onSuccess: (r) => { setBulk(null); qc.invalidateQueries({ queryKey: ['price-history'] }); notify.success(`${r.count} article(s) mis à jour`); },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Échec de la mise à jour')),
  });

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const listKpis = {
    active: lists.filter((l: PriceList) => l.is_active).length,
    items: lists.reduce((n: number, l: PriceList) => n + (Number(l.item_count) || 0), 0),
    targeted: lists.filter((l: PriceList) => l.channel_id || l.customer_type || l.price_group || l.customer_id).length,
    ending: lists.filter((l: PriceList) => l.is_active && l.valid_to && l.valid_to.slice(0, 10) >= today && l.valid_to.slice(0, 10) <= soon).length,
  };
  const field: React.CSSProperties = { padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', background: 'var(--odoo-bg)', width: '100%' };
  const lab: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'block', marginBottom: 2 };

  return (
    <SalesPageShell icon={Tag} parent="Ventes" title="Listes de prix"
      summary={`${lists.length} liste${lists.length > 1 ? 's' : ''}`}
      actions={<>
        <button className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => setBulk({ family: '', mode: 'increase_pct', value: '5', reason: '' })}><TrendingUp size={13} /> Mise à jour des prix</button>
        <button type="button" className="odoo-btn-secondary" aria-pressed={showHistory} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => setShowHistory(v => !v)}><History size={13} /> {showHistory ? 'Masquer l\'historique' : 'Historique'}</button>
        <button className="odoo-btn-primary" onClick={() => createList.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Nouvelle liste</button>
      </>}>
    <section className="prj prj-kpis" aria-label="Indicateurs">
      <ListKpi label="Listes actives" value={`${listKpis.active} / ${lists.length}`} sub="appliquées en caisse et en commande" />
      <ListKpi label="Prix spécifiques" value={String(listKpis.items)} sub="lignes d'articles, toutes listes" />
      <ListKpi label="Ciblées" value={String(listKpis.targeted)} sub="par canal, type ou client" />
      <ListKpi label="Expirent sous 30 j" value={String(listKpis.ending)} sub="fin de validité proche" tone={listKpis.ending ? 'orange' : undefined} />
    </section>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 260px', maxWidth: 340, minWidth: 0 }}>
        {showHistory && (
          <div className="prj-panel" style={{ padding: 10, marginBottom: 10, maxHeight: 240, overflow: 'auto', fontSize: '0.75rem' }}>
            {history.length === 0 && <div style={{ color: 'var(--odoo-text-muted)' }}>Aucun changement.</div>}
            {history.map(h => (
              <div key={h.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--odoo-border)' }}>
                <strong>{h.product_name}</strong> {Number(h.old_price ?? 0).toFixed(2)} → {Number(h.new_price ?? 0).toFixed(2)}
                {h.pct != null && <span> ({Number(h.pct) > 0 ? '+' : ''}{Number(h.pct).toFixed(1)} %)</span>}
                <div style={{ color: 'var(--odoo-text-muted)' }}>{new Date(h.changed_at).toLocaleString('fr-FR')}{h.reason ? ` · ${h.reason}` : ''}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lists.map((l: PriceList) => (
            <button key={l.id} onClick={() => setSelectedId(l.id)}
              style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: `1px solid ${l.id === selectedId ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
                background: l.id === selectedId ? 'color-mix(in srgb, var(--odoo-purple) 8%, var(--theme-bg-card))' : 'var(--theme-bg-card)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{l.name} {!l.is_active && <StatusTag tone="cancelled" label="inactive" />}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--odoo-text-muted)' }}>
                {[l.channel_name, l.customer_type, l.price_group, l.customer_id ? 'client précis' : null].filter(Boolean).join(' · ') || 'Générale'} · {l.currency} · {l.item_count ?? 0} art.
              </div>
            </button>
          ))}
          {lists.length === 0 && <p className="prj-note">Aucune liste : le prix catalogue s'applique partout.</p>}
        </div>
      </div>

      {detail ? (
        <div style={{ flex: '999 1 480px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <input aria-label="Nom de la liste" style={{ ...field, width: 280, fontWeight: 600 }} defaultValue={detail.name} key={detail.id}
              onBlur={(e) => e.target.value !== detail.name && updateList.mutate({ name: e.target.value })} />
            <button type="button" className="ds-btn-danger ds-btn-sm"
              onClick={async () => { if (await confirm(`Supprimer la liste « ${detail.name} » et ses prix ?`, { title: 'Supprimer la liste de prix', confirmLabel: 'Supprimer', danger: true })) delList.mutate(detail.id); }}>
              <Trash2 size={13} /> Supprimer la liste</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14, border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12 }}>
            <label><span style={lab}>Canal</span>
              <select style={field} defaultValue={detail.channel_id ?? ''} onChange={(e) => updateList.mutate({ channelId: e.target.value || null })}>
                <option value="">Tous</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label><span style={lab}>Type de client</span>
              <select style={field} defaultValue={detail.customer_type ?? ''} onChange={(e) => updateList.mutate({ customerType: e.target.value || null })}>
                <option value="">Tous</option>
                {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label><span style={lab}>Groupe de clients</span>
              <input style={field} defaultValue={detail.price_group ?? ''} placeholder="Hôtels…" onBlur={(e) => updateList.mutate({ priceGroup: e.target.value || null })} />
            </label>
            <label><span style={lab}>Devise</span>
              <input style={{ ...field, textTransform: 'uppercase' }} maxLength={3} defaultValue={detail.currency} onBlur={(e) => updateList.mutate({ currency: e.target.value.toUpperCase() || BASE_CURRENCY })} />
            </label>
            <label><span style={lab}>Valide du</span>
              <input type="date" style={field} defaultValue={detail.valid_from ?? ''} onChange={(e) => updateList.mutate({ validFrom: e.target.value || null })} />
            </label>
            <label><span style={lab}>au</span>
              <input type="date" style={field} defaultValue={detail.valid_to ?? ''} onChange={(e) => updateList.mutate({ validTo: e.target.value || null })} />
            </label>
            <label><span style={lab}>Priorité</span>
              <input type="number" style={field} defaultValue={detail.priority} onBlur={(e) => updateList.mutate({ priority: Number(e.target.value) || 0 })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
              <input type="checkbox" defaultChecked={detail.is_active} onChange={(e) => updateList.mutate({ isActive: e.target.checked })} /> Active
            </label>
          </div>

          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>Prix par article (palier de quantité)</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
            <label style={{ flex: 2 }}><span style={lab}>Article</span>
              <SearchSelect value={itemForm.productId} onChange={(v) => setItemForm({ ...itemForm, productId: v })}
                placeholder="— Choisir —" width="100%" size="md" ariaLabel="Article"
                options={products.map(p => ({ id: String(p.id), label: p.name as string }))} />
            </label>
            <label style={{ width: 110 }}><span style={lab}>À partir de</span>
              <input type="number" style={field} value={itemForm.minQuantity} onChange={(e) => setItemForm({ ...itemForm, minQuantity: e.target.value })} /></label>
            <label style={{ width: 120 }}><span style={lab}>Prix</span>
              <input type="number" style={field} value={itemForm.unitPrice} onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })} /></label>
            <button className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              disabled={!itemForm.productId || itemForm.unitPrice === ''}
              onClick={() => { addItem.mutate({ productId: itemForm.productId, minQuantity: Number(itemForm.minQuantity) || 0, unitPrice: Number(itemForm.unitPrice) }); setItemForm({ productId: '', minQuantity: '0', unitPrice: '' }); }}>
              <Check size={13} /> Ajouter
            </button>
          </div>
          {(detail.items ?? []).length === 0 ? <EmptyState icon={Tag} title="Aucun prix dans cette liste" text="Ajoutez un article et son prix ci-dessus." /> : (
          <DataPanel label="Prix par article" footer={<TableFooter note={`${(detail.items ?? []).length} prix`} />}>
          <table className="odoo-table">
            <thead><tr><th>Article</th><th className="ds-num">À partir de (qté)</th><th className="ds-num">Prix ({detail.currency})</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {(detail.items ?? []).map(it => (
                <tr key={it.id}>
                  <td className="ds-strong">{it.product_name}</td>
                  <td className="ds-num">{Number(it.min_quantity)}</td>
                  <td className="ds-num">{Number(it.unit_price).toFixed(2)}</td>
                  <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label={`Retirer le prix de ${it.product_name}`} disabled={delItem.isPending} onClick={() => delItem.mutate(it.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
          )}
        </div>
      ) : (
        <div style={{ flex: '999 1 480px', minWidth: 0 }}>
          <EmptyState icon={Tag} title="Aucune liste sélectionnée" text={lists.length ? 'Choisissez une liste à gauche.' : 'Aucune liste : le prix catalogue s\'applique partout. Créez-en une avec « Nouvelle liste ».'} />
        </div>
      )}

    </div>
      {bulk && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setBulk(null)}>
          <div style={{ background: 'var(--odoo-bg)', borderRadius: 8, padding: 20, width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><TrendingUp size={16} /> Mise à jour en masse des prix</h3>
            <label><span style={lab}>Famille d'articles<span className="ds-req" aria-hidden="true"> *</span></span>
              <input style={field} value={bulk.family} onChange={(e) => setBulk({ ...bulk, family: e.target.value })} placeholder="Nom exact de la famille (categories.family)" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label><span style={lab}>Opération</span>
                <select style={field} value={bulk.mode} onChange={(e) => setBulk({ ...bulk, mode: e.target.value as 'increase_pct' | 'set' })}>
                  <option value="increase_pct">Variation en %</option>
                  <option value="set">Fixer le prix</option>
                </select></label>
              <label><span style={lab}>{bulk.mode === 'increase_pct' ? 'Pourcentage (+/−)' : 'Nouveau prix'}</span>
                <input type="number" step="0.01" style={field} value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} /></label>
            </div>
            <label style={{ display: 'block', marginTop: 8 }}><span style={lab}>Motif (tracé)</span>
              <input style={field} value={bulk.reason} onChange={(e) => setBulk({ ...bulk, reason: e.target.value })} placeholder="Hausse tarifaire 2026…" /></label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="odoo-btn-secondary" onClick={() => setBulk(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!bulk.family.trim() || bulk.value === '' || bulkMut.isPending}
                onClick={() => bulkMut.mutate()}>{bulkMut.isPending ? 'Application…' : 'Appliquer'}</button>
            </div>
          </div>
        </div>
      )}
    </SalesPageShell>
  );
}
