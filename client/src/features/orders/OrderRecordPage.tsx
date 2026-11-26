import { money, currencySymbol } from '../../utils/money';
import { usePermissions } from '../../context/PermissionsContext';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay } from 'date-fns';
import {
  ArrowLeft, Check, ClipboardList, Loader2, Minus, Pencil, CalendarClock, Banknote, Ban, Trash2, Building2, Phone, FileText,
  type LucideIcon,
} from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { ordersApi } from '../../api/orders.api';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { useAuth } from '../../context/AuthContext';
import OrderFormModal from '../../components/orders/OrderFormModal';
import { NextStep } from '../sales/ListTemplate';
import {
  TYPE_LABELS, orderNextStep, CAN_CANCEL, CAN_RESCHEDULE, isPro, customerName, num, n, fmtDate, isLate, daysLate,
  DeliverModal, ProDeliverModal, RescheduleModal, PrepaymentModal,
} from './OrdersPage';
import { OrderStatusTag } from './OrderSplit';
import { LoadingState, ErrorState, EmptyState } from '../../components/ds';

/**
 * Fiche commande (refonte Ventes, maquette planche 3) : en-tête avec l'action de l'étape
 * suivante, frise devis → commande → livraison → facture → encaissement (chaque pièce
 * s'ouvre), lignes avec quantités livrées et reliquat, colonne client (encours contre
 * plafond), pièces liées et historique reconstitué. Les fenêtres de livraison, report et
 * acompte sont celles de la liste des commandes.
 */

type Row = Record<string, any>;
type StepTone = 'done' | 'current' | 'warn' | '';
const INVOICE_STATUS: Record<string, { label: string; tone: StatusTone; icon?: LucideIcon }> = {
  pending: { label: 'À encaisser', tone: 'todo' }, partial: { label: 'Partielle', tone: 'progress' },
  paid: { label: 'Soldée', tone: 'done' }, draft: { label: 'Brouillon', tone: 'draft' },
};
const BL_STATUS: Record<string, { label: string; tone: StatusTone; icon?: LucideIcon }> = {
  delivered: { label: 'À facturer', tone: 'todo', icon: FileText }, invoiced: { label: 'Facturé', tone: 'done' }, cancelled: { label: 'Annulé', tone: 'cancelled' },
};
const STAGE_ORDER = ['pending', 'confirmed', 'in_production', 'ready', 'partially_delivered', 'completed'];

/** Historique reconstitué d'une commande (création, devis, reports, livraisons, factures), du plus récent au plus ancien. */
export function orderHistory(o: Row) {
  const ev: Array<{ at: string; tone: string; text: string; sub: string }> = [];
  ev.push({ at: o.created_at, tone: 'grey', text: 'Commande créée', sub: `${o.created_by_name || '—'} · ${fmtDate(o.created_at, 'dd/MM/yyyy HH:mm')}` });
  if (o.links?.quote) ev.push({ at: o.links.quote.quote_date, tone: 'green', text: `Devis ${o.links.quote.number}`, sub: fmtDate(o.links.quote.quote_date) });
  for (const r of (o.reschedules ?? []) as Row[]) ev.push({ at: r.created_at, tone: 'orange', text: `Retrait reporté au ${fmtDate(r.new_pickup_date, 'dd/MM')}`, sub: `${r.created_by_name || '—'}${r.reason ? ` · ${r.reason}` : ''}` });
  for (const d of (o.links?.deliveryNotes ?? []) as Row[]) ev.push({ at: d.delivery_date, tone: d.status === 'cancelled' ? 'grey' : 'blue', text: `Livraison ${d.number}${d.status === 'cancelled' ? ' (annulée)' : ''}`, sub: `${d.created_by_name || '—'} · ${fmtDate(d.delivery_date)}` });
  for (const i of (o.links?.invoices ?? []) as Row[]) ev.push({ at: i.invoice_date, tone: i.status === 'paid' ? 'green' : 'orange', text: `${i.kind === 'credit_note' ? 'Avoir' : 'Facture'} ${i.invoice_number}`, sub: `${INVOICE_STATUS[i.status]?.label ?? i.status} · ${fmtDate(i.invoice_date)}` });
  return ev.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** Frise de la chaîne d'une commande (devis → … → encaissement), chaque étape avec son état. */
export function orderSteps(o: Row) {
  const st = o.status as string;
  const pro = isPro(o);
  const late = isLate(o, startOfDay(new Date()));
  const bls: Row[] = (o.links?.deliveryNotes ?? []).filter((d: Row) => d.status !== 'cancelled');
  const invoices: Row[] = (o.links?.invoices ?? []).filter((i: Row) => i.kind !== 'credit_note');
  const quote: Row | null = o.links?.quote ?? null;
  const advance = num(o.advance_amount);
  const invoicePaid = invoices.length > 0 && invoices.every(i => i.status === 'paid');
  const credit = o.customer_credit as Row | null;
  const idx = STAGE_ORDER.indexOf(st);
  const reached = (k: string) => idx >= STAGE_ORDER.indexOf(k);
  const steps: Array<{ label: string; sub: string; tone: StepTone; href?: string }> = [];
  if (quote) steps.push({ label: 'Devis', sub: `${quote.number} · ${fmtDate(quote.quote_date, 'dd MMM')}`, tone: 'done', href: `/quotes?open=${quote.id}` });
  steps.push({ label: 'Confirmée', sub: fmtDate(o.created_at, 'dd MMM'), tone: reached('confirmed') ? 'done' : 'current' });
  steps.push({ label: 'Préparée', sub: reached('ready') ? 'prête' : st === 'in_production' ? 'en atelier' : 'à lancer', tone: reached('ready') ? 'done' : st === 'in_production' ? (late ? 'warn' : 'current') : '' });
  const handedOver = st === 'completed' || st === 'partially_delivered';
  steps.push(pro
    ? { label: 'Livraison', sub: bls.length ? `${bls.map(b => b.number).join(', ')}${st === 'partially_delivered' ? ' · partielle' : ''}` : `prévue le ${fmtDate(o.pickup_date, 'dd MMM')}`, tone: st === 'completed' ? 'done' : st === 'partially_delivered' ? 'warn' : st === 'ready' ? (late ? 'warn' : 'current') : '', href: bls[0] ? `/delivery-notes?open=${bls[0].id}` : undefined }
    : { label: 'Retrait', sub: handedOver ? 'remise au client' : `le ${fmtDate(o.pickup_date, 'dd MMM')}`, tone: handedOver ? 'done' : st === 'ready' ? (late ? 'warn' : 'current') : '' });
  if (pro) steps.push({ label: 'Facture', sub: invoices.length ? invoices.map(i => i.invoice_number).join(', ') : 'à émettre', tone: invoices.length ? 'done' : '', href: invoices.length ? '/sales?tab=invoices' : undefined });
  steps.push(pro
    ? { label: 'Encaissement', sub: invoicePaid ? 'soldée' : invoices.length ? `échéance ${invoices[0].due_date ? fmtDate(invoices[0].due_date, 'dd MMM') : 'non fixée'}` : credit?.delai_paiement_jours ? `à ${credit.delai_paiement_jours} jours` : 'à la facture', tone: invoicePaid ? 'done' : invoices.some(i => i.status === 'partial') ? 'warn' : '' }
    : { label: 'Encaissement', sub: st === 'completed' ? 'soldée' : advance > 0 ? `avance ${money(advance)}` : 'au retrait', tone: st === 'completed' ? 'done' : advance > 0 ? 'warn' : '' });

  return steps;
}

/** Statut d'une ligne d'ordre de fabrication (M2-08). */
const PLAN_ITEM_STATUS: Record<string, string> = {
  pending: 'à produire', in_progress: 'en production', produced: 'produit', transferred: 'transféré', received: 'reçu', cancelled: 'annulé',
};

export default function OrderRecordPage() {
  const productionOn = usePermissions().moduleActive('production');
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // Écran d'origine (ex. bon de livraison) : le lien retour y ramène, sinon la liste des commandes.
  const from = (useLocation().state as { from?: { label: string; href: string } } | null)?.from ?? { label: 'Commandes', href: '/orders' };
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [tab, setTab] = useState<'lines' | 'deliveries' | 'invoices' | 'history'>('lines');
  const [modal, setModal] = useState<'edit' | 'deliver' | 'reschedule' | 'prepay' | null>(null);

  const { data: o, isLoading, error } = useQuery({ queryKey: ['order-detail', id], queryFn: () => ordersApi.getById(id), enabled: !!id });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['order-detail', id] }); };
  const status = useMutation({
    mutationFn: (s: string) => ordersApi.updateStatus(id, s),
    onSuccess: (res: unknown) => {
      refresh(); notify.success('Statut mis à jour');
      for (const w of (res as { plan_warnings?: string[] } | undefined)?.plan_warnings ?? []) notify.warning(w);
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la mise à jour')),
  });
  const remove = useMutation({
    mutationFn: () => ordersApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); notify.success('Commande supprimée'); navigate('/orders'); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Impossible de supprimer la commande')),
  });

  const history = useMemo(() => (o ? orderHistory(o) : []), [o]);

  if (isLoading) return <div className="prj sal-page"><LoadingState label="Chargement de la commande…" /></div>;
  if (error || !o) {
    return (
      <div className="prj sal-page">
        <ErrorState title="Commande introuvable" text={getApiErrorMessage(error, 'Elle a peut-être été supprimée.')} error={error} />
        <div><button type="button" className="odoo-btn-secondary" onClick={() => navigate('/orders')}>Retour aux commandes</button></div>
      </div>
    );
  }

  const st = o.status as string;
  const pro = isPro(o);
  const today = startOfDay(new Date());
  const late = isLate(o, today);
  const items: Row[] = o.items ?? [];
  const bls: Row[] = (o.links?.deliveryNotes ?? []).filter((d: Row) => d.status !== 'cancelled');
  const invoices: Row[] = (o.links?.invoices ?? []).filter((i: Row) => i.kind !== 'credit_note');
  const quote: Row | null = o.links?.quote ?? null;
  const total = num(o.total);
  const advance = num(o.advance_amount);
  const discount = num(o.discount_amount);
  const tax = num(o.tax_amount);
  const promo = num(o.promotion_amount);
  const deliveredHt = items.reduce((s, it) => s + num(it.qty_delivered) * num(it.unit_price), 0);
  const restHt = items.reduce((s, it) => s + Math.max(0, num(it.quantity) - num(it.qty_delivered) - num(it.qty_cancelled)) * num(it.unit_price), 0);
  const invoicePaid = invoices.length > 0 && invoices.every(i => i.status === 'paid');
  const credit = o.customer_credit as Row | null;
  const limit = credit?.credit_limit != null ? num(credit.credit_limit) : null;
  const exposure = credit ? num(credit.exposure) : 0;

  const steps = orderSteps(o);

  /* ── Actions ── */
  const step = orderNextStep(st, productionOn);
  const next = step
    ? { label: step.label, icon: step.icon, run: () => status.mutate(step.to) }
    : st === 'ready' ? { label: pro ? 'Livrer' : 'Remettre au client', icon: Check, run: () => setModal('deliver') }
    : st === 'partially_delivered' && pro ? { label: 'Livrer le reliquat', icon: Check, run: () => setModal('deliver') } : null;
  const cancel = async () => {
    const msg = advance > 0 ? `Annuler la commande ${o.order_number} ? L'avance de ${money(advance)} reste acquise : elle n'est pas remboursée.` : `Annuler la commande ${o.order_number} ?`;
    if (await confirm(msg, { title: 'Annuler la commande', confirmLabel: 'Annuler la commande', cancelLabel: 'Retour', danger: true })) status.mutate('cancelled');
  };
  const more: RowMenuItem[] = [];
  if (st !== 'completed' && st !== 'cancelled' && st !== 'partially_delivered') more.push({ label: 'Modifier', icon: Pencil, onSelect: () => setModal('edit') });
  if (CAN_RESCHEDULE.has(st)) more.push({ label: 'Reporter le retrait', icon: CalendarClock, onSelect: () => setModal('reschedule') });
  if (pro && isDirection && st !== 'cancelled' && st !== 'completed') more.push({ label: "Facture d'acompte", icon: Banknote, onSelect: () => setModal('prepay') });
  if (CAN_CANCEL.has(st)) more.push({ label: 'Annuler la commande', icon: Ban, danger: true, onSelect: cancel });
  if (st === 'cancelled') more.push({ label: 'Supprimer définitivement', icon: Trash2, danger: true, onSelect: async () => { if (await confirm(`Supprimer définitivement la commande annulée ${o.order_number} ?`, { title: 'Supprimer la commande', confirmLabel: 'Supprimer', danger: true })) remove.mutate(); } });

  const allInvoices: Row[] = o.links?.invoices ?? [];
  const allNotes: Row[] = o.links?.deliveryNotes ?? [];
  const tabs: Array<[typeof tab, string, number | null]> = [
    ['lines', 'Lignes', items.length], ['deliveries', 'Livraisons', bls.length], ['invoices', 'Factures', allInvoices.length], ['history', 'Historique', null],
  ];
  const initials = customerName(o).split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';

  return (
    <div className="prj prj-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', color: 'var(--ds-muted)', flexWrap: 'wrap' }}>
        <button type="button" className="sal-link" style={{ marginLeft: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => navigate(from.href)}><ArrowLeft size={14} /> {from.label}</button>
        <span aria-hidden="true">›</span><span>{o.order_number}</span>
      </div>

      <section className="prj-panel prj-hero">
        <div className="prj-hero-top">
          <span className="prj-hero-icon"><ClipboardList size={22} /></span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.order_number}</h1>
              <OrderStatusTag status={st} />
              <span className={`odoo-tag ${pro ? 'odoo-tag-blue' : 'odoo-tag-grey'}`}>{pro ? 'Professionnel' : o.customer_id ? 'Particulier' : 'Passager'}</span>
              {late && <StatusTag tone="late" label={`Retrait en retard de ${daysLate(o, today)} j`} />}
            </div>
            <div className="prj-hero-meta">
              <span>{customerName(o)}</span>
              <span>{pro ? 'Livraison' : 'Retrait'} le {fmtDate(o.pickup_date, 'dd MMM yyyy')}</span>
              {o.type && TYPE_LABELS[o.type] && <span>{TYPE_LABELS[o.type]}</span>}
              <span>Créée par {o.created_by_name || '—'} le {fmtDate(o.created_at, 'dd MMM')}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {next && <button type="button" className="odoo-btn-primary" disabled={status.isPending} onClick={next.run} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><next.icon size={14} /> {next.label}</button>}
            <RowMenu items={more} label="Autres actions" />
          </div>
        </div>
        {st === 'cancelled' ? (
          <p className="prj-note" style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>Commande annulée{advance > 0 ? ` · avance de ${money(advance)} conservée` : ''}.</p>
        ) : (
          <ol className="sal-steps" aria-label="Avancement de la commande">
            {steps.map(s => (
              <li key={s.label} className={`sal-step ${s.tone}`} aria-current={s.tone === 'current' || s.tone === 'warn' ? 'step' : undefined}>
                <span className="sal-step-mark">{s.tone === 'done' ? <Check size={13} strokeWidth={3} /> : s.tone ? <Minus size={13} strokeWidth={3} /> : null}</span>
                <b>{s.label}</b>
                <small>{s.href ? <button type="button" className="sal-link" style={{ marginLeft: 0, fontSize: 'inherit' }} onClick={() => navigate(s.href!)}>{s.sub}</button> : s.sub}</small>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="prj-columns">
        <div className="prj-main">
          <section className="prj-panel">
            <div className="prj-tabs" role="tablist" aria-label="Contenu de la commande">
              {tabs.map(([k, label, count]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`prj-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
                  {label}{count != null && <small>{count}</small>}
                </button>
              ))}
            </div>

            {tab === 'lines' && (<>
              <div className="prj-scroll">
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr>
                    <th>Produit</th><th className="ds-num">Commandé</th><th className="ds-num">Livré</th><th className="ds-num">Reste</th>
                    <th className="ds-num">PU{pro ? ' HT' : ''} ({currencySymbol()})</th>{pro && <th>TVA</th>}<th className="ds-num">Montant{pro ? ' HT' : ''} ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>
                    {items.map((it, i) => {
                      const qty = num(it.quantity); const dl = num(it.qty_delivered); const rest = Math.max(0, qty - dl - num(it.qty_cancelled));
                      return (
                        <tr key={it.id ?? i} style={{ cursor: 'default' }}>
                          <td><span className="ds-strong">{it.product_name || it.product_id}</span>{it.notes && <span className="sal-sub">{it.notes}</span>}
                            {Array.isArray(it.production_lines) && it.production_lines.map((pl: { plan_id: string; of_number: string; item_status: string; planned_quantity: number }) => (
                              <a key={pl.plan_id} href={`/production/${pl.plan_id}`} onClick={(e) => { e.preventDefault(); navigate(`/production/${pl.plan_id}`); }}
                                className="sal-sub" title="Ordre de fabrication qui sert cette ligne" style={{ display: 'block' }}>
                                {pl.of_number} · {PLAN_ITEM_STATUS[pl.item_status] ?? pl.item_status} · {Number(pl.planned_quantity)} planifié(s)
                              </a>
                            ))}
                          </td>
                          <td className="ds-num">{qty}</td>
                          <td className="ds-num">{dl}</td>
                          <td className="ds-num">{rest > 0 && st !== 'cancelled' ? <span style={{ color: 'var(--ds-warning)', fontWeight: 600 }}>{rest}</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                          <td className="ds-num">{n(num(it.unit_price))}</td>
                          {pro && <td>{it.tva_rate != null ? (num(it.tva_rate) ? `${num(it.tva_rate)} %` : 'Exonéré') : '—'}</td>}
                          <td className="ds-num ds-strong">{n(qty * num(it.unit_price))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16 }}>
                <div style={{ flex: '1 1 280px', display: 'grid', gap: 8 }}>
                  {o.notes && <p className="prj-note" style={{ whiteSpace: 'pre-line' }}><strong style={{ color: 'var(--ds-ink)' }}>Note : </strong>{o.notes}</p>}
                  {pro && restHt > 0.004 && st !== 'cancelled' && <p className="prj-note">Reste à livrer : <strong style={{ color: 'var(--ds-warning)' }}>{money(restHt)} HT</strong>.</p>}
                  {!pro && advance > 0 && st !== 'completed' && <p className="prj-note">Avance non remboursable · le solde est encaissé au retrait.</p>}
                </div>
                <dl className="sal-totals">
                  <dt>Sous-total{pro ? ' HT' : ''}</dt><dd>{n(total + discount - tax)}</dd>
                  {promo > 0 && <><dt>Promotions</dt><dd>−{n(promo)}</dd></>}
                  {discount - promo > 0.004 && <><dt>Remise{o.discount_pct != null ? ` (${num(o.discount_pct)} %)` : ''}</dt><dd>−{n(discount - promo)}</dd></>}
                  {pro && <><dt>TVA</dt><dd>{n(tax)}</dd></>}
                  <dt className="big">Total{pro ? ' TTC' : ''}</dt><dd className="big">{money(total)}</dd>
                  {pro && deliveredHt > 0 && <><dt>Déjà livré</dt><dd>{n(deliveredHt)} HT</dd></>}
                  {!pro && advance > 0 && <><dt>Avance versée</dt><dd>{n(advance)}</dd><dt>Reste à payer</dt><dd><strong>{n(st === 'completed' ? 0 : Math.max(0, total - advance))}</strong></dd></>}
                </dl>
              </div>
            </>)}

            {tab === 'deliveries' && (allNotes.length ? (
              <div className="prj-scroll"><table className="odoo-table" style={{ margin: 0 }}>
                <thead><tr><th>N° BL</th><th>Date</th><th>Par</th><th>Statut</th><th className="ds-num">HT ({currencySymbol()})</th><th className="ds-num">TTC ({currencySymbol()})</th></tr></thead>
                <tbody>{allNotes.map(d => (
                  <tr key={d.id} onClick={() => navigate(`/delivery-notes?open=${d.id}`)} style={{ cursor: 'pointer' }}>
                    <td><span className="ds-ref">{d.number}</span></td><td>{fmtDate(d.delivery_date)}</td><td>{d.created_by_name || '—'}</td>
                    <td><StatusTag tone={BL_STATUS[d.status]?.tone ?? 'draft'} icon={BL_STATUS[d.status]?.icon} label={BL_STATUS[d.status]?.label ?? d.status} />{d.invoice_number && <span className="sal-sub sal-mono">{d.invoice_number}</span>}</td>
                    <td className="ds-num">{n(num(d.total_ht))}</td><td className="ds-num ds-strong">{n(num(d.total_ttc))}</td>
                  </tr>))}</tbody>
              </table></div>
            ) : <EmptyState bare icon={ClipboardList} title={pro ? 'Aucune livraison pour cette commande' : 'Pas de bon de livraison'} text={pro ? undefined : 'Commande de particulier : remise au comptoir, sans bon de livraison.'} />)}

            {tab === 'invoices' && (allInvoices.length ? (
              <div className="prj-scroll"><table className="odoo-table" style={{ margin: 0 }}>
                <thead><tr><th>N°</th><th>Date</th><th>Échéance</th><th>Statut</th><th className="ds-num">Total ({currencySymbol()})</th><th className="ds-num">Encaissé ({currencySymbol()})</th></tr></thead>
                <tbody>{allInvoices.map(i => (
                  <tr key={i.id} onClick={() => navigate('/sales?tab=invoices')} style={{ cursor: 'pointer' }}>
                    <td><span className="ds-ref">{i.invoice_number}</span>{i.kind === 'credit_note' && <span className="sal-sub">avoir</span>}</td>
                    <td>{fmtDate(i.invoice_date)}</td><td>{i.due_date ? fmtDate(i.due_date) : '—'}</td>
                    <td><StatusTag tone={INVOICE_STATUS[i.status]?.tone ?? 'draft'} icon={INVOICE_STATUS[i.status]?.icon} label={INVOICE_STATUS[i.status]?.label ?? i.status} /></td>
                    <td className="ds-num ds-strong">{n(num(i.total_amount))}</td>
                    <td className="ds-num">{n(num(i.paid_amount))}</td>
                  </tr>))}</tbody>
              </table></div>
            ) : <EmptyState bare icon={FileText} title="Pas de facture" text={pro ? 'Elle naît de la livraison.' : 'Commande de particulier : encaissée en caisse, sans facture.'} />)}

            {tab === 'history' && (
              <ul className="prj-feed" style={{ padding: 16 }}>
                {history.map((h, i) => <li key={i}><span className={`prj-dot ${h.tone === 'blue' ? '' : h.tone}`} /><div>{h.text}<small>{h.sub}</small></div></li>)}
              </ul>
            )}
          </section>
        </div>

        <aside className="prj-aside" aria-label="Contexte de la commande">
          <section className="prj-panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="prj-hero-icon" style={{ width: 40, height: 40, borderRadius: '50%' }}>
                {pro ? <Building2 size={18} /> : <span style={{ fontWeight: 700, fontSize: '13px' }}>{initials}</span>}
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{customerName(o)}</strong>
                <span className="sal-sub">{pro ? 'Professionnel' : o.customer_id ? 'Particulier' : 'Client de passage'}</span>
              </div>
            </div>
            <dl className="prj-dl">
              {o.customer_phone && <><dt>Téléphone</dt><dd style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {o.customer_phone}</dd></>}
              {credit?.email && <><dt>E-mail</dt><dd>{credit.email}</dd></>}
              {pro && <><dt>Paiement</dt><dd>{credit?.delai_paiement_jours ? `${credit.delai_paiement_jours} jours` : 'comptant'}</dd></>}
              {pro && <><dt>ICE</dt><dd>{credit?.ice || <span className="odoo-tag odoo-tag-orange">À saisir</span>}</dd></>}
            </dl>
            {credit && (exposure > 0 || limit != null) && (
              <div className="prj-meter">
                <div className="prj-meter-head"><span>{limit != null ? 'Encours / plafond' : 'Encours'}</span><strong>{n(exposure)}{limit != null ? ` / ${n(limit)}` : ''} {currencySymbol()}</strong></div>
                {limit != null && limit > 0 && (
                  <div className={`prj-bar ${exposure > limit ? 'red' : exposure > limit * 0.85 ? 'orange' : 'green'}`} role="progressbar" aria-label="Encours du client" aria-valuenow={Math.round(exposure / limit * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.min(100, exposure / limit * 100)}%` }} />
                  </div>
                )}
                {credit.credit_hold && <span className="sal-late-txt">Client bloqué (relances)</span>}
              </div>
            )}
            {o.customer_id && <button type="button" className="sal-link" style={{ marginLeft: 0, justifySelf: 'start' }} onClick={() => navigate(`/customers/${o.customer_id}`)}>Ouvrir la fiche client</button>}
          </section>

          <section className="prj-panel">
            <h2>Pièces liées</h2>
            <ul className="sal-docs">
              {/* Type de pièce en gris (catégorie) ; l'état de la pièce en étiquette de statut commune. */}
              {quote && <li><span className="odoo-tag odoo-tag-grey">Devis</span><button type="button" className="sal-link sal-doc-main" onClick={() => navigate(`/quotes?open=${quote.id}`)}>{quote.number}</button><span className="sal-mono">{n(num(quote.total))}</span></li>}
              {allNotes.map(d => <li key={d.id}><span className="odoo-tag odoo-tag-grey">BL</span><button type="button" className="sal-link sal-doc-main" onClick={() => navigate(`/delivery-notes?open=${d.id}`)}>{d.number}</button>{BL_STATUS[d.status] && <StatusTag tone={BL_STATUS[d.status].tone} icon={BL_STATUS[d.status].icon} label={BL_STATUS[d.status].label} />}<span className="sal-mono">{n(num(d.total_ttc))}</span></li>)}
              {allInvoices.map(i => <li key={i.id}><span className="odoo-tag odoo-tag-grey">{i.kind === 'credit_note' ? 'Avoir' : 'Facture'}</span><button type="button" className="sal-link sal-doc-main" onClick={() => navigate('/sales?tab=invoices')}>{i.invoice_number}</button>{INVOICE_STATUS[i.status] && <StatusTag tone={INVOICE_STATUS[i.status].tone} label={INVOICE_STATUS[i.status].label} />}<span className="sal-mono">{n(num(i.total_amount))}</span></li>)}
              {!quote && !allNotes.length && !allInvoices.length && <li className="sal-sub" style={{ margin: 0 }}>Aucune pièce liée pour l'instant.</li>}
            </ul>
            {pro && st === 'ready' && <NextStep icon={Check} label="Créer le bon de livraison" onClick={() => setModal('deliver')} />}
          </section>

          <section className="prj-panel">
            <h2>Historique</h2>
            <ul className="prj-feed">
              {history.slice(0, 5).map((h, i) => <li key={i}><span className={`prj-dot ${h.tone === 'blue' ? '' : h.tone}`} /><div>{h.text}<small>{h.sub}</small></div></li>)}
            </ul>
          </section>
        </aside>
      </div>

      {modal === 'edit' && <OrderFormModal order={o} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {modal === 'deliver' && (pro
        ? <ProDeliverModal order={o} onClose={() => setModal(null)} onDelivered={() => { setModal(null); refresh(); ['delivery-notes', 'invoices'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); }} />
        : <DeliverModal order={o} onClose={() => setModal(null)} onDelivered={() => { setModal(null); refresh(); qc.invalidateQueries({ queryKey: ['sales'] }); }} />)}
      {modal === 'reschedule' && <RescheduleModal order={o} isDirection={isDirection} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'prepay' && <PrepaymentModal order={o} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
}
