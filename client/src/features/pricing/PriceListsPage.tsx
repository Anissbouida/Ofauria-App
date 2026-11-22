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
import { DataPanel, TableFooter, EmptyState, Modal, FormField, FormSection, FormFooter } from '../../components/ds';
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
          <div className="prj-panel" style={{ padding: 10, marginBottom: 10, maxHeight: 240, overflow: 'auto', fontSize: '12px' }}>
            {history.length === 0 && <div style={{ color: 'var(--ds-muted)' }}>Aucun changement.</div>}
            {history.map(h => (
              <div key={h.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--ds-sep)' }}>
                <strong>{h.product_name}</strong> {Number(h.old_price ?? 0).toFixed(2)} → {Number(h.new_price ?? 0).toFixed(2)}
                {h.pct != null && <span> ({Number(h.pct) > 0 ? '+' : ''}{Number(h.pct).toFixed(1)} %)</span>}
                <div style={{ color: 'var(--ds-muted)' }}>{new Date(h.changed_at).toLocaleString('fr-FR')}{h.reason ? ` · ${h.reason}` : ''}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lists.map((l: PriceList) => (
            <button key={l.id} onClick={() => setSelectedId(l.id)}
              style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: `1px solid ${l.id === selectedId ? 'var(--ds-accent)' : 'var(--ds-sep)'}`,
                background: l.id === selectedId ? 'color-mix(in srgb, var(--ds-accent) 8%, var(--ds-card))' : 'var(--ds-card)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>{l.name} {!l.is_active && <StatusTag tone="cancelled" label="inactive" />}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--ds-muted)' }}>
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
            <input aria-label="Nom de la liste" className="ds-input" style={{ width: 280, fontWeight: 600 }} defaultValue={detail.name} key={detail.id}
              onBlur={(e) => e.target.value !== detail.name && updateList.mutate({ name: e.target.value })} />
            <button type="button" className="ds-btn-danger ds-btn-sm"
              onClick={async () => { if (await confirm(`Supprimer la liste « ${detail.name} » et ses prix ?`, { title: 'Supprimer la liste de prix', confirmLabel: 'Supprimer', danger: true })) delList.mutate(detail.id); }}>
              <Trash2 size={13} /> Supprimer la liste</button>
          </div>

          <div style={{ marginBottom: 14 }}>
          <FormSection title="Ciblage et validité">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <FormField label="Canal" htmlFor="pl-channel">
                <select id="pl-channel" className="ds-input" defaultValue={detail.channel_id ?? ''} onChange={(e) => updateList.mutate({ channelId: e.target.value || null })}>
                  <option value="">Tous</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </FormField>
              <FormField label="Type de client" htmlFor="pl-ctype">
                <select id="pl-ctype" className="ds-input" defaultValue={detail.customer_type ?? ''} onChange={(e) => updateList.mutate({ customerType: e.target.value || null })}>
                  <option value="">Tous</option>
                  {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Groupe de clients" htmlFor="pl-group">
                <input id="pl-group" className="ds-input" defaultValue={detail.price_group ?? ''} placeholder="Hôtels…" onBlur={(e) => updateList.mutate({ priceGroup: e.target.value || null })} />
              </FormField>
              <FormField label="Devise" htmlFor="pl-currency">
                <input id="pl-currency" className="ds-input" style={{ textTransform: 'uppercase' }} maxLength={3} defaultValue={detail.currency} onBlur={(e) => updateList.mutate({ currency: e.target.value.toUpperCase() || BASE_CURRENCY })} />
              </FormField>
              <FormField label="Valide du" htmlFor="pl-from">
                <input id="pl-from" type="date" className="ds-input" defaultValue={detail.valid_from ?? ''} onChange={(e) => updateList.mutate({ validFrom: e.target.value || null })} />
              </FormField>
              <FormField label="au" htmlFor="pl-to">
                <input id="pl-to" type="date" className="ds-input" defaultValue={detail.valid_to ?? ''} onChange={(e) => updateList.mutate({ validTo: e.target.value || null })} />
              </FormField>
              <FormField label="Priorité" htmlFor="pl-priority">
                <input id="pl-priority" type="number" className="ds-input" defaultValue={detail.priority} onBlur={(e) => updateList.mutate({ priority: Number(e.target.value) || 0 })} />
              </FormField>
              <label htmlFor="pl-active" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 24, fontSize: 13 }}>
                <input id="pl-active" type="checkbox" defaultChecked={detail.is_active} onChange={(e) => updateList.mutate({ isActive: e.target.checked })} /> Active
              </label>
            </div>
          </FormSection>
          </div>

          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>Prix par article (palier de quantité)</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 220px' }}><FormField label="Article" required>
              <SearchSelect value={itemForm.productId} onChange={(v) => setItemForm({ ...itemForm, productId: v })}
                placeholder="— Choisir —" width="100%" size="md" ariaLabel="Article"
                options={products.map(p => ({ id: String(p.id), label: p.name as string }))} />
            </FormField></div>
            <div style={{ width: 120 }}><FormField label="À partir de (qté)" htmlFor="pl-item-min">
              <input id="pl-item-min" type="number" className="ds-input" value={itemForm.minQuantity} onChange={(e) => setItemForm({ ...itemForm, minQuantity: e.target.value })} />
            </FormField></div>
            <div style={{ width: 130 }}><FormField label={`Prix (${detail.currency})`} htmlFor="pl-item-price" required>
              <input id="pl-item-price" type="number" className="ds-input" value={itemForm.unitPrice} onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })} />
            </FormField></div>
            <button type="button" className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
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
        <Modal title="Mise à jour en masse des prix" onClose={() => setBulk(null)} width={440} locked={bulkMut.isPending}
          footer={<FormFooter onCancel={() => setBulk(null)} onSubmit={() => bulkMut.mutate()} submitLabel={bulkMut.isPending ? 'Application…' : 'Appliquer'}
            disabled={!bulk.family.trim() || bulk.value === ''} busy={bulkMut.isPending} />}>
          <FormField label="Famille d'articles" htmlFor="bulk-family" required>
            <input id="bulk-family" className="ds-input" value={bulk.family} onChange={(e) => setBulk({ ...bulk, family: e.target.value })} placeholder="Nom exact de la famille (categories.family)" />
          </FormField>
          <div className="ds-form-grid">
            <FormField label="Opération" htmlFor="bulk-mode">
              <select id="bulk-mode" className="ds-input" value={bulk.mode} onChange={(e) => setBulk({ ...bulk, mode: e.target.value as 'increase_pct' | 'set' })}>
                <option value="increase_pct">Variation en %</option>
                <option value="set">Fixer le prix</option>
              </select>
            </FormField>
            <FormField label={bulk.mode === 'increase_pct' ? 'Pourcentage (+/−)' : 'Nouveau prix'} htmlFor="bulk-value" required>
              <input id="bulk-value" type="number" step="0.01" className="ds-input" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Motif (tracé)" htmlFor="bulk-reason">
            <input id="bulk-reason" className="ds-input" value={bulk.reason} onChange={(e) => setBulk({ ...bulk, reason: e.target.value })} placeholder="Hausse tarifaire 2026…" />
          </FormField>
        </Modal>
      )}
    </SalesPageShell>
  );
}
