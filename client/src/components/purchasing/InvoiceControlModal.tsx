import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, ShieldAlert, ShieldCheck, RefreshCw, Loader2, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import ModalBackdrop from '../ui/ModalBackdrop';
import { StatusBanner } from '../ui/StatusBanner';
import { notify } from '../ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { invoicesApi } from '../../api/accounting.api';
import ReasonCodeDialog from './ReasonCodeDialog';

/**
 * Contrôle d'une facture fournisseur (mig 309) : blocages posés par le rapprochement,
 * mentions légales, et tableau commandé / reçu / facturé / prix par ligne.
 * Un blocage « bloquant » empêche le paiement jusqu'à sa levée motivée.
 */
type Hold = {
  id: string; hold_code: string; label: string; blocks_payment: boolean; is_system: boolean;
  details: Record<string, any> | null; held_at: string; released_at: string | null; release_mode: string | null;
  release_note: string | null; release_reason: string | null; released_by_name: string | null;
};
type MatchRow = {
  invoice_item_id: string; item_name: string; purchase_order_item_id: string | null;
  quantity_ordered: string | null; quantity_received: string | null; quantity_invoiced_total: string; quantity_invoiced_here: string;
  po_unit_price: string | null; invoiced_unit_price: string; price_variance: string | null;
};
type Control = {
  id: string; invoice_number: string; supplier_invoice_number: string | null; validation_status: string; payment_status: string;
  legal_issues: Array<{ code: string; label: string }>; checked_at: string | null; payable: boolean;
  holds: Hold[]; match: MatchRow[];
};

const fmt = (v: string | number | null | undefined, d = 3) => (v == null ? '—' : Number(Number(v).toFixed(d)).toLocaleString('fr-FR'));

function holdDetail(h: Hold): string {
  const d = h.details ?? {};
  switch (h.hold_code) {
    case 'QTY_REC': return `${d.item} : facturé ${fmt(d.invoiced)} pour ${fmt(d.received)} reçu (tolérance ${d.tolerance_pct} %)`;
    case 'PRICE': return `${d.item} : ${fmt(d.invoiced_price, 4)} facturé contre ${fmt(d.po_price, 4)} commandé (tolérance ${d.tolerance_pct} %)`;
    case 'AMOUNT_MISMATCH': return d.declared_ttc != null ? `Déclaré ${fmt(d.declared_ttc, 2)} TTC, calculé ${fmt(d.computed_ttc, 2)}` : `Lignes ${fmt(d.lines_ht, 2)} HT, en-tête ${fmt(d.header_ht, 2)}`;
    case 'DUPLICATE_SUSPECT': return `Ressemble à la facture ${d.candidate_number} du ${d.candidate_date ? format(new Date(d.candidate_date), 'dd/MM/yyyy') : '?'}`;
    case 'TAX_VARIANCE': return d.lines_without_rate > 0 ? `${d.lines_without_rate} ligne(s) sans taux de TVA` : `TVA lignes ${fmt(d.lines_vat, 2)}, en-tête ${fmt(d.header_vat, 2)}`;
    case 'LEGAL_MENTIONS': return (d.issues ?? []).map((i: { label: string }) => i.label).join(' · ');
    case 'MANUAL': return d.note ?? '';
    default: return '';
  }
}

export default function InvoiceControlModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [revalidate, setRevalidate] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery<Control>({
    queryKey: ['invoice-control', invoiceId, revalidate],
    queryFn: () => invoicesApi.control(invoiceId, revalidate),
  });
  const [releaseFor, setReleaseFor] = useState<Hold | null>(null);
  const [manualNote, setManualNote] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice-control', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };
  const releaseMutation = useMutation({
    mutationFn: ({ holdId, reason }: { holdId: string; reason: { reasonCodeId: string; note?: string } }) => invoicesApi.releaseHold(holdId, reason),
    onSuccess: () => { notify.success('Blocage levé'); setReleaseFor(null); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Levée impossible')),
  });
  const holdMutation = useMutation({
    mutationFn: () => invoicesApi.addHold(invoiceId, manualNote.trim()),
    onSuccess: () => { notify.success('Facture bloquée'); setManualNote(''); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Blocage impossible')),
  });

  const open = (data?.holds ?? []).filter(h => !h.released_at);
  const closed = (data?.holds ?? []).filter(h => h.released_at);
  const blocking = open.filter(h => h.blocks_payment);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 940, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <ShieldCheck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Contrôle de facture</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{data ? (data.supplier_invoice_number ?? data.invoice_number) : '…'}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="odoo-btn-secondary" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 8 }}
            disabled={isFetching} onClick={() => { setRevalidate(true); refetch(); }} title="Relancer le contrôle">
            {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Recontrôler
          </button>
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        {isLoading || !data ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 className="animate-spin" size={18} /></div>
        ) : (
          <div className="flex-1 overflow-y-auto" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.validation_status === 'cancelled' ? (
              <StatusBanner tone="neutral" icon={ShieldCheck} title="Facture annulée">Aucun blocage actif.</StatusBanner>
            ) : blocking.length > 0 ? (
              <StatusBanner tone="danger" icon={ShieldAlert} title={`Paiement bloqué : ${blocking.length} blocage${blocking.length > 1 ? 's' : ''}`}>
                Vérifiez l'écart avec la pièce du fournisseur. Levez le blocage avec un motif s'il est justifié, ou corrigez la facture.
              </StatusBanner>
            ) : open.length > 0 ? (
              <StatusBanner tone="warning" icon={ShieldAlert} title="Payable, avec des points à régulariser">
                Ces alertes ne bloquent pas le paiement mais exposent la déductibilité de la TVA et de la charge.
              </StatusBanner>
            ) : (
              <StatusBanner tone="success" icon={ShieldCheck} title="Facture conforme au rapprochement">Commandé, reçu et facturé concordent.</StatusBanner>
            )}

            <div>
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Blocages ouverts</div>
              {open.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucun.</p> : (
                <table className="odoo-table">
                  <tbody>
                    {open.map(h => (
                      <tr key={h.id}>
                        <td style={{ width: 210 }}><span className={`odoo-tag ${h.blocks_payment ? 'odoo-tag-red' : 'odoo-tag-orange'}`}>{h.label}</span></td>
                        <td>{holdDetail(h)}{h.details?.legacy ? <span style={{ color: 'var(--theme-text-muted)' }}> · reprise</span> : null}</td>
                        <td style={{ width: 140, color: 'var(--theme-text-muted)' }}>{format(new Date(h.held_at), 'd MMM HH:mm', { locale: fr })}</td>
                        <td style={{ width: 110, textAlign: 'right' }}>
                          {h.hold_code !== 'LEGAL_MENTIONS' && h.hold_code !== 'TAX_VARIANCE' ? (
                            <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setReleaseFor(h)}>Lever</button>
                          ) : <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>se lève à la correction</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {data.match.some(m => m.purchase_order_item_id) && (
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Rapprochement par ligne</div>
                <table className="odoo-table">
                  <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Commandé</th><th style={{ textAlign: 'right' }}>Reçu</th><th style={{ textAlign: 'right' }}>Facturé (toutes factures)</th><th style={{ textAlign: 'right' }}>Prix commandé</th><th style={{ textAlign: 'right' }}>Prix facturé</th></tr></thead>
                  <tbody>
                    {data.match.map(m => {
                      const overQty = m.quantity_received != null && Number(m.quantity_invoiced_total) > Number(m.quantity_received) + 0.0001;
                      const priceGap = m.price_variance != null && Math.abs(Number(m.price_variance)) > 0.005;
                      return (
                        <tr key={m.invoice_item_id}>
                          <td>{m.item_name}{!m.purchase_order_item_id && <span style={{ color: 'var(--theme-text-muted)' }}> · hors commande</span>}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(m.quantity_ordered)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(m.quantity_received)}</td>
                          <td style={{ textAlign: 'right', color: overQty ? '#dc3545' : undefined, fontWeight: overQty ? 600 : undefined }}>{fmt(m.quantity_invoiced_total)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(m.po_unit_price, 4)}</td>
                          <td style={{ textAlign: 'right', color: priceGap ? '#b45309' : undefined, fontWeight: priceGap ? 600 : undefined }}>{fmt(m.invoiced_unit_price, 4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {data.validation_status === 'validated' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input id="manual-hold-note" value={manualNote} onChange={(e) => setManualNote(e.target.value)} maxLength={1000}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm" placeholder="Bloquer le paiement manuellement : raison (litige, qualité…)" />
                <button className="odoo-btn-secondary" disabled={manualNote.trim().length < 3 || holdMutation.isPending}
                  style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => holdMutation.mutate()}>
                  <PauseCircle size={13} /> Bloquer
                </button>
              </div>
            )}

            {closed.length > 0 && (
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Blocages levés</div>
                <table className="odoo-table">
                  <tbody>
                    {closed.map(h => (
                      <tr key={h.id} style={{ color: 'var(--theme-text-muted)' }}>
                        <td style={{ width: 210 }}>{h.label}</td>
                        <td>{h.release_mode === 'auto' ? 'Levé automatiquement : la cause a disparu' : `${h.release_reason ?? ''}${h.release_note ? ` · ${h.release_note}` : ''}`}</td>
                        <td style={{ width: 200 }}>{h.released_by_name ?? 'système'} · {h.released_at ? format(new Date(h.released_at), 'd MMM HH:mm', { locale: fr }) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {releaseFor && (
        <ReasonCodeDialog
          title={`Lever le blocage · ${releaseFor.label}`}
          scope="release_hold"
          description={holdDetail(releaseFor)}
          confirmLabel="Lever le blocage"
          pending={releaseMutation.isPending}
          onClose={() => setReleaseFor(null)}
          onSubmit={(reason) => releaseMutation.mutate({ holdId: releaseFor.id, reason })}
        />
      )}
    </ModalBackdrop>
  );
}
