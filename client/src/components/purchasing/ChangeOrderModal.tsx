import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePenLine } from 'lucide-react';
import { StatusBanner } from '../ui/StatusBanner';
import { useReferentiel } from '../../hooks/useReferentiel';
import { purchaseOrdersApi, newIdempotencyKey } from '../../api/purchase-orders.api';
import { notify } from '../ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';
import { DataPanel, FormField, FormFooter, Modal } from '../ds';

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
  const inputCls = 'ds-input sm ds-num';

  return (
    <Modal title="Demande de changement" width={920} onClose={onClose} locked={mutation.isPending}
      subtitle={`${po.order_number} · révision ${versions.length ? Math.max(...versions.map((v: { version_no: number }) => v.version_no)) + 1 : 1}`}
      footer={
        <FormFooter onCancel={onClose} onSubmit={() => mutation.mutate()} busy={mutation.isPending} disabled={!valid}
          submitLabel="Enregistrer la révision" dirty={hasChanges} />
      }>
          <StatusBanner tone="info" icon={FilePenLine} title="Le BC est engagé : chaque modification devient une révision motivée">
            Une quantité ne descend pas sous ce qui est déjà reçu ou clôturé. Le prix d'un BC facturé ne change plus ici.
          </StatusBanner>
          <DataPanel label="Lignes du bon de commande">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Article</th>
                <th className="ds-num">Contenants</th>
                <th className="ds-num">= base</th>
                <th className="ds-num">Reçu + clôturé</th>
                <th className="ds-num">Prix / unité ({currencySymbol()})</th>
                <th className="ds-num">Remise (%)</th>
                <th className="ds-num">TVA (%)</th>
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
                    <td className="ds-strong">{l.ingredient_name}{per !== 1 && <span style={{ color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 }}> · {l.line_container_label ?? 'contenant'} de {per} {unit}</span>}</td>
                    <td style={{ width: 100 }}><input className={inputCls} type="number" step="any" min="0" value={d.qtyContainer} onChange={e => set(l.id, 'qtyContainer', e.target.value)}
                      aria-label={`Contenants, ${l.ingredient_name}`} aria-invalid={below || undefined} title={below ? 'Sous la quantité déjà reçue ou clôturée' : undefined} /></td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap', color: below ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: below ? 600 : undefined }}>{base != null ? `${fmt(base)} ${unit}` : '—'}</td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)' }}>{fmt(floor)} {unit}</td>
                    <td style={{ width: 110 }}><input className={inputCls} type="number" step="any" min="0" value={d.unitPrice} onChange={e => set(l.id, 'unitPrice', e.target.value)} aria-label={`Prix par unité, ${l.ingredient_name}`} /></td>
                    <td style={{ width: 80 }}><input className={inputCls} type="number" step="any" min="0" max="100" value={d.discountPct} onChange={e => set(l.id, 'discountPct', e.target.value)} aria-label={`Remise en pourcentage, ${l.ingredient_name}`} /></td>
                    <td style={{ width: 80 }}><input className={inputCls} type="number" step="any" min="0" max="100" value={d.tvaRate} onChange={e => set(l.id, 'tvaRate', e.target.value)} aria-label={`TVA en pourcentage, ${l.ingredient_name}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </DataPanel>
          <div className="ds-form-grid">
            <FormField label="Livraison prévue" htmlFor="co-expected">
              <input id="co-expected" type="date" value={expected} onChange={e => setExpected(e.target.value)} className="ds-input" />
            </FormField>
            <FormField label="Motif" htmlFor="co-reason" required>
              <select id="co-reason" value={reasonCodeId} onChange={e => setReasonCodeId(e.target.value)} className="ds-input" aria-required="true">
                <option value="">— Choisir un motif —</option>
                {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Précision" htmlFor="co-note" required={requiresNote}
            hint={requiresNote ? 'Obligatoire pour ce motif (3 caractères au moins).' : undefined}>
            <textarea id="co-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className="ds-input" style={{ minHeight: 64 }} />
          </FormField>
          {versions.length > 0 && (
            <div>
              <h3 className="ds-subhead" style={{ marginBottom: 6 }}>Révisions</h3>
              <DataPanel label="Révisions">
              <table className="odoo-table ds-dense">
                <tbody>
                  {versions.map((v: { version_no: number; created_at: string; created_by_name: string | null; reason_label: string | null; reason_note: string | null; reconstituted: boolean; diff: Array<{ path: string; old: unknown; new: unknown }> | null }) => (
                    <tr key={v.version_no}>
                      <td style={{ width: 60 }}><span className="ds-ref">v{v.version_no}</span></td>
                      <td style={{ width: 160, color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{new Date(v.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ width: 160 }}>{v.created_by_name ?? '—'}</td>
                      <td>
                        {v.version_no === 0 ? (v.reconstituted ? 'Version d\'engagement (reconstituée)' : 'Version envoyée')
                          : <>{v.reason_label}{v.reason_note ? ` · ${v.reason_note}` : ''}
                              {v.diff?.length ? <ul style={{ margin: '2px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--ds-muted)' }}>
                                {v.diff.map((d, i) => <li key={i}>{d.path} : {String(d.old ?? '∅')} → {String(d.new ?? '∅')}</li>)}
                              </ul> : null}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </DataPanel>
            </div>
          )}
    </Modal>
  );
}
