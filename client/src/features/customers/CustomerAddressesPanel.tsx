import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Pencil, Trash2, Truck, Receipt, Check, X } from 'lucide-react';
import { customersApi, type CustomerAddress } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';

// Panneau d'adresses multiples de la fiche client (phase 4.1). Liste + ajout/
// édition inline + défauts livraison/facturation. Le gel sur les pièces (BL) se
// fait côté serveur à l'émission ; ici on gère seulement le référentiel.

const KINDS: { v: CustomerAddress['kind']; label: string }[] = [
  { v: 'both', label: 'Livraison + facturation' },
  { v: 'delivery', label: 'Livraison' },
  { v: 'billing', label: 'Facturation' },
];

type Form = {
  label: string; kind: CustomerAddress['kind']; addressLine: string;
  postalCode: string; city: string; countryCode: string;
  isDefaultDelivery: boolean; isDefaultBilling: boolean;
};
const emptyForm = (): Form => ({ label: '', kind: 'both', addressLine: '', postalCode: '', city: '', countryCode: 'MA', isDefaultDelivery: false, isDefaultBilling: false });

export default function CustomerAddressesPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { data: addresses = [] } = useQuery({ queryKey: ['customer-addresses', customerId], queryFn: () => customersApi.listAddresses(customerId) });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-addresses', customerId] });

  const save = useMutation({
    mutationFn: (f: Form) => {
      const payload = { label: f.label || null, kind: f.kind, addressLine: f.addressLine, postalCode: f.postalCode || null, city: f.city || null, countryCode: f.countryCode || 'MA', isDefaultDelivery: f.isDefaultDelivery, isDefaultBilling: f.isDefaultBilling };
      return editingId ? customersApi.updateAddress(customerId, editingId, payload) : customersApi.createAddress(customerId, payload);
    },
    onSuccess: () => { invalidate(); setForm(null); setEditingId(null); notify.success('Adresse enregistrée'); },
    onError: () => notify.error('Échec de l\'enregistrement'),
  });
  const del = useMutation({
    mutationFn: (id: string) => customersApi.removeAddress(customerId, id),
    onSuccess: () => { invalidate(); notify.success('Adresse supprimée'); },
  });

  const openNew = () => { setEditingId(null); setForm(emptyForm()); };
  const openEdit = (a: CustomerAddress) => {
    setEditingId(a.id);
    setForm({ label: a.label ?? '', kind: a.kind, addressLine: a.address_line, postalCode: a.postal_code ?? '', city: a.city ?? '', countryCode: a.country_code ?? 'MA', isDefaultDelivery: a.is_default_delivery, isDefaultBilling: a.is_default_billing });
  };

  const input: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', background: 'var(--odoo-bg)' };
  const lab: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', display: 'block', marginBottom: 2 };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--odoo-text-muted)' }}>
          <MapPin size={12} /> Adresses
        </div>
        {!form && <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={openNew}><Plus size={12} /> Ajouter</button>}
      </div>

      {addresses.length === 0 && !form && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', padding: '6px 0' }}>Aucune adresse enregistrée.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {addresses.map(a => (
          <div key={a.id} style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{a.label || a.address_line}</div>
              {a.label && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{a.address_line}</div>}
              <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{[a.postal_code, a.city].filter(Boolean).join(' ')}{a.country_code && a.country_code !== 'MA' ? ` · ${a.country_code}` : ''}</div>
              <div style={{ display: 'inline-flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {a.is_default_delivery && <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Truck size={10} /> Livraison</span>}
                {a.is_default_billing && <span className="odoo-tag odoo-tag-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Receipt size={10} /> Facturation</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
              <button type="button" className="odoo-btn-secondary" title="Modifier" onClick={() => openEdit(a)}><Pencil size={12} /></button>
              <button type="button" className="odoo-btn-secondary" title="Supprimer" onClick={() => del.mutate(a.id)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div style={{ border: '1px solid var(--odoo-purple)', borderRadius: 4, padding: 10, marginTop: 6, display: 'grid', gap: 8, background: 'var(--odoo-bg)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label><span style={lab}>Libellé (optionnel)</span><input style={input} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Siège, Entrepôt…" /></label>
            <label><span style={lab}>Rôle</span>
              <select style={input} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as CustomerAddress['kind'] })}>
                {KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </label>
          </div>
          <label><span style={lab}>Adresse</span><input style={input} value={form.addressLine} onChange={e => setForm({ ...form, addressLine: e.target.value })} placeholder="123 rue Mohammed V" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px', gap: 8 }}>
            <label><span style={lab}>Code postal</span><input style={input} value={form.postalCode} onChange={e => setForm({ ...form, postalCode: e.target.value })} placeholder="20000" /></label>
            <label><span style={lab}>Ville</span><input style={input} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Casablanca" /></label>
            <label><span style={lab}>Pays</span><input style={{ ...input, textTransform: 'uppercase' }} maxLength={2} value={form.countryCode} onChange={e => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} placeholder="MA" /></label>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: '0.8125rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={form.isDefaultDelivery} onChange={e => setForm({ ...form, isDefaultDelivery: e.target.checked })} /> Livraison par défaut</label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={form.isDefaultBilling} onChange={e => setForm({ ...form, isDefaultBilling: e.target.checked })} /> Facturation par défaut</label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => { setForm(null); setEditingId(null); }}><X size={12} /> Annuler</button>
            <button type="button" className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={!form.addressLine.trim() || save.isPending} onClick={() => save.mutate(form)}><Check size={12} /> Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}
