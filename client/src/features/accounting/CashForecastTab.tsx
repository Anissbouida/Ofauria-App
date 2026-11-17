import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus, Trash2, TrendingUp } from 'lucide-react';
import { cashForecastApi } from '../../api/ledger.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Prévision de trésorerie sur 13 semaines (G4-03) : courbe du solde prévu, seuil d'alerte,
 * détail par semaine et par source, scénario de retard des clients, lignes manuelles
 * (emprunt, investissement). Lecture seule, sauf les lignes manuelles et le seuil.
 */

const money = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DH`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dmy = (d: string) => d.split('-').reverse().join('/');
const field: React.CSSProperties = { fontSize: '0.85rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };

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

  if (isLoading || !data) return <div style={{ padding: 24 }}><Loader2 size={18} className="animate-spin" /></div>;
  const below = data.firstBelowThreshold;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatusBanner tone={below ? 'warning' : 'info'} icon={below ? AlertTriangle : TrendingUp} title="Prévision de trésorerie — 13 semaines">
        {below
          ? `Le solde prévu passe sous le seuil de ${money(data.threshold)} le ${dmy(below.date)} (${money(below.balance)}). Point bas : ${money(data.minimum.balance)} le ${dmy(data.minimum.date)}.`
          : `Solde de départ ${money(data.opening)} (banque et caisse au grand livre). Point bas prévu : ${money(data.minimum.balance)} le ${dmy(data.minimum.date)}.`}
        {' '}Salaires comptés en brut ; créances décalées du retard moyen de chaque client.
      </StatusBanner>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', fontSize: '0.85rem' }}>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 500 }}>Scénario : retard supplémentaire des clients</span>
          <select style={field} value={delay} onChange={e => setDelay(Number(e.target.value))} aria-label="Retard supplémentaire des clients">
            {[0, 7, 15, 30, 45, 60].map(d => <option key={d} value={d}>{d === 0 ? 'Aucun' : `${d} jours`}</option>)}
          </select></label>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 500 }}>Seuil d'alerte (DH)</span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <input style={{ ...field, width: 130, textAlign: 'right' }} inputMode="decimal" aria-label="Seuil d'alerte"
              value={thresholdInput ?? String(data.threshold)} onChange={e => setThresholdInput(e.target.value)} />
            {thresholdInput !== null && <button type="button" className="odoo-btn-primary" disabled={saveThreshold.isPending}
              onClick={() => saveThreshold.mutate(Number(thresholdInput.replace(',', '.')) || 0)}>Enregistrer</button>}
          </span></label>
      </div>

      <div style={{ height: 280, border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', padding: '10px 6px 4px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.days} margin={{ top: 6, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--odoo-border)" />
            <XAxis dataKey="date" tickFormatter={dm} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `${Math.round(Number(v) / 1000)} k`} tick={{ fontSize: 11 }} width={60} domain={[(min: number) => Math.min(min, data.threshold), (max: number) => Math.max(max, data.threshold)]} />
            <Tooltip formatter={(v: number) => money(v)} labelFormatter={(d: string) => dmy(d)} />
            <ReferenceLine y={data.threshold} stroke="#c62828" strokeDasharray="4 4" label={{ value: 'Seuil', position: 'insideTopRight', fontSize: 11, fill: '#c62828' }} />
            {/* Base de l'aire au plus bas de la série : un solde entièrement négatif reste visible. */}
            <Area type="stepAfter" dataKey="balance" name="Solde prévu" stroke="#1a73e8" strokeWidth={2} fill="#1a73e8" fillOpacity={0.12} baseValue="dataMin" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, overflowX: 'auto', background: 'var(--odoo-bg)' }}>
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead><tr><th /><th style={{ textAlign: 'left' }}>Semaine</th><th style={{ textAlign: 'right' }}>Encaissements</th>
            <th style={{ textAlign: 'right' }}>Décaissements</th><th style={{ textAlign: 'right' }}>Solde fin de semaine</th></tr></thead>
          <tbody>
            {data.weeks.map((w, i) => {
              const isOpen = open === i;
              const flows = data.flows.filter(f => f.date >= w.start && f.date <= w.end);
              return [
                <tr key={w.start} style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : i)}>
                  <td style={{ width: 28 }}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                  <td>S{i + 1} · {dm(w.start)} → {dm(w.end)}</td>
                  <td style={{ textAlign: 'right', color: '#0e7c3a', fontVariantNumeric: 'tabular-nums' }}>{money(w.inflow)}</td>
                  <td style={{ textAlign: 'right', color: '#c62828', fontVariantNumeric: 'tabular-nums' }}>{money(-w.outflow)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: w.closing < data.threshold ? '#c62828' : undefined }}>{money(w.closing)}</td>
                </tr>,
                isOpen && (
                  <tr key={`${w.start}-d`}><td colSpan={5} style={{ padding: '4px 12px 10px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px', fontSize: '0.78rem' }}>
                      {Object.entries(w.byCategory).map(([k, v]) => (
                        <span key={k} style={{ border: '1px solid var(--odoo-border)', borderRadius: 999, padding: '2px 8px' }}>{data.categories[k] ?? k} : <strong>{money(v)}</strong></span>
                      ))}
                    </div>
                    {flows.length === 0 ? <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Aucun flux.</span> : (
                      <table className="odoo-table" style={{ width: '100%', margin: 0 }}><tbody>
                        {flows.map((f, n) => (
                          <tr key={n}><td style={{ width: 60 }}>{dm(f.date)}</td><td style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)', width: 150 }}>{data.categories[f.category] ?? f.category}</td>
                            <td style={{ fontSize: '0.82rem' }}>{f.label}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: f.amount < 0 ? '#c62828' : '#0e7c3a' }}>{money(f.amount)}</td></tr>
                        ))}
                      </tbody></table>
                    )}
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      <section style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, background: 'var(--odoo-bg)', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: '0.9rem' }}>Lignes manuelles</strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Ce que l'application ne connaît pas encore : emprunt attendu, investissement, apport. Montant positif = encaissement, négatif = décaissement.</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" style={field} value={line.flowDate} onChange={e => setLine(l => ({ ...l, flowDate: e.target.value }))} aria-label="Date" />
          <input style={{ ...field, minWidth: 220 }} placeholder="Libellé" value={line.label} onChange={e => setLine(l => ({ ...l, label: e.target.value }))} aria-label="Libellé" />
          <input style={{ ...field, width: 120, textAlign: 'right' }} inputMode="decimal" placeholder="Montant" value={line.amount} onChange={e => setLine(l => ({ ...l, amount: e.target.value }))} aria-label="Montant" />
          <select style={field} value={line.category} onChange={e => setLine(l => ({ ...l, category: e.target.value }))} aria-label="Nature">
            <option value="emprunt">Emprunt</option><option value="investissement">Investissement</option><option value="apport">Apport</option>
            <option value="subvention">Subvention</option><option value="autre">Autre</option>
          </select>
          <button type="button" className="odoo-btn-secondary" disabled={!line.flowDate || line.label.trim().length < 2 || !Number(line.amount.replace(',', '.')) || addLine.isPending}
            onClick={() => addLine.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Ajouter</button>
        </div>
        {lines.length > 0 && (
          <table className="odoo-table" style={{ width: '100%', margin: 0 }}><tbody>
            {lines.map(l => (
              <tr key={l.id}><td style={{ width: 90 }}>{dmy(l.flow_date)}</td><td>{l.label}</td><td style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{l.category}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amount)}</td>
                <td style={{ width: 40, textAlign: 'right' }}><button type="button" className="odoo-btn-secondary" title="Supprimer" onClick={() => delLine.mutate(l.id)}><Trash2 size={12} /></button></td></tr>
            ))}
          </tbody></table>
        )}
      </section>
    </div>
  );
}
