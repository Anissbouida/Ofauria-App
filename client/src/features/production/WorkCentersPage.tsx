import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cog, Plus, X, Loader2, Power, Trash2, Route } from 'lucide-react';
import { routingsApi, type WorkCenter, type Routing, type OperationInput } from '../../api/routings.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };

export default function WorkCentersPage() {
  const [view, setView] = useState<'routings' | 'centers'>('routings');
  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Cog} title="Postes de travail & gammes">
        Définissez vos postes de travail et leur coût horaire, puis des gammes (séquences d'opérations) pour obtenir le coût de main-d'œuvre standard de fabrication. Capacité autonome, à côté des plans de production réels.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={view === 'routings' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('routings')}>Gammes</button>
        <button className={view === 'centers' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('centers')}>Postes de travail</button>
      </div>
      {view === 'routings' ? <Routings /> : <Centers />}
    </div>
  );
}

function Centers() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const [showForm, setShowForm] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => routingsApi.setWorkCenterActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-centers'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouveau poste</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Poste</th><th style={{ textAlign: 'right' }}>Coût horaire</th><th style={{ textAlign: 'right' }}>Opérations</th><th>État</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun poste. Créez-en (ex. Pétrin, Four, Façonnage).</td></tr>}
            {rows.map(w => (
              <tr key={w.id}>
                <td style={{ fontWeight: 500 }}>{w.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(w.hourly_cost)}/h</td>
                <td style={{ textAlign: 'right' }}>{w.operations_count}</td>
                <td><span className={`odoo-tag ${w.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{w.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td style={{ textAlign: 'right' }}><button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggle.mutate({ id: w.id, active: !w.is_active })}><Power size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && <CenterForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['work-centers'] }); setShowForm(false); }} />}
    </>
  );
}

function CenterForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const save = useMutation({
    mutationFn: () => routingsApi.createWorkCenter({ name: name.trim(), hourlyCost: Number(cost) || 0 }),
    onSuccess: () => { notify.success('Poste créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(420px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Cog size={16} /> Nouveau poste de travail</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Four à sole" style={inp} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Coût horaire (DH/h)</span><input type="number" step="0.01" min="0" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" style={inp} /></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Routings() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['routings'], queryFn: routingsApi.list });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouvelle gamme</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Gamme</th><th>Produit</th><th style={{ textAlign: 'right' }}>Opérations</th><th style={{ textAlign: 'right' }}>Durée</th><th style={{ textAlign: 'right' }}>Coût MO standard</th><th>État</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune gamme.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(r.id)}>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.product_name || '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.operations_count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.total_minutes} min</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.labor_cost)}</td>
                <td><span className={`odoo-tag ${r.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{r.is_active ? 'Active' : 'Inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RoutingEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['routings'] }); setEditing(null); }} />}
    </>
  );
}

function RoutingEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({ queryKey: ['routing', id], queryFn: () => routingsApi.getById(id!), enabled: !!id });
  const { data: centers = [] } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const activeCenters = centers.filter(c => c.is_active);
  const { data: prodResp } = useQuery({ queryKey: ['products', 'all-routing'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((prodResp as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name) })), [products]);

  // état local initialisé depuis `existing`
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [ops, setOps] = useState<OperationInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (existing && !loaded) {
    setName(existing.name); setProductId(existing.product_id ?? '');
    setOps(existing.operations.map(o => ({ operationName: o.operation_name, workCenterId: o.work_center_id, durationMin: o.duration_min })));
    setLoaded(true);
  }
  if (!id && !loaded) { setOps([{ operationName: '', workCenterId: null, durationMin: 0 }]); setLoaded(true); }

  const wcCost = (wid: string | null | undefined) => activeCenters.find(c => c.id === wid)?.hourly_cost ?? (centers.find(c => c.id === wid)?.hourly_cost ?? 0);
  const liveCost = ops.reduce((s, o) => s + (wcCost(o.workCenterId) * (Number(o.durationMin) || 0) / 60), 0);
  const liveMinutes = ops.reduce((s, o) => s + (Number(o.durationMin) || 0), 0);

  const save = useMutation({
    mutationFn: async () => {
      const clean = ops.filter(o => o.operationName.trim());
      if (id) return routingsApi.update(id, { name: name.trim(), productId: productId || null, operations: clean });
      const created = await routingsApi.create({ name: name.trim(), productId: productId || null });
      return routingsApi.update(created.id, { operations: clean });
    },
    onSuccess: () => { notify.success(id ? 'Gamme enregistrée' : 'Gamme créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const del = useMutation({ mutationFn: () => routingsApi.remove(id!), onSuccess: () => { notify.success('Gamme supprimée'); qc.invalidateQueries({ queryKey: ['routings'] }); onClose(); }, onError: e => notify.error(apiErrorMessage(e)) });
  const setOp = (i: number, patch: Partial<OperationInput>) => setOps(a => a.map((o, j) => j === i ? { ...o, ...patch } : o));

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(720px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Route size={16} /> {id ? 'Modifier la gamme' : 'Nouvelle gamme'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 200 }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom de la gamme</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Fabrication baguette" style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 200 }}><span style={{ color: 'var(--theme-text-muted)' }}>Produit (optionnel)</span><SearchSelect options={productOptions} value={productId} onChange={setProductId} placeholder="Associer un produit…" width="100%" /></label>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Opérations</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ops.map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ width: 20, textAlign: 'center', color: 'var(--theme-text-muted)', fontWeight: 600 }}>{i + 1}</span>
                <input type="text" value={o.operationName} onChange={e => setOp(i, { operationName: e.target.value })} placeholder="Opération" style={{ ...inp, flex: 1, minWidth: 140 }} />
                <select value={o.workCenterId ?? ''} onChange={e => setOp(i, { workCenterId: e.target.value || null })} style={{ ...inp, width: 170 }}>
                  <option value="">— Poste —</option>
                  {activeCenters.map(c => <option key={c.id} value={c.id}>{c.name} ({money(c.hourly_cost)}/h)</option>)}
                </select>
                <input type="number" min="0" value={o.durationMin || ''} onChange={e => setOp(i, { durationMin: Number(e.target.value) || 0 })} placeholder="min" style={{ ...inp, width: 80 }} />
                <span style={{ width: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>{money(wcCost(o.workCenterId) * (Number(o.durationMin) || 0) / 60)}</span>
                <button className="odoo-btn-secondary" style={{ padding: '0.3rem 0.4rem' }} onClick={() => setOps(a => a.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setOps(a => [...a, { operationName: '', workCenterId: null, durationMin: 0 }])}><Plus size={13} /> Ajouter une opération</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontWeight: 600, borderTop: '1px solid var(--odoo-border)', paddingTop: 10 }}>
            <span style={{ color: 'var(--theme-text-muted)' }}>Durée totale : {liveMinutes} min</span>
            <span>Coût MO standard : {money(Math.round(liveCost * 100) / 100)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <div>{id && <button className="odoo-btn-secondary" style={{ color: '#dc2626' }} onClick={() => del.mutate()}><Trash2 size={13} /> Supprimer</button>}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {id ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
