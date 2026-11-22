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
import SearchSelect from '../../components/ui/SearchSelect';
import { FormField, FormFooter, Modal } from '../../components/ds';

/** Formulaires du module Maintenance : intervention, plan d'entretien. */

export const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const PRIORITY_TAG: Record<Priority, string> = { critical: 'odoo-tag-red', high: 'odoo-tag-orange', normal: 'odoo-tag-blue', low: 'odoo-tag-grey' };
/** Libellé de champ aux cotes du Design System (ds-field-label). */
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--ds-ink)', marginBottom: 6, display: 'block' };
const req = <span className="ds-req" aria-hidden="true"> *</span>;
const customerLabel = (c: Record<string, any>) => (c.company_name as string)?.trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();

function Shell({ title, onClose, children, footer, width = 680 }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; width?: number }) {
  return (
    <Modal title={title} onClose={onClose} width={width} footer={footer}>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </Modal>
  );
}

/** Équipement : une immobilisation (interne) ou un équipement chez un client (libellé + n° de série). */
function EquipmentFields({ value, onChange, withProductionEquipment = false }: {
  value: { fixedAssetId: string | null; customerId: string | null; customerName: string; equipmentLabel: string; serialNo: string; equipmentId?: string | null };
  onChange: (v: Partial<typeof value>) => void;
  /** M5-05 : choix de l'équipement de production (intervention seulement) — sa clôture crée l'arrêt du poste. */
  withProductionEquipment?: boolean;
}) {
  const { data: equipments = [] } = useQuery({ queryKey: ['maintenance-equipments'], queryFn: maintenanceApi.equipments, enabled: withProductionEquipment });
  const [mode, setMode] = useState<'asset' | 'customer'>(value.fixedAssetId || !value.customerId ? 'asset' : 'customer');
  const { data: assets = [] } = useQuery({ queryKey: ['maintenance-assets'], queryFn: maintenanceApi.assets });
  const [q, setQ] = useState('');
  const { data: customersData } = useQuery({ queryKey: ['customers', 'search', q], queryFn: () => customersApi.list({ search: q, limit: '20' }), enabled: q.trim().length >= 2 });
  const customers: Record<string, any>[] = customersData?.data ?? [];
  return (
    <>
      <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--ds-hair)', borderRadius: 8, width: 'fit-content' }}>
        {([['asset', 'Matériel interne'], ['customer', 'Chez un client']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setMode(k); onChange(k === 'asset' ? { customerId: null, customerName: '' } : { fixedAssetId: null }); }}
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: mode === k ? 600 : 400,
              background: mode === k ? 'var(--ds-card)' : 'transparent', color: mode === k ? 'var(--ds-ink)' : 'var(--ds-muted)' }}>{l}</button>
        ))}
      </div>
      {mode === 'asset' && withProductionEquipment && (
        <div>
          <span style={label}>Équipement de production</span>
          <SearchSelect value={value.equipmentId ?? ''} width="100%" size="md" ariaLabel="Équipement de production"
            placeholder="Aucun (immobilisation ou libellé ci-dessous)"
            options={equipments.map(e => ({ id: e.id, label: e.label }))}
            onChange={id => {
              const e = equipments.find(x => x.id === id);
              onChange(e
                ? { equipmentId: e.id, fixedAssetId: e.fixed_asset_id ?? value.fixedAssetId, equipmentLabel: e.fixed_asset_id ? value.equipmentLabel : (value.equipmentLabel || e.label) }
                : { equipmentId: null });
            }} />
        </div>
      )}
      {mode === 'asset' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <span style={label}>Immobilisation</span>
            <SearchSelect value={value.fixedAssetId != null ? String(value.fixedAssetId) : ''} onChange={id => onChange({ fixedAssetId: id || null })}
              placeholder="Hors immobilisations (libellé ci-contre)" width="100%" size="md" ariaLabel="Immobilisation"
              options={assets.map(a => ({ id: String(a.id), label: a.label as string }))} />
          </div>
          <div>
            <span style={label}>Ou équipement (libellé)</span>
            <input className="ds-input" value={value.equipmentLabel} maxLength={200} onChange={e => onChange({ equipmentLabel: e.target.value })} placeholder="Ex. : four à sole n° 2, chambre froide" />
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
                <input className="ds-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une fiche" />
                {customers.length > 0 && q.trim().length >= 2 && (
                  <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 4, marginTop: 4, maxHeight: 120, overflowY: 'auto' }}>
                    {customers.slice(0, 8).map(c => (
                      <button key={c.id} type="button" onClick={() => { onChange({ customerId: c.id, customerName: customerLabel(c) }); setQ(''); }}
                        style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: 14, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>{customerLabel(c)}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <FormField label="Équipement" htmlFor="mnt-f1"><input id="mnt-f1" className="ds-input" value={value.equipmentLabel} maxLength={200} onChange={e => onChange({ equipmentLabel: e.target.value })} placeholder="Ex. : vitrine réfrigérée" /></FormField>
          <FormField label="N° de série" htmlFor="mnt-f2"><input id="mnt-f2" className="ds-input" value={value.serialNo} maxLength={80} onChange={e => onChange({ serialNo: e.target.value })} /></FormField>
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
    assigneeId: '', scheduledAt: '', underWarranty: false, billable: false, equipmentId: null as string | null,
  });
  const set = (p: Partial<typeof f>) => setF(s => ({ ...s, ...p }));
  const create = useMutation({
    mutationFn: () => maintenanceApi.create({
      kind: f.kind, priority: f.priority, title: f.title.trim(), fixedAssetId: f.fixedAssetId, customerId: f.customerId, equipmentId: f.equipmentId,
      equipmentLabel: f.equipmentLabel.trim() || null, serialNo: f.serialNo.trim() || null, location: f.location.trim() || null,
      reportedProblem: f.reportedProblem.trim() || null, assigneeId: f.assigneeId || null, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
      underWarranty: f.underWarranty, billable: f.billable, complaintId: defaults?.complaintId ?? null, projectId: defaults?.projectId ?? null,
    }),
    onSuccess: (i) => { qc.invalidateQueries({ queryKey: ['maintenance'] }); notify.success(`Intervention ${i.number} créée`); onCreated?.(i.id); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = f.title.trim().length > 0 && (!!f.fixedAssetId || !!f.equipmentId || f.equipmentLabel.trim().length > 0) && !create.isPending;
  return (
    <Shell title="Nouvelle intervention" onClose={onClose}
      footer={<FormFooter onCancel={onClose} submitLabel="Créer l'intervention" busy={create.isPending} disabled={!can} onSubmit={() => create.mutate()} />}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <FormField label="Objet" htmlFor="mnt-f3" required><input id="mnt-f3" className="ds-input" value={f.title} maxLength={200} onChange={e => set({ title: e.target.value })} placeholder="Ex. : four ne chauffe plus, révision annuelle…" autoFocus /></FormField>
        <div>
          <span style={label}>Type</span>
          <select className="ds-input" value={f.kind} onChange={e => set({ kind: e.target.value as InterventionKind })}>
            {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Priorité</span>
          <select className="ds-input" value={f.priority} onChange={e => set({ priority: e.target.value as Priority })}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <EquipmentFields value={f} onChange={set} withProductionEquipment />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Intervenant</span>
          <SearchSelect value={f.assigneeId} onChange={v => set({ assigneeId: v })}
            placeholder="À affecter" width="100%" size="md" ariaLabel="Intervenant"
            options={people.map(p => ({ id: String(p.id), label: p.name as string }))} />
        </div>
        <FormField label="Planifiée le" htmlFor="mnt-f4"><input id="mnt-f4" className="ds-input" type="datetime-local" value={f.scheduledAt} onChange={e => set({ scheduledAt: e.target.value })} /></FormField>
        <FormField label="Lieu" htmlFor="mnt-f5"><input id="mnt-f5" className="ds-input" value={f.location} maxLength={200} onChange={e => set({ location: e.target.value })} placeholder="Atelier, adresse…" /></FormField>
      </div>
      <FormField label="Problème signalé / travail demandé" htmlFor="mnt-f6"><textarea id="mnt-f6" className="ds-input" style={{ minHeight: 70 }} value={f.reportedProblem} onChange={e => set({ reportedProblem: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
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
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={!can} onSubmit={() => save.mutate()} />}>
      <FormField label="Entretien" htmlFor="mnt-f7" required><input id="mnt-f7" className="ds-input" value={f.label} maxLength={200} onChange={e => set({ label: e.target.value })} placeholder="Ex. : Détartrage four vapeur, Contrôle joints chambre froide" autoFocus /></FormField>
      <EquipmentFields value={f} onChange={set} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <FormField label="Tous les (jours)" htmlFor="mnt-f8" required><input id="mnt-f8" className="ds-input" type="number" min="1" max="3660" value={f.frequencyDays} onChange={e => set({ frequencyDays: Number(e.target.value) })} /></FormField>
        <FormField label="Prochaine échéance" htmlFor="mnt-f9" required><input id="mnt-f9" className="ds-input" type="date" value={f.nextDueOn} onChange={e => set({ nextDueOn: e.target.value })} /></FormField>
        <div>
          <span style={label}>Intervenant habituel</span>
          <SearchSelect value={f.assigneeId} onChange={v => set({ assigneeId: v })}
            placeholder="—" width="100%" size="md" ariaLabel="Intervenant habituel"
            options={people.map(p => ({ id: String(p.id), label: p.name as string }))} />
        </div>
      </div>
      <FormField label="Points à vérifier" htmlFor="mnt-f10"><textarea id="mnt-f10" className="ds-input" style={{ minHeight: 70 }} value={f.checklist} onChange={e => set({ checklist: e.target.value })} placeholder="Une ligne par point de contrôle" /></FormField>
      {plan && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={f.isActive} onChange={e => set({ isActive: e.target.checked })} /> Plan actif</label>}
    </Shell>
  );
}
