import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Loader2, Save, Trash2 } from 'lucide-react';
import { salesTargetsApi } from '../../api/sales-targets.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { RowMenu } from '../../components/ui/RowMenu';
import { ListPanel, ListEmpty } from './ListTemplate';

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

  const totalTarget = rows.reduce((s, r) => s + (r.target || 0), 0);
  const totalRealized = rows.reduce((s, r) => s + (r.realized || 0), 0);
  return (
    <SalesPageShell icon={Target} title="Objectifs" parent="Ventes" list
      summary={totalTarget > 0 ? `${money(totalRealized)} réalisés sur ${money(totalTarget)}` : undefined}>
      <div className="prj-toolbar">
        <label className="prj-chip" style={{ cursor: 'default' }}>Du <input className="odoo-input" type="date" value={start} onChange={e => setStart(e.target.value)} style={{ border: 0, background: 'transparent' }} /></label>
        <label className="prj-chip" style={{ cursor: 'default' }}>au <input className="odoo-input" type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ border: 0, background: 'transparent' }} /></label>
        <p className="prj-note" style={{ flex: 1, minWidth: 240 }}>Réalisé = factures émises attribuées au vendeur, net des avoirs.</p>
      </div>

      {isDirection && (
        <section className="prj-panel" style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: '0.875rem', marginRight: 4 }}>Fixer un objectif</strong>
          <select className="odoo-input" aria-label="Vendeur" value={sellerId} onChange={e => setSellerId(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Vendeur…</option>
            {sellers.map(s => <option key={s.id} value={s.id}>{`${s.first_name || ''} ${s.last_name || ''}`.trim()}</option>)}
          </select>
          <input className="odoo-input" aria-label="Objectif en DH" type="number" placeholder="Objectif (DH)" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 150 }} />
          <button className="odoo-btn-primary" disabled={!sellerId || !(Number(amount) >= 0) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Enregistrer
          </button>
        </section>
      )}

      {isLoading ? <ListEmpty icon={Loader2} title="Chargement des objectifs…" /> : !rows.length ? (
        <ListEmpty icon={Target} title="Aucun objectif ni réalisé sur la période" text={isDirection ? 'Fixez un objectif par vendeur ci-dessus.' : undefined} />
      ) : (
        <ListPanel>
          <table className="odoo-table">
            <thead><tr><th>Vendeur</th><th style={{ textAlign: 'right' }}>Objectif</th><th style={{ textAlign: 'right' }}>Réalisé</th><th style={{ textAlign: 'right' }}>Écart</th><th>Atteinte</th><th style={{ width: 48 }} /></tr></thead>
            <tbody>
              {rows.map(r => {
                const pct = r.pct ?? (r.target > 0 ? Math.round((r.realized / r.target) * 100) : null);
                return (
                  <tr key={r.salespersonId} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.target > 0 ? money(r.target) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.realized)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: r.gap >= 0 ? 'var(--prj-green)' : 'var(--prj-red)' }}>{money(r.gap)}</td>
                    <td style={{ minWidth: 160 }}>
                      {pct != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`prj-bar ${pct >= 100 ? 'green' : pct < 50 ? 'orange' : ''}`} style={{ flex: 1 }}><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
                          <span style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>{pct} %</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{isDirection && r.targetId && (
                      <RowMenu items={[{ label: "Retirer l'objectif", icon: Trash2, danger: true, disabled: remove.isPending, onSelect: () => remove.mutate(r.targetId!) }]} />
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListPanel>
      )}
    </SalesPageShell>
  );
}
