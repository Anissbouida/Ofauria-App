import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2, TrendingUp } from 'lucide-react';
import { cashForecastApi } from '../../api/ledger.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { money as fmtMoney, currencySymbol } from '../../utils/money';
import { LoadingState, DataPanel, SectionHeader, FormField, FormSection } from '../../components/ds';

/** Montant sans devise (devise dans l'en-tête de colonne). */
const amt = (v: number) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });

/**
 * Prévision de trésorerie sur 13 semaines (G4-03) : courbe du solde prévu, seuil d'alerte,
 * détail par semaine et par source, scénario de retard des clients, lignes manuelles
 * (emprunt, investissement). Lecture seule, sauf les lignes manuelles et le seuil.
 */

const money = (n: number) => fmtMoney(n, { decimals: 0 });
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dmy = (d: string) => d.split('-').reverse().join('/');

export default function CashForecastTab() {
  const qc = useQueryClient();
  const [delay, setDelay] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [line, setLine] = useState({ flowDate: '', label: '', amount: '', category: 'emprunt' });
  const [thresholdInput, setThresholdInput] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['cash-forecast', delay], queryFn: () => cashForecastApi.get(delay) });
  const { data: lines = [] } = useQuery({ queryKey: ['cash-forecast-lines'], queryFn: cashForecastApi.lines });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cash-forecast'] }); qc.invalidateQueries({ queryKey: ['cash-forecast-lines'] }); };

  const addLine = useMutation({
    mutationFn: () => cashForecastApi.addLine({ flowDate: line.flowDate, label: line.label, amount: Number(line.amount.replace(',', '.')), category: line.category }),
    onSuccess: () => { setLine({ flowDate: '', label: '', amount: '', category: 'emprunt' }); refresh(); notify.success('Ligne ajoutée'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const delLine = useMutation({ mutationFn: (id: string) => cashForecastApi.deleteLine(id), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const saveThreshold = useMutation({
    mutationFn: (v: number) => cashForecastApi.setThreshold(v),
    onSuccess: () => { setThresholdInput(null); refresh(); notify.success('Seuil enregistré'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !data) return <LoadingState />;
  const below = data.firstBelowThreshold;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatusBanner tone={below ? 'warning' : 'info'} icon={below ? AlertTriangle : TrendingUp} title="Prévision de trésorerie — 13 semaines">
        {below
          ? `Le solde prévu passe sous le seuil de ${money(data.threshold)} le ${dmy(below.date)} (${money(below.balance)}). Point bas : ${money(data.minimum.balance)} le ${dmy(data.minimum.date)}.`
          : `Solde de départ ${money(data.opening)} (banque et caisse au grand livre). Point bas prévu : ${money(data.minimum.balance)} le ${dmy(data.minimum.date)}.`}
        {' '}Salaires comptés en brut ; créances décalées du retard moyen de chaque client.
      </StatusBanner>

      <div className="prj-toolbar" style={{ alignItems: 'flex-end' }}>
        <FormField label="Scénario : retard supplémentaire des clients" htmlFor="cf-delay">
          <select id="cf-delay" className="ds-input sm" style={{ width: 'auto' }} value={delay} onChange={e => setDelay(Number(e.target.value))}>
            {[0, 7, 15, 30, 45, 60].map(d => <option key={d} value={d}>{d === 0 ? 'Aucun' : `${d} jours`}</option>)}
          </select>
        </FormField>
        <FormField label={`Seuil d'alerte (${currencySymbol()})`} htmlFor="cf-threshold">
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <input id="cf-threshold" className="ds-input sm" style={{ width: 130, textAlign: 'right' }} inputMode="decimal"
              value={thresholdInput ?? String(data.threshold)} onChange={e => setThresholdInput(e.target.value)} />
            {thresholdInput !== null && <button type="button" className="odoo-btn-primary" disabled={saveThreshold.isPending}
              onClick={() => saveThreshold.mutate(Number(thresholdInput.replace(',', '.')) || 0)}>Enregistrer</button>}
          </span>
        </FormField>
      </div>

      <div className="ds-panel" style={{ height: 280, padding: '12px 8px 4px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.days} margin={{ top: 6, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--odoo-border)" />
            <XAxis dataKey="date" tickFormatter={dm} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `${Math.round(Number(v) / 1000)} k`} tick={{ fontSize: 11 }} width={60} domain={[(min: number) => Math.min(min, data.threshold), (max: number) => Math.max(max, data.threshold)]} />
            <Tooltip formatter={(v: number) => money(v)} labelFormatter={(d: string) => dmy(d)} />
            <ReferenceLine y={data.threshold} stroke="var(--ds-danger)" strokeDasharray="4 4" label={{ value: 'Seuil', position: 'insideTopRight', fontSize: 11, fill: 'var(--ds-danger)' }} />
            {/* Base de l'aire au plus bas de la série : un solde entièrement négatif reste visible. */}
            <Area type="stepAfter" dataKey="balance" name="Solde prévu" stroke="var(--ds-info)" strokeWidth={2} fill="var(--ds-info)" fillOpacity={0.12} baseValue="dataMin" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <DataPanel label="Prévision par semaine">
        <table className="odoo-table ds-dense">
          <thead><tr><th><span className="ds-sr-only">Détail</span></th><th>Semaine</th><th className="ds-num">Encaissements ({currencySymbol()})</th>
            <th className="ds-num">Décaissements ({currencySymbol()})</th><th className="ds-num">Solde fin de semaine ({currencySymbol()})</th></tr></thead>
          <tbody>
            {data.weeks.map((w, i) => {
              const isOpen = open === i;
              const flows = data.flows.filter(f => f.date >= w.start && f.date <= w.end);
              return [
                <tr key={w.start} style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : i)}>
                  <td style={{ width: 28 }}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                  <td>S{i + 1} · {dm(w.start)} → {dm(w.end)}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-success)' }}>{amt(w.inflow)}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{amt(-w.outflow)}</td>
                  <td className="ds-num ds-strong" style={{ color: w.closing < data.threshold ? 'var(--ds-danger)' : undefined }}>{amt(w.closing)}</td>
                </tr>,
                isOpen && (
                  <tr key={`${w.start}-d`}><td colSpan={5} style={{ padding: '4px 12px 10px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px', fontSize: '0.78rem' }}>
                      {Object.entries(w.byCategory).map(([k, v]) => (
                        <span key={k} style={{ border: '1px solid var(--ds-line)', borderRadius: 999, padding: '2px 8px' }}>{data.categories[k] ?? k} : <strong>{money(v)}</strong></span>
                      ))}
                    </div>
                    {flows.length === 0 ? <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Aucun flux.</span> : (
                      <table className="odoo-table ds-dense">
                        <thead><tr><th style={{ width: 60 }}>Date</th><th style={{ width: 150 }}>Nature</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
                        <tbody>
                        {flows.map((f, n) => (
                          <tr key={n}><td>{dm(f.date)}</td><td style={{ color: 'var(--ds-muted)' }}>{data.categories[f.category] ?? f.category}</td>
                            <td>{f.label}</td>
                            <td className="ds-num" style={{ color: f.amount < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{amt(f.amount)}</td></tr>
                        ))}
                      </tbody></table>
                    )}
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </DataPanel>

      <SectionHeader title="Lignes manuelles" />
      <section className="ds-panel" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <FormSection title="Nouvelle ligne">
          <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Ce que l'application ne connaît pas encore : emprunt attendu, investissement, apport. Montant positif = encaissement, négatif = décaissement.</span>
          <div className="ds-form-grid cols-4" style={{ alignItems: 'end' }}>
            <FormField label="Date" htmlFor="cf-line-date" required>
              <input id="cf-line-date" type="date" className="ds-input" value={line.flowDate} onChange={e => setLine(l => ({ ...l, flowDate: e.target.value }))} />
            </FormField>
            <FormField label="Libellé" htmlFor="cf-line-label" required>
              <input id="cf-line-label" className="ds-input" placeholder="Emprunt bancaire" value={line.label} onChange={e => setLine(l => ({ ...l, label: e.target.value }))} />
            </FormField>
            <FormField label={`Montant (${currencySymbol()})`} htmlFor="cf-line-amount" required>
              <input id="cf-line-amount" className="ds-input" style={{ textAlign: 'right' }} inputMode="decimal" value={line.amount} onChange={e => setLine(l => ({ ...l, amount: e.target.value }))} />
            </FormField>
            <FormField label="Nature" htmlFor="cf-line-cat">
              <select id="cf-line-cat" className="ds-input" value={line.category} onChange={e => setLine(l => ({ ...l, category: e.target.value }))}>
                <option value="emprunt">Emprunt</option><option value="investissement">Investissement</option><option value="apport">Apport</option>
                <option value="subvention">Subvention</option><option value="autre">Autre</option>
              </select>
            </FormField>
          </div>
          <div>
            <button type="button" className="odoo-btn-secondary" disabled={!line.flowDate || line.label.trim().length < 2 || !Number(line.amount.replace(',', '.')) || addLine.isPending}
              onClick={() => addLine.mutate()}><Plus size={13} /> Ajouter</button>
          </div>
        </FormSection>
      </section>
      {lines.length > 0 && (
        <DataPanel label="Lignes manuelles">
          <table className="odoo-table ds-dense">
            <thead><tr><th style={{ width: 110 }}>Date</th><th>Libellé</th><th>Nature</th><th className="ds-num">Montant ({currencySymbol()})</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
            {lines.map(l => (
              <tr key={l.id}><td>{dmy(l.flow_date)}</td><td className="ds-strong">{l.label}</td><td style={{ color: 'var(--ds-muted)' }}>{l.category}</td>
                <td className="ds-num">{amt(Number(l.amount))}</td>
                <td className="ds-actions" style={{ width: 40 }}><button type="button" className="ds-icon-btn" title="Supprimer" onClick={() => delLine.mutate(l.id)} aria-label="Supprimer"><Trash2 size={12} /></button></td></tr>
            ))}
          </tbody></table>
        </DataPanel>
      )}
    </div>
  );
}
