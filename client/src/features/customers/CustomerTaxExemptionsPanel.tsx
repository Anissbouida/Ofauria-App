import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, Check, X } from 'lucide-react';
import { customersApi, type CustomerTaxExemption } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';

// Attestations d'exonération de TVA de la fiche client (phase 5.7). Référentiel daté
// (numéro, motif, validité). L'application à la TVA des factures reste différée aux
// réponses de l'expert-comptable ; ici on saisit et on liste.

type Form = { certificateNumber: string; reason: string; validFrom: string; validTo: string; notes: string };
const emptyForm = (): Form => ({ certificateNumber: '', reason: '', validFrom: new Date().toISOString().slice(0, 10), validTo: '', notes: '' });

export default function CustomerTaxExemptionsPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
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

  const input: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', background: 'var(--odoo-bg)' };
  const lab: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'block', marginBottom: 2 };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--odoo-text-muted)' }}>
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
                {todayActive(r) && <span className="odoo-tag odoo-tag-green">En cours</span>}
              </div>
              {r.reason && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{r.reason}</div>}
              <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Du {r.valid_from}{r.valid_to ? ` au ${r.valid_to}` : ' (sans fin)'}</div>
            </div>
            <button type="button" className="odoo-btn-secondary" title="Supprimer" onClick={() => del.mutate(r.id)}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {form && (
        <div style={{ border: '1px solid var(--odoo-purple)', borderRadius: 4, padding: 10, marginTop: 6, display: 'grid', gap: 8, background: 'var(--odoo-bg)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label><span style={lab}>N° d'attestation</span><input style={input} value={form.certificateNumber} onChange={e => setForm({ ...form, certificateNumber: e.target.value })} placeholder="EXO-2026-001" /></label>
            <label><span style={lab}>Motif</span><input style={input} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Export, ANP…" /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label><span style={lab}>Valide du</span><input type="date" style={input} value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} /></label>
            <label><span style={lab}>au (optionnel)</span><input type="date" style={input} value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} /></label>
          </div>
          <label><span style={lab}>Notes (optionnel)</span><input style={input} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setForm(null)}><X size={12} /> Annuler</button>
            <button type="button" className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={!form.certificateNumber.trim() || !form.validFrom || save.isPending} onClick={() => save.mutate(form)}><Check size={12} /> Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}
