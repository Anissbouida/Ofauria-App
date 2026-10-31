import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Ban, Trash2, Plus, Loader2, X, Check } from 'lucide-react';
import { supplierItemsApi, suppliersApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

const inp: React.CSSProperties = { padding: '0.4rem 0.5rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit', fontSize: '0.82rem', width: '100%' };

/**
 * Fiche article × fournisseur (mig 404) — Achats lot prix P1.
 * Remplace l'input texte `supplier` mono-valué par la gestion des N fournisseurs
 * d'un article (référence, conditionnement, délai, MOQ, préféré, bloqué).
 */
export default function SupplierItemsSection({ kind, purchasableId, unit }: { kind: 'ingredient' | 'packaging'; purchasableId: string; unit?: string }) {
  const qc = useQueryClient();
  const key = ['supplier-items', kind, purchasableId];
  const { data: items = [], isLoading } = useQuery({ queryKey: key, queryFn: () => supplierItemsApi.byPurchasable(kind, purchasableId) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'active'], queryFn: suppliersApi.listActive });
  const inv = () => qc.invalidateQueries({ queryKey: key });

  const [showAdd, setShowAdd] = useState(false);
  const [sup, setSup] = useState(''); const [ref, setRef] = useState('');
  const [qpc, setQpc] = useState(''); const [lead, setLead] = useState(''); const [moq, setMoq] = useState('');

  const create = useMutation({
    mutationFn: () => supplierItemsApi.create({
      supplierId: sup, kind, purchasableId, supplierReference: ref || null,
      qtyPerContainer: qpc || null, leadTimeDays: lead || null, moq: moq || null,
    }),
    onSuccess: () => { notify.success('Fournisseur ajouté'); setShowAdd(false); setSup(''); setRef(''); setQpc(''); setLead(''); setMoq(''); inv(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const prefer = useMutation({ mutationFn: (id: string) => supplierItemsApi.prefer(id), onSuccess: inv, onError: e => notify.error(apiErrorMessage(e)) });
  const block = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => supplierItemsApi.update(id, { isBlocked: v }), onSuccess: inv, onError: e => notify.error(apiErrorMessage(e)) });
  const archive = useMutation({ mutationFn: (id: string) => supplierItemsApi.archive(id), onSuccess: () => { notify.success('Fournisseur retiré'); inv(); }, onError: e => notify.error(apiErrorMessage(e)) });

  const used = new Set(items.map(i => i.supplier_id));
  const avail = (suppliers as { id: string; name: string }[]).filter(s => !used.has(s.id));

  return (
    <div className="odoo-scope" style={{ padding: '0.5rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>
          Fournisseurs de cet article — le fournisseur <b>préféré</b> est proposé par défaut à l'achat.
        </span>
        {!showAdd && avail.length > 0 && (
          <button className="odoo-btn-primary" onClick={() => setShowAdd(true)}><Plus size={13} /> Ajouter un fournisseur</button>
        )}
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 10, marginBottom: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, alignItems: 'end' }}>
          <label style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)', gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 3 }}>Fournisseur
            <select value={sup} onChange={e => setSup(e.target.value)} style={inp}>
              <option value="">— Choisir —</option>
              {avail.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>Réf. fournisseur
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Optionnel" style={inp} /></label>
          <label style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>Qté / contenant{unit ? ` (${unit})` : ''}
            <input type="number" step="0.001" min="0" value={qpc} onChange={e => setQpc(e.target.value)} placeholder="Ex. 25" style={inp} /></label>
          <label style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>Délai (jours)
            <input type="number" min="0" value={lead} onChange={e => setLead(e.target.value)} placeholder="Ex. 2" style={inp} /></label>
          <label style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>MOQ
            <input type="number" min="0" step="0.001" value={moq} onChange={e => setMoq(e.target.value)} placeholder="Min. commande" style={inp} /></label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="odoo-btn-primary" disabled={!sup || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Ajouter</button>
            <button className="odoo-btn-secondary" onClick={() => setShowAdd(false)}><X size={13} /></button>
          </div>
        </div>
      )}

      {isLoading && <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}

      {!isLoading && items.length === 0 && !showAdd && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>
          Aucun fournisseur. Ajoutez-en un pour gérer le multi-sourcing et (bientôt) les prix datés.
        </div>
      )}

      {items.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr>
              <th>Fournisseur</th><th>Réf.</th><th style={{ textAlign: 'right' }}>Qté/contenant</th>
              <th style={{ textAlign: 'right' }}>Délai</th><th style={{ textAlign: 'right' }}>MOQ</th><th style={{ width: 120 }} />
            </tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ opacity: it.is_blocked ? 0.55 : 1 }}>
                  <td style={{ fontWeight: 500 }}>
                    {it.is_preferred && <Star size={12} style={{ display: 'inline', color: '#f59e0b', fill: '#f59e0b', marginRight: 4 }} />}
                    {it.supplier_name}
                    {it.is_blocked && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Bloqué</span>}
                    {!it.supplier_active && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Inactif</span>}
                  </td>
                  <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.82rem' }}>{it.supplier_reference || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.qty_per_container != null ? `${it.qty_per_container}${unit ? ' ' + unit : ''}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.lead_time_days != null ? `${it.lead_time_days} j` : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.moq != null ? it.moq : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!it.is_preferred && !it.is_blocked && (
                      <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.45rem', marginRight: 4 }} title="Définir comme préféré" onClick={() => prefer.mutate(it.id)}><Star size={12} /></button>
                    )}
                    <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.45rem', marginRight: 4 }} title={it.is_blocked ? 'Débloquer' : 'Bloquer'} onClick={() => block.mutate({ id: it.id, v: !it.is_blocked })}><Ban size={12} /></button>
                    <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.45rem', color: '#dc2626' }} title="Retirer" onClick={() => archive.mutate(it.id)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
