import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Ban, Trash2, Plus, Loader2, X, Check, Clock, ChevronDown, Truck, Pencil } from 'lucide-react';
import { supplierItemsApi, suppliersApi, type SupplierItemPrice } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit', fontSize: '0.85rem', width: '100%' };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.76rem', color: 'var(--theme-text-muted)', fontWeight: 500 };

/**
 * Fiche article × fournisseur (mig 404/405) — Achats lot prix P1/P2.
 * Gère les N fournisseurs d'un article : référence, conditionnement, délai, MOQ,
 * préféré/bloqué, et le prix d'achat daté (saisi ou alimenté à la réception).
 */
export default function SupplierItemsSection({ kind, purchasableId, unit }: { kind: 'ingredient' | 'packaging'; purchasableId: string; unit?: string }) {
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
  const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Truck size={16} /> Fournisseurs <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>({items.length})</span></div>
          <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>Le fournisseur <b>préféré</b> (⭐) est proposé par défaut à l'achat. Le prix se remplit aussi tout seul à la réception.</div>
        </div>
        {avail.length > 0 && <button className="odoo-btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} /> Ajouter un fournisseur</button>}
      </div>

      {isLoading && <div style={{ padding: 24, color: 'var(--theme-text-muted)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}

      {!isLoading && items.length === 0 && (
        <div style={{ border: '1px dashed var(--odoo-border)', borderRadius: 8, padding: '28px 16px', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Truck size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div style={{ fontSize: '0.9rem', marginBottom: 4 }}>Aucun fournisseur pour cet article.</div>
          <div style={{ fontSize: '0.8rem', marginBottom: 12 }}>Ajoutez-en un pour gérer le multi-sourcing et suivre les prix d'achat.</div>
          {avail.length > 0 && <button className="odoo-btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} /> Ajouter un fournisseur</button>}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr>
              <th>Fournisseur</th>
              <th style={{ textAlign: 'right' }}>Prix d'achat{unit ? ` / ${unit}` : ''}</th>
              <th style={{ textAlign: 'right' }} title="Quantité contenue dans un contenant d'achat (sac, carton…)">Qté/contenant</th>
              <th style={{ textAlign: 'right' }} title="Délai de livraison du fournisseur, en jours">Délai livr.</th>
              <th style={{ textAlign: 'right' }} title="Quantité minimale de commande imposée par le fournisseur (MOQ)">Qté min.</th>
              <th>Réf.</th>
              <th style={{ width: 120, textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>
              {items.map(it => (
                <Fragment key={it.id}>
                  <tr style={{ opacity: it.is_blocked ? 0.5 : 1, background: it.is_preferred ? 'rgba(245,158,11,0.06)' : undefined }}>
                    <td style={{ fontWeight: 500 }}>
                      {it.is_preferred && <Star size={13} style={{ display: 'inline', color: '#f59e0b', fill: '#f59e0b', marginRight: 5, verticalAlign: '-2px' }} />}
                      {it.supplier_name}
                      {it.is_blocked && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Bloqué</span>}
                      {!it.supplier_active && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Inactif</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {priceEdit?.id === it.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input type="number" step="0.01" min="0" autoFocus value={priceEdit.val} style={{ ...inp, width: 100, textAlign: 'right', padding: '0.25rem 0.4rem' }}
                            onChange={e => setPriceEdit({ id: it.id, val: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter' && priceEdit.val) addPrice.mutate({ id: it.id, price: Number(priceEdit.val) }); if (e.key === 'Escape') setPriceEdit(null); }} />
                          <button className="odoo-btn-primary" style={{ padding: '0.25rem 0.4rem' }} disabled={!priceEdit.val || addPrice.isPending} onClick={() => addPrice.mutate({ id: it.id, price: Number(priceEdit.val) })}><Check size={12} /></button>
                          <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.4rem' }} onClick={() => setPriceEdit(null)}><X size={12} /></button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                          {it.current_price != null
                            ? <b>{money(Number(it.current_price))}</b>
                            : <span style={{ color: 'var(--theme-text-muted)' }}>à saisir</span>}
                          {it.current_price_source === 'reception' && <span className="odoo-tag odoo-tag-grey" style={{ fontSize: '0.62rem' }} title="Dernier prix relevé à la réception">auto</span>}
                          <button className="odoo-btn-secondary" style={{ padding: '0.15rem 0.35rem' }} title="Saisir / modifier le prix" onClick={() => setPriceEdit({ id: it.id, val: it.current_price != null ? String(it.current_price) : '' })}><Pencil size={11} /></button>
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{it.qty_per_container != null ? `${it.qty_per_container}${unit ? ' ' + unit : ''}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{it.lead_time_days != null ? `${it.lead_time_days} j` : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{it.moq != null ? it.moq : '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.82rem' }}>{it.supplier_reference || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.4rem', marginRight: 3 }} title="Historique des prix" onClick={() => setHistId(histId === it.id ? null : it.id)}>{histId === it.id ? <ChevronDown size={12} /> : <Clock size={12} />}</button>
                      {!it.is_preferred && !it.is_blocked && (
                        <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.4rem', marginRight: 3 }} title="Définir comme préféré" onClick={() => prefer.mutate(it.id)}><Star size={12} /></button>
                      )}
                      <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.4rem', marginRight: 3 }} title={it.is_blocked ? 'Débloquer' : 'Bloquer'} onClick={() => block.mutate({ id: it.id, v: !it.is_blocked })}><Ban size={12} /></button>
                      <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.4rem', color: '#dc2626' }} title="Retirer" onClick={() => archive.mutate(it.id)}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                  {histId === it.id && <PriceHistoryRow supplierItemId={it.id} colSpan={7} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(560px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Truck size={16} /> Ajouter un fournisseur</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={field}><span style={lbl}>Fournisseur</span>
            <select value={sup} onChange={e => setSup(e.target.value)} style={inp}>
              <option value="">— Choisir —</option>
              {avail.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={field}><span style={lbl}>Prix d'achat{unit ? ` / ${unit}` : ''} <span style={{ fontWeight: 400 }}>(optionnel)</span></span>
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" style={{ ...inp, paddingRight: 40 }} />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>DH</span>
              </div>
            </label>
            <label style={field}><span style={lbl}>Réf. fournisseur <span style={{ fontWeight: 400 }}>(optionnel)</span></span>
              <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Code chez le fournisseur" style={inp} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={field}><span style={lbl}>Qté / contenant{unit ? ` (${unit})` : ''}</span>
              <input type="number" step="0.001" min="0" value={qpc} onChange={e => setQpc(e.target.value)} placeholder="ex. 25" style={inp} />
              <span style={{ fontSize: '0.68rem', color: 'var(--theme-text-muted)' }}>Contenu d'un sac/carton</span></label>
            <label style={field}><span style={lbl}>Délai de livraison</span>
              <input type="number" min="0" value={lead} onChange={e => setLead(e.target.value)} placeholder="en jours" style={inp} />
              <span style={{ fontSize: '0.68rem', color: 'var(--theme-text-muted)' }}>Jours commande → livraison</span></label>
            <label style={field}><span style={lbl}>Qté min. de commande</span>
              <input type="number" min="0" step="0.001" value={moq} onChange={e => setMoq(e.target.value)} placeholder="optionnel" style={inp} />
              <span style={{ fontSize: '0.68rem', color: 'var(--theme-text-muted)' }}>Minimum imposé (MOQ)</span></label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!sup || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Ajouter</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// Historique des prix d'une fiche article × fournisseur (mig 405).
function PriceHistoryRow({ supplierItemId, colSpan }: { supplierItemId: string; colSpan: number }) {
  const { data: prices = [], isLoading } = useQuery({ queryKey: ['supplier-item-prices', supplierItemId], queryFn: () => supplierItemsApi.prices(supplierItemId) });
  const sourceLabel: Record<string, string> = { manual: 'Saisi', reception: 'Réception', po: 'Commande', invoice: 'Facture', quote: 'Devis' };
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'rgba(127,127,127,0.05)', padding: '8px 14px' }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Historique des prix</div>
        {isLoading ? (
          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8rem' }}><Loader2 size={12} className="animate-spin" style={{ display: 'inline' }} /> …</span>
        ) : prices.length === 0 ? (
          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8rem' }}>Aucun prix enregistré pour l'instant.</span>
        ) : (
          <table style={{ width: '100%', fontSize: '0.78rem' }}>
            <thead><tr style={{ color: 'var(--theme-text-muted)' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Prix</th>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Depuis</th>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Jusqu'à</th>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Origine</th>
            </tr></thead>
            <tbody>{(prices as SupplierItemPrice[]).map(pr => (
              <tr key={pr.id}>
                <td style={{ padding: '2px 6px', fontVariantNumeric: 'tabular-nums', fontWeight: pr.valid_to ? 400 : 600 }}>{Number(pr.price).toFixed(2)} {pr.currency}</td>
                <td style={{ padding: '2px 6px' }}>{new Date(pr.valid_from).toLocaleDateString('fr-FR')}</td>
                <td style={{ padding: '2px 6px' }}>{pr.valid_to ? new Date(pr.valid_to).toLocaleDateString('fr-FR') : <b style={{ color: '#2e7d32' }}>en vigueur</b>}</td>
                <td style={{ padding: '2px 6px', color: 'var(--theme-text-muted)' }}>{sourceLabel[pr.source] ?? pr.source}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </td>
    </tr>
  );
}
