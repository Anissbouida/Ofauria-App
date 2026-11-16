import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Loader2, Plus, Lock, X } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { rebatesApi, type RebateAgreement } from '../../api/rebates.api';
import { customersApi } from '../../api/customers.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SalesPageShell from './SalesPageShell';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { FilterChips, ListPanel, ListEmpty, NextStep, ListKpi } from './ListTemplate';

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
  const confirm = useConfirm();
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: list = [], isLoading } = useQuery({ queryKey: ['rebates', year], queryFn: () => rebatesApi.list(year), enabled: hasModule('sales') });
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list(), enabled: isDirection });
  const customers = arr<{ id: string; company_name: string | null; first_name: string | null; last_name: string | null }>(customersRaw);

  const [form, setForm] = useState({ customerId: '', ratePercent: '', minTurnover: '' });
  const [view, setView] = useState<'' | RebateAgreement['status']>('');
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
    onSuccess: () => { setForm({ customerId: '', ratePercent: '', minTurnover: '' }); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const settle = useMutation({ mutationFn: (id: string) => rebatesApi.settle(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: (id: string) => rebatesApi.cancel(id), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });

  const custName = (r: RebateAgreement) => r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—';

  return (
    <SalesPageShell icon={BadgePercent} title="Ristournes de fin d'année" parent="Ventes" list
      summary={`${stats.active.count} accord${stats.active.count > 1 ? 's' : ''} actif${stats.active.count > 1 ? 's' : ''} · ${money(stats.active.total)} à ce jour`}
      actions={
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Année
          <input className="odoo-input" type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 90 }} />
        </label>
      }>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label={`CA ${year} des accords`} value={money(kpis.turnover)} sub="net des avoirs, accords actifs" />
        <ListKpi label="Ristourne à ce jour" value={money(stats.active.total)} sub="si l'année s'arrêtait aujourd'hui" tone={stats.active.total > 0 ? 'orange' : undefined} />
        <ListKpi label="Seuil atteint" value={`${kpis.eligible} / ${stats.active.count}`} sub="accords actifs éligibles" />
        <ListKpi label="Ristournes clôturées" value={money(kpis.settled)} sub={`${stats.settled.count} accord${stats.settled.count > 1 ? 's' : ''} figé${stats.settled.count > 1 ? 's' : ''}`} />
      </section>
      <p className="prj-note">Taux sur le CA annuel (net des avoirs) au-delà d'un seuil ; la ristourne est figée à la clôture, puis émise en avoir.</p>

      {isDirection && (
        <section className="prj-panel" style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: '0.875rem', marginRight: 4 }}>Nouvel accord {year}</strong>
          <select className="odoo-input" aria-label="Client" value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} style={{ minWidth: 220 }}>
            <option value="">Client…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}</option>)}
          </select>
          <input className="odoo-input" aria-label="Taux en %" type="number" step="0.1" placeholder="Taux %" value={form.ratePercent} onChange={e => setForm({ ...form, ratePercent: e.target.value })} style={{ width: 90 }} />
          <input className="odoo-input" aria-label="Seuil de CA en DH" type="number" placeholder="Seuil CA (DH)" value={form.minTurnover} onChange={e => setForm({ ...form, minTurnover: e.target.value })} style={{ width: 130 }} />
          <button className="odoo-btn-primary" disabled={!form.customerId || !(Number(form.ratePercent) >= 0) || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Créer l'accord
          </button>
        </section>
      )}

      <FilterChips label="Filtrer les accords" value={view} onChange={k => setView(k as '' | RebateAgreement['status'])} chips={[
        { key: 'active', label: 'Actifs', count: stats.active.count },
        { key: 'settled', label: 'Clôturés', count: stats.settled.count },
        { key: 'cancelled', label: 'Annulés', count: stats.cancelled.count },
        { key: '', label: 'Tous', count: list.length },
      ]} />

      {isLoading ? <ListEmpty icon={Loader2} title="Chargement des accords…" /> : !filtered.length ? (
        <ListEmpty icon={BadgePercent} title={list.length ? 'Aucun accord pour ce filtre' : `Aucun accord pour ${year}`} />
      ) : (
        <ListPanel>
          <table className="odoo-table">
            <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Taux</th><th style={{ textAlign: 'right' }}>Seuil</th><th>CA de l'année</th><th style={{ textAlign: 'right' }}>Ristourne</th><th>État</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {filtered.map(r => {
                const reached = Number(r.min_turnover) > 0 ? Math.min(100, Number(r.current_turnover) / Number(r.min_turnover) * 100) : 100;
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 500 }}>{custName(r)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.rate_percent)} %</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(r.min_turnover)}</td>
                    <td style={{ minWidth: 160 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.current_turnover)}</span>
                      <span className={`prj-bar ${reached >= 100 ? 'green' : ''}`} style={{ marginTop: 4 }} title={`${Math.round(reached)} % du seuil`}><span style={{ width: `${reached}%` }} /></span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.current_amount > 0 ? money(r.current_amount) : '—'}</td>
                    <td>{r.status === 'active' ? <StatusTag tone="progress" label="Actif" /> : r.status === 'settled' ? <StatusTag tone="done" icon={Lock} label="Clôturé" /> : <StatusTag tone="cancelled" label="Annulé" />}
                      {r.status === 'settled' && r.settled_credit_note_id && <span className="sal-sub">avoir émis</span>}</td>
                    <td style={{ textAlign: 'right' }}>{isDirection && r.status === 'active' && (
                      <div className="sal-actions">
                        <NextStep icon={Lock} label="Clôturer" disabled={settle.isPending} onClick={async () => {
                          if (await confirm(`Clôturer l'accord de ${custName(r)} ? La ristourne est figée à ${r.current_amount > 0 ? money(r.current_amount) : '0 DH'}.`, { title: 'Clôturer la ristourne', confirmLabel: 'Clôturer' })) settle.mutate(r.id);
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
        </ListPanel>
      )}
    </SalesPageShell>
  );
}
