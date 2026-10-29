import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock, ArrowDownToLine, ArrowUpFromLine, Wallet } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';

/**
 * État de flux de trésorerie (comptes classe 5). Encaissements et décaissements
 * de la période par compte de trésorerie (caisse, banque, effets), avec solde
 * d'ouverture et de clôture, puis ventilation par nature des contreparties.
 */

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

export default function CashFlowTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-cashflow', startDate, endDate],
    queryFn: () => financialStatementsApi.cashFlow({ startDate, endDate }),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p>Réservé à l'administration.</p>
      </div>
    );
  }

  const net = data ? data.inflowTotal - data.outflowTotal : 0;

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Du
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Au
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inp} />
        </label>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div>
      ) : !data ? null : (
        <>
          <div className="odoo-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><ArrowDownToLine size={11} style={{ display: 'inline', marginRight: 4, color: '#15803d' }} /> Encaissements</div>
              <div className="odoo-stat-card-value" style={{ color: '#15803d' }}>{money(data.inflowTotal)}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><ArrowUpFromLine size={11} style={{ display: 'inline', marginRight: 4, color: '#dc2626' }} /> Décaissements</div>
              <div className="odoo-stat-card-value" style={{ color: '#dc2626' }}>{money(data.outflowTotal)}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><Wallet size={11} style={{ display: 'inline', marginRight: 4 }} /> Variation nette</div>
              <div className="odoo-stat-card-value" style={{ color: net >= 0 ? '#15803d' : '#dc2626' }}>{money(net)}</div>
            </div>
            <div className="odoo-stat-card" style={{ background: 'var(--theme-bg-secondary)' }}>
              <div className="odoo-stat-card-label">Trésorerie fin de période</div>
              <div className="odoo-stat-card-value">{money(data.closingTotal)}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>ouverture {money(data.openingTotal)}</div>
            </div>
          </div>

          <h3 style={{ margin: '4px 0 0', fontSize: '0.95rem' }}>Par compte de trésorerie</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th style={{ textAlign: 'right' }}>Ouverture</th>
                  <th style={{ textAlign: 'right' }}>Encaissements</th>
                  <th style={{ textAlign: 'right' }}>Décaissements</th>
                  <th style={{ textAlign: 'right' }}>Clôture</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map(a => (
                  <tr key={a.code}>
                    <td><span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.code}</span> {a.label}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(a.opening)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#15803d' }}>{a.inflow > 0 ? money(a.inflow) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#dc2626' }}>{a.outflow > 0 ? money(a.outflow) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(a.closing)}</td>
                  </tr>
                ))}
                {data.accounts.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--theme-text-muted)' }}>Aucun mouvement de trésorerie sur la période.</td></tr>
                )}
              </tbody>
              {data.accounts.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.openingTotal)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.inflowTotal)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.outflowTotal)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.closingTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <h3 style={{ margin: '8px 0 0', fontSize: '0.95rem' }}>Par nature <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>(hors virements internes)</span></h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Nature</th>
                  <th style={{ textAlign: 'right' }}>Entrées</th>
                  <th style={{ textAlign: 'right' }}>Sorties</th>
                </tr>
              </thead>
              <tbody>
                {data.nature.map(n => (
                  <tr key={n.account_class}>
                    <td>{n.label}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: n.inflow > 0 ? '#15803d' : 'var(--theme-text-muted)' }}>{n.inflow > 0 ? money(n.inflow) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: n.outflow > 0 ? '#dc2626' : 'var(--theme-text-muted)' }}>{n.outflow > 0 ? money(n.outflow) : '—'}</td>
                  </tr>
                ))}
                {data.nature.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20, color: 'var(--theme-text-muted)' }}>—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
