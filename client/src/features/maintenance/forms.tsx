import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  maintenanceApi, KIND_LABELS, PRIORITY_LABELS, type InterventionInput, type InterventionKind, type MaintenancePlan, type PlanInput, type Priority,
} from '../../api/maintenance.api';
import { customersApi } from '../../api/customers.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/** Formulaires du module Maintenance : intervention, plan d'entretien. */

export const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const PRIORITY_TAG: Record<Priority, string> = { critical: 'odoo-tag-red', high: 'odoo-tag-orange', normal: 'odoo-tag-blue', low: 'odoo-tag-grey' };
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, display: 'block' };
const customerLabel = (c: Record<string, any>) => (c.company_name as string)?.trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();

function Shell({ title, onClose, children, footer, width = 680 }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; width?: number }) {
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{title}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>{children}</div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>{footer}</div>
      </div>
    </ModalBackdrop>
  );
}

/** Équipement : une immobilisation (interne) ou un équipement chez un client (libellé + n° de série). */
function EquipmentFields({ value, onChange }: {
  value: { fixedAssetId: string | null; customerId: string | null; customerName: string; equipmentLabel: string; serialNo: string };
  onChange: (v: Partial<typeof value>) => void;
}) {
  const [mode, setMode] = useState<'asset' | 'customer'>(value.fixedAssetId || !value.customerId ? 'asset' : 'customer');
  const { data: assets = [] } = useQuery({ queryKey: ['maintenance-assets'], queryFn: maintenanceApi.assets });
  const [q, setQ] = useState('');
  const { data: customersData } = useQuery({ queryKey: ['customers', 'search', q], queryFn: () => customersApi.list({ search: q, limit: '20' }), enabled: q.trim().length >= 2 });
  const customers: Record<string, any>[] = customersData?.data ?? [];
  return (
    <>
      <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--theme-bg-secondary)', borderRadius: 8, width: 'fit-content' }}>
        {([['asset', 'Matériel interne'], ['customer', 'Chez un client']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setMode(k); onChange(k === 'asset' ? { customerId: null, customerName: '' } : { fixedAssetId: null }); }}
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: mode === k ? 600 : 400,
              background: mode === k ? 'var(--theme-bg-card)' : 'transparent', color: mode === k ? 'var(--theme-text)' : 'var(--theme-text-muted)' }}>{l}</button>
        ))}
      </div>
      {mode === 'asset' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <span style={label}>Immobilisation</span>
            <select className="input" style={{ width: '100%' }} value={value.fixedAssetId ?? ''} onChange={e => onChange({ fixedAssetId: e.target.value || null })}>
              <option value="">Hors immobilisations (libellé ci-contre)</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>Ou équipement (libellé)</span>
            <input className="input" style={{ width: '100%' }} value={value.equipmentLabel} maxLength={200} onChange={e => onChange({ equipmentLabel: e.target.value })} placeholder="Ex. : four à sole n° 2, chambre froide" />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <span style={label}>Client</span>
            {value.customerId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="odoo-tag odoo-tag-blue">{value.customerName || 'Fiche client'}</span>
                <button type="button" className="odoo-btn-secondary" onClick={() => onChange({ customerId: null, customerName: '' })}>Changer</button>
              </div>
            ) : (
              <>
                <input className="input" style={{ width: '100%' }} value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une fiche" />
                {customers.length > 0 && q.trim().length >= 2 && (
                  <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, marginTop: 4, maxHeight: 120, overflowY: 'auto' }}>
                    {customers.slice(0, 8).map(c => (
                      <button key={c.id} type="button" onClick={() => { onChange({ customerId: c.id, customerName: customerLabel(c) }); setQ(''); }}
                        style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: '0.8125rem', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>{customerLabel(c)}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div><span style={label}>Équipement</span><input className="input" style={{ width: '100%' }} value={value.equipmentLabel} maxLength={200} onChange={e => onChange({ equipmentLabel: e.target.value })} placeholder="Ex. : vitrine réfrigérée" /></div>
          <div><span style={label}>N° de série</span><input className="input" style={{ width: '100%' }} value={value.serialNo} maxLength={80} onChange={e => onChange({ serialNo: e.target.value })} /></div>
        </div>
      )}
    </>
  );
}

export function InterventionFormModal({ onClose, onCreated, defaults }: {
  onClose: () => void; onCreated?: (id: string) => void;
  defaults?: Partial<InterventionInput> & { customerName?: string };
}) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery({ queryKey: ['maintenance-people'], queryFn: maintenanceApi.people });
  const [f, setF] = useState({
    kind: (defaults?.kind ?? 'corrective') as InterventionKind, priority: (defaults?.priority ?? 'normal') as Priority, title: defaults?.title ?? '',
    fixedAssetId: defaults?.fixedAssetId ?? null, customerId: defaults?.customerId ?? null, customerName: defaults?.customerName ?? '',
    equipmentLabel: defaults?.equipmentLabel ?? '', serialNo: defaults?.serialNo ?? '', location: '', reportedProblem: defaults?.reportedProblem ?? '',
    assigneeId: '', scheduledAt: '', underWarranty: false, billable: false,
  });
  const set = (p: Partial<typeof f>) => setF(s => ({ ...s, ...p }));
  const create = useMutation({
    mutationFn: () => maintenanceApi.create({
      kind: f.kind, priority: f.priority, title: f.title.trim(), fixedAssetId: f.fixedAssetId, customerId: f.customerId,
      equipmentLabel: f.equipmentLabel.trim() || null, serialNo: f.serialNo.trim() || null, location: f.location.trim() || null,
      reportedProblem: f.reportedProblem.trim() || null, assigneeId: f.assigneeId || null, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
      underWarranty: f.underWarranty, billable: f.billable, complaintId: defaults?.complaintId ?? null, projectId: defaults?.projectId ?? null,
    }),
    onSuccess: (i) => { qc.invalidateQueries({ queryKey: ['maintenance'] }); notify.success(`Intervention ${i.number} créée`); onCreated?.(i.id); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = f.title.trim().length > 0 && (!!f.fixedAssetId || f.equipmentLabel.trim().length > 0) && !create.isPending;
  return (
    <Shell title="Nouvelle intervention" onClose={onClose}
      footer={<>
        <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button className="odoo-btn-primary" disabled={!can} onClick={() => create.mutate()}>{create.isPending && <Loader2 size={13} className="animate-spin" />} Créer</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div><span style={label}>Objet</span><input className="input" style={{ width: '100%' }} value={f.title} maxLength={200} onChange={e => set({ title: e.target.value })} placeholder="Ex. : four ne chauffe plus, révision annuelle…" autoFocus /></div>
        <div>
          <span style={label}>Type</span>
          <select className="input" style={{ width: '100%' }} value={f.kind} onChange={e => set({ kind: e.target.value as InterventionKind })}>
            {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Priorité</span>
          <select className="input" style={{ width: '100%' }} value={f.priority} onChange={e => set({ priority: e.target.value as Priority })}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <EquipmentFields value={f} onChange={set} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Intervenant</span>
          <select className="input" style={{ width: '100%' }} value={f.assigneeId} onChange={e => set({ assigneeId: e.target.value })}>
            <option value="">À affecter</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><span style={label}>Planifiée le</span><input className="input" type="datetime-local" style={{ width: '100%' }} value={f.scheduledAt} onChange={e => set({ scheduledAt: e.target.value })} /></div>
        <div><span style={label}>Lieu</span><input className="input" style={{ width: '100%' }} value={f.location} maxLength={200} onChange={e => set({ location: e.target.value })} placeholder="Atelier, adresse…" /></div>
      </div>
      <div><span style={label}>Problème signalé / travail demandé</span><textarea className="input" style={{ width: '100%', minHeight: 70 }} value={f.reportedProblem} onChange={e => set({ reportedProblem: e.target.value })} /></div>
      <div style={{ display: 'flex', gap: 16, fontSize: '0.8125rem' }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.underWarranty} onChange={e => set({ underWarranty: e.target.checked })} /> Sous garantie</label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.billable} onChange={e => set({ billable: e.target.checked })} /> Refacturable au client</label>
      </div>
    </Shell>
  );
}

export function PlanFormModal({ plan, onClose }: { plan?: MaintenancePlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery({ queryKey: ['maintenance-people'], queryFn: maintenanceApi.people });
  const [f, setF] = useState({
    label: plan?.label ?? '', fixedAssetId: plan?.fixed_asset_id ?? null, customerId: plan?.customer_id ?? null, customerName: plan?.customer_label ?? '',
    equipmentLabel: plan?.equipment_label ?? '', serialNo: plan?.serial_no ?? '', frequencyDays: plan?.frequency_days ?? 30,
    checklist: plan?.checklist ?? '', assigneeId: plan?.assignee_id ?? '', nextDueOn: plan?.next_due_on?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd'), isActive: plan?.is_active ?? true,
  });
  const set = (p: Partial<typeof f>) => setF(s => ({ ...s, ...p }));
  const save = useMutation({
    mutationFn: () => {
      const body: PlanInput = {
        label: f.label.trim(), fixedAssetId: f.fixedAssetId, customerId: f.customerId, equipmentLabel: f.equipmentLabel.trim() || null, serialNo: f.serialNo.trim() || null,
        frequencyDays: Number(f.frequencyDays), checklist: f.checklist.trim() || null, assigneeId: f.assigneeId || null, nextDueOn: f.nextDueOn, isActive: f.isActive,
      };
      return maintenanceApi.savePlan(body, plan?.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); notify.success('Plan enregistré'); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = f.label.trim().length > 0 && (!!f.fixedAssetId || f.equipmentLabel.trim().length > 0) && Number(f.frequencyDays) >= 1 && !!f.nextDueOn && !save.isPending;
  return (
    <Shell title={plan ? 'Modifier le plan d\'entretien' : 'Nouveau plan d\'entretien'} onClose={onClose}
      footer={<>
        <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button className="odoo-btn-primary" disabled={!can} onClick={() => save.mutate()}>Enregistrer</button>
      </>}>
      <div><span style={label}>Entretien</span><input className="input" style={{ width: '100%' }} value={f.label} maxLength={200} onChange={e => set({ label: e.target.value })} placeholder="Ex. : Détartrage four vapeur, Contrôle joints chambre froide" autoFocus /></div>
      <EquipmentFields value={f} onChange={set} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div><span style={label}>Tous les (jours)</span><input className="input" type="number" min="1" max="3660" style={{ width: '100%' }} value={f.frequencyDays} onChange={e => set({ frequencyDays: Number(e.target.value) })} /></div>
        <div><span style={label}>Prochaine échéance</span><input className="input" type="date" style={{ width: '100%' }} value={f.nextDueOn} onChange={e => set({ nextDueOn: e.target.value })} /></div>
        <div>
          <span style={label}>Intervenant habituel</span>
          <select className="input" style={{ width: '100%' }} value={f.assigneeId} onChange={e => set({ assigneeId: e.target.value })}>
            <option value="">—</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div><span style={label}>Points à vérifier</span><textarea className="input" style={{ width: '100%', minHeight: 70 }} value={f.checklist} onChange={e => set({ checklist: e.target.value })} placeholder="Une ligne par point de contrôle" /></div>
      {plan && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem' }}><input type="checkbox" checked={f.isActive} onChange={e => set({ isActive: e.target.checked })} /> Plan actif</label>}
    </Shell>
  );
}
