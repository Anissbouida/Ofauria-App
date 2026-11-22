import { useMemo, useState } from 'react';
import { routingOpMinutes, routingOpCost } from '@ofauria/shared';
import { money, currencySymbol } from '../../utils/money';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cog, Plus, Power, Trash2, Route, Wrench, ListOrdered, Gauge, CalendarDays } from 'lucide-react';
import { routingsApi, opToInput, OP_TYPE_LABELS, type OpType, type Routing, type OperationInput } from '../../api/routings.api';
import WorkCenterOeeModal from './WorkCenterOeeModal';
import WorkCenterCalendarModal from './WorkCenterCalendarModal';
import EquipmentLinksPanel from './EquipmentLinksPanel';

// Statuts de poste (mig 402)
const WC_STATUS: Record<string, { label: string }> = {
  production: { label: 'En production' },
  idle: { label: 'Inactif' },
  off: { label: 'Éteint' },
  probleme: { label: 'Problème' },
  maintenance: { label: 'Maintenance' },
  reglage: { label: 'Réglage' },
};
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import SalesPageShell from '../sales/SalesPageShell';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { DataPanel, EmptyState, ErrorState, FormField, FormFooter, FormSection, LoadingState, Modal, Segmented, TableFooter, Toolbar } from '../../components/ds';

const round2 = (n: number) => Math.round(n * 100) / 100;
const suffix: React.CSSProperties = { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--ds-muted)' };

/** Grille partagée en-tête / lignes de l'éditeur d'opérations (alignement des colonnes). */
const OPS_GRID = '26px minmax(0, 1fr) 190px 92px 94px 34px';
const colHead: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)' };

export default function WorkCentersPage() {
  const [view, setView] = useState<'routings' | 'centers'>('routings');
  // Création lancée depuis la barre du haut (bouton principal de l'écran).
  const [creating, setCreating] = useState(false);
  return (
    <SalesPageShell icon={Cog} parent="Production › Paramétrage" title="Postes & gammes"
      summary="Postes de travail avec leur coût horaire, et gammes d'opérations qui donnent le coût de main-d'œuvre standard."
      actions={
        <button type="button" className="odoo-btn-primary" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> {view === 'routings' ? 'Nouvelle gamme' : 'Nouveau poste'}
        </button>
      }>
      {/* Bascule de vue : la gamme s'appuie sur les postes, donc Gammes en premier. */}
      <Toolbar>
        <Segmented label="Vue" value={view} onChange={v => { setView(v); setCreating(false); }}
          options={[{ key: 'routings', label: 'Gammes', icon: ListOrdered }, { key: 'centers', label: 'Postes de travail', icon: Wrench }]} />
      </Toolbar>
      {view === 'routings'
        ? <Routings creating={creating} onCreatingChange={setCreating} />
        : <Centers creating={creating} onCreatingChange={setCreating} />}
    </SalesPageShell>
  );
}

function Centers({ creating: showForm, onCreatingChange: setShowForm }: { creating: boolean; onCreatingChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const [oeeFor, setOeeFor] = useState<{ id: string; name: string } | null>(null);
  const [calFor, setCalFor] = useState<{ id: string; name: string } | null>(null);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="Aucun poste de travail" text="Créez un poste (pétrin, four, façonnage…) avec son coût horaire."
          action={<button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} aria-hidden="true" /> Nouveau poste</button>} />
      ) : (
      <DataPanel label="Postes de travail" footer={<TableFooter note={`${rows.length} poste${rows.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead><tr><th>Poste</th><th className="ds-num">Coût horaire ({currencySymbol()}/h)</th><th className="ds-num">Capacité (min/j)</th><th>Statut</th><th className="ds-num">Opérations</th><th>État</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(w => (
              <tr key={w.id} style={{ opacity: w.is_active ? 1 : 0.6 }}>
                <td className="ds-strong">{w.name}</td>
                <td className="ds-num">{money(w.hourly_cost)}</td>
                <td className="ds-num">{w.capacity_minutes_per_day != null ? w.capacity_minutes_per_day : '—'}</td>
                <td>
                  <select className="ds-input sm" aria-label={`Statut de ${w.name}`} value={w.status ?? 'idle'} onChange={e => setStatus.mutate({ id: w.id, status: e.target.value })} style={{ width: 150 }}>
                    {Object.entries(WC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </td>
                <td className="ds-num">{w.operations_count}</td>
                <td><StatusTag tone={w.is_active ? 'done' : 'cancelled'} label={w.is_active ? 'Actif' : 'Inactif'} /></td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setOeeFor({ id: w.id, name: w.name })}><Gauge size={12} aria-hidden="true" /> TRS et arrêts</button>
                  <RowMenu label={`Plus d'actions sur ${w.name}`} items={[
                    { label: 'Calendrier du poste', icon: CalendarDays, onSelect: () => setCalFor({ id: w.id, name: w.name }) },
                    { label: w.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate({ id: w.id, active: !w.is_active }) },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
      {showForm && <CenterForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['work-centers'] }); setShowForm(false); }} />}
      {oeeFor && <WorkCenterOeeModal workCenter={oeeFor} onClose={() => setOeeFor(null)} />}
      {calFor && <WorkCenterCalendarModal workCenter={calFor} onClose={() => setCalFor(null)} />}
      <EquipmentLinksPanel workCenters={rows} />
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
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Wrench size={18} aria-hidden="true" /> Nouveau poste de travail</span>}
      onClose={onClose} width={440} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} submitLabel="Créer le poste" busy={save.isPending} disabled={name.trim().length < 2} onSubmit={() => save.mutate()} />}>
          <FormField label="Nom du poste" htmlFor="wc-name" required>
            <input id="wc-name" type="text" className="ds-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. : four à sole" />
          </FormField>
          <FormField label="Coût horaire" htmlFor="wc-cost">
            <div style={{ position: 'relative' }}>
              <input id="wc-cost" type="number" step="0.01" min="0" className="ds-input" value={cost} onChange={e => setCost(e.target.value)} placeholder="0,00" style={{ paddingRight: 52 }} />
              <span style={suffix}>{currencySymbol()}/h</span>
            </div>
          </FormField>
          <FormField label="Capacité" htmlFor="wc-capacity" hint="Facultatif.">
            <div style={{ position: 'relative' }}>
              <input id="wc-capacity" type="number" step="1" min="0" className="ds-input" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Ex. : 480" style={{ paddingRight: 52 }} />
              <span style={suffix}>min/j</span>
            </div>
          </FormField>
    </Modal>
  );
}

function Routings({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['routings'], queryFn: routingsApi.list });
  const [editingId, setEditing] = useState<string | null>(null);
  // « Nouvelle gamme » vient de la barre du haut ; une gamme existante s'ouvre au clic sur sa ligne.
  const editing: string | 'new' | null = creating ? 'new' : editingId;
  const closeEditor = () => { setEditing(null); onCreatingChange(false); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Route} title="Aucune gamme" text="Une gamme est une séquence d'opérations, chacune sur un poste, qui donne un coût de main-d'œuvre standard."
          action={<button type="button" className="odoo-btn-primary" onClick={() => onCreatingChange(true)}><Plus size={14} aria-hidden="true" /> Nouvelle gamme</button>} />
      ) : (
      <DataPanel label="Gammes" footer={<TableFooter note={`${rows.length} gamme${rows.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead><tr><th>Gamme</th><th>Produit associé</th><th className="ds-num">Fournée (unités)</th><th className="ds-num">Opérations</th><th className="ds-num">Durée (min)</th><th className="ds-num">Coût de main-d'œuvre standard ({currencySymbol()})</th><th>État</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(r.id)}>
                <td className="ds-strong">{r.name}</td>
                <td>{r.product_name || '—'}</td>
                <td className="ds-num">{r.batch_size}</td>
                <td className="ds-num">{r.operations_count}</td>
                <td className="ds-num">{r.total_minutes}</td>
                <td className="ds-num ds-strong">{money(r.labor_cost)}</td>
                <td><StatusTag tone={r.is_active ? 'done' : 'cancelled'} label={r.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing(r.id)}>Modifier</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
      {editing && <RoutingEditor id={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={() => { qc.invalidateQueries({ queryKey: ['routings'] }); closeEditor(); }} />}
    </div>
  );
}

export function RoutingEditor({ id, onClose, onSaved, recipeId, defaultName }: { id: string | null; onClose: () => void; onSaved: () => void; recipeId?: string; defaultName?: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: existing } = useQuery({ queryKey: ['routing', id], queryFn: () => routingsApi.getById(id!), enabled: !!id });
  const { data: centers = [] } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const activeCenters = centers.filter(c => c.is_active);
  const { data: prodResp } = useQuery({ queryKey: ['products', 'all-routing'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((prodResp as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name) })), [products]);

  // état local initialisé depuis `existing`
  const [name, setName] = useState(defaultName ?? '');
  const [openOp, setOpenOp] = useState<number | null>(null);
  const [productId, setProductId] = useState('');
  const [batchSize, setBatchSize] = useState('1');
  const [ops, setOps] = useState<OperationInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (existing && !loaded) {
    setName(existing.name); setProductId(existing.product_id ?? '');
    setBatchSize(String(existing.batch_size ?? 1));
    setOps(existing.operations.map(opToInput));
    setLoaded(true);
  }
  if (!id && !loaded) { setOps([{ operationName: '', workCenterId: null, durationMin: 0 }]); setLoaded(true); }

  const wcCost = (wid: string | null | undefined) => activeCenters.find(c => c.id === wid)?.hourly_cost ?? (centers.find(c => c.id === wid)?.hourly_cost ?? 0);
  // Temps main-d'œuvre prévu pour une fournée (M5-01) : même calcul que fn_routing_op_minutes
  // côté serveur (formule partagée, M8-05) ; la gamme enregistrée relit les valeurs du serveur.
  const opMinutes = (o: OperationInput) => routingOpMinutes(o, Number(batchSize) > 0 ? Number(batchSize) : 1).labor;
  const opCost = (o: OperationInput) => routingOpCost(wcCost(o.workCenterId), opMinutes(o));
  const liveCost = round2(ops.reduce((s, o) => s + opCost(o), 0));
  const liveMinutes = Math.round(ops.reduce((s, o) => s + opMinutes(o), 0) * 10) / 10;

  const save = useMutation({
    mutationFn: async () => {
      const clean = ops.filter(o => o.operationName.trim());
      const bs = Number(batchSize) > 0 ? Number(batchSize) : 1;
      if (id) return routingsApi.update(id, { name: name.trim(), productId: productId || null, batchSize: bs, operations: clean });
      const created = await routingsApi.create({ name: name.trim(), productId: productId || null, recipeId: recipeId ?? null, batchSize: bs });
      return routingsApi.update(created.id, { operations: clean });
    },
    onSuccess: () => { notify.success(id ? 'Gamme enregistrée' : 'Gamme créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const del = useMutation({ mutationFn: () => routingsApi.remove(id!), onSuccess: () => { notify.success('Gamme supprimée'); qc.invalidateQueries({ queryKey: ['routings'] }); onClose(); }, onError: e => notify.error(apiErrorMessage(e)) });
  const setOp = (i: number, patch: Partial<OperationInput>) => setOps(a => a.map((o, j) => j === i ? { ...o, ...patch } : o));

  return (
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Route size={18} aria-hidden="true" /> {id ? 'Modifier la gamme' : 'Nouvelle gamme'}</span>}
      onClose={onClose} width={760} locked={save.isPending || del.isPending}
      footer={
        <FormFooter onCancel={onClose} submitLabel={id ? 'Enregistrer' : 'Créer la gamme'} busy={save.isPending} disabled={name.trim().length < 2} onSubmit={() => save.mutate()}>
          {id && (
            <button type="button" className="ds-btn-danger" disabled={del.isPending || save.isPending}
              onClick={async () => { if (await confirm('La gamme et ses opérations seront supprimées définitivement.', { title: 'Supprimer cette gamme ?', confirmLabel: 'Supprimer', danger: true })) del.mutate(); }}>
              <Trash2 size={13} aria-hidden="true" /> Supprimer
            </button>
          )}
        </FormFooter>
      }>
          <FormSection title="Identité de la gamme">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <FormField label="Nom de la gamme" htmlFor="rt-name" required>
              <input id="rt-name" type="text" className="ds-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. : fabrication baguette" />
            </FormField>
            <FormField label="Produit associé" hint="Facultatif.">
              <SearchSelect options={productOptions} value={productId} onChange={setProductId} placeholder="Associer un produit" width="100%" ariaLabel="Produit associé" />
            </FormField>
            <FormField label="Taille de fournée" htmlFor="rt-batch" hint="Unités produites par un passage (sert au calcul de la charge).">
              <div style={{ position: 'relative' }}>
                <input id="rt-batch" type="number" step="0.001" min="0" className="ds-input" value={batchSize} onChange={e => setBatchSize(e.target.value)} placeholder="1" style={{ paddingRight: 56 }} />
                <span style={suffix}>unités</span>
              </div>
            </FormField>
          </div>
          </FormSection>

          {/* Opérations : tableau à en-têtes */}
          <FormSection title="Opérations">
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 540, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* En-têtes de colonnes */}
                <div style={{ display: 'grid', gridTemplateColumns: OPS_GRID, gap: 8, padding: '0 2px', alignItems: 'end' }}>
                  <span style={{ ...colHead, textAlign: 'center' }}>N°</span>
                  <span style={colHead}>Opération</span>
                  <span style={colHead}>Poste de travail</span>
                  <span style={{ ...colHead, textAlign: 'center' }}>Durée (min)</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>Coût ({currencySymbol()})</span>
                  <span />
                </div>
                {ops.map((o, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: OPS_GRID, gap: 8, alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ justifySelf: 'center', width: 8, height: 8, borderRadius: '50%', background: 'var(--ds-accent)' }} />
                    <input type="text" className="ds-input" aria-label={`Nom de l'opération ${i + 1}`} value={o.operationName} onChange={e => setOp(i, { operationName: e.target.value })} placeholder="Ex. : pétrissage" />
                    <SearchSelect value={o.workCenterId != null ? String(o.workCenterId) : ''} onChange={id => setOp(i, { workCenterId: id || null })}
                      placeholder="Choisir" width="100%" size="md" ariaLabel={`Poste de travail de l'opération ${i + 1}`}
                      options={activeCenters.map(c => ({ id: String(c.id), label: `${c.name} · ${money(c.hourly_cost)}/h` }))} />
                    <input type="number" min="0" className="ds-input" aria-label={`Durée de l'opération ${i + 1} en minutes`} value={o.durationMin || ''} onChange={e => setOp(i, { durationMin: Number(e.target.value) || 0 })} placeholder="0" style={{ textAlign: 'center' }} />
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{money(opCost(o))}</span>
                    <button type="button" className="ds-icon-btn" aria-label={`Retirer l'opération ${i + 1}`} title="Retirer l'opération" disabled={ops.length <= 1} onClick={() => setOps(a => a.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
                    <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' }}>
                      <button type="button" className="bsi-link-btn" onClick={() => setOpenOp(openOp === i ? null : i)}>
                        {OP_TYPE_LABELS[o.opType ?? 'execution']}{o.isBlocking ? ' · bloquante' : ''}{(o.setupMin || o.laborMinPerUnit || o.machineMinPerUnit) ? ' · temps détaillés' : ''} {openOp === i ? '▲' : '▼'}
                      </button>
                      {openOp === i && <>
                        <select className="ds-input sm" style={{ width: 'auto' }} value={o.opType ?? 'execution'} aria-label="Type d'opération" onChange={e => setOp(i, { opType: e.target.value as OpType })}>
                          {Object.entries(OP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <label>Réglage <input type="number" min="0" className="ds-input sm" style={{ width: 64, display: 'inline-block' }} value={o.setupMin || ''} onChange={e => setOp(i, { setupMin: Number(e.target.value) || 0 })} /> min</label>
                        <label>Main-d'œuvre <input type="number" min="0" step="0.01" className="ds-input sm" style={{ width: 64, display: 'inline-block' }} value={o.laborMinPerUnit || ''} onChange={e => setOp(i, { laborMinPerUnit: Number(e.target.value) || 0 })} /></label>
                        <label>Machine <input type="number" min="0" step="0.01" className="ds-input sm" style={{ width: 64, display: 'inline-block' }} value={o.machineMinPerUnit || ''} onChange={e => setOp(i, { machineMinPerUnit: Number(e.target.value) || 0 })} /></label>
                        <label>min pour <input type="number" min="0.001" step="0.001" className="ds-input sm" style={{ width: 64, display: 'inline-block' }} value={o.baseQuantity ?? 1} onChange={e => setOp(i, { baseQuantity: Number(e.target.value) || 1 })} /> unités</label>
                        <label><input type="checkbox" checked={!!o.isBlocking} onChange={e => setOp(i, { isBlocking: e.target.checked })} /> Bloquante</label>
                        <input type="text" className="ds-input sm" aria-label="Point de contrôle" style={{ width: 240 }} placeholder="Point de contrôle (ex. : T° à cœur ≥ 72 °C)" value={o.controlPoint ?? ''} onChange={e => setOp(i, { controlPoint: e.target.value || null })} />
                      </>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setOps(a => [...a, { operationName: '', workCenterId: null, durationMin: 0 }])}><Plus size={13} aria-hidden="true" /> Ajouter une opération</button>
          </FormSection>

          {/* Totaux */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 28, borderTop: '1px solid var(--ds-hair)', paddingTop: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={colHead}>Durée totale</div>
              <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{liveMinutes} min</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={colHead}>Coût de main-d'œuvre standard</div>
              <div className="ds-strong" style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{money(liveCost)}</div>
            </div>
          </div>
    </Modal>
  );
}
