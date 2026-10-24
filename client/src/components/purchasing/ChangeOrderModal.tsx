import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, FilePenLine } from 'lucide-react';
import ModalBackdrop from '../ui/ModalBackdrop';
import { StatusBanner } from '../ui/StatusBanner';
import { useReferentiel } from '../../hooks/useReferentiel';
import { purchaseOrdersApi, newIdempotencyKey } from '../../api/purchase-orders.api';
import { notify } from '../ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Demande de changement (avenant) d'un BC engagé (mig 307).
 *
 * Seules les valeurs modifiées sont envoyées. Le serveur refuse ce qui contredit les faits :
 * quantité sous ce qui est déjà reçu ou clôturé, prix d'un BC déjà facturé. Chaque avenant
 * crée une version numérotée, motivée, avec le détail des changements.
 */
type Line = {
  id: string; ingredient_name: string; base_unit?: string | null; ingredient_unit?: string;
  qty_container: string | null; qty_per_container: string; line_container_label?: string | null;
  quantity_ordered: string; qty_received_base: string; qty_cancelled_base: string;
  unit_price: string | null; discount_pct: string; tva_rate: string | null;
};

type Draft = { qtyContainer: string; unitPrice: string; discountPct: string; tvaRate: string };

const num = (v: string | null | undefined) => (v == null || v === '' ? null : Number(v));
const fmt = (v: number | null) => (v == null ? '' : String(Number(v.toFixed(4))));

export default function ChangeOrderModal({ po, onClose }: {
  po: { id: string; order_number: string; expected_delivery_date?: string | null; notes?: string | null; items: Line[] };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { entries } = useReferentiel('purchase_reason_codes');
  const reasons = entries.filter(e => Array.isArray(e.metadata?.scope) && (e.metadata!.scope as string[]).includes('change'));
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [expected, setExpected] = useState(po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : '');
  const [idemKey] = useState(newIdempotencyKey);
  const initial = useMemo(() => Object.fromEntries(po.items.map(l => [l.id, {
    qtyContainer: fmt(num(l.qty_container) ?? Number(l.quantity_ordered) / Number(l.qty_per_container)),
    unitPrice: fmt(num(l.unit_price)), discountPct: fmt(num(l.discount_pct) ?? 0), tvaRate: fmt(num(l.tva_rate)),
  } satisfies Draft])), [po.items]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const { data: versions = [] } = useQuery({ queryKey: ['po-versions', po.id], queryFn: () => purchaseOrdersApi.versions(po.id) });

  const selected = reasons.find(r => r.id === reasonCodeId);
  const requiresNote = !!selected?.metadata?.requires_note;

  const payloadLines = po.items.flatMap(l => {
    const d = drafts[l.id]; const i = initial[l.id];
    const out: { id: string; qtyContainer?: number; unitPrice?: number | null; discountPct?: number; tvaRate?: number | null } = { id: l.id };
    if (d.qtyContainer !== i.qtyContainer && d.qtyContainer !== '') out.qtyContainer = Number(d.qtyContainer);
    if (d.unitPrice !== i.unitPrice) out.unitPrice = d.unitPrice === '' ? null : Number(d.unitPrice);
    if (d.discountPct !== i.discountPct && d.discountPct !== '') out.discountPct = Number(d.discountPct);
    if (d.tvaRate !== i.tvaRate) out.tvaRate = d.tvaRate === '' ? null : Number(d.tvaRate);
    return Object.keys(out).length > 1 ? [out] : [];
  });
  const expectedChanged = expected !== (po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : '');
  const hasChanges = payloadLines.length > 0 || expectedChanged;
  const valid = hasChanges && !!reasonCodeId && (!requiresNote || note.trim().length >= 3);

  const mutation = useMutation({
    mutationFn: () => purchaseOrdersApi.changeOrder(po.id, {
      reasonCodeId, note: note.trim() || undefined,
      header: expectedChanged ? { expectedDeliveryDate: expected || null } : undefined,
      lines: payloadLines.length ? payloadLines : undefined,
    }, idemKey),
    onSuccess: (r: { version_no: number }) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['po-actions', po.id] });
      queryClient.invalidateQueries({ queryKey: ['po-versions', po.id] });
      notify.success(`Avenant enregistré : ${po.order_number} révision ${r.version_no}`);
      onClose();
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Avenant refusé')),
  });

  const set = (id: string, k: keyof Draft, v: string) => setDrafts(d => ({ ...d, [id]: { ...d[id], [k]: v } }));
  const inputCls = 'w-full px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 920, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <FilePenLine size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Demande de changement</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{po.order_number} · révision {versions.length ? Math.max(...versions.map((v: { version_no: number }) => v.version_no)) + 1 : 1}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StatusBanner tone="info" icon={FilePenLine} title="Le BC est engagé : chaque modification devient une révision motivée">
            Une quantité ne descend pas sous ce qui est déjà reçu ou clôturé. Le prix d'un BC facturé ne change plus ici.
          </StatusBanner>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Article</th>
                <th style={{ textAlign: 'right' }}>Contenants</th>
                <th style={{ textAlign: 'right' }}>= base</th>
                <th style={{ textAlign: 'right' }}>Reçu + clôturé</th>
                <th style={{ textAlign: 'right' }}>Prix / unité</th>
                <th style={{ textAlign: 'right' }}>Remise %</th>
                <th style={{ textAlign: 'right' }}>TVA %</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map(l => {
                const d = drafts[l.id];
                const per = Number(l.qty_per_container);
                const unit = l.base_unit || l.ingredient_unit || '';
                const floor = Number(l.qty_received_base) + Number(l.qty_cancelled_base);
                const base = d.qtyContainer === '' ? null : Number(d.qtyContainer) * per;
                const below = base != null && base < floor - 0.0001;
                return (
                  <tr key={l.id}>
                    <td>{l.ingredient_name}{per !== 1 && <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> · {l.line_container_label ?? 'contenant'} de {per} {unit}</span>}</td>
                    <td style={{ width: 100 }}><input className={inputCls} type="number" step="any" min="0" value={d.qtyContainer} onChange={e => set(l.id, 'qtyContainer', e.target.value)} style={below ? { borderColor: '#dc3545' } : undefined} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: below ? '#dc3545' : 'var(--theme-text-muted)' }}>{base != null ? `${fmt(base)} ${unit}` : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}>{fmt(floor)} {unit}</td>
                    <td style={{ width: 110 }}><input className={inputCls} type="number" step="any" min="0" value={d.unitPrice} onChange={e => set(l.id, 'unitPrice', e.target.value)} /></td>
                    <td style={{ width: 80 }}><input className={inputCls} type="number" step="any" min="0" max="100" value={d.discountPct} onChange={e => set(l.id, 'discountPct', e.target.value)} /></td>
                    <td style={{ width: 80 }}><input className={inputCls} type="number" step="any" min="0" max="100" value={d.tvaRate} onChange={e => set(l.id, 'tvaRate', e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="co-expected" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Livraison prévue</label>
              <input id="co-expected" type="date" value={expected} onChange={e => setExpected(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
            </div>
            <div>
              <label htmlFor="co-reason" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Motif *</label>
              <select id="co-reason" value={reasonCodeId} onChange={e => setReasonCodeId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm">
                <option value="">— Choisir un motif —</option>
                {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="co-note" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Précision{requiresNote ? ' *' : ''}</label>
            <textarea id="co-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          </div>
          {versions.length > 0 && (
            <div>
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Révisions</div>
              <table className="odoo-table">
                <tbody>
                  {versions.map((v: { version_no: number; created_at: string; created_by_name: string | null; reason_label: string | null; reason_note: string | null; reconstituted: boolean; diff: Array<{ path: string; old: unknown; new: unknown }> | null }) => (
                    <tr key={v.version_no}>
                      <td style={{ width: 60 }}><b>v{v.version_no}</b></td>
                      <td style={{ width: 140, color: 'var(--theme-text-muted)' }}>{new Date(v.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td style={{ width: 160 }}>{v.created_by_name ?? '—'}</td>
                      <td>
                        {v.version_no === 0 ? (v.reconstituted ? 'Version d\'engagement (reconstituée)' : 'Version envoyée')
                          : <>{v.reason_label}{v.reason_note ? ` · ${v.reason_note}` : ''}
                              {v.diff?.length ? <ul style={{ margin: '2px 0 0', paddingLeft: 16, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                                {v.diff.map((d, i) => <li key={i}>{d.path} : {String(d.old ?? '∅')} → {String(d.new ?? '∅')}</li>)}
                              </ul> : null}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Retour</button>
          <button type="button" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {mutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Enregistrer la révision
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
