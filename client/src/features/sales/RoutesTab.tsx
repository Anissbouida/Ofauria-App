import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Truck, Plus, ChevronUp, ChevronDown, Trash2, MapPin, Phone, CheckCircle2, type LucideIcon } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { deliveryRoutesApi, type DeliveryRoute, type RouteStatus, type RouteStop } from '../../api/delivery-routes.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { ListKpi } from './ListTemplate';
import { createPortal } from 'react-dom';
import { TableFooter, EmptyState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormFooter } from '../../components/ds';

const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
/** Tournée planifiée = à lancer (action attendue), en cours = bleu, terminée = vert. */
const STATUS: Record<RouteStatus, { label: string; tone: StatusTone; icon?: LucideIcon }> = {
  planned: { label: 'Planifiée', tone: 'todo' }, in_progress: { label: 'En cours', tone: 'progress', icon: Truck }, done: { label: 'Terminée', tone: 'done' },
};

/** `actionsSlot` : emplacement de la barre du haut où poser l'action principale de la page. */
export default function RoutesTab({ actionsSlot }: { actionsSlot?: HTMLElement | null } = {}) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['delivery-routes'], queryFn: () => deliveryRoutesApi.list() });
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const todayRoutes = rows.filter(r => r.route_date.slice(0, 10) === today);
  const open = rows.filter(r => r.status !== 'done');
  const stops = open.reduce((n, r) => n + r.stops, 0);
  const delivered = open.reduce((n, r) => n + r.delivered, 0);
  const newBtn = <button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouvelle tournée</button>;
  return (
    <div className="odoo-scope prj">
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Tournées du jour" value={String(todayRoutes.length)} sub={`${todayRoutes.reduce((n, r) => n + r.stops, 0)} arrêt(s)`} />
        <ListKpi label="Planifiées" value={String(rows.filter(r => r.status === 'planned').length)} sub="à partir" />
        <ListKpi label="En cours" value={String(rows.filter(r => r.status === 'in_progress').length)} sub="sur la route" tone={rows.some(r => r.status === 'in_progress') ? 'orange' : undefined} />
        <ListKpi label="Arrêts livrés" value={`${delivered} / ${stops}`} sub="tournées non terminées" />
      </section>
      {actionsSlot
        ? createPortal(newBtn, actionsSlot)
        : <div className="prj-toolbar"><span style={{ flex: 1 }} />{newBtn}</div>}
      {isLoading ? <LoadingState label="Chargement des tournées…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Truck} title="Aucune tournée" text="Créez une tournée puis ajoutez-y les bons de livraison à remettre." />
      ) : (
        <DataPanel label="Tournées" footer={<TableFooter note={<>{rows.length} tournée{rows.length > 1 ? 's' : ''}</>} />}>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Tournée</th><th>Chauffeur</th><th className="ds-num">Arrêts livrés</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{day(r.route_date)}</td>
                  <td className="ds-strong">{r.label}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>{r.driver_name || '—'}</td>
                  <td className="ds-num">{r.delivered} / {r.stops}</td>
                  <td><StatusTag tone={STATUS[r.status].tone} icon={STATUS[r.status].icon} label={STATUS[r.status].label} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      {showForm && <RouteForm onClose={() => setShowForm(false)} onSaved={r => { qc.invalidateQueries({ queryKey: ['delivery-routes'] }); setShowForm(false); setOpenId(r.id); }} />}
      {openId && <RouteDetail id={openId} onClose={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ['delivery-routes'] }); }} />}
    </div>
  );
}

function RouteForm({ onClose, onSaved }: { onClose: () => void; onSaved: (r: DeliveryRoute) => void }) {
  const [label, setLabel] = useState('');
  const [routeDate, setRouteDate] = useState(new Date().toISOString().slice(0, 10));
  const [driver, setDriver] = useState('');
  const save = useMutation({
    mutationFn: () => deliveryRoutesApi.create({ label: label.trim(), routeDate, driverName: driver || null }),
    onSuccess: r => { notify.success('Tournée créée'); onSaved(r); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title="Nouvelle tournée" onClose={onClose} width={440} locked={save.isPending}
      footer={<FormFooter dirty={!!(label || driver)} onCancel={onClose} onSubmit={() => save.mutate()} submitLabel="Créer" disabled={label.trim().length < 2} busy={save.isPending} />}>
      <FormField label="Libellé" htmlFor="rt-label" required>
        <input id="rt-label" type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Tournée centre-ville" className="ds-input" />
      </FormField>
      <div className="ds-form-grid">
        <FormField label="Date" htmlFor="rt-date" required>
          <input id="rt-date" type="date" value={routeDate} onChange={e => setRouteDate(e.target.value)} className="ds-input" />
        </FormField>
        <FormField label="Chauffeur" htmlFor="rt-driver">
          <input id="rt-driver" type="text" value={driver} onChange={e => setDriver(e.target.value)} className="ds-input" />
        </FormField>
      </div>
    </Modal>
  );
}

function RouteDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['delivery-route', id], queryFn: () => deliveryRoutesApi.getById(id) });
  const [adding, setAdding] = useState(false);
  const refresh = (r: DeliveryRoute) => qc.setQueryData(['delivery-route', id], r);
  const mut = <T,>(fn: () => Promise<DeliveryRoute>) => fn().then(refresh).catch(e => notify.error(apiErrorMessage(e)));

  const stops = data?.stops_list ?? [];
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const ids = stops.map(s => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    mut(() => deliveryRoutesApi.reorder(id, ids));
  };

  return (
    <>
    <Modal title={data?.label ?? 'Tournée'} subtitle={data ? `${day(data.route_date)}${data.driver_name ? ` · ${data.driver_name}` : ''}` : undefined} onClose={onClose} width={720}
      aside={data && <StatusTag tone={STATUS[data.status].tone} icon={STATUS[data.status].icon} label={STATUS[data.status].label} />}>
      {isLoading || !data ? <LoadingState bare /> : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-primary" onClick={() => setAdding(true)}><Plus size={13} /> Ajouter des BL</button>
            <div style={{ flex: 1 }} />
            <div style={{ width: 170 }}>
              <FormField label="Statut" htmlFor="rt-status">
                <select id="rt-status" value={data.status} onChange={e => mut(() => deliveryRoutesApi.setStatus(id, e.target.value as RouteStatus))} className="ds-input">
                  <option value="planned">Planifiée</option><option value="in_progress">En cours</option><option value="done">Terminée</option>
                </select>
              </FormField>
            </div>
          </div>
          {stops.length === 0 ? (
            <EmptyState bare icon={Truck} title="Aucun arrêt" text="Ajoutez des bons de livraison." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stops.map((s, i) => <StopRow key={s.id} s={s} i={i} count={stops.length} onMove={move}
                onToggle={() => mut(() => deliveryRoutesApi.markStop(s.id, !s.delivered_at))}
                onRemove={() => mut(() => deliveryRoutesApi.removeStop(s.id))} />)}
            </div>
          )}
        </>
      )}
    </Modal>
    {adding && <AddStops routeId={id} onClose={() => setAdding(false)} onAdded={r => { refresh(r); setAdding(false); }} />}
    </>
  );
}

function StopRow({ s, i, count, onMove, onToggle, onRemove }: { s: RouteStop; i: number; count: number; onMove: (i: number, dir: -1 | 1) => void; onToggle: () => void; onRemove: () => void }) {
  const done = !!s.delivered_at;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--ds-sep)', borderRadius: 8, padding: '8px 12px', background: done ? 'var(--ds-hair)' : 'var(--ds-card)' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <button className="odoo-pager-btn" style={{ padding: 2 }} aria-label="Monter l'arrêt" disabled={i === 0} onClick={onMove.bind(null, i, -1)}><ChevronUp size={12} /></button>
        <button className="odoo-pager-btn" style={{ padding: 2 }} aria-label="Descendre l'arrêt" disabled={i === count - 1} onClick={onMove.bind(null, i, 1)}><ChevronDown size={12} /></button>
      </div>
      <div style={{ width: 22, textAlign: 'center', fontWeight: 700, color: 'var(--ds-muted)' }}>{i + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{s.customer_name} <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--ds-muted)' }}>{s.delivery_number}</span></div>
        <div style={{ fontSize: '0.78rem', color: 'var(--ds-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s.customer_address && <span><MapPin size={10} style={{ display: 'inline', verticalAlign: -1 }} /> {s.customer_address}{s.customer_city ? `, ${s.customer_city}` : ''}</span>}
          {s.customer_phone && <span><Phone size={10} style={{ display: 'inline', verticalAlign: -1 }} /> {s.customer_phone}</span>}
        </div>
      </div>
      <button className={done ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={onToggle}>
        <CheckCircle2 size={13} /> {done ? 'Livré' : 'À livrer'}
      </button>
      <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.4rem' }} onClick={onRemove} title="Retirer" aria-label="Retirer l'arrêt"><Trash2 size={13} /></button>
    </div>
  );
}

function AddStops({ routeId, onClose, onAdded }: { routeId: string; onClose: () => void; onAdded: (r: DeliveryRoute) => void }) {
  const { data: notes = [], isLoading } = useQuery({ queryKey: ['delivery-routes', 'available'], queryFn: deliveryRoutesApi.availableNotes });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const add = useMutation({
    mutationFn: () => deliveryRoutesApi.addStops(routeId, [...sel]),
    onSuccess: r => { notify.success('Bons ajoutés'); onAdded(r); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal title="Ajouter des bons de livraison" onClose={onClose} width={560} locked={add.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => add.mutate()} submitLabel={`Ajouter (${sel.size})`} disabled={sel.size === 0} busy={add.isPending} />}>
      {isLoading ? <LoadingState bare />
        : notes.length === 0 ? <EmptyState bare icon={Truck} title="Aucun bon de livraison disponible" text="Tous les bons sont déjà en tournée." />
        : (
          <DataPanel label="Bons de livraison disponibles">
            <table className="odoo-table ds-dense">
              <thead><tr><th style={{ width: 36 }}><span className="sr-only">Sélection</span></th><th>Client</th><th>N° BL</th><th>Ville</th><th>Livraison</th></tr></thead>
              <tbody>
                {notes.map(n => (
                  <tr key={n.id} className={sel.has(n.id) ? 'ds-selected' : undefined} onClick={() => toggle(n.id)} style={{ cursor: 'pointer' }}>
                    <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Sélectionner ${n.number}`} /></td>
                    <td className="ds-strong">{n.customer_name}</td>
                    <td><span className="ds-ref">{n.number}</span></td>
                    <td style={{ color: 'var(--ds-muted)' }}>{n.customer_city || '—'}</td>
                    <td>{day(n.delivery_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
    </Modal>
  );
}

