import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Scale, Check, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { receptionVouchersApi } from '../../api/purchase-orders.api';
import { SectionHeader, DataPanel, TableFooter, EmptyState, LoadingState, Alert, ErrorState } from '../../components/ds';
import { currencySymbol } from '../../utils/money';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Écarts de prix d'achat (lot L3 P2P) — contrôle de gestion réservé au gérant/admin.
 *
 *  1. Écarts à la réception (incrément 2/5) : le magasinier saisit un prix, le
 *     gérant approuve ou rejette l'écart avec le prix du BC. Décision tracée.
 *  2. Simulation de réévaluation (incrément 3/5) : quand la facture arrive à un
 *     prix différent du coût du lot, ce que la réévaluation DÉPLACERAIT (part en
 *     stock / part déjà consommée). Lecture seule — AUCUNE écriture n'est passée.
 *     La réévaluation effective reste un geste séparé, conditionné à un compte
 *     d'écart (IPV) dans les profils de posting et à un dry-run de validation.
 */

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (v: string | null) => (v ? format(new Date(v), 'd MMM yyyy', { locale: fr }) : '—');

interface VarianceRow {
  id: string;
  voucher_number: string | null;
  reception_date: string | null;
  supplier_name: string | null;
  order_number: string | null;
  item_name: string | null;
  po_unit_price: string | number | null;
  unit_price: string | number | null;
  unit_delta: string | number | null;
  price_status: 'variance' | 'approved' | 'rejected';
  price_decision_note: string | null;
  price_decided_at: string | null;
  decided_by_name: string | null;
}

interface CandidateRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  supplier_name: string | null;
  lines: string | number;
  total_stock: string | number;
  total_variance: string | number;
}

interface PreviewLine {
  ingredient_lot_id: string;
  item_name: string | null;
  lot_unit_cost: string | number;
  invoice_unit_price: string | number;
  unit_delta: string | number;
  qty_basis: string | number;
  qty_remaining: string | number;
  amount_to_stock: string | number;
  amount_to_variance: string | number;
}

const STATUS_TAG: Record<VarianceRow['price_status'], { label: string; tone: StatusTone }> = {
  variance: { label: 'À décider', tone: 'todo' },
  approved: { label: 'Approuvé', tone: 'done' },
  rejected: { label: 'Rejeté', tone: 'blocked' },
};

export default function PriceVariancesTab() {
  const queryClient = useQueryClient();

  const { data: variances = [], isLoading: loadingVar, error: varError, refetch: refetchVar } = useQuery<VarianceRow[]>({
    queryKey: ['reception-price-variances'],
    queryFn: () => receptionVouchersApi.priceVariances(),
  });

  const { data: candidates = [], isLoading: loadingCand, error: candError, refetch: refetchCand } = useQuery<CandidateRow[]>({
    queryKey: ['reception-revaluation-candidates'],
    queryFn: () => receptionVouchersApi.revaluationCandidates(),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      receptionVouchersApi.decidePrice(id, decision),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ['reception-price-variances'] });
      notify.success(v.decision === 'approved' ? 'Écart approuvé' : 'Écart rejeté');
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const toDecide = variances.filter(v => v.price_status === 'variance').length;

  return (
    <>
      {/* ─── 1. Écarts de prix à la réception (prix saisi vs prix BC) ─── */}
      <SectionHeader title="Écarts à la réception" note={toDecide > 0 ? `${toDecide} à décider` : undefined} />
      {loadingVar ? <LoadingState /> : varError ? <ErrorState error={varError} onRetry={() => { void refetchVar(); }} /> : variances.length === 0 ? (
        <EmptyState icon={Check} title="Aucun écart de prix"
          text="Toutes les réceptions sont au prix du bon de commande. Un écart entre le prix saisi à la réception et le prix commandé apparaît ici ; la décision est tracée." />
      ) : (
        <DataPanel label="Écarts de prix à la réception"
          footer={<TableFooter note={`${variances.length} écart${variances.length > 1 ? 's' : ''}${toDecide > 0 ? ` · ${toDecide} à décider` : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Réception</th><th>Date</th><th>Fournisseur</th><th>Article</th>
                <th className="ds-num">Prix commandé ({currencySymbol()})</th>
                <th className="ds-num">Prix reçu ({currencySymbol()})</th>
                <th className="ds-num">Écart par unité ({currencySymbol()})</th>
                <th>Statut</th><th className="ds-actions">Décision</th>
              </tr>
            </thead>
            <tbody>
              {variances.map(v => {
                const delta = Number(v.unit_delta ?? 0);
                const tag = STATUS_TAG[v.price_status];
                return (
                  <tr key={v.id}>
                    <td className="ds-ref">{v.voucher_number ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d(v.reception_date)}</td>
                    <td>{v.supplier_name ?? '—'}</td>
                    <td className="ds-strong">{v.item_name ?? '—'}</td>
                    <td className="ds-num">{money(v.po_unit_price)}</td>
                    <td className="ds-num">{money(v.unit_price)}</td>
                    <td className="ds-num ds-strong" style={{ color: delta > 0 ? 'var(--ds-danger)' : delta < 0 ? 'var(--ds-success)' : undefined }}>
                      {delta > 0 ? '+' : ''}{money(delta)}
                    </td>
                    <td><StatusTag tone={tag.tone} label={tag.label} /></td>
                    <td className="ds-actions">
                      {v.price_status === 'variance' ? (
                        <>
                          <button type="button" className="ds-btn-danger ds-btn-sm" disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: v.id, decision: 'rejected' })}>Rejeter</button>
                          <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: v.id, decision: 'approved' })}>Approuver</button>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--ds-muted)', whiteSpace: 'normal' }}>
                          {v.decided_by_name ?? '—'}{v.price_decided_at ? ` · ${d(v.price_decided_at)}` : ''}
                          {v.price_decision_note ? ` — ${v.price_decision_note}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* ─── 2. Simulation de réévaluation (écart facture vs coût du lot) ─── */}
      <SectionHeader title="Réévaluation sur écart de prix" note="simulation" />
      <Alert tone="info" icon={Info}>
        Simulation en lecture seule : aucune écriture n'est passée. La part encore en stock réévaluerait le lot (et le coût moyen), la part déjà consommée
        partirait en compte d'écart. La réévaluation effective est un geste séparé : elle exige un compte « price_variance » dans les profils de comptabilisation.
      </Alert>
      {loadingCand ? <LoadingState /> : candError ? <ErrorState error={candError} onRetry={() => { void refetchCand(); }} /> : candidates.length === 0 ? (
        <EmptyState icon={Scale} title="Aucune facture ne déclencherait de réévaluation"
          text="Les prix de facture correspondent aux prix reçus : rien à réévaluer." />
      ) : (
        <DataPanel label="Factures à réévaluer"
          footer={<TableFooter note={`${candidates.length} facture${candidates.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}><span className="sr-only">Détail</span></th>
                <th>Facture</th><th>Date</th><th>Fournisseur</th>
                <th className="ds-num">Lignes</th>
                <th className="ds-num">À réévaluer en stock ({currencySymbol()})</th>
                <th className="ds-num">En écart ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <CandidateRows key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

/** Ligne de facture candidate + détail par lot (déplié à la demande). */
function CandidateRows({ c }: { c: CandidateRow }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ lines: PreviewLine[]; ipv_account: string | null }>({
    queryKey: ['reception-revaluation-preview', c.id],
    queryFn: () => receptionVouchersApi.revaluationPreview(c.id),
    enabled: open,
  });

  return (
    <>
      <tr>
        <td>
          <button type="button" className="ds-icon-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}
            aria-label={`${open ? 'Replier' : 'Afficher'} le détail de la facture ${c.invoice_number ?? ''}`.trim()}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="ds-ref">{c.invoice_number ?? '—'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{d(c.invoice_date)}</td>
        <td className="ds-strong">{c.supplier_name ?? '—'}</td>
        <td className="ds-num">{c.lines}</td>
        <td className="ds-num">{money(c.total_stock)}</td>
        <td className="ds-num">{money(c.total_variance)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--ds-bg)', padding: 12 }}>
            {isLoading ? <LoadingState bare label="Chargement du détail…" /> : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--ds-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  Compte d'écart :
                  {data?.ipv_account
                    ? <StatusTag tone="done" label={data.ipv_account} />
                    : <StatusTag tone="blocked" label="Non configuré" />}
                  requis pour la réévaluation effective (profil « price_variance »).
                </div>
                <DataPanel label="Détail de la réévaluation">
                <table className="odoo-table ds-dense">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th className="ds-num">Coût du lot ({currencySymbol()})</th>
                      <th className="ds-num">Prix facturé ({currencySymbol()})</th>
                      <th className="ds-num">Écart par unité ({currencySymbol()})</th>
                      <th className="ds-num">Qté facturée</th>
                      <th className="ds-num">Qté en stock</th>
                      <th className="ds-num">Part en stock ({currencySymbol()})</th>
                      <th className="ds-num">Part en écart ({currencySymbol()})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.lines ?? []).map(l => (
                      <tr key={l.ingredient_lot_id}>
                        <td>{l.item_name ?? '—'}</td>
                        <td className="ds-num">{money(l.lot_unit_cost)}</td>
                        <td className="ds-num">{money(l.invoice_unit_price)}</td>
                        <td className="ds-num">{money(l.unit_delta)}</td>
                        <td className="ds-num">{money(l.qty_basis)}</td>
                        <td className="ds-num">{money(l.qty_remaining)}</td>
                        <td className="ds-num">{money(l.amount_to_stock)}</td>
                        <td className="ds-num">{money(l.amount_to_variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </DataPanel>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
