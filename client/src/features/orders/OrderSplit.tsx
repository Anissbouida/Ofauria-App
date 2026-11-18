import { money } from '../../utils/money';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { startOfDay } from 'date-fns';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { ClipboardList, ClipboardCheck, ChefHat, PackageCheck, Truck, ExternalLink, Loader2, Phone, type LucideIcon } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { ordersApi } from '../../api/orders.api';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { TYPE_LABELS, isPro, customerName, num, n, fmtDate, isLate, daysLate } from './OrdersPage';
import { orderSteps, orderHistory } from './OrderRecordPage';

/** Statut d'une commande en étiquette commune (couleur + icône + libellé). */
export const ORDER_TONE: Record<string, { tone: StatusTone; icon?: LucideIcon }> = {
  pending: { tone: 'draft' },
  confirmed: { tone: 'progress', icon: ClipboardCheck },
  in_production: { tone: 'progress', icon: ChefHat },
  ready: { tone: 'todo', icon: PackageCheck },
  partially_delivered: { tone: 'progress', icon: Truck },
  completed: { tone: 'done' },
  cancelled: { tone: 'cancelled' },
};
export function OrderStatusTag({ status }: { status: string }) {
  const t = ORDER_TONE[status] ?? { tone: 'draft' as StatusTone };
  return <StatusTag tone={t.tone} icon={t.icon} label={ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status} />;
}

/**
 * Commandes en trois colonnes (style Apple, maquette 2026-11-14) : la barre du module, la
 * liste compacte des commandes, la fiche de la commande choisie à droite — on parcourt sans
 * quitter la liste. L'étape suivante et le menu « ⋯ » sont ceux de la liste (mêmes fenêtres).
 */

type Row = Record<string, any>;

const initials = (name: string) => name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';

/** Colonne de gauche : une ligne par commande, la sélection en couleur d'accent. */
export function OrderList({ orders, activeId, onPick }: { orders: Row[]; activeId: string | null; onPick: (id: string) => void }) {
  const today = startOfDay(new Date());
  return (
    <nav className="ord-list" aria-label="Commandes">
      {orders.map(o => {
        const id = o.id as string;
        const late = isLate(o, today);
        const st = o.status as string;
        const dayDiff = o.pickup_date ? Math.round((startOfDay(new Date(o.pickup_date as string)).getTime() - today.getTime()) / 86_400_000) : null;
        const when = dayDiff === 0 ? "Aujourd'hui" : dayDiff === 1 ? 'Demain' : dayDiff === -1 ? 'Hier' : fmtDate(o.pickup_date, 'd MMM');
        return (
          <button key={id} type="button" className={`ord-row${id === activeId ? ' sel' : ''}`} aria-current={id === activeId ? 'true' : undefined} onClick={() => onPick(id)}>
            <span className={`ord-dot${late ? ' late' : dayDiff === 0 && st !== 'completed' && st !== 'cancelled' ? ' today' : ''}`} aria-hidden="true" />
            <span className="ord-l1"><span className="ord-nm">{customerName(o)}</span><span className="ord-when">{when}</span></span>
            <span className="ord-l2"><span className="sal-num">{o.order_number as string}</span> · <b>{money(num(o.total))}</b></span>
            <span className="ord-l3">
              {late
                ? <StatusTag tone="late" label={`En retard de ${daysLate(o, today)} j`} />
                : <OrderStatusTag status={st} />}
              {late && <> {ORDER_STATUS_LABELS[st as keyof typeof ORDER_STATUS_LABELS] || st}</>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** Colonne de droite : la fiche de la commande choisie (détail chargé à la demande). */
export function OrderPane({ row, next, menu, busy }: {
  row: Row;
  next: { label: string; icon: LucideIcon; run: () => void } | null;
  menu: RowMenuItem[];
  busy: boolean;
}) {
  const navigate = useNavigate();
  const id = row.id as string;
  const { data: o, isLoading } = useQuery({ queryKey: ['order-detail', id], queryFn: () => ordersApi.getById(id) });
  const d: Row = o ?? row;
  const st = d.status as string;
  const pro = isPro(d);
  const total = num(d.total);
  const advance = num(d.advance_amount);
  const due = st === 'completed' || st === 'cancelled' ? 0 : pro
    ? total - ((d.links?.invoices ?? []) as Row[]).reduce((s, i) => s + num(i.paid_amount), 0)
    : Math.max(0, total - advance);
  const steps = o ? orderSteps(o) : [];
  const done = steps.filter(s => s.tone === 'done').length;
  const current = steps.find(s => s.tone === 'current' || s.tone === 'warn');
  const late = isLate(d, startOfDay(new Date()));
  const items: Row[] = o?.items ?? [];
  const history = o ? orderHistory(o).slice(0, 4) : [];
  const credit = o?.customer_credit as Row | null | undefined;
  const pct = steps.length ? Math.round((done + (current ? 0.5 : 0)) / steps.length * 100) : 0;

  return (
    <section className="ord-pane" aria-label={`Commande ${row.order_number as string}`}>
      <header className="ord-head">
        <span className="ord-mono" aria-hidden="true">{initials(customerName(d))}</span>
        <div className="ord-who">
          <h2>{customerName(d)}</h2>
          <p><span className="sal-num">{d.order_number as string}</span> · {pro ? 'Client pro' : d.customer_id ? 'Particulier' : 'Passager'}
            {d.type && TYPE_LABELS[d.type] ? ` · ${TYPE_LABELS[d.type]}` : ''}{pro && credit?.delai_paiement_jours ? ` · ${credit.delai_paiement_jours} jours` : ''}</p>
        </div>
        <div className="ord-amt">
          <b>{money(total)}</b>
          <small>{st === 'cancelled' ? 'annulée' : due > 0.004 ? `reste à encaisser ${money(due)}` : 'soldée'}</small>
        </div>
      </header>

      <div className="ord-actions">
        {next && <button type="button" className="odoo-btn-primary" disabled={busy} onClick={next.run} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><next.icon size={14} /> {next.label}</button>}
        <button type="button" className="odoo-btn-secondary" onClick={() => navigate(`/orders/${id}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ExternalLink size={13} /> Ouvrir la fiche</button>
        <RowMenu items={menu} label="Autres actions" />
      </div>

      {isLoading && !o ? (
        <div className="kl-widget kl-empty"><Loader2 className="animate-spin" size={20} /><span>Chargement…</span></div>
      ) : st === 'cancelled' ? (
        <div className="kl-widget"><div className="ord-state">Commande annulée</div>
          <div className="ord-state-sub">{advance > 0 ? `L'avance de ${money(advance)} reste acquise.` : 'Aucune somme versée.'}</div></div>
      ) : (
        <div className="kl-widget">
          <div className="ord-state">{st === 'completed' ? 'Terminée' : current?.label ?? (ORDER_STATUS_LABELS[st as keyof typeof ORDER_STATUS_LABELS] || st)}</div>
          <div className="ord-state-sub">
            {late ? `${pro ? 'Livraison' : 'Retrait'} en retard de ${daysLate(d, startOfDay(new Date()))} j · ` : ''}{current?.sub ?? `${pro ? 'Livraison' : 'Retrait'} le ${fmtDate(d.pickup_date, 'd MMMM')}`}
          </div>
          <div className={`ord-track${late ? ' late' : ''}`} aria-hidden="true"><span style={{ width: `${st === 'completed' ? 100 : pct}%` }} /></div>
          <ol className="ord-steps" aria-label="Avancement">
            {steps.map(s => (
              <li key={s.label} className={s.tone || undefined}>
                <b>{s.label}</b>
                {s.href ? <button type="button" className="sal-link" onClick={() => navigate(s.href!)}>{s.sub}</button> : <span>{s.sub}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <section>
        <div className="kl-sec"><h2>Articles</h2><small>{items.length ? `${items.length} ligne${items.length > 1 ? 's' : ''}` : ''}</small></div>
        <div className="kl-group">
          {items.length ? items.map((it, i) => {
            const qty = num(it.quantity);
            return (
              <div key={it.id ?? i} className="ord-line">
                <span className="ord-qty">{qty} ×</span>
                <span className="ord-pn">{it.product_name || it.product_id}{it.notes && <small>{it.notes}</small>}</span>
                <span className="ord-pv">{n(qty * num(it.unit_price))}</span>
              </div>
            );
          }) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucune ligne.'}</div>}
          {items.length > 0 && (
            <div className="ord-line tot"><span className="ord-pn">Total{pro ? ' TTC' : ''}</span><span className="ord-pv">{money(total)}</span></div>
          )}
        </div>
      </section>

      <section>
        <div className="kl-sec"><h2>{pro ? 'Livraison' : 'Retrait'}</h2></div>
        <div className="kl-group">
          <div className="ord-kv"><span>Date</span><b>{fmtDate(d.pickup_date, 'EEEE d MMMM yyyy')}</b></div>
          {d.customer_phone && <div className="ord-kv"><span>Téléphone</span><b style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Phone size={12} /> {d.customer_phone as string}</b></div>}
          {!pro && advance > 0 && <div className="ord-kv"><span>Avance versée</span><b>{money(advance)}</b></div>}
          {pro && credit && credit.credit_limit != null && <div className="ord-kv"><span>Encours / plafond</span><b>{n(num(credit.exposure))} / {money(num(credit.credit_limit))}</b></div>}
          {d.notes && <div className="ord-kv"><span>Note</span><b style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>{d.notes as string}</b></div>}
        </div>
      </section>

      {history.length > 0 && (
        <section>
          <div className="kl-sec"><h2>Activité</h2></div>
          <div className="kl-group">
            {history.map((h, i) => (
              <div key={i} className="ord-ev"><span className="ord-evd" aria-hidden="true"><span /></span><div>{h.text}<small>{h.sub}</small></div></div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

/** État vide de la colonne de droite (aucune commande dans le filtre). */
export function OrderPaneEmpty() {
  return (
    <section className="ord-pane">
      <div className="kl-widget kl-empty"><ClipboardList size={28} style={{ opacity: 0.4 }} /><strong>Aucune commande sélectionnée</strong><span>Choisissez une commande dans la liste.</span></div>
    </section>
  );
}
