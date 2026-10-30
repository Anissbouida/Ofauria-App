import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cog, Plus, X, Loader2, Power, Trash2, Route, Save, Wrench, ListOrdered, Gauge } from 'lucide-react';
import { routingsApi, type Routing, type OperationInput } from '../../api/routings.api';
import WorkCenterOeeModal from './WorkCenterOeeModal';

// Statuts de poste (mig 402)
const WC_STATUS: Record<string, { label: string; color: string }> = {
  production: { label: 'En production', color: '#2e7d32' },
  idle: { label: 'Inactif', color: '#6b7280' },
  off: { label: 'Éteint', color: '#374151' },
  probleme: { label: 'Problème', color: '#c62828' },
  maintenance: { label: 'Maintenance', color: '#b45309' },
  reglage: { label: 'Réglage', color: '#1d4ed8' },
};
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };
const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' };
const fieldLbl: React.CSSProperties = { color: 'var(--theme-text-muted)', fontWeight: 500 };

/** Grille partagée en-tête / lignes de l'éditeur d'opérations (alignement des colonnes). */
const OPS_GRID = '26px minmax(0, 1fr) 190px 92px 94px 34px';
const colHead: React.CSSProperties = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-muted)' };

export default function WorkCentersPage() {
  const [view, setView] = useState<'routings' | 'centers'>('routings');
  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Cog} title="Postes de travail & gammes">
        Définissez vos postes de travail et leur coût horaire, puis des gammes (séquences d'opérations) pour obtenir le coût de main-d'œuvre standard de fabrication. Capacité autonome, à côté des plans de production réels.
      </StatusBanner>

      {/* Onglets : la gamme s'appuie sur les postes, donc Gammes en premier. */}
      <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--theme-bg-subtle, rgba(127,127,127,0.08))', borderRadius: 8, alignSelf: 'flex-start' }}>
        <SegTab icon={ListOrdered} label="Gammes" active={view === 'routings'} onClick={() => setView('routings')} />
        <SegTab icon={Wrench} label="Postes de travail" active={view === 'centers'} onClick={() => setView('centers')} />
      </div>

      {view === 'routings' ? <Routings /> : <Centers />}
    </div>
  );
}

function SegTab({ icon: Icon, label, active, onClick }: { icon: typeof Cog; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.9rem', borderRadius: 6, border: 'none', cursor: 'pointer',
      font: 'inherit', fontWeight: 600, fontSize: '0.82rem',
      background: active ? 'var(--odoo-bg)' : 'transparent', color: active ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
    }}><Icon size={14} /> {label}</button>
  );
}

/** Barre d'outils d'une liste : titre + compteur à gauche, action à droite. */
function Toolbar({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{title}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function Centers() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const [showForm, setShowForm] = useState(false);
  const [oeeFor, setOeeFor] = useState<{ id: string; name: string } | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => routingsApi.setWorkCenterActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-centers'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => routingsApi.setWorkCenterStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-centers'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Toolbar title="Postes de travail" count={rows.length}>
        <button className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouveau poste</button>
      </Toolbar>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Poste</th><th style={{ textAlign: 'right' }}>Coût horaire</th><th style={{ textAlign: 'right' }}>Capacité</th><th>Statut</th><th style={{ textAlign: 'right' }}>Utilisé dans</th><th>État</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun poste. Créez-en un (ex. Pétrin, Four, Façonnage) avec son coût horaire.</td></tr>}
            {rows.map(w => (
              <tr key={w.id} style={{ opacity: w.is_active ? 1 : 0.6 }}>
                <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}><Wrench size={13} style={{ color: 'var(--theme-accent)' }} /> {w.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(w.hourly_cost)}<span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> /h</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{w.capacity_minutes_per_day != null ? <>{w.capacity_minutes_per_day}<span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> min/j</span></> : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}</td>
                <td>
                  <select value={w.status ?? 'idle'} onChange={e => setStatus.mutate({ id: w.id, status: e.target.value })}
                    style={{ fontSize: '0.78rem', padding: '0.2rem 0.3rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: WC_STATUS[w.status ?? 'idle']?.color, fontWeight: 600 }}>
                    {Object.entries(WC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>{w.operations_count} op.</td>
                <td><span className={`odoo-tag ${w.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{w.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', marginRight: 4 }} title="TRS & arrêts" onClick={() => setOeeFor({ id: w.id, name: w.name })}><Gauge size={12} /></button>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem' }} title={w.is_active ? 'Désactiver' : 'Activer'} onClick={() => toggle.mutate({ id: w.id, active: !w.is_active })}><Power size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && <CenterForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['work-centers'] }); setShowForm(false); }} />}
      {oeeFor && <WorkCenterOeeModal workCenter={oeeFor} onClose={() => setOeeFor(null)} />}
    </div>
  );
}

function CenterForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [capacity, setCapacity] = useState('');
  const save = useMutation({
    mutationFn: () => routingsApi.createWorkCenter({ name: name.trim(), hourlyCost: Number(cost) || 0, capacityMinutesPerDay: capacity ? Number(capacity) : null }),
    onSuccess: () => { notify.success('Poste créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(440px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Wrench size={16} /> Nouveau poste de travail</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={fieldCol}><span style={fieldLbl}>Nom du poste</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Four à sole" style={inp} /></label>
          <label style={fieldCol}><span style={fieldLbl}>Coût horaire</span>
            <div style={{ position: 'relative' }}>
              <input type="number" step="0.01" min="0" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" style={{ ...inp, paddingRight: 44 }} />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>DH/h</span>
            </div>
          </label>
          <label style={fieldCol}><span style={fieldLbl}>Capacité <span style={{ fontWeight: 400 }}>(optionnel)</span></span>
            <div style={{ position: 'relative' }}>
              <input type="number" step="1" min="0" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Ex. 480" style={{ ...inp, paddingRight: 52 }} />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>min/j</span>
            </div>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer le poste</button>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Toolbar title="Gammes" count={rows.length}>
        <button className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouvelle gamme</button>
      </Toolbar>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Gamme</th><th>Produit associé</th><th style={{ textAlign: 'right' }}>Fournée</th><th style={{ textAlign: 'right' }}>Opérations</th><th style={{ textAlign: 'right' }}>Durée</th><th style={{ textAlign: 'right' }}>Coût MO standard</th><th>État</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune gamme. Créez-en une : une séquence d'opérations, chacune sur un poste, pour un coût de main-d'œuvre standard.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(r.id)} title="Modifier la gamme">
                <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}><Route size={13} style={{ color: 'var(--theme-accent)' }} /> {r.name}</td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.product_name || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.batch_size}<span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> u.</span></td>
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
    </div>
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
  const [batchSize, setBatchSize] = useState('1');
  const [ops, setOps] = useState<OperationInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (existing && !loaded) {
    setName(existing.name); setProductId(existing.product_id ?? '');
    setBatchSize(String(existing.batch_size ?? 1));
    setOps(existing.operations.map(o => ({ operationName: o.operation_name, workCenterId: o.work_center_id, durationMin: o.duration_min })));
    setLoaded(true);
  }
  if (!id && !loaded) { setOps([{ operationName: '', workCenterId: null, durationMin: 0 }]); setLoaded(true); }

  const wcCost = (wid: string | null | undefined) => activeCenters.find(c => c.id === wid)?.hourly_cost ?? (centers.find(c => c.id === wid)?.hourly_cost ?? 0);
  const opCost = (o: OperationInput) => round2(wcCost(o.workCenterId) * (Number(o.durationMin) || 0) / 60);
  const liveCost = round2(ops.reduce((s, o) => s + opCost(o), 0));
  const liveMinutes = ops.reduce((s, o) => s + (Number(o.durationMin) || 0), 0);

  const save = useMutation({
    mutationFn: async () => {
      const clean = ops.filter(o => o.operationName.trim());
      const bs = Number(batchSize) > 0 ? Number(batchSize) : 1;
      if (id) return routingsApi.update(id, { name: name.trim(), productId: productId || null, batchSize: bs, operations: clean });
      const created = await routingsApi.create({ name: name.trim(), productId: productId || null, batchSize: bs });
      return routingsApi.update(created.id, { operations: clean });
    },
    onSuccess: () => { notify.success(id ? 'Gamme enregistrée' : 'Gamme créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const del = useMutation({ mutationFn: () => routingsApi.remove(id!), onSuccess: () => { notify.success('Gamme supprimée'); qc.invalidateQueries({ queryKey: ['routings'] }); onClose(); }, onError: e => notify.error(apiErrorMessage(e)) });
  const setOp = (i: number, patch: Partial<OperationInput>) => setOps(a => a.map((o, j) => j === i ? { ...o, ...patch } : o));

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(760px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Route size={16} /> {id ? 'Modifier la gamme' : 'Nouvelle gamme'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Identité de la gamme */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <label style={fieldCol}><span style={fieldLbl}>Nom de la gamme</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Fabrication baguette" style={inp} /></label>
            <label style={fieldCol}><span style={fieldLbl}>Produit associé <span style={{ fontWeight: 400 }}>(optionnel)</span></span><SearchSelect options={productOptions} value={productId} onChange={setProductId} placeholder="Associer un produit…" width="100%" /></label>
            <label style={fieldCol}><span style={fieldLbl}>Taille de fournée</span>
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.001" min="0" value={batchSize} onChange={e => setBatchSize(e.target.value)} placeholder="1" style={{ ...inp, paddingRight: 56 }} />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>unités</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--theme-text-muted)' }}>Unités produites par un passage (sert au calcul de la charge).</span>
            </label>
          </div>

          {/* Opérations : tableau à en-têtes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Opérations</div>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 540, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* En-têtes de colonnes */}
                <div style={{ display: 'grid', gridTemplateColumns: OPS_GRID, gap: 8, padding: '0 2px', alignItems: 'end' }}>
                  <span style={{ ...colHead, textAlign: 'center' }}>#</span>
                  <span style={colHead}>Opération</span>
                  <span style={colHead}>Poste de travail</span>
                  <span style={{ ...colHead, textAlign: 'center' }}>Durée (min)</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>Coût</span>
                  <span />
                </div>
                {ops.map((o, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: OPS_GRID, gap: 8, alignItems: 'center' }}>
                    <span style={{ textAlign: 'center', fontWeight: 600, color: 'var(--theme-text-muted)' }}>{i + 1}</span>
                    <input type="text" value={o.operationName} onChange={e => setOp(i, { operationName: e.target.value })} placeholder="Ex. Pétrissage" style={inp} />
                    <select value={o.workCenterId ?? ''} onChange={e => setOp(i, { workCenterId: e.target.value || null })} style={inp}>
                      <option value="">— Choisir —</option>
                      {activeCenters.map(c => <option key={c.id} value={c.id}>{c.name} · {money(c.hourly_cost)}/h</option>)}
                    </select>
                    <input type="number" min="0" value={o.durationMin || ''} onChange={e => setOp(i, { durationMin: Number(e.target.value) || 0 })} placeholder="0" style={{ ...inp, textAlign: 'center' }} />
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.84rem' }}>{money(opCost(o))}</span>
                    <button className="odoo-btn-secondary" style={{ padding: '0.35rem 0.4rem' }} title="Retirer l'opération" disabled={ops.length <= 1} onClick={() => setOps(a => a.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
            <button className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setOps(a => [...a, { operationName: '', workCenterId: null, durationMin: 0 }])}><Plus size={13} /> Ajouter une opération</button>
          </div>

          {/* Totaux */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 28, borderTop: '1px solid var(--odoo-border)', paddingTop: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={colHead}>Durée totale</div>
              <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{liveMinutes} min</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={colHead}>Coût MO standard</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--theme-accent)', fontVariantNumeric: 'tabular-nums' }}>{money(liveCost)}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <div>{id && <button className="odoo-btn-secondary" style={{ color: '#dc2626' }} onClick={() => del.mutate()}><Trash2 size={13} /> Supprimer</button>}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : (id ? <Save size={13} /> : <Plus size={13} />)} {id ? 'Enregistrer' : 'Créer la gamme'}</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
