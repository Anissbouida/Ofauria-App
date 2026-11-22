import { money, currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Loader2, Save, Trash2 } from 'lucide-react';
import { salesTargetsApi } from '../../api/sales-targets.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { RowMenu } from '../../components/ui/RowMenu';
import { ListKpi } from './ListTemplate';
import { TableFooter, EmptyState, LoadingState, ErrorState, DataPanel } from '../../components/ds';

/**
 * Ventes › Objectifs (phase 11, D3-13). Objectif de CA par commercial et par
 * période ; le réalisé se lit sur les factures émises du vendeur, net des avoirs.
 */

function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function monthEnd() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }

/** Montant sans unité (l'unité est dans l'en-tête de colonne). */
const amt = (v: number) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: key, queryFn: () => salesTargetsApi.report(start, end), enabled: hasModule('sales') });
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
  const withTarget = rows.filter(r => r.target > 0);
  return (
    <SalesPageShell icon={Target} title="Objectifs" parent="Ventes" list
      summary={totalTarget > 0 ? `${money(totalRealized)} réalisés sur ${money(totalTarget)}` : 'Objectif et réalisé par vendeur sur la période'}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Objectif de la période" value={money(totalTarget)} sub={`${withTarget.length} vendeur${withTarget.length > 1 ? 's' : ''} avec objectif`} />
        <ListKpi label="Réalisé" value={money(totalRealized)} sub={totalTarget > 0 ? `${Math.round((totalRealized / totalTarget) * 100)} % de l'objectif` : 'factures émises nettes'} tone={totalTarget > 0 && totalRealized >= totalTarget ? 'green' : undefined} />
        <ListKpi label="Reste à réaliser" value={money(Math.max(0, totalTarget - totalRealized))} sub="pour atteindre l'objectif global" />
        <ListKpi label="Objectifs atteints" value={`${withTarget.filter(r => r.realized >= r.target).length} / ${withTarget.length}`} sub="vendeurs à 100 % ou plus" />
      </section>

      <div className="kl-rep-period">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="Du" />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} aria-label="Au" />
        </span>
        <small>Réalisé = factures émises attribuées au vendeur, net des avoirs.</small>
      </div>

      {isDirection && (
        <section>
          <div className="kl-sec"><h2>Fixer un objectif</h2></div>
          <div className="kl-group kl-rb-form">
            <div className="kl-rb-row">
              <span className="k">Vendeur</span>
              <span className="v">
                <SearchSelect value={sellerId} onChange={setSellerId}
                  placeholder="Choisir un vendeur…" width={240} size="md" ariaLabel="Vendeur"
                  options={sellers.map(s => ({ id: String(s.id), label: `${s.first_name || ''} ${s.last_name || ''}`.trim() }))} />
              </span>
            </div>
            <div className="kl-rb-row">
              <span className="k">Objectif<small>en {currencySymbol()} sur la période</small></span>
              <span className="v">
                <input aria-label={`Objectif en ${currencySymbol()}`} type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 160 }} />
                <span style={{ flex: 1 }} />
                <button className="odoo-btn-primary" disabled={!sellerId || !(Number(amount) >= 0) || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
                </button>
              </span>
            </div>
          </div>
        </section>
      )}

      {isLoading ? <LoadingState label="Chargement des objectifs…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !rows.length ? (
        <EmptyState icon={Target} title="Aucun objectif ni réalisé sur la période" text={isDirection ? 'Fixez un objectif par vendeur ci-dessus.' : undefined} />
      ) : (
        <DataPanel label="Objectifs par vendeur" footer={<TableFooter note={`${rows.length} vendeur${rows.length > 1 ? 's' : ''} · réalisé ${money(totalRealized)} sur ${money(totalTarget)}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Vendeur</th><th className="ds-num">Objectif ({currencySymbol()})</th><th className="ds-num">Réalisé ({currencySymbol()})</th><th className="ds-num">Écart ({currencySymbol()})</th><th>Atteinte</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const pct = r.pct ?? (r.target > 0 ? Math.round((r.realized / r.target) * 100) : null);
                return (
                  <tr key={r.salespersonId} style={{ cursor: 'default' }}>
                    <td className="ds-strong">{r.name}</td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{r.target > 0 ? amt(r.target) : '—'}</td>
                    <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{amt(r.realized)}</td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap', color: r.gap >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{amt(r.gap)}</td>
                    <td style={{ minWidth: 160 }}>
                      {pct != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`prj-bar ${pct >= 100 ? 'green' : pct < 50 ? 'orange' : ''}`} style={{ flex: 1 }}><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
                          <span style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>{pct} %</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="ds-actions">{isDirection && r.targetId && (
                      <RowMenu items={[{ label: "Retirer l'objectif", icon: Trash2, danger: true, disabled: remove.isPending, onSelect: () => remove.mutate(r.targetId!) }]} />
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </SalesPageShell>
  );
}
