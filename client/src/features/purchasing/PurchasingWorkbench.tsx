import { useMemo, useState } from 'react';
import { usePermissions } from '../../context/PermissionsContext';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { purchasingReportsApi } from '../../api/purchasing-reports.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { invoicesApi } from '../../api/accounting.api';
import { approvalsApi } from '../../api/approvals.api';
import { rfqApi } from '../../api/rfq.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PODetailModal } from '../accounting/PurchaseOrdersTab';
import { useOpenReception } from './purchasingNav';
import { Kpi } from '../projects/shared';
import { PurHeaderActions } from './PurHeaderActions';
import './purchasing.css';
import { money } from '../../utils/money';

/**
 * Poste de travail des achats (refonte 2026-11, style Apple) : le circuit d'achat en 8 étapes avec ce
 * qui coince à chacune, la liste des actions à mener (retards, devis à comparer,
 * approbations, factures bloquées ou échues, brouillons) et les montants à suivre.
 * Lecture seule : chaque action ouvre l'écran ou la fiche qui la traite.
 */
export type WorkbenchTab = 'identification' | 'purchase_requests' | 'rfq' | 'approvals' | 'purchase_orders' | 'reception' | 'invoices' | 'pilotage';
type Kind = 'po' | 'inv' | 'req' | 'rfq' | 'appr';
type Item = { key: string; kind: Kind; kindLabel: string; title: string; ref?: string; who?: string; amount?: number | null; due?: string; late?: boolean; urgent?: boolean; gap?: boolean; approval?: boolean; action: string; run: () => void };
type Filter = 'all' | 'urgent' | 'approval' | 'gap';

const dh = (v: number | string | null | undefined) => money(Math.round(Number(v ?? 0)), { decimals: 0 });
const day = (v: string | null | undefined) => (v ? format(new Date(v), 'd MMM', { locale: fr }) : '');
const quiet = { retry: false, staleTime: 60_000 } as const;

export default function PurchasingWorkbench({ onOpenTab, onOpenInvoice }: {
  onOpenTab: (k: WorkbenchTab) => void;
  onOpenInvoice: (f: { search?: string; view?: 'open' | 'history' }) => void;
}) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [poDetail, setPoDetail] = useState<string | null>(null);
  const openReception = useOpenReception();

  const { data: reco } = useQuery({ queryKey: ['p2p-flow', 'reco'], queryFn: replenishmentApi.recommendations, ...quiet });
  const { data: pr } = useQuery({ queryKey: ['p2p-flow', 'pr-count'], queryFn: purchaseRequestsApi.count, ...quiet });
  const { data: apprCount } = useQuery({ queryKey: ['approvals', 'count'], queryFn: approvalsApi.count, ...quiet });
  const { data: inbox = [] } = useQuery({ queryKey: ['approvals', 'inbox'], queryFn: approvalsApi.inbox, ...quiet });
  // Feuille de route 7.3 : demandes de prix lues seulement si la capacité est active.
  const { hasFeature } = usePermissions();
  const rfqOn = hasFeature('appels_offres');
  const { data: rfq } = useQuery({ queryKey: ['rfqs', 'workbench'], queryFn: () => rfqApi.list({ page: '1', pageSize: '20', status: 'quoted' }), ...quiet, enabled: rfqOn });
  const { data: rfqAll } = useQuery({ queryKey: ['p2p-flow', 'rfq'], queryFn: () => rfqApi.list({ page: '1', pageSize: '1' }), ...quiet, enabled: rfqOn });
  const { data: pipe, isLoading } = useQuery({ queryKey: ['purchase-orders', 'pipeline'], queryFn: purchaseOrdersApi.pipeline, ...quiet });
  const { data: drafts } = useQuery({ queryKey: ['purchase-orders', 'board', 'workbench-draft'], queryFn: () => purchaseOrdersApi.board({ view: 'open', stage: 'draft', page: '1', pageSize: '10' }), ...quiet });
  const { data: invPipe } = useQuery({ queryKey: ['invoices', 'received-pipeline'], queryFn: invoicesApi.receivedPipeline, ...quiet });
  const { data: blocked } = useQuery({ queryKey: ['invoices', 'received-board', 'workbench-blocked'], queryFn: () => invoicesApi.receivedBoard({ view: 'open', stage: 'blocked', page: '1', pageSize: '10' }), ...quiet });
  const { data: sum } = useQuery({ queryKey: ['purch-reports-summary'], queryFn: () => purchasingReportsApi.summary(), ...quiet });

  const poStage = (k: string) => pipe?.stages.find(s => s.stage === k);
  const invStage = (k: string) => invPipe?.stages.find(s => s.stage === k);
  const RFQ_OPEN = ['draft', 'sent', 'quoted'];
  const rfqOpen = rfqAll ? RFQ_OPEN.reduce((a, k) => a + (rfqAll.byStatus?.[k]?.count ?? 0), 0) : null;
  const rfqQuoted = rfqAll?.byStatus?.quoted?.count ?? 0;
  const rfqLate = rfqAll ? RFQ_OPEN.reduce((a, k) => a + (rfqAll.byStatus?.[k]?.overdue ?? 0), 0) : 0;
  const lateDeliveries = pipe?.late.length ?? 0;
  const toReceive = (poStage('sent')?.count ?? 0) + (poStage('partial')?.count ?? 0);
  const invToValidate = (invStage('draft')?.count ?? 0) + (invStage('blocked')?.count ?? 0);
  const toPay = ['to_pay', 'partial'].reduce((a, k) => a + Number(invStage(k)?.remaining ?? 0), 0);
  const toPayCount = ['to_pay', 'partial'].reduce((a, k) => a + (invStage(k)?.count ?? 0), 0);
  const overdueInv = invPipe?.late.length ?? 0;

  const stages: Array<{ n: number; label: string; count: number | null; sub: string; tone?: 'orange' | 'red'; go: () => void }> = [
    { n: 1, label: 'À commander', count: Array.isArray(reco) ? reco.length : null, sub: 'besoins détectés', tone: Array.isArray(reco) && reco.length ? 'orange' : undefined, go: () => onOpenTab('identification') },
    { n: 2, label: 'Demandes', count: pr?.count ?? null, sub: 'demandes d’achat à traiter', go: () => onOpenTab('purchase_requests') },
    { n: 3, label: 'Demandes de prix', count: rfqOpen, sub: rfqLate ? `${rfqLate} en retard` : rfqQuoted ? `${rfqQuoted} à comparer` : 'en cours', tone: rfqLate ? 'red' : rfqQuoted ? 'orange' : undefined, go: () => onOpenTab('rfq') },
    { n: 4, label: 'Approbation', count: apprCount ?? null, sub: 'en attente de décision', tone: apprCount ? 'orange' : undefined, go: () => onOpenTab('approvals') },
    { n: 5, label: 'Commandes', count: pipe ? (poStage('draft')?.count ?? 0) + toReceive : null, sub: lateDeliveries ? `${lateDeliveries} en retard de livraison` : `${poStage('draft')?.count ?? 0} brouillon(s)`, tone: lateDeliveries ? 'red' : undefined, go: () => onOpenTab('purchase_orders') },
    { n: 6, label: 'Réceptions', count: pipe ? toReceive : null, sub: 'livraisons attendues', go: () => onOpenTab('reception') },
    { n: 7, label: 'Factures', count: invPipe ? invToValidate : null, sub: (invStage('blocked')?.count ?? 0) ? `${invStage('blocked')!.count} bloquée(s)` : 'à valider', tone: (invStage('blocked')?.count ?? 0) ? 'orange' : undefined, go: () => onOpenTab('invoices') },
    { n: 8, label: 'Paiements', count: invPipe ? toPayCount : null, sub: overdueInv ? `${overdueInv} échue(s)` : `${dh(toPay)} à payer`, tone: overdueInv ? 'red' : undefined, go: () => onOpenTab('invoices') },
  ];

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const l of pipe?.late ?? []) out.push({
      key: `late-${l.id}`, kind: 'po', kindLabel: 'Commande', title: `Livraison en retard de ${l.days_late} j`, ref: l.order_number, who: l.supplier_name,
      due: `prévue le ${day(l.expected_delivery_date)}`, late: true, urgent: true, action: 'Ouvrir', run: () => setPoDetail(l.id),
    });
    for (const a of inbox) out.push({
      key: `appr-${a.id}`, kind: 'appr', kindLabel: 'Approbation', title: a.rule_label, ref: a.doc_label, who: a.requested_by_name ?? undefined,
      amount: a.amount != null ? Number(a.amount) : null, due: `depuis le ${day(a.requested_at)}`, approval: true, action: 'Décider', run: () => onOpenTab('approvals'),
    });
    for (const r of rfq?.rows ?? []) out.push({
      key: `rfq-${r.id}`, kind: 'rfq', kindLabel: 'Demande de prix', title: `${r.quotation_count} devis reçu${r.quotation_count > 1 ? 's' : ''} sur ${r.supplier_count} — ${r.title}`, ref: r.number,
      due: r.response_deadline ? `clôture ${day(r.response_deadline)}` : undefined, late: r.is_overdue, urgent: r.is_overdue, action: 'Comparer', run: () => onOpenTab('rfq'),
    });
    for (const inv of blocked?.rows ?? []) out.push({
      key: `blk-${inv.id}`, kind: 'inv', kindLabel: 'Facture', title: Number(inv.blocking_holds) > 1 ? `Paiement bloqué · ${inv.blocking_holds} blocages` : 'Paiement bloqué · écart ou litige à lever', ref: inv.invoice_number, who: inv.supplier_name,
      amount: Number(inv.total_amount) - Number(inv.paid_amount ?? 0), due: inv.due_date ? `échéance ${day(inv.due_date)}` : undefined, gap: true, action: 'Vérifier',
      run: () => onOpenInvoice({ search: inv.invoice_number, view: 'open' }),
    });
    for (const l of invPipe?.late ?? []) out.push({
      key: `due-${l.id}`, kind: 'inv', kindLabel: 'Facture', title: `Échéance dépassée de ${l.days_late} j`, ref: l.invoice_number, who: l.supplier_name,
      amount: Number(l.remaining), due: `échue le ${day(l.due_date)}`, late: true, urgent: true, action: 'Payer', run: () => onOpenInvoice({ search: l.invoice_number, view: 'open' }),
    });
    for (const po of drafts?.rows ?? []) out.push({
      key: `draft-${po.id}`, kind: 'po', kindLabel: 'Commande', title: po.approval_pending ? 'En attente d’approbation' : 'Brouillon à envoyer au fournisseur', ref: po.order_number, who: po.supplier_name,
      amount: po.total_amount != null ? Number(po.total_amount) : null, due: po.order_date ? `créé le ${day(po.order_date)}` : undefined, action: 'Ouvrir', run: () => setPoDetail(po.id),
    });
    if ((pr?.count ?? 0) > 0) out.push({
      key: 'pr', kind: 'req', kindLabel: 'Demande', title: `${pr!.count} demande${pr!.count > 1 ? 's' : ''} d’achat à traiter`, action: 'Ouvrir', run: () => onOpenTab('purchase_requests'),
    });
    return out.sort((a, b) => Number(!!b.late) - Number(!!a.late));
  }, [pipe, inbox, rfq, blocked, invPipe, drafts, pr, onOpenTab, onOpenInvoice]);

  const tests: Record<Filter, (i: Item) => boolean> = { all: () => true, urgent: i => !!i.urgent, approval: i => !!i.approval, gap: i => !!i.gap };
  const shown = items.filter(tests[filter]);
  const FILTERS: Array<[Filter, string]> = [['all', 'Tout'], ['urgent', 'Urgent'], ['approval', 'À approuver'], ['gap', 'Écarts']];

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" /></div>;

  return (
    <div className="prj">
      <PurHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => onOpenTab('purchase_requests')}>Nouvelle demande d’achat</button>
      </PurHeaderActions>
      <header className="kl-largetitle">
        <h1>Poste de travail</h1>
        <p>{format(new Date(), 'EEEE d MMMM', { locale: fr })} · {items.length
          ? <><b>{items.length} action{items.length > 1 ? 's' : ''}</b> vous attend{items.length > 1 ? 'ent' : ''} dans le circuit d’achat{user?.firstName ? `, ${user.firstName}` : ''}.</>
          : 'rien ne vous attend dans le circuit d’achat.'}</p>
      </header>

      <section aria-label="Circuit d’achat">
        <div className="kl-sec"><h2>Circuit d’achat</h2><small>Cliquez une étape pour ouvrir ses pièces</small></div>
        <div className="kl-widget">
          <ol className="pur-circuit">
            {stages.filter(s => s.n !== 3 || rfqOn).map(s => (
              <li key={s.n}>
                <button type="button" className={`pur-stage ${s.tone ?? ''}`} onClick={s.go}>
                  <span className="pur-stage-head">{s.label}</span>
                  <span className="pur-stage-count">{s.count ?? '—'}</span>
                  <span className="pur-stage-sub">{s.sub}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="kl-stats" aria-label="Montants à suivre">
        <Kpi label="Engagements ouverts" value={sum ? dh(sum.open_commitments.amount) : '…'} sub={sum ? `${sum.open_commitments.pos} BC commandés, non reçus` : undefined} />
        <Kpi label="Reçu, non facturé" value={sum ? dh(sum.received_not_invoiced.amount) : '…'}
          sub={sum ? `${sum.received_not_invoiced.lines} ligne(s)${sum.received_not_invoiced.aged ? ` · ${sum.received_not_invoiced.aged} > 30 j` : ''}` : undefined} />
        <Kpi label="À payer" value={invPipe ? dh(toPay) : '…'} sub={invPipe ? `${toPayCount} facture(s)${overdueInv ? ` · ${overdueInv} échue(s)` : ''}` : undefined} tone={overdueInv ? 'red' : undefined} />
        <Kpi label="Facturé, non reçu" value={sum ? dh(sum.invoiced_not_received.amount) : '…'} sub={sum ? `${sum.invoiced_not_received.lines} ligne(s) à vérifier avant paiement` : undefined}
          tone={sum && sum.invoiced_not_received.lines ? 'red' : undefined} />
      </section>

      <section aria-label="À traiter">
        <div className="kl-sec" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <h2>À traiter</h2>
          <div className="prj-views" role="group" aria-label="Filtrer">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l} <small>{items.filter(tests[k]).length}</small>
              </button>
            ))}
          </div>
        </div>
        {!shown.length ? (
          <StatusBanner tone="success" icon={CheckCircle2} title={items.length ? 'Rien dans ce filtre' : 'Tout est à jour'}>
            {items.length ? 'Changez de filtre pour voir les autres actions.' : 'Aucun retard, aucun devis à comparer, aucune facture bloquée.'}
          </StatusBanner>
        ) : (
          <div className="kl-group">
            <ul className="pur-inbox">
              {shown.map(i => (
                <li key={i.key}>
                  <span className={`pur-kind ${i.kind}`}>{i.kindLabel}</span>
                  <span className="pur-inbox-main">
                    <span className="pur-inbox-title">{i.title}</span>
                    {(i.ref || i.who) && <span className="pur-inbox-meta">{i.ref && <code>{i.ref}</code>}{i.ref && i.who ? ' · ' : ''}{i.who}</span>}
                  </span>
                  <span className="pur-inbox-amount">{i.amount != null ? dh(i.amount) : ''}</span>
                  <span className={`pur-inbox-due${i.late ? ' late' : ''}`}>{i.due ?? ''}</span>
                  <button type="button" className="odoo-btn-secondary" onClick={i.run}>{i.action}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="odoo-btn-secondary" onClick={() => onOpenTab('pilotage')} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Rapprochement détaillé <ArrowRight size={14} />
        </button>
      </section>

      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} onDelivery={() => openReception(poDetail)} />}
    </div>
  );
}
