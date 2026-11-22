import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Ban, Trash2, Plus, Loader2, X, Check, Clock, ChevronDown, Truck, Pencil } from 'lucide-react';
import { supplierItemsApi, suppliersApi, type SupplierItemPrice } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState, Modal } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--ds-sep)', borderRadius: 6, background: 'var(--ds-card)', color: 'inherit', font: 'inherit', fontSize: '0.85rem', width: '100%' };

/**
 * Fiche article × fournisseur (mig 404/405) — Achats lot prix P1/P2.
 * Gère les N fournisseurs d'un article : référence, conditionnement, délai, MOQ,
 * préféré/bloqué, et le prix d'achat daté (saisi ou alimenté à la réception).
 */
export default function SupplierItemsSection({ kind, purchasableId, unit }: { kind: 'ingredient' | 'packaging'; purchasableId: string; unit?: string }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ['supplier-items', kind, purchasableId];
  const { data: items = [], isLoading } = useQuery({ queryKey: key, queryFn: () => supplierItemsApi.byPurchasable(kind, purchasableId) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'active'], queryFn: suppliersApi.listActive });
  const inv = () => qc.invalidateQueries({ queryKey: key });

  const [showAdd, setShowAdd] = useState(false);
  const [priceEdit, setPriceEdit] = useState<{ id: string; val: string } | null>(null);
  const [histId, setHistId] = useState<string | null>(null);

  const prefer = useMutation({ mutationFn: (id: string) => supplierItemsApi.prefer(id), onSuccess: inv, onError: e => notify.error(apiErrorMessage(e)) });
  const block = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => supplierItemsApi.update(id, { isBlocked: v }), onSuccess: inv, onError: e => notify.error(apiErrorMessage(e)) });
  const archive = useMutation({ mutationFn: (id: string) => supplierItemsApi.archive(id), onSuccess: () => { notify.success('Fournisseur retiré'); inv(); }, onError: e => notify.error(apiErrorMessage(e)) });
  const addPrice = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) => supplierItemsApi.addPrice(id, { price }),
    onSuccess: () => { notify.success('Prix enregistré'); setPriceEdit(null); inv(); }, onError: e => notify.error(apiErrorMessage(e)),
  });

  const used = new Set(items.map(i => i.supplier_id));
  const avail = (suppliers as { id: string; name: string }[]).filter(s => !used.has(s.id));

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Truck size={16} /> Fournisseurs <span style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>({items.length})</span></div>
          <div style={{ fontSize: '0.78rem', color: 'var(--ds-muted)', marginTop: 2 }}>Le fournisseur <b>préféré</b> (⭐) est proposé par défaut à l'achat. Le prix se remplit aussi tout seul à la réception.</div>
        </div>
        {avail.length > 0 && <button type="button" className="odoo-btn-secondary" onClick={() => setShowAdd(true)}><Plus size={14} aria-hidden="true" /> Ajouter un fournisseur</button>}
      </div>

      {isLoading && <LoadingState bare label="Chargement des fournisseurs…" />}

      {!isLoading && items.length === 0 && (
        <EmptyState bare icon={Truck} title="Aucun fournisseur pour cet article" text="Ajoutez-en un pour comparer plusieurs sources et suivre les prix d'achat."
          action={avail.length > 0 ? <button type="button" className="odoo-btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} aria-hidden="true" /> Ajouter un fournisseur</button> : undefined} />
      )}

      {items.length > 0 && (
        <DataPanel label="Fournisseurs de l'article">
          <table className="odoo-table">
            <thead><tr>
              <th>Fournisseur</th>
              <th className="ds-num">Prix d'achat{unit ? ` / ${unit}` : ''}</th>
              <th className="ds-num" title="Quantité contenue dans un contenant d'achat (sac, carton…)">Quantité par contenant</th>
              <th className="ds-num" title="Délai de livraison du fournisseur, en jours">Délai de livraison (j)</th>
              <th className="ds-num" title="Quantité minimale de commande imposée par le fournisseur">Quantité minimale</th>
              <th>Référence</th>
              <th className="ds-actions">Actions</th>
            </tr></thead>
            <tbody>
              {items.map(it => (
                <Fragment key={it.id}>
                  <tr style={{ opacity: it.is_blocked ? 0.5 : 1, background: it.is_preferred ? 'var(--ds-warning-bg)' : undefined }}>
                    <td className="ds-strong">
                      {it.is_preferred && <Star size={13} aria-label="Fournisseur préféré" style={{ display: 'inline', color: 'var(--ds-warning)', fill: 'var(--ds-warning)', marginRight: 5, verticalAlign: '-2px' }} />}
                      {it.supplier_name}
                      {it.is_blocked && <span style={{ marginLeft: 6 }}><StatusTag tone="blocked" label="Bloqué" /></span>}
                      {!it.supplier_active && <span style={{ marginLeft: 6 }}><StatusTag tone="cancelled" label="Inactif" /></span>}
                    </td>
                    <td className="ds-num">
                      {priceEdit?.id === it.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input type="number" step="0.01" min="0" autoFocus value={priceEdit.val} className="ds-input sm ds-num" aria-label="Nouveau prix d'achat" style={{ width: 100 }}
                            onChange={e => setPriceEdit({ id: it.id, val: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter' && priceEdit.val) addPrice.mutate({ id: it.id, price: Number(priceEdit.val) }); if (e.key === 'Escape') setPriceEdit(null); }} />
                          <button type="button" aria-label="Enregistrer le prix" className="odoo-btn-primary" style={{ padding: '0.25rem 0.4rem' }} disabled={!priceEdit.val || addPrice.isPending} onClick={() => addPrice.mutate({ id: it.id, price: Number(priceEdit.val) })}><Check size={12} /></button>
                          <button type="button" aria-label="Annuler la saisie du prix" className="odoo-btn-secondary" style={{ padding: '0.25rem 0.4rem' }} onClick={() => setPriceEdit(null)}><X size={12} /></button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                          {it.current_price != null
                            ? <b>{money(Number(it.current_price))}</b>
                            : <span style={{ color: 'var(--ds-muted)' }}>à saisir</span>}
                          {it.current_price_source === 'reception' && <span className="odoo-tag odoo-tag-grey" style={{ fontSize: '0.62rem' }} title="Dernier prix relevé à la réception">auto</span>}
                          <button type="button" aria-label="Saisir ou modifier le prix" className="ds-icon-btn" title="Saisir ou modifier le prix" onClick={() => setPriceEdit({ id: it.id, val: it.current_price != null ? String(it.current_price) : '' })}><Pencil size={11} /></button>
                        </span>
                      )}
                    </td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{it.qty_per_container != null ? `${it.qty_per_container}${unit ? ' ' + unit : ''}` : '—'}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{it.lead_time_days != null ? it.lead_time_days : '—'}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{it.moq != null ? it.moq : '—'}</td>
                    <td style={{ color: 'var(--ds-muted)', fontSize: '0.82rem' }}>{it.supplier_reference || '—'}</td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-expanded={histId === it.id} onClick={() => setHistId(histId === it.id ? null : it.id)}>
                        {histId === it.id ? <ChevronDown size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />} Historique
                      </button>
                      <RowMenu items={[
                        ...(!it.is_preferred && !it.is_blocked ? [{ label: 'Définir comme préféré', icon: Star, onSelect: () => prefer.mutate(it.id) }] : []),
                        { label: it.is_blocked ? 'Débloquer' : 'Bloquer', icon: Ban, onSelect: () => block.mutate({ id: it.id, v: !it.is_blocked }) },
                        { label: 'Retirer le fournisseur', icon: Trash2, danger: true, onSelect: async () => {
                          if (await confirm(`Retirer ${it.supplier_name} des fournisseurs de cet article ?`, { title: 'Retirer le fournisseur', confirmLabel: 'Retirer', danger: true })) archive.mutate(it.id);
                        } },
                      ]} />
                    </td>
                  </tr>
                  {histId === it.id && <PriceHistoryRow supplierItemId={it.id} colSpan={7} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {showAdd && <AddSupplierModal kind={kind} purchasableId={purchasableId} unit={unit} avail={avail} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); inv(); }} />}
    </div>
  );
}

function AddSupplierModal({ kind, purchasableId, unit, avail, onClose, onSaved }: {
  kind: 'ingredient' | 'packaging'; purchasableId: string; unit?: string;
  avail: { id: string; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [sup, setSup] = useState(''); const [ref, setRef] = useState(''); const [price, setPrice] = useState('');
  const [qpc, setQpc] = useState(''); const [lead, setLead] = useState(''); const [moq, setMoq] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const created = await supplierItemsApi.create({
        supplierId: sup, kind, purchasableId, supplierReference: ref || null,
        qtyPerContainer: qpc || null, leadTimeDays: lead || null, moq: moq || null,
      });
      if (price && Number(price) >= 0) await supplierItemsApi.addPrice(created.id, { price: Number(price) });
      return created;
    },
    onSuccess: () => { notify.success('Fournisseur ajouté'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <Modal title="Ajouter un fournisseur" onClose={onClose} locked={save.isPending} width={560}
      footer={<FormFooter onCancel={onClose} submitLabel="Ajouter" busy={save.isPending} disabled={!sup} onSubmit={() => save.mutate()} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Fournisseur" required>
            <SearchSelect value={sup} onChange={setSup}
              placeholder="— Choisir —" width="100%" size="md" ariaLabel="Fournisseur"
              options={avail.map(s => ({ id: String(s.id), label: s.name as string }))} />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={<>Prix d'achat{unit ? ` / ${unit}` : ''} <span style={{ fontWeight: 400 }}>(optionnel)</span></>} htmlFor="si-price">
              <div style={{ position: 'relative' }}>
                <input id="si-price" className="ds-input" type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" style={{ paddingRight: 40 }} />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.76rem', color: 'var(--ds-muted)' }}>{currencySymbol()}</span>
              </div>
            </FormField>
            <FormField label={<>Réf. fournisseur <span style={{ fontWeight: 400 }}>(optionnel)</span></>} htmlFor="si-ref">
              <input id="si-ref" className="ds-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="Code chez le fournisseur" /></FormField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label={<>Qté / contenant{unit ? ` (${unit})` : ''}</>} htmlFor="si-qpc" hint="Contenu d'un sac/carton">
              <input id="si-qpc" className="ds-input" type="number" step="0.001" min="0" value={qpc} onChange={e => setQpc(e.target.value)} placeholder="ex. 25" /></FormField>
            <FormField label={<>Délai de livraison</>} htmlFor="si-lead" hint="Jours commande → livraison">
              <input id="si-lead" className="ds-input" type="number" min="0" value={lead} onChange={e => setLead(e.target.value)} placeholder="en jours" /></FormField>
            <FormField label={<>Qté min. de commande</>} htmlFor="si-moq" hint="Minimum imposé (MOQ)">
              <input id="si-moq" className="ds-input" type="number" min="0" step="0.001" value={moq} onChange={e => setMoq(e.target.value)} placeholder="optionnel" /></FormField>
          </div>
        </div>
    </Modal>
  );
}

// Historique des prix d'une fiche article × fournisseur (mig 405).
function PriceHistoryRow({ supplierItemId, colSpan }: { supplierItemId: string; colSpan: number }) {
  const { data: prices = [], isLoading } = useQuery({ queryKey: ['supplier-item-prices', supplierItemId], queryFn: () => supplierItemsApi.prices(supplierItemId) });
  const sourceLabel: Record<string, string> = { manual: 'Saisi', reception: 'Réception', po: 'Commande', invoice: 'Facture', quote: 'Devis' };
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))', padding: '8px 14px' }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--ds-muted)', marginBottom: 4 }}>Historique des prix</div>
        {isLoading ? (
          <span style={{ color: 'var(--ds-muted)', fontSize: '0.8rem' }}><Loader2 size={12} className="animate-spin" style={{ display: 'inline' }} /> …</span>
        ) : prices.length === 0 ? (
          <span style={{ color: 'var(--ds-muted)', fontSize: '0.8rem' }}>Aucun prix enregistré pour l'instant.</span>
        ) : (
          <DataPanel label="Historique des prix">
          <table className="odoo-table ds-dense">
            <thead><tr>
              <th className="ds-num">Prix</th>
              <th>Depuis</th>
              <th>Jusqu'à</th>
              <th>Origine</th>
            </tr></thead>
            <tbody>{(prices as SupplierItemPrice[]).map(pr => (
              <tr key={pr.id}>
                <td className="ds-num" style={{ fontWeight: pr.valid_to ? 400 : 600 }}>{Number(pr.price).toFixed(2)} {pr.currency}</td>
                <td>{new Date(pr.valid_from).toLocaleDateString('fr-FR')}</td>
                <td>{pr.valid_to ? new Date(pr.valid_to).toLocaleDateString('fr-FR') : <b style={{ color: 'var(--ds-success)' }}>en vigueur</b>}</td>
                <td style={{ color: 'var(--ds-muted)' }}>{sourceLabel[pr.source] ?? pr.source}</td>
              </tr>
            ))}</tbody>
          </table>
          </DataPanel>
        )}
      </td>
    </tr>
  );
}
