import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Truck, Plus, X, Loader2, ChevronUp, ChevronDown, Trash2, MapPin, Phone, CheckCircle2 } from 'lucide-react';
import { deliveryRoutesApi, type DeliveryRoute, type RouteStatus, type RouteStop } from '../../api/delivery-routes.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };
const STATUS: Record<RouteStatus, { label: string; tag: string }> = {
  planned: { label: 'Planifiée', tag: 'odoo-tag-blue' }, in_progress: { label: 'En cours', tag: 'odoo-tag-orange' }, done: { label: 'Terminée', tag: 'odoo-tag-green' },
};

export default function RoutesTab() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['delivery-routes'], queryFn: () => deliveryRoutesApi.list() });
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Truck} title="Tournées de livraison">
        Regroupez vos bons de livraison en tournées datées, définissez l'ordre de passage, et pointez chaque arrêt comme livré.
      </StatusBanner>
      <div><button className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouvelle tournée</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Tournée</th><th>Chauffeur</th><th style={{ textAlign: 'center' }}>Arrêts</th><th>Statut</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune tournée.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(r.route_date)}</td>
                <td style={{ fontWeight: 500 }}>{r.label}</td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.driver_name || '—'}</td>
                <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{r.delivered}/{r.stops}</td>
                <td><span className={`odoo-tag ${STATUS[r.status].tag}`}>{STATUS[r.status].label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(440px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Truck size={16} /> Nouvelle tournée</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={lab}>Libellé<input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Tournée centre-ville" style={inp} /></label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={lab}>Date<input type="date" value={routeDate} onChange={e => setRouteDate(e.target.value)} style={inp} /></label>
            <label style={lab}>Chauffeur<input type="text" value={driver} onChange={e => setDriver(e.target.value)} style={inp} /></label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={label.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer</button>
        </div>
      </div>
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(720px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Truck size={16} /> {data?.label ?? 'Tournée'}{data && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}> · {day(data.route_date)}{data.driver_name ? ` · ${data.driver_name}` : ''}</span>}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isLoading || !data ? <div style={{ textAlign: 'center', padding: 24 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div> : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="odoo-btn-primary" onClick={() => setAdding(true)}><Plus size={13} /> Ajouter des BL</button>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Statut</span>
                <select value={data.status} onChange={e => mut(() => deliveryRoutesApi.setStatus(id, e.target.value as RouteStatus))} style={{ ...inp, width: 150 }}>
                  <option value="planned">Planifiée</option><option value="in_progress">En cours</option><option value="done">Terminée</option>
                </select>
              </div>
              {stops.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: 'var(--theme-text-muted)' }}>Aucun arrêt. Ajoutez des bons de livraison.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stops.map((s, i) => <StopRow key={s.id} s={s} i={i} count={stops.length} onMove={move}
                    onToggle={() => mut(() => deliveryRoutesApi.markStop(s.id, !s.delivered_at))}
                    onRemove={() => mut(() => deliveryRoutesApi.removeStop(s.id))} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {adding && <AddStops routeId={id} onClose={() => setAdding(false)} onAdded={r => { refresh(r); setAdding(false); }} />}
    </ModalBackdrop>
  );
}

function StopRow({ s, i, count, onMove, onToggle, onRemove }: { s: RouteStop; i: number; count: number; onMove: (i: number, dir: -1 | 1) => void; onToggle: () => void; onRemove: () => void }) {
  const done = !!s.delivered_at;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--odoo-border)', borderRadius: 8, padding: '8px 12px', background: done ? 'var(--theme-bg-secondary)' : 'var(--odoo-bg)' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <button className="odoo-pager-btn" style={{ padding: 2 }} disabled={i === 0} onClick={onMove.bind(null, i, -1)}><ChevronUp size={12} /></button>
        <button className="odoo-pager-btn" style={{ padding: 2 }} disabled={i === count - 1} onClick={onMove.bind(null, i, 1)}><ChevronDown size={12} /></button>
      </div>
      <div style={{ width: 22, textAlign: 'center', fontWeight: 700, color: 'var(--theme-text-muted)' }}>{i + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{s.customer_name} <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{s.delivery_number}</span></div>
        <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s.customer_address && <span><MapPin size={10} style={{ display: 'inline', verticalAlign: -1 }} /> {s.customer_address}{s.customer_city ? `, ${s.customer_city}` : ''}</span>}
          {s.customer_phone && <span><Phone size={10} style={{ display: 'inline', verticalAlign: -1 }} /> {s.customer_phone}</span>}
        </div>
      </div>
      <button className={done ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={onToggle}>
        <CheckCircle2 size={13} /> {done ? 'Livré' : 'À livrer'}
      </button>
      <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.4rem' }} onClick={onRemove} title="Retirer"><Trash2 size={13} /></button>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(560px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600 }}>Ajouter des bons de livraison</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 12 }}>
          {isLoading ? <div style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div>
            : notes.length === 0 ? <p style={{ textAlign: 'center', padding: 20, color: 'var(--theme-text-muted)' }}>Aucun bon de livraison disponible (tous déjà en tournée).</p>
            : notes.map(n => (
              <label key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--odoo-border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} style={{ accentColor: 'var(--theme-accent)' }} />
                <span style={{ flex: 1 }}><span style={{ fontWeight: 500 }}>{n.customer_name}</span> <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{n.number}</span>{n.customer_city && <span style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}> · {n.customer_city}</span>}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{day(n.delivery_date)}</span>
              </label>
            ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={sel.size === 0 || add.isPending} onClick={() => add.mutate()}>{add.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ajouter ({sel.size})</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

const lab: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1 };
