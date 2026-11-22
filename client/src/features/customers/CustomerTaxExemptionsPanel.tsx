import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { Modal, FormField, FormSection, FormFooter } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { customersApi, type CustomerTaxExemption } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

// Attestations d'exonération de TVA de la fiche client (phase 5.7). Référentiel daté
// (numéro, motif, validité). L'application à la TVA des factures reste différée aux
// réponses de l'expert-comptable ; ici on saisit et on liste.

type Form = { certificateNumber: string; reason: string; validFrom: string; validTo: string; notes: string };
const emptyForm = (): Form => ({ certificateNumber: '', reason: '', validFrom: new Date().toISOString().slice(0, 10), validTo: '', notes: '' });

export default function CustomerTaxExemptionsPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rows = [] } = useQuery({ queryKey: ['customer-tax-exemptions', customerId], queryFn: () => customersApi.listExemptions(customerId) });
  const [form, setForm] = useState<Form | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-tax-exemptions', customerId] });

  const save = useMutation({
    mutationFn: (f: Form) => customersApi.createExemption(customerId, {
      certificateNumber: f.certificateNumber, reason: f.reason || null, validFrom: f.validFrom, validTo: f.validTo || null, notes: f.notes || null,
    }),
    onSuccess: () => { invalidate(); setForm(null); notify.success('Attestation enregistrée'); },
    onError: () => notify.error('Échec de l\'enregistrement'),
  });
  const del = useMutation({
    mutationFn: (id: string) => customersApi.removeExemption(customerId, id),
    onSuccess: () => { invalidate(); notify.success('Attestation supprimée'); },
  });

  const todayActive = (r: CustomerTaxExemption) => {
    const t = new Date().toISOString().slice(0, 10);
    return r.valid_from <= t && (!r.valid_to || r.valid_to >= t);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 600, color: 'var(--ds-ink)' }}>
          <ShieldCheck size={12} /> Exonérations de TVA
        </div>
        {!form && <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setForm(emptyForm())}><Plus size={12} /> Ajouter</button>}
      </div>

      {rows.length === 0 && !form && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', padding: '6px 0' }}>Aucune attestation.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {r.certificate_number}
                {todayActive(r) && <StatusTag tone="done" label="En cours" />}
              </div>
              {r.reason && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{r.reason}</div>}
              <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Du {r.valid_from}{r.valid_to ? ` au ${r.valid_to}` : ' (sans fin)'}</div>
            </div>
            <button type="button" className="ds-icon-btn" title="Supprimer" aria-label="Supprimer l'exonération" disabled={del.isPending} style={{ color: 'var(--ds-danger)' }}
              onClick={async () => { if (await confirm('Supprimer cette exonération de TVA ?', { title: 'Supprimer l\'exonération', confirmLabel: 'Supprimer', danger: true })) del.mutate(r.id); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {form && (
        <Modal title="Nouvelle attestation d'exonération" onClose={() => setForm(null)} width={560} locked={save.isPending}
          footer={<FormFooter onCancel={() => setForm(null)} onSubmit={() => save.mutate(form)} disabled={!form.certificateNumber.trim() || !form.validFrom} busy={save.isPending} />}>
          <FormSection title="Attestation">
            <div className="ds-form-grid">
              <FormField label="N° d'attestation" htmlFor="te-number" required>
                <input id="te-number" className="ds-input" value={form.certificateNumber} onChange={e => setForm({ ...form, certificateNumber: e.target.value })} placeholder="EXO-2026-001" />
              </FormField>
              <FormField label="Motif" htmlFor="te-reason">
                <input id="te-reason" className="ds-input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Export, ANP…" />
              </FormField>
            </div>
          </FormSection>
          <FormSection title="Validité">
            <div className="ds-form-grid">
              <FormField label="Valide du" htmlFor="te-from" required>
                <input id="te-from" type="date" className="ds-input" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
              </FormField>
              <FormField label="au (optionnel)" htmlFor="te-to">
                <input id="te-to" type="date" className="ds-input" value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Notes (optionnel)" htmlFor="te-notes">
              <input id="te-notes" className="ds-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </FormSection>
        </Modal>
      )}
    </div>
  );
}
