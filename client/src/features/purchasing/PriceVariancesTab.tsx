import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ShieldAlert, Scale, Info, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { receptionVouchersApi } from '../../api/purchase-orders.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
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

const STATUS_TAG: Record<VarianceRow['price_status'], { label: string; cls: string }> = {
  variance: { label: 'À décider', cls: 'odoo-tag orange' },
  approved: { label: 'Approuvé', cls: 'odoo-tag success' },
  rejected: { label: 'Rejeté', cls: 'odoo-tag danger' },
};

export default function PriceVariancesTab() {
  const queryClient = useQueryClient();

  const { data: variances = [], isLoading: loadingVar } = useQuery<VarianceRow[]>({
    queryKey: ['reception-price-variances'],
    queryFn: () => receptionVouchersApi.priceVariances(),
  });

  const { data: candidates = [], isLoading: loadingCand } = useQuery<CandidateRow[]>({
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
    <div className="space-y-6">
      <StatusBanner tone="info" icon={ShieldAlert} title="Contrôle des prix d'achat">
        Le magasinier reçoit, le gérant décide. Un écart entre le prix saisi à la réception et le prix
        du bon de commande est signalé ici ; l'approbation ou le rejet est tracé.
      </StatusBanner>

      {/* ─── 1. Écarts de prix à la réception (prix saisi vs prix BC) ─── */}
      <section>
        <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>
          Écarts à la réception{toDecide > 0 ? ` · ${toDecide} à décider` : ''}
        </div>
        {loadingVar ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : variances.length === 0 ? (
          <StatusBanner tone="success" icon={Check} title="Aucun écart de prix">
            Toutes les réceptions sont au prix du bon de commande.
          </StatusBanner>
        ) : (
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Réception</th><th>Date</th><th>Fournisseur</th><th>Article</th>
                <th style={{ textAlign: 'right' }}>Prix BC</th>
                <th style={{ textAlign: 'right' }}>Prix reçu</th>
                <th style={{ textAlign: 'right' }}>Écart/u</th>
                <th>Statut</th><th style={{ textAlign: 'right' }}>Décision</th>
              </tr>
            </thead>
            <tbody>
              {variances.map(v => {
                const delta = Number(v.unit_delta ?? 0);
                const tag = STATUS_TAG[v.price_status];
                return (
                  <tr key={v.id}>
                    <td>{v.voucher_number ?? '—'}</td>
                    <td>{d(v.reception_date)}</td>
                    <td>{v.supplier_name ?? '—'}</td>
                    <td>{v.item_name ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{money(v.po_unit_price)}</td>
                    <td style={{ textAlign: 'right' }}>{money(v.unit_price)}</td>
                    <td style={{ textAlign: 'right', color: delta > 0 ? '#b91c1c' : delta < 0 ? '#047857' : undefined }}>
                      {delta > 0 ? '+' : ''}{money(delta)}
                    </td>
                    <td><span className={tag.cls}>{tag.label}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {v.price_status === 'variance' ? (
                        <span className="inline-flex gap-1">
                          <button className="odoo-btn-primary" disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: v.id, decision: 'approved' })}>
                            <Check size={13} /> Approuver
                          </button>
                          <button className="odoo-btn-secondary" disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: v.id, decision: 'rejected' })}>
                            <X size={13} /> Rejeter
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">
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
        )}
      </section>

      {/* ─── 2. Simulation de réévaluation (écart facture vs coût du lot) ─── */}
      <section>
        <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>
          Réévaluation sur écart de prix — simulation
        </div>
        <StatusBanner tone="warning" icon={Info} title="Lecture seule — aucune écriture n'est passée">
          Quand la facture arrive à un prix différent du coût du lot, l'écart se partage : la part
          encore en stock réévaluerait le lot (et le CMUP), la part déjà consommée partirait en compte
          d'écart (IPV). La réévaluation effective est un geste séparé : elle exige un compte
          « price_variance » dans les profils de posting et un dry-run de validation.
        </StatusBanner>
        {loadingCand ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : candidates.length === 0 ? (
          <StatusBanner tone="neutral" icon={Scale} title="Aucune facture ne déclencherait de réévaluation">
            Les prix de facture correspondent aux prix reçus : rien à réévaluer.
          </StatusBanner>
        ) : (
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Facture</th><th>Date</th><th>Fournisseur</th>
                <th style={{ textAlign: 'right' }}>Lignes</th>
                <th style={{ textAlign: 'right' }}>À réévaluer (stock)</th>
                <th style={{ textAlign: 'right' }}>En écart (IPV)</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <CandidateRows key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
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
          <button className="odoo-btn-link" onClick={() => setOpen(o => !o)} aria-label={open ? 'Replier' : 'Détail'}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </td>
        <td>{c.invoice_number ?? '—'}</td>
        <td>{d(c.invoice_date)}</td>
        <td>{c.supplier_name ?? '—'}</td>
        <td style={{ textAlign: 'right' }}>{c.lines}</td>
        <td style={{ textAlign: 'right' }}>{money(c.total_stock)}</td>
        <td style={{ textAlign: 'right' }}>{money(c.total_variance)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: '#fafafa' }}>
            {isLoading ? (
              <p className="text-sm text-gray-400 p-2">Chargement du détail…</p>
            ) : (
              <div className="p-2 space-y-2">
                <div className="text-xs text-gray-500">
                  Compte d'écart (IPV) :{' '}
                  {data?.ipv_account
                    ? <span className="odoo-tag success">{data.ipv_account}</span>
                    : <span className="odoo-tag danger">non configuré</span>}
                  {' '}— requis pour la réévaluation effective (profil de posting « price_variance »).
                </div>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th style={{ textAlign: 'right' }}>Coût lot</th>
                      <th style={{ textAlign: 'right' }}>Prix facture</th>
                      <th style={{ textAlign: 'right' }}>Écart/u</th>
                      <th style={{ textAlign: 'right' }}>Qté facturée</th>
                      <th style={{ textAlign: 'right' }}>Qté en stock</th>
                      <th style={{ textAlign: 'right' }}>→ Stock</th>
                      <th style={{ textAlign: 'right' }}>→ Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.lines ?? []).map(l => (
                      <tr key={l.ingredient_lot_id}>
                        <td>{l.item_name ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.lot_unit_cost)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.invoice_unit_price)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.unit_delta)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.qty_basis)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.qty_remaining)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.amount_to_stock)}</td>
                        <td style={{ textAlign: 'right' }}>{money(l.amount_to_variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
