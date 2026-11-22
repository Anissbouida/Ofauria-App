import { money, currencySymbol } from '../../utils/money';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus, Lock, X } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { rebatesApi, type RebateAgreement } from '../../api/rebates.api';
import { customersApi } from '../../api/customers.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { FilterChips, NextStep, ListKpi } from './ListTemplate';
import { TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

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

const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RebatesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: list = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['rebates', year], queryFn: () => rebatesApi.list(year), enabled: hasModule('sales') });
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list(), enabled: isDirection });
  const customers = arr<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>(customersRaw);

  const [form, setForm] = useState({ customerId: '', ratePercent: '', minTurnover: '' });
  const [view, setView] = useState<'' | RebateAgreement['status']>('');
  const [creating, setCreating] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['rebates', year] });

  const stats = useMemo(() => {
    const acc: Record<string, { count: number; total: number }> = {
      active: { count: 0, total: 0 }, settled: { count: 0, total: 0 }, cancelled: { count: 0, total: 0 },
    };
    for (const r of list) { const a = acc[r.status]; if (a) { a.count += 1; a.total += Number(r.current_amount) || 0; } }
    return acc;
  }, [list]);
  const filtered = view ? list.filter(r => r.status === view) : list;
  const kpis = useMemo(() => {
    const k = { turnover: 0, eligible: 0, settled: 0 };
    for (const r of list) {
      if (r.status === 'active') { k.turnover += Number(r.current_turnover) || 0; if (r.eligible) k.eligible++; }
      if (r.status === 'settled') k.settled += Number(r.computed_amount) || 0;
    }
    return k;
  }, [list]);

  const create = useMutation({
    mutationFn: () => rebatesApi.create({ customerId: form.customerId, year, ratePercent: Number(form.ratePercent), minTurnover: Number(form.minTurnover) || 0 }),
    onSuccess: () => { setForm({ customerId: '', ratePercent: '', minTurnover: '' }); setCreating(false); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const settle = useMutation({ mutationFn: (id: string) => rebatesApi.settle(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: (id: string) => rebatesApi.cancel(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });

  const custName = (r: RebateAgreement) => r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—';

  return (
    <SalesPageShell icon={BadgePercent} title="Ristournes de fin d'année" parent="Ventes" list
      summary={`${stats.active.count} accord${stats.active.count > 1 ? 's' : ''} actif${stats.active.count > 1 ? 's' : ''} · ${money(stats.active.total)} à ce jour`}
      actions={<>
        <span className="ds-period">Année
          <input className="ds-input sm" aria-label="Année" type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 90 }} />
        </span>
        {isDirection && <button type="button" className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouvel accord</button>}
      </>}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label={`CA ${year} des accords`} value={money(kpis.turnover)} sub="net des avoirs, accords actifs" />
        <ListKpi label="Ristourne à ce jour" value={money(stats.active.total)} sub="si l'année s'arrêtait aujourd'hui" tone={stats.active.total > 0 ? 'orange' : undefined} />
        <ListKpi label="Seuil atteint" value={`${kpis.eligible} / ${stats.active.count}`} sub="accords actifs éligibles" />
        <ListKpi label="Ristournes clôturées" value={money(kpis.settled)} sub={`${stats.settled.count} accord${stats.settled.count > 1 ? 's' : ''} figé${stats.settled.count > 1 ? 's' : ''}`} />
      </section>
      <p className="prj-note">Taux sur le CA annuel (net des avoirs) au-delà d'un seuil ; la ristourne est figée à la clôture, puis émise en avoir.</p>

      <FilterChips label="Filtrer les accords" value={view} onChange={k => setView(k as '' | RebateAgreement['status'])} chips={[
        { key: 'active', label: 'Actifs', count: stats.active.count },
        { key: 'settled', label: 'Clôturés', count: stats.settled.count },
        { key: 'cancelled', label: 'Annulés', count: stats.cancelled.count },
        { key: '', label: 'Tous', count: list.length },
      ]} />

      {isDirection && creating && (
        <Modal title={`Nouvel accord ${year}`} onClose={() => setCreating(false)} width={560} locked={create.isPending}
          footer={<FormFooter onCancel={() => setCreating(false)} onSubmit={() => create.mutate()} submitLabel="Créer l'accord"
            disabled={!form.customerId || !(Number(form.ratePercent) >= 0)} busy={create.isPending} />}>
          <FormSection title="Accord de ristourne">
            <FormField label="Client" required>
              <SearchSelect value={form.customerId} onChange={v => setForm({ ...form, customerId: v })}
                placeholder="Client…" width="100%" size="md" ariaLabel="Client"
                options={customers.map(c => ({ id: String(c.id), label: c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() }))} />
            </FormField>
            <div className="ds-form-grid">
              <FormField label="Taux (%)" htmlFor="rb-rate">
                <input id="rb-rate" className="ds-input" type="number" step="0.1" placeholder="Taux %" value={form.ratePercent} onChange={e => setForm({ ...form, ratePercent: e.target.value })} />
              </FormField>
              <FormField label={`Seuil de CA (${currencySymbol()})`} htmlFor="rb-min">
                <input id="rb-min" className="ds-input" type="number" placeholder={`Seuil CA (${currencySymbol()})`} value={form.minTurnover} onChange={e => setForm({ ...form, minTurnover: e.target.value })} />
              </FormField>
            </div>
          </FormSection>
        </Modal>
      )}

      {isLoading ? <LoadingState label="Chargement des accords…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !filtered.length ? (
        list.length
          ? <NoResultState onReset={() => setView('')} text="Aucun accord ne correspond au filtre." />
          : <EmptyState icon={BadgePercent} title={`Aucun accord pour ${year}`} text="Un accord de ristourne applique un taux sur le chiffre d'affaires annuel d'un client." />
      ) : (
        <DataPanel label="Ristournes" footer={<TableFooter note={`${filtered.length} accord${filtered.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Client</th><th className="ds-num">Taux</th><th className="ds-num">Seuil ({currencySymbol()})</th><th>CA de l'année ({currencySymbol()})</th><th className="ds-num">Ristourne ({currencySymbol()})</th><th>État</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {filtered.map(r => {
                const reached = Number(r.min_turnover) > 0 ? Math.min(100, Number(r.current_turnover) / Number(r.min_turnover) * 100) : 100;
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td className="ds-strong">{custName(r)}</td>
                    <td className="ds-num">{Number(r.rate_percent)} %</td>
                    <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{n2(r.min_turnover)}</td>
                    <td style={{ minWidth: 160 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n2(r.current_turnover)}</span>
                      <span className={`prj-bar ${reached >= 100 ? 'green' : ''}`} style={{ marginTop: 4 }} title={`${Math.round(reached)} % du seuil`}><span style={{ width: `${reached}%` }} /></span>
                    </td>
                    <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{r.current_amount > 0 ? n2(r.current_amount) : '—'}</td>
                    <td>{r.status === 'active' ? <StatusTag tone="progress" label="Actif" /> : r.status === 'settled' ? <StatusTag tone="done" icon={Lock} label="Clôturé" /> : <StatusTag tone="cancelled" label="Annulé" />}
                      {r.status === 'settled' && r.settled_credit_note_id && <span className="sal-sub">avoir émis</span>}</td>
                    <td className="ds-actions">{isDirection && r.status === 'active' && (
                      <div className="sal-actions">
                        <NextStep icon={Lock} label="Clôturer" disabled={settle.isPending} onClick={async () => {
                          if (await confirm(`Clôturer l'accord de ${custName(r)} ? La ristourne est figée à ${r.current_amount > 0 ? money(r.current_amount) : money(0, { decimals: 0 })}.`, { title: 'Clôturer la ristourne', confirmLabel: 'Clôturer' })) settle.mutate(r.id);
                        }} />
                        <RowMenu items={[{ label: "Annuler l'accord", icon: X, danger: true, onSelect: async () => {
                          if (await confirm(`Annuler l'accord de ristourne de ${custName(r)} ?`, { title: "Annuler l'accord", confirmLabel: 'Annuler l\'accord', cancelLabel: 'Retour', danger: true })) cancel.mutate(r.id);
                        } }]} />
                      </div>
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
