import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, TrendingDown, Banknote, Activity, Clock, Percent, Download, CalendarRange, Loader2, BarChart3 } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';
import { downloadCsv, MONTH_NAMES } from '../shared';
import { EmptyState } from '../ui';

// Palette categorielle validee (bleu, orange, vert d'eau), ordre fixe.
const SERIES = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a' };
const GRID = '#e9ecef';
const TICK = { fontSize: 11, fill: '#6c757d' };
const dh = (v: number) => `${Math.round(v).toLocaleString('fr-FR').replace(/ /g, ' ')}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('fr-FR')} %`);
const short = (m: number) => MONTH_NAMES[m - 1].slice(0, 3);

type Months = Array<Record<string, any>>;

const sectionHead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--odoo-text-muted)' } as const;

/** Bloc du tableau de bord, au format du pilotage Achats (cadre, intitule en capitales, resume a droite). */
function Section({ title, summary, children, flush }: { title: ReactNode; summary?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 16px 0' }}>
        <span style={sectionHead}>{title}</span>
        {summary && <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{summary}</span>}
      </div>
      <div style={{ padding: flush ? '8px 0 0' : '8px 16px 12px' }}>{children}</div>
    </section>
  );
}

/**
 * Pilotage RH : effectif et mouvements, turnover, masse salariale et ratio au
 * chiffre d'affaires, absentéisme, heures et coût horaire, répartitions.
 */
export default function HrAnalyticsTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useQuery<Record<string, any>>({
    queryKey: ['hr-analytics', year],
    queryFn: () => employeesApi.hrAnalytics(year),
  });
  const t = data?.totals;
  const months: Months = (data?.months ?? []).map((m: Record<string, any>) => ({ ...m, label: short(m.month) }));

  const exportCsv = () => downloadCsv(`pilotage_rh_${year}.csv`,
    ['Mois', 'Effectif', 'Entrées', 'Sorties', 'Brut', 'Charges patronales', 'Autres paies', 'Coût total', 'CA', 'Ratio CA %', 'Absentéisme %', 'Heures', 'Coût horaire'],
    months.map(m => [MONTH_NAMES[m.month - 1], String(m.headcount), String(m.entries), String(m.exits), m.grossPayroll, m.employerCharges,
      m.otherPayroll, m.laborCost, m.revenue, m.laborCostRatio, m.absenteeismRate, m.hoursWorked, m.costPerHour]));

  const card = (icon: ReactNode, label: string, value: string, sub?: string, title?: string) => (
    <div className="odoo-stat-card" title={title}>
      <div className="odoo-stat-card-label">{icon} {label}</div>
      <div className="odoo-stat-card-value">{value}</div>
      {sub && <div className="odoo-stat-card-sub">{sub}</div>}
    </div>
  );
  const muted = { fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 } as const;

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          <CalendarRange size={13} /> Année
          <input type="number" className="odoo-filter-dropdown" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        </label>
        <div style={{ flex: 1 }} />
        <button className="odoo-btn-secondary" onClick={exportCsv} disabled={!months.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : !t ? (
        <EmptyState icon={BarChart3}>Aucune donnée RH pour {year}</EmptyState>
      ) : (
        <>
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 16px 0' }}>
              <span style={sectionHead}>Indicateurs RH {year}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Effectif, coûts, absentéisme et heures sur l'année</span>
            </div>
          <div className="odoo-stat-grid" style={{ borderBottom: 'none' }}>
            {card(<Users size={11} />, 'Effectif', String(t.headcount), `moyen ${t.averageHeadcount} · +${t.entries} / −${t.exits}`)}
            {card(<TrendingDown size={11} />, 'Turnover', pct(t.turnoverRate), `rotation ${pct(t.rotationRate)}`, 'Sorties de l\'année / effectif moyen')}
            {card(<Banknote size={11} />, 'Coût de main-d\'œuvre', `${dh(t.laborCost)} DH`, `brut ${dh(t.grossPayroll)} · charges ${dh(t.employerCharges)}`)}
            {card(<Percent size={11} />, 'Masse salariale / CA', pct(t.laborCostRatio), t.revenue ? `CA ${dh(t.revenue)} DH` : 'CA comptable indisponible', 'Coût de main-d\'œuvre / chiffre d\'affaires comptable HT (comptes 71)')}
            {card(<Activity size={11} />, 'Absentéisme', pct(t.absenteeismRate), `${t.absenceDays} j / ${t.theoreticalDays} j ouvrables pointés`)}
            {card(<Clock size={11} />, 'Coût horaire', t.costPerHour ? `${t.costPerHour.toLocaleString('fr-FR')} DH/h` : '—', `${dh(t.hoursWorked)} h travaillées · HS ${dh(t.overtimeCost)} DH`)}
          </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
            <Section title="Coût de main-d'œuvre mensuel" summary="DH">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => dh(Number(v))} width={60} />
                  <Tooltip formatter={(v: number) => `${dh(v)} DH`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="grossPayroll" name="Brut (mensuels)" stackId="c" fill={SERIES.s1} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="employerCharges" name="Charges patronales" stackId="c" fill={SERIES.s2} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="otherPayroll" name="Hebdo / quinzaine" stackId="c" fill={SERIES.s3} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Section>

            <Section title="Masse salariale / chiffre d'affaires" summary="%">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={months}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" %" width={50} />
                  <Tooltip formatter={(v: number) => pct(v)} />
                  <Line type="monotone" dataKey="laborCostRatio" name="Ratio" stroke={SERIES.s1} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </Section>

            <Section title="Entrées et sorties">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="30%" barGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="entries" name="Entrées" fill={SERIES.s1} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="exits" name="Sorties" fill={SERIES.s2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Section>

            <Section title="Taux d'absentéisme (%)" summary="mois non pointés exclus">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" %" width={50} />
                  <Tooltip formatter={(v: number) => pct(v)} />
                  <Bar dataKey="absenteeismRate" name="Absentéisme" fill={SERIES.s1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {([['Par poste', data!.breakdowns.byRole], ['Par contrat', data!.breakdowns.byContract],
              ['Par ancienneté', data!.breakdowns.bySeniority], ['Motifs de sortie', data!.breakdowns.exitReasons]] as Array<[string, Array<{ label: string; value: number }>]>)
              .map(([title, rows]) => (
                <Section key={title} title={title} flush={rows.length > 0}>
                  {rows.length === 0 ? <p style={muted}>—</p> : (
                    <table className="odoo-table"><tbody>
                      {rows.map(r => <tr key={r.label}><td>{r.label}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{r.value}</td></tr>)}
                    </tbody></table>
                  )}
                </Section>
              ))}
            <Section title="Plus d'absences" flush={data!.topAbsentees.length > 0}>
              {data!.topAbsentees.length === 0 ? <p style={muted}>—</p> : (
                <table className="odoo-table"><tbody>
                  {data!.topAbsentees.map((r: Record<string, any>) => <tr key={r.employeeId}><td>{r.name}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{r.days} j</td></tr>)}
                </tbody></table>
              )}
            </Section>
          </div>

          <Section title="Détail mensuel" flush>
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr>
                  <th>Mois</th><th style={{ textAlign: 'right' }}>Effectif</th><th style={{ textAlign: 'right' }}>Entr. / Sort.</th>
                  <th style={{ textAlign: 'right' }}>Coût total</th><th style={{ textAlign: 'right' }}>CA</th><th style={{ textAlign: 'right' }}>Ratio</th>
                  <th style={{ textAlign: 'right' }}>Absentéisme</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coût horaire</th>
                </tr></thead>
                <tbody>
                  {months.map(m => (
                    <tr key={m.month}>
                      <td>{MONTH_NAMES[m.month - 1]}</td>
                      <td style={{ textAlign: 'right' }}>{m.headcount}</td>
                      <td style={{ textAlign: 'right' }}>+{m.entries} / −{m.exits}</td>
                      <td style={{ textAlign: 'right' }}>{dh(m.laborCost)}</td>
                      <td style={{ textAlign: 'right' }}>{m.revenue ? dh(m.revenue) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{pct(m.laborCostRatio)}</td>
                      <td style={{ textAlign: 'right' }}>{m.tracked ? pct(m.absenteeismRate) : 'non pointé'}</td>
                      <td style={{ textAlign: 'right' }}>{m.hoursWorked ? dh(m.hoursWorked) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{m.costPerHour ? m.costPerHour.toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', margin: 0, padding: '8px 16px 12px' }}>
              Coût de main-d'œuvre = brut et charges patronales des bulletins mensuels + net des paies hebdomadaires et par quinzaine.
              CA = chiffre d'affaires comptable HT (comptes 71). Absentéisme = absences pointées, demi-journées et congés non payés par l'employeur, sur les jours ouvrables (hors repos et fériés).
            </p>
          </Section>
        </>
      )}
    </>
  );
}
