import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Columns3, List, SquareKanban, Maximize2 } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import '../sales/sales.css';

/**
 * Achats — vues Colonnes / Liste / Kanban (style Apple, 2026-11), sur le modèle des
 * Commandes, Bons de livraison et Factures des Ventes : même bascule, même liste à
 * gauche + fiche à droite (classes ord-* de sales.css), même tableau Kanban (prj-board).
 * Utilisées par Bons de commande, Factures reçues, Réceptions et Frais d'approche.
 */

export type PurLayout = 'split' | 'list' | 'kanban';
/** Taille de page demandée en Kanban : toutes les pièces de la vue (plafond serveur 500). */
export const KANBAN_ALL = 500;

/** Colonnes par défaut sur grand écran, Liste sinon (même règle que les Ventes). */
export function usePurLayout(): [PurLayout, (l: PurLayout) => void] {
  return useState<PurLayout>(() => (typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'split' : 'list'));
}

export function LayoutSwitch({ value, onChange }: { value: PurLayout; onChange: (l: PurLayout) => void }) {
  const btn = (k: PurLayout, Icon: typeof List, label: string) => (
    <button type="button" className={value === k ? 'active' : ''} aria-pressed={value === k} onClick={() => onChange(k)}><Icon size={14} /> {label}</button>
  );
  return (
    <div className="prj-views" role="group" aria-label="Affichage">
      {btn('split', Columns3, 'Colonnes')}{btn('list', List, 'Liste')}{btn('kanban', SquareKanban, 'Kanban')}
    </div>
  );
}

/** Étiquette de statut d'une facture reçue (StatusTag commun). */
const INV_TONE: Record<string, StatusTone> = { draft: 'draft', blocked: 'blocked', to_pay: 'todo', partial: 'progress', paid: 'done', cancelled: 'cancelled' };
export function InvoiceStageTag({ stage, label, late }: { stage: string; label: string; late?: boolean }) {
  const isLate = !!late && (stage === 'to_pay' || stage === 'partial');
  return <StatusTag tone={isLate ? 'late' : INV_TONE[stage] ?? 'draft'} label={isLate ? `${label} · en retard` : label} />;
}

export type SplitRowView = { title: string; when?: string; l2: ReactNode; l3?: ReactNode; dot?: 'late' | 'today' | '' };

/** Liste compacte à gauche, fiche de l'élément choisi à droite. */
export function SplitView<T>({ items, getId, activeId, onPick, row, pane, label }: {
  items: T[]; getId: (t: T) => string; activeId: string | null; onPick: (id: string) => void;
  row: (t: T) => SplitRowView; pane: (t: T) => ReactNode; label: string;
}) {
  const active = items.find(t => getId(t) === activeId) ?? items[0];
  if (!active) return null;
  return (
    <div className="ord-split">
      <nav className="ord-list" aria-label={label}>
        {items.map(t => {
          const r = row(t);
          const sel = getId(t) === getId(active);
          return (
            <button key={getId(t)} type="button" className={`ord-row${sel ? ' sel' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => onPick(getId(t))}>
              <span className={`ord-dot${r.dot ? ` ${r.dot}` : ''}`} aria-hidden="true" />
              <span className="ord-l1"><span className="ord-nm">{r.title}</span>{r.when && <span className="ord-when">{r.when}</span>}</span>
              <span className="ord-l2">{r.l2}</span>
              {r.l3 && <span className="ord-l3">{r.l3}</span>}
            </button>
          );
        })}
      </nav>
      <Fragment key={getId(active)}>{pane(active)}</Fragment>
    </div>
  );
}

export type KanbanLane<T> = { key: string; label: string; tone?: '' | 'grey' | 'red' | 'orange' | 'green' | 'blue'; match: (t: T) => boolean };
export type KanbanCard = { num: string; title: string; meta?: string; amount?: string };

/** Tableau Kanban : une colonne par étape, une carte ouvre la fiche. */
export function KanbanView<T>({ items, lanes, getId, card, onOpen, sum, empty = 'Aucun élément' }: {
  items: T[]; lanes: KanbanLane<T>[]; getId: (t: T) => string; card: (t: T) => KanbanCard; onOpen: (t: T) => void;
  sum?: (cards: T[]) => string; empty?: string;
}) {
  return (
    <div className="prj-board" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(200px, 1fr))`, overflowX: 'auto', paddingBottom: 4 }}>
      {lanes.map(l => {
        const cards = items.filter(l.match);
        return (
          <section key={l.key} aria-label={l.label} className="prj-lane">
            <div className="prj-lane-head"><span className={`prj-dot ${l.tone ?? ''}`} /><strong>{l.label}</strong><small className="sal-lane-sum">{cards.length}{sum && cards.length ? ` · ${sum(cards)}` : ''}</small></div>
            {!cards.length && <div className="prj-lane-empty">{empty}</div>}
            {cards.map(t => {
              const c = card(t);
              return (
                <button key={getId(t)} type="button" className="prj-task" onClick={() => onOpen(t)} style={{ cursor: 'pointer' }}>
                  <span className="prj-card-num">{c.num}</span>
                  <span className="prj-task-title">{c.title}</span>
                  {(c.meta || c.amount) && (
                    <span className="prj-task-meta">
                      <span style={{ flex: 1 }}>{c.meta}</span>
                      {c.amount && <span className="sal-amount">{c.amount}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

export const pn = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
export const pmoney = (v: unknown) => `${pn(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
export const pdate = (v: unknown, f = 'd MMM yyyy') => {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : String(v));
  return isNaN(d.getTime()) ? '—' : format(d, f, { locale: fr });
};
export const initialsOf = (name: string) => name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ0-9]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';

/** En-tête de fiche commun (initiales, nom, sous-titre, montant). */
export function PaneHead({ name, sub, amount, amountSub }: { name: string; sub: ReactNode; amount: string; amountSub?: string }) {
  return (
    <header className="ord-head">
      <span className="ord-mono" aria-hidden="true">{initialsOf(name)}</span>
      <div className="ord-who"><h2>{name}</h2><p>{sub}</p></div>
      <div className="ord-amt"><b>{amount}</b>{amountSub && <small>{amountSub}</small>}</div>
    </header>
  );
}

export type PaneStep = { label: string; sub: string; tone?: 'done' | 'current' | 'warn' | '' };

/** Bloc d'état : titre, sous-titre, barre de progression et étapes. */
export function PaneState({ title, sub, pct, late, steps }: { title: string; sub: string; pct: number; late?: boolean; steps: PaneStep[] }) {
  return (
    <div className="kl-widget">
      <div className="ord-state">{title}</div>
      <div className="ord-state-sub">{sub}</div>
      <div className={`ord-track${late ? ' late' : ''}`} aria-hidden="true"><span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} /></div>
      <ol className="ord-steps" aria-label="Avancement">
        {steps.map(s => <li key={s.label} className={s.tone || undefined}><b>{s.label}</b><span>{s.sub}</span></li>)}
      </ol>
    </div>
  );
}

/**
 * Fiche compacte d'un bon de commande (colonne de droite) : étapes du BC, articles
 * commandés / reçus, pièces liées. `actions` = boutons propres à l'écran (Réceptionner, Facturer…).
 */
export function POPane({ poId, actions, onFull, children }: { poId: string; actions?: ReactNode; onFull?: () => void; children?: ReactNode }) {
  const { data: po, isLoading } = useQuery({ queryKey: ['purchase-orders', poId], queryFn: () => purchaseOrdersApi.getById(poId) });
  if (isLoading || !po) return <section className="ord-pane"><div className="kl-empty">{isLoading ? 'Chargement…' : 'Bon de commande introuvable.'}</div></section>;

  const items = (po.items || []) as Array<Record<string, any>>;
  const invoices = (po.invoices || []) as Array<Record<string, any>>;
  const receptions = (po.receptions || []) as Array<Record<string, any>>;
  const total = items.reduce((s, it) => s + pn(it.quantity_ordered) * pn(it.unit_price), 0);
  const received = items.reduce((s, it) => s + pn(it.quantity_delivered) * pn(it.unit_price), 0);
  const status = String(po.status);
  const cancelled = status === 'annule' || status === 'non_livre';
  const stage = status === 'en_attente' ? 0 : status === 'envoye' ? 1 : status === 'livre_partiel' ? 2
    : status === 'en_attente_facturation' || (status === 'livre_complet' && invoices.length === 0) ? 3 : status === 'livre_complet' ? 5 : -1;
  const late = [0, 1, 2].includes(stage) && !!po.expected_delivery_date && new Date(po.expected_delivery_date) < new Date(new Date().toDateString());
  const linesDone = items.filter(it => pn(it.qty_remaining_base ?? Math.max(0, pn(it.quantity_ordered) - pn(it.quantity_delivered))) <= 0).length;
  const pct = cancelled ? 0 : stage === 5 ? 100 : stage <= 0 ? 8 : total > 0 ? Math.max(20, (received / total) * 80) : 30;
  const title = cancelled ? (status === 'annule' ? 'Annulé' : 'Non livré') : po.on_hold ? 'Bloqué' : late ? 'Livraison en retard'
    : ['Brouillon', 'Envoyé au fournisseur', 'Réception partielle', 'À facturer', '', 'Clôturé'][stage] || '—';
  const steps: PaneStep[] = [
    { label: 'Commandé', sub: pdate(po.order_date), tone: 'done' },
    { label: 'Envoyé', sub: stage >= 1 ? (po.locked_at ? pdate(po.locked_at) : 'oui') : 'à envoyer', tone: stage >= 1 ? 'done' : 'current' },
    { label: 'Reçu', sub: stage >= 2 ? `${linesDone}/${items.length} ligne${items.length > 1 ? 's' : ''}` : po.expected_delivery_date ? `prévu ${pdate(po.expected_delivery_date, 'd MMM')}` : 'à venir', tone: stage >= 3 ? 'done' : stage >= 1 ? (late ? 'warn' : 'current') : '' },
    { label: 'Facturé', sub: invoices.length ? `${invoices.length} facture${invoices.length > 1 ? 's' : ''}` : stage >= 3 ? 'attendue' : '—', tone: invoices.length ? 'done' : stage >= 3 ? 'current' : '' },
  ];

  return (
    <section className="ord-pane" aria-label={`Bon de commande ${po.order_number}`}>
      <PaneHead name={String(po.supplier_name ?? '—')} sub={<><span className="sal-num">{po.order_number}</span> · {items.length} article{items.length > 1 ? 's' : ''}{po.created_by_name ? ` · ${po.created_by_name}` : ''}</>}
        amount={pmoney(total)} amountSub={stage >= 2 && stage < 5 ? `reçu ${pmoney(received)}` : undefined} />
      <div className="ord-actions">
        {actions}
        {onFull && <button type="button" className="odoo-btn-secondary" onClick={onFull} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Maximize2 size={13} /> Fiche complète</button>}
      </div>
      <PaneState title={title} late={late || !!po.on_hold}
        sub={cancelled ? (po.cancel_note || 'Ce BC ne sera plus livré.') : po.on_hold ? (po.hold_note || 'Ni réception ni facture tant que le blocage n\'est pas levé.')
          : po.expected_delivery_date && stage <= 2 ? `Livraison prévue le ${pdate(po.expected_delivery_date)}` : `${linesDone}/${items.length} ligne${items.length > 1 ? 's' : ''} reçue${linesDone > 1 ? 's' : ''}`}
        pct={pct} steps={steps} />
      {children}
      <section>
        <div className="kl-sec"><h2>Articles</h2><small>{items.length} ligne{items.length > 1 ? 's' : ''}</small></div>
        <div className="kl-group">
          {items.map(it => {
            const ord = pn(it.quantity_ordered); const rec = pn(it.quantity_delivered);
            const unit = it.base_unit || it.ingredient_unit || '';
            return (
              <div key={it.id} className="ord-line">
                <span className="ord-qty">{ord.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ×</span>
                <span className="ord-pn">{it.ingredient_name}<small>{unit}{it.unit_price != null ? ` · ${pmoney(it.unit_price)}` : ' · prix à définir'}{stage >= 2 ? ` · reçu ${rec.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}` : ''}</small></span>
                <span className="ord-pv">{it.unit_price != null ? pmoney(ord * pn(it.unit_price)) : '—'}</span>
              </div>
            );
          })}
          <div className="ord-line tot"><span className="ord-pn">Total HT</span><span className="ord-pv">{pmoney(total)}</span></div>
        </div>
      </section>
      {(receptions.length > 0 || invoices.length > 0) && (
        <section>
          <div className="kl-sec"><h2>Pièces liées</h2></div>
          <div className="kl-group">
            {receptions.map(r => <div key={r.id} className="ord-kv"><span>Réception <span className="sal-num">{r.voucher_number}</span></span><b>{pdate(r.created_at)}</b></div>)}
            {invoices.map(i => (
              <div key={i.id} className="ord-kv">
                <span>Facture <span className="sal-num">{i.supplier_invoice_number || i.invoice_number}</span> · {pdate(i.invoice_date)}</span>
                <b>{pn(i.paid_amount) >= pn(i.total_amount) - 0.005 ? 'réglée' : `reste ${pmoney(pn(i.total_amount) - pn(i.paid_amount))}`}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
