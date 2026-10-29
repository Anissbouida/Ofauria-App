import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Target, Loader2, Plus, Power, X } from 'lucide-react';
import { costCentersApi, type CostCenter } from '../../api/cost-centers.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useAuth } from '../../context/AuthContext';

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
const inp: React.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };

export default function CostCentersTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [view, setView] = useState<'report' | 'assign' | 'manage'>('report');
  if (!isAdmin) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Réservé à l'administration.</div>;
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Target} title="Centres de coûts (analytique)">
        Ventilez charges et produits par activité pour sortir un résultat par centre. Dimension posée sur les factures (fournisseurs et émises). Créez vos centres, affectez les factures, puis consultez le résultat.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={view === 'report' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('report')}>Résultat</button>
        <button className={view === 'assign' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('assign')}>Affectation</button>
        <button className={view === 'manage' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('manage')}>Centres</button>
      </div>
      {view === 'report' ? <Report /> : view === 'assign' ? <Assign /> : <Manage />}
    </div>
  );
}

function Report() {
  const now = new Date(); const y = now.getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const { data, isLoading } = useQuery({ queryKey: ['cost-centers', 'report', from, to], queryFn: () => costCentersApi.report({ from, to }) });
  const totCharges = (data?.rows.reduce((s, r) => s + r.charges, 0) ?? 0) + (data?.unassigned.charges ?? 0);
  const totProduits = (data?.rows.reduce((s, r) => s + r.produits, 0) ?? 0) + (data?.unassigned.produits ?? 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Au<input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></label>
      </div>
      {isLoading ? <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div> : !data ? null : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Centre</th><th style={{ textAlign: 'right' }}>Produits</th><th style={{ textAlign: 'right' }}>Charges</th><th style={{ textAlign: 'right' }}>Résultat</th></tr></thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.id}>
                  <td><span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.code}</span> {r.name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#15803d' }}>{r.produits > 0 ? money(r.produits) : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#dc2626' }}>{r.charges > 0 ? money(r.charges) : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.result >= 0 ? '#15803d' : '#dc2626' }}>{money(r.result)}</td>
                </tr>
              ))}
              {(data.unassigned.charges > 0 || data.unassigned.produits > 0) && (
                <tr style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>
                  <td>Non affecté</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{data.unassigned.produits > 0 ? money(data.unassigned.produits) : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{data.unassigned.charges > 0 ? money(data.unassigned.charges) : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.unassigned.result)}</td>
                </tr>
              )}
              {data.rows.length === 0 && data.unassigned.charges === 0 && data.unassigned.produits === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--theme-text-muted)' }}>Aucune facture sur la période.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
                <td>Total</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(totProduits)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(totCharges)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(totProduits - totCharges)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function Assign() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'' | 'received' | 'emitted'>('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const { data: centers = [] } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
  const activeCenters = centers.filter(c => c.is_active);
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['cost-centers', 'invoices', kind, onlyUnassigned],
    queryFn: () => costCentersApi.invoices({ kind: kind || undefined, onlyUnassigned }),
  });
  const assign = useMutation({
    mutationFn: ({ invoiceId, costCenterId }: { invoiceId: string; costCenterId: string | null }) => costCentersApi.assign(invoiceId, costCenterId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value as '' | 'received' | 'emitted')} style={inp}>
          <option value="">Toutes les factures</option>
          <option value="received">Factures fournisseurs (charges)</option>
          <option value="emitted">Factures émises (produits)</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} style={{ accentColor: 'var(--theme-accent)' }} /> Non affectées seulement
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Facture</th><th>Type</th><th>Tiers</th><th style={{ textAlign: 'right' }}>HT</th><th>Centre de coût</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && invoices.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune facture.</td></tr>}
            {invoices.map(i => (
              <tr key={i.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(i.invoice_date)}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>{i.invoice_number}</td>
                <td><span className={`odoo-tag ${i.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{i.invoice_type === 'received' ? 'Charge' : 'Produit'}</span></td>
                <td style={{ fontSize: '0.85rem' }}>{i.party || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(i.amount)}</td>
                <td>
                  <select value={i.cost_center_id ?? ''} onChange={e => assign.mutate({ invoiceId: i.id, costCenterId: e.target.value || null })} style={{ ...inp, minWidth: 150 }}>
                    <option value="">— Non affecté —</option>
                    {activeCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Manage() {
  const qc = useQueryClient();
  const { data: centers = [], isLoading } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
  const [showForm, setShowForm] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => costCentersApi.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cost-centers'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouveau centre</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Code</th><th>Nom</th><th style={{ textAlign: 'right' }}>Factures</th><th>État</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && centers.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun centre. Créez-en (ex. Boulangerie, Pâtisserie, Traiteur).</td></tr>}
            {centers.map(c => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{c.code}</td>
                <td>{c.name}</td>
                <td style={{ textAlign: 'right' }}>{c.invoices_count}</td>
                <td><span className={`odoo-tag ${c.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{c.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggle.mutate({ id: c.id, active: !c.is_active })} title={c.is_active ? 'Désactiver' : 'Activer'}><Power size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && <CenterForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); setShowForm(false); }} />}
    </>
  );
}

function CenterForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => costCentersApi.create({ code: code.trim(), name: name.trim() }),
    onSuccess: () => { notify.success('Centre créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(420px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Target size={16} /> Nouveau centre de coût</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Code</span><input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="Ex. BOUL" style={{ ...inp, width: '100%' }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Boulangerie" style={{ ...inp, width: '100%' }} /></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!code.trim() || !name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer</button>
        </div>
      </div>
    </div>
  );
}
