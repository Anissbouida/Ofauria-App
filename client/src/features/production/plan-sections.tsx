import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { History, Layers, Package } from 'lucide-react';
import type { ProductionPlanEvent } from '@ofauria/shared';
import { planStatusTag, bonStatusTag } from './status';

/**
 * Sections d'affichage pur de la fiche plan, sorties de PlanDetailPage (lot 4) :
 * journal des transitions, tracabilite des lots, commande liee.
 */

export function PlanJournal({ events }: { events: ProductionPlanEvent[] }) {
  const planEvents = events;
  if (planEvents.length === 0) return null;
  return (
    <details className="odoo-section" style={{ margin: '1rem' }}>
      <summary className="odoo-section-header" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <History size={12} /> Journal du plan
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {planEvents.length} transition{planEvents.length > 1 ? 's' : ''}
        </span>
      </summary>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
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
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}>{format(new Date(ev.created_at as string), 'dd/MM/yyyy HH:mm', { locale: fr })}</td>
                  <td>{isBon ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ev.bon_numero as string}</span> : 'Plan'}</td>
                  <td>{from ? <span className={`odoo-tag ${from.cls}`}>{from.label}</span> : <span style={{ color: 'var(--theme-text-muted)' }}>création</span>}</td>
                  <td><span className={`odoo-tag ${to.cls}`}>{to.label}</span></td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{(ev.actor_name as string) || '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{(ev.reason as string) || ''}</td>
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
  const productionLotUsage = usage;
  if (productionLotUsage.length === 0) return null;
  return (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Layers size={12} /> Traçabilité des lots
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {(productionLotUsage as Record<string, any>[]).length} lot(s) d'ingrédients utilisé(s)
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Ingrédient</th>
              <th>Lot</th>
              <th>Fournisseur</th>
              <th>Reçu le</th>
              <th>DLC</th>
              <th style={{ textAlign: 'right' }}>Quantité utilisée</th>
            </tr>
          </thead>
          <tbody>
            {(productionLotUsage as Record<string, any>[]).map((usage, idx) => {
              const expDate = usage.expiration_date ? new Date(usage.expiration_date as string) : null;
              const isExpired = !!expDate && expDate < new Date();
              return (
                <tr key={idx} style={{ cursor: 'default' }}>
                  <td><span className={`odoo-status-dot ${isExpired ? 'danger' : 'ok'}`} /></td>
                  <td style={{ fontWeight: 500 }}>{usage.ingredient_name as string}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{(usage.supplier_lot_number as string) || <span style={{ color: 'var(--theme-text-muted)' }}>sans réf.</span>}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{usage.supplier_name ? String(usage.supplier_name) : '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{usage.received_at ? format(new Date(usage.received_at as string), 'dd/MM/yyyy') : '—'}</td>
                  <td>
                    {expDate
                      ? (isExpired ? <span className="odoo-tag odoo-tag-red">Expiré {format(expDate, 'dd/MM/yyyy')}</span> : <span style={{ color: 'var(--theme-text-muted)' }}>{format(expDate, 'dd/MM/yyyy')}</span>)
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{parseFloat(usage.quantity_used as string).toFixed(2)}</strong>
                    <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{(usage.ingredient_unit as string) || ''}</span>
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
  const orderTag = os === 'in_production' ? 'odoo-tag-yellow'
    : os === 'ready' ? 'odoo-tag-green'
    : os === 'completed' ? 'odoo-tag-grey'
    : os === 'cancelled' ? 'odoo-tag-red'
    : 'odoo-tag-blue';
  const orderLabel = os === 'pending' ? 'En attente' : os === 'confirmed' ? 'Confirmée'
    : os === 'in_production' ? 'En production' : os === 'ready' ? 'Prête'
    : os === 'completed' ? 'Livrée' : os === 'cancelled' ? 'Annulée' : os;
  const cell = (label: string, value: ReactNode) => (
    <div>
      <div className="odoo-stat-card-label">{label}</div>
      <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--theme-text-strong)' }}>{value}</div>
    </div>
  );
  return (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Package size={12} /> Commande liée
        <span style={{ marginLeft: 4, fontFamily: 'ui-monospace, monospace', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{plan.order_number}</span>
        <span className={`odoo-tag ${orderTag}`} style={{ marginLeft: 'auto' }}>{orderLabel}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-card)' }}>
        {plan.order_customer_first_name && cell('Client', `${plan.order_customer_first_name} ${plan.order_customer_last_name || ''}`)}
        {plan.order_customer_phone && cell('Téléphone', plan.order_customer_phone)}
        {plan.order_pickup_date && cell('Retrait', format(new Date(plan.order_pickup_date), 'dd/MM/yyyy', { locale: fr }))}
        {plan.order_total && cell('Total', <>
          {parseFloat(plan.order_total).toFixed(2)} DH
          {parseFloat(plan.order_advance_amount) > 0 && (
            <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 4 }}>(avance {parseFloat(plan.order_advance_amount).toFixed(2)})</span>
          )}
        </>)}
      </div>
    </div>
  );
}
