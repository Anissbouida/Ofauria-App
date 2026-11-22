import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import { money as fmtMoney, currencySymbol } from '../../utils/money';
import { EmptyState, KpiCard, LoadingState, DataPanel, KpiGrid, SectionHeader, Toolbar, DateRangeField } from '../../components/ds';

/**
 * État de flux de trésorerie (comptes classe 5). Encaissements et décaissements
 * de la période par compte de trésorerie (caisse, banque, effets), avec solde
 * d'ouverture et de clôture, puis ventilation par nature des contreparties.
 */

const money = (v: number) => fmtMoney(v);
/** Montant sans devise (devise dans l'en-tête de colonne). */
const amt = (v: number) => (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = currencySymbol;

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
      <EmptyState icon={Lock} title="Réservé à l'administration" />
    );
  }

  const net = data ? data.inflowTotal - data.outflowTotal : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {data && (
        <KpiGrid>
          <KpiCard label="Encaissements" value={money(data.inflowTotal)} />
          <KpiCard label="Décaissements" value={money(data.outflowTotal)} />
          <KpiCard label="Variation nette" value={money(net)} sub={net >= 0 ? 'excédent de la période' : 'déficit de la période'} tone={net >= 0 ? 'green' : 'red'} />
          <KpiCard label="Trésorerie fin de période" value={money(data.closingTotal)} sub={<>ouverture {money(data.openingTotal)}</>} />
        </KpiGrid>
      )}

      <Toolbar>
        <DateRangeField from={startDate} to={endDate} onFrom={setStartDate} onTo={setEndDate} />
      </Toolbar>

      {isLoading ? (
        <LoadingState />
      ) : !data ? null : (
        <>
          <SectionHeader title="Par compte de trésorerie" />
          <DataPanel>
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th className="ds-num">Ouverture ({cur()})</th>
                  <th className="ds-num">Encaissements ({cur()})</th>
                  <th className="ds-num">Décaissements ({cur()})</th>
                  <th className="ds-num">Clôture ({cur()})</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map(a => (
                  <tr key={a.code}>
                    <td><span className="ds-ref">{a.code}</span> {a.label}</td>
                    <td className="ds-num">{amt(a.opening)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-success)' }}>{a.inflow > 0 ? amt(a.inflow) : '—'}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{a.outflow > 0 ? amt(a.outflow) : '—'}</td>
                    <td className="ds-num ds-strong">{amt(a.closing)}</td>
                  </tr>
                ))}
                {data.accounts.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--ds-muted)' }}>Aucun mouvement de trésorerie sur la période.</td></tr>
                )}
              </tbody>
              {data.accounts.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="ds-strong">Total</td>
                    <td className="ds-num">{amt(data.openingTotal)}</td>
                    <td className="ds-num">{amt(data.inflowTotal)}</td>
                    <td className="ds-num">{amt(data.outflowTotal)}</td>
                    <td className="ds-num">{amt(data.closingTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </DataPanel>

          <SectionHeader title="Par nature" note="hors virements internes" />
          <DataPanel>
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Nature</th>
                  <th className="ds-num">Entrées ({cur()})</th>
                  <th className="ds-num">Sorties ({cur()})</th>
                </tr>
              </thead>
              <tbody>
                {data.nature.map(n => (
                  <tr key={n.account_class}>
                    <td>{n.label}</td>
                    <td className="ds-num" style={{ color: n.inflow > 0 ? 'var(--ds-success)' : 'var(--ds-muted)' }}>{n.inflow > 0 ? amt(n.inflow) : '—'}</td>
                    <td className="ds-num" style={{ color: n.outflow > 0 ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>{n.outflow > 0 ? amt(n.outflow) : '—'}</td>
                  </tr>
                ))}
                {data.nature.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20, color: 'var(--ds-muted)' }}>—</td></tr>
                )}
              </tbody>
            </table>
          </DataPanel>
        </>
      )}
    </div>
  );
}

