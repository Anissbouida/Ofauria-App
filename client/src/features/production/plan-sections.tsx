import type { ReactNode } from 'react';
import { money } from '../../utils/money';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { History, Layers, Package, ChefHat, PackageCheck, type LucideIcon } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import type { ProductionPlanEvent } from '@ofauria/shared';
import { planStatusTag, bonStatusTag } from './status';
import './production.css';
import { useProdTerms } from '../../hooks/useProdTerms';

/**
 * Sections d'affichage pur de la fiche plan, sorties de PlanDetailPage (lot 4) :
 * journal des transitions, tracabilite des lots, commande liee.
 */

export function PlanJournal({ events }: { events: ProductionPlanEvent[] }) {
  const planEvents = events;
  if (planEvents.length === 0) return null;
  return (
    <details className="ds-panel pd-section">
      <summary className="pd-section-head" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <History size={12} /> Journal du plan
        <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {planEvents.length} transition{planEvents.length > 1 ? 's' : ''}
        </span>
      </summary>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Date</th>
              <th>Objet</th>
              <th>De</th>
              <th>Vers</th>
              <th>Par</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {[...planEvents].reverse().map((ev) => {
              const isBon = ev.entity === 'bon';
              const from = ev.from_status ? (isBon ? bonStatusTag(ev.from_status) : planStatusTag(ev.from_status)) : null;
              const to = isBon ? bonStatusTag(ev.to_status) : planStatusTag(ev.to_status);
              return (
                <tr key={ev.id} style={{ cursor: 'default' }}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)' }}>{format(new Date(ev.created_at as string), 'dd/MM/yyyy HH:mm', { locale: fr })}</td>
                  <td>{isBon ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ev.bon_numero as string}</span> : 'Plan'}</td>
                  <td>{from ? <StatusTag tone={from.tone} icon={from.icon} label={from.label} /> : <span style={{ color: 'var(--ds-muted)' }}>création</span>}</td>
                  <td><StatusTag tone={to.tone} icon={to.icon} label={to.label} /></td>
                  <td style={{ color: 'var(--ds-muted)' }}>{(ev.actor_name as string) || '—'}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>{(ev.reason as string) || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function PlanLotTraceability({ usage }: { usage: Record<string, any>[] }) {
  const T = useProdTerms();
  const productionLotUsage = usage;
  if (productionLotUsage.length === 0) return null;
  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Layers size={12} /> Traçabilité des lots
        <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {(productionLotUsage as Record<string, any>[]).length} lot(s) utilisé(s) — {T.ingredientsLc}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>{T.ingredient}</th>
              <th>Lot interne</th>
              <th>Lot fournisseur</th>
              <th>Fournisseur</th>
              <th>Reçu le</th>
              <th>DLC</th>
              <th className="ds-num">Quantité utilisée</th>
            </tr>
          </thead>
          <tbody>
            {(productionLotUsage as Record<string, any>[]).map((usage, idx) => {
              const expDate = usage.expiration_date ? new Date(usage.expiration_date as string) : null;
              const isExpired = !!expDate && expDate < new Date();
              return (
                <tr key={idx} style={{ cursor: 'default' }}>
                  <td><span className={`odoo-status-dot ${isExpired ? 'danger' : 'ok'}`} title={isExpired ? 'DLC dépassée' : 'DLC valide'} aria-label={isExpired ? 'DLC dépassée' : 'DLC valide'} role="img" /></td>
                  <td style={{ fontWeight: 500 }}>{usage.ingredient_name as string}</td>
                  {/* Lot interne = celui affiche sur le bon de sortie ; le lot fournisseur
                      (etiquette du sac) n'est pas toujours saisi a la reception. */}
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{(usage.lot_number as string) || '—'}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{(usage.supplier_lot_number as string) || <span style={{ color: 'var(--ds-muted)', fontFamily: 'inherit' }}>non renseigné</span>}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>{usage.supplier_name ? String(usage.supplier_name) : '—'}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>{usage.received_at ? format(new Date(usage.received_at as string), 'dd/MM/yyyy') : '—'}</td>
                  <td>
                    {expDate
                      ? (isExpired ? <StatusTag tone="late" label={`Expiré ${format(expDate, 'dd/MM/yyyy')}`} /> : <span style={{ color: 'var(--ds-muted)' }}>{format(expDate, 'dd/MM/yyyy')}</span>)
                      : '—'}
                  </td>
                  <td className="ds-num">
                    <strong>{parseFloat(usage.quantity_used as string).toFixed(2)}</strong>
                    <span style={{ color: 'var(--ds-muted)', fontSize: '12px', marginLeft: 2 }}>{(usage.ingredient_unit as string) || ''}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PlanLinkedOrder({ plan }: { plan: Record<string, any> }) {
  const os = plan.order_status as string;
  const orderTone: { tone: StatusTone; icon?: LucideIcon } = os === 'in_production' ? { tone: 'progress', icon: ChefHat }
    : os === 'ready' ? { tone: 'todo', icon: PackageCheck }
    : os === 'completed' ? { tone: 'done' }
    : os === 'cancelled' ? { tone: 'cancelled' }
    : os === 'confirmed' ? { tone: 'progress' }
    : { tone: 'draft' };
  const orderLabel = os === 'pending' ? 'En attente' : os === 'confirmed' ? 'Confirmée'
    : os === 'in_production' ? 'En production' : os === 'ready' ? 'Prête'
    : os === 'completed' ? 'Livrée' : os === 'cancelled' ? 'Annulée' : os;
  const cell = (label: string, value: ReactNode) => (
    <div>
      <div className="odoo-stat-card-label">{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-ink)' }}>{value}</div>
    </div>
  );
  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Package size={12} /> Commande liée
        <span style={{ marginLeft: 4, fontFamily: 'ui-monospace, monospace', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{plan.order_number}</span>
        <span style={{ marginLeft: 'auto' }}><StatusTag tone={orderTone.tone} icon={orderTone.icon} label={orderLabel} /></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', padding: '0.75rem 1rem', backgroundColor: 'var(--ds-card)' }}>
        {plan.order_customer_first_name && cell('Client', `${plan.order_customer_first_name} ${plan.order_customer_last_name || ''}`)}
        {plan.order_customer_phone && cell('Téléphone', plan.order_customer_phone)}
        {plan.order_pickup_date && cell('Retrait', format(new Date(plan.order_pickup_date), 'dd/MM/yyyy', { locale: fr }))}
        {plan.order_total && cell('Total', <>
          {money(parseFloat(plan.order_total))}
          {parseFloat(plan.order_advance_amount) > 0 && (
            <span style={{ color: 'var(--ds-muted)', fontSize: '12px', marginLeft: 4 }}>(avance {parseFloat(plan.order_advance_amount).toFixed(2)})</span>
          )}
        </>)}
      </div>
    </div>
  );
}
