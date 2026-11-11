import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Loader2, Save, Trash2 } from 'lucide-react';
import { salesTargetsApi } from '../../api/sales-targets.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Ventes › Objectifs (phase 11, D3-13). Objectif de CA par commercial et par
 * période ; le réalisé se lit sur les factures émises du vendeur, net des avoirs.
 */
const money = (v: number) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function monthEnd() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }

export default function SalesTargetsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(monthEnd());
  const [sellerId, setSellerId] = useState('');
  const [amount, setAmount] = useState('');

  const key = ['sales-targets', start, end];
  const { data: rows = [], isLoading } = useQuery({ queryKey: key, queryFn: () => salesTargetsApi.report(start, end), enabled: hasModule('sales') });
  const { data: sellers = [] } = useQuery({ queryKey: ['salespeople'], queryFn: () => salesTargetsApi.salespeople(), enabled: isDirection });

  const save = useMutation({
    mutationFn: () => salesTargetsApi.upsert({ salespersonId: sellerId, periodStart: start, periodEnd: end, targetAmount: Number(amount) }),
    onSuccess: () => { setSellerId(''); setAmount(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => salesTargetsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Target size={20} /> Objectifs commerciaux</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Objectif de chiffre d'affaires par vendeur ; réalisé = factures émises attribuées au vendeur, net des avoirs.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label>Du <input className="odoo-input" type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>au <input className="odoo-input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>

      {isDirection && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <select className="odoo-input" value={sellerId} onChange={e => setSellerId(e.target.value)}>
            <option value="">Vendeur…</option>
            {sellers.map(s => <option key={s.id} value={s.id}>{`${s.first_name || ''} ${s.last_name || ''}`.trim()}</option>)}
          </select>
          <input className="odoo-input" type="number" placeholder="Objectif (DH)" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 150 }} />
          <button className="odoo-btn-primary" disabled={!sellerId || !(Number(amount) >= 0) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Fixer l'objectif
          </button>
        </div>
      )}

      {isLoading ? <Loader2 className="spin" /> : (
        <table className="odoo-table">
          <thead><tr><th>Vendeur</th><th>Objectif</th><th>Réalisé</th><th>Écart</th><th>Atteinte</th><th /></tr></thead>
          <tbody>
            {rows.map(r => {
              const pct = r.pct ?? (r.target > 0 ? Math.round((r.realized / r.target) * 100) : null);
              return (
                <tr key={r.salespersonId}>
                  <td>{r.name}</td>
                  <td>{r.target > 0 ? money(r.target) : '—'}</td>
                  <td>{money(r.realized)}</td>
                  <td style={{ color: r.gap >= 0 ? '#1a7f37' : '#b00020' }}>{money(r.gap)}</td>
                  <td style={{ minWidth: 140 }}>
                    {pct != null ? `${pct} %` : '—'}
                    {pct != null && (
                      <div style={{ height: 4, background: 'var(--odoo-border, #eee)', borderRadius: 2, marginTop: 2 }}>
                        <div style={{ height: 4, width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#1a7f37' : '#8E4A1F', borderRadius: 2 }} />
                      </div>
                    )}
                  </td>
                  <td>{isDirection && r.targetId && (
                    <button className="odoo-pager-btn" title="Retirer l'objectif" onClick={() => remove.mutate(r.targetId!)}><Trash2 size={13} /></button>
                  )}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} style={{ textAlign: 'center', opacity: 0.6 }}>Aucun objectif ni réalisé sur la période.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
