import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Loader2, Plus, Lock, X } from 'lucide-react';
import { rebatesApi, type RebateAgreement } from '../../api/rebates.api';
import { customersApi } from '../../api/customers.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Ventes › Ristournes de fin d'année (phase 11, D5-12). Un accord par client et
 * par année (taux sur le CA au-delà d'un seuil) ; la ristourne calculée est
 * figée à la clôture, puis émise en avoir par le flux manuel.
 */
function arr<T>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[];
  const r = resp as { data?: T[]; items?: T[] };
  return r?.data ?? r?.items ?? [];
}
const money = (v: number | string) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

export default function RebatesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: list = [], isLoading } = useQuery({ queryKey: ['rebates', year], queryFn: () => rebatesApi.list(year), enabled: hasModule('sales') });
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list(), enabled: isDirection });
  const customers = arr<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>(customersRaw);

  const [form, setForm] = useState({ customerId: '', ratePercent: '', minTurnover: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['rebates', year] });

  const create = useMutation({
    mutationFn: () => rebatesApi.create({ customerId: form.customerId, year, ratePercent: Number(form.ratePercent), minTurnover: Number(form.minTurnover) || 0 }),
    onSuccess: () => { setForm({ customerId: '', ratePercent: '', minTurnover: '' }); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const settle = useMutation({ mutationFn: (id: string) => rebatesApi.settle(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: (id: string) => rebatesApi.cancel(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });

  const custName = (r: RebateAgreement) => r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—';

  return (
    <div style={{ padding: 24, maxWidth: 1050, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><BadgePercent size={20} /> Ristournes de fin d'année</h1>
        <label>Année <input className="odoo-input" type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
      </div>
      <p style={{ opacity: 0.7, marginTop: 4 }}>Taux sur le CA annuel (net des avoirs) au-delà d'un seuil. La ristourne est figée à la clôture, puis émise en avoir.</p>

      {isDirection && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
          <select className="odoo-input" value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
            <option value="">Client…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}</option>)}
          </select>
          <input className="odoo-input" type="number" step="0.1" placeholder="Taux %" value={form.ratePercent} onChange={e => setForm({ ...form, ratePercent: e.target.value })} style={{ width: 90 }} />
          <input className="odoo-input" type="number" placeholder="Seuil CA (DH)" value={form.minTurnover} onChange={e => setForm({ ...form, minTurnover: e.target.value })} style={{ width: 130 }} />
          <button className="odoo-btn-primary" disabled={!form.customerId || !(Number(form.ratePercent) >= 0) || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Accord {year}
          </button>
        </div>
      )}

      {isLoading ? <Loader2 className="spin" /> : (
        <table className="odoo-table">
          <thead><tr><th>Client</th><th>Taux</th><th>Seuil</th><th>CA</th><th>Ristourne</th><th>État</th><th /></tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id}>
                <td>{custName(r)}</td>
                <td>{Number(r.rate_percent)} %</td>
                <td>{money(r.min_turnover)}</td>
                <td>{money(r.current_turnover)}</td>
                <td style={{ fontWeight: 600 }}>{r.current_amount > 0 ? money(r.current_amount) : '—'}</td>
                <td>{r.status === 'active' ? 'Actif' : r.status === 'settled' ? `Clôturé${r.settled_credit_note_id ? ' · avoir émis' : ''}` : 'Annulé'}</td>
                <td>{isDirection && r.status === 'active' && (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button className="odoo-pager-btn" title="Clôturer (figer la ristourne)" onClick={() => settle.mutate(r.id)}><Lock size={13} /></button>
                    <button className="odoo-pager-btn" title="Annuler" onClick={() => cancel.mutate(r.id)}><X size={13} /></button>
                  </span>
                )}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} style={{ textAlign: 'center', opacity: 0.6 }}>Aucun accord pour {year}.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
