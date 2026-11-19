import { money, currencySymbol } from '../../../utils/money';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, TrendingDown, Banknote, Activity, Clock, Percent, Download, CalendarRange, BarChart3, ArrowLeftRight, PieChart, type LucideIcon } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';
import { downloadCsv, MONTH_NAMES } from '../shared';
import { EmptyPanel, LoadingPanel } from '../ui';

// Palette categorielle validee (bleu, orange, vert d'eau), ordre fixe.
const SERIES = { s1: '#2a78d6', s2: '#eb6834', s3: 'var(--prj-green)' };
const GRID = 'var(--kl-hair, #e9ecef)';
const TICK = { fontSize: 12, fill: 'var(--kl-muted, #6c757d)' };
const dh = (v: number) => `${Math.round(v).toLocaleString('fr-FR').replace(/ /g, ' ')}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('fr-FR')} %`);
const short = (m: number) => MONTH_NAMES[m - 1].slice(0, 3);

type Months = Array<Record<string, any>>;

/** Bloc graphique du tableau de bord (brique kl-widget du tableau de bord Ventes). */
function ChartWidget({ icon: Icon, title, summary, children }: { icon: LucideIcon; title: ReactNode; summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="kl-widget">
      <div className="kl-wlabel" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="kl-sq"><Icon size={13} /></span>{title}</span>
        {summary && <span style={{ fontWeight: 400 }}>{summary}</span>}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

/** Répartition en barres (brique kl-bars) : la barre est proportionnelle à la plus grande valeur. */
function Breakdown({ rows, unit }: { rows: Array<{ label: string; value: number }>; unit?: string }) {
  if (!rows.length) return <div className="kl-empty">—</div>;
  const max = Math.max(...rows.map(r => Number(r.value) || 0), 1);
  return (
    <ul className="kl-bars" style={{ padding: '4px 0 0' }}>
      {rows.map(r => (
        <li key={r.label}>
          <div className="h"><span>{r.label}</span><b>{r.value}{unit}</b></div>
          <div className="bar"><span style={{ width: `${(Number(r.value) || 0) / max * 100}%` }} /></div>
        </li>
      ))}
    </ul>
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

  const stat = (Icon: LucideIcon, label: string, value: ReactNode, sub?: string, title?: string) => (
    <div className="kl-widget" title={title}>
      <div className="kl-wlabel"><span className="kl-sq"><Icon size={13} /></span>{label}</div>
      <div className="kl-big" style={{ fontSize: 30 }}>{value}</div>
      {sub && <div className="kl-sub">{sub}</div>}
    </div>
  );

  return (
    <>
      <div className="prj-toolbar">
        <label className="hr-tools">
          <CalendarRange size={14} style={{ color: 'var(--theme-text-muted)' }} /> <span className="hr-tools-label">Année</span>
          <input type="number" className="odoo-filter-dropdown" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        </label>
        <span className="hr-spacer" />
        <button className="odoo-btn-secondary" onClick={exportCsv} disabled={!months.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {isLoading ? (
        <LoadingPanel />
      ) : !t ? (
        <EmptyPanel icon={BarChart3}>Aucune donnée RH pour {year}</EmptyPanel>
      ) : (
        <>
          <section aria-label={`Indicateurs RH ${year}`}>
            <div className="kl-sec"><h2>Indicateurs RH {year}</h2><small>Effectif, coûts, absentéisme et heures sur l'année</small></div>
            <div className="kl-stats">
              {stat(Users, 'Effectif', String(t.headcount), `moyen ${t.averageHeadcount} · +${t.entries} / −${t.exits}`)}
              {stat(TrendingDown, 'Turnover', pct(t.turnoverRate), `rotation ${pct(t.rotationRate)}`, 'Sorties de l\'année / effectif moyen')}
              {stat(Banknote, 'Coût de main-d\'œuvre', money(t.laborCost, { decimals: 0 }), `brut ${dh(t.grossPayroll)} · charges ${dh(t.employerCharges)}`)}
              {stat(Percent, 'Masse salariale / CA', pct(t.laborCostRatio), t.revenue ? `CA ${money(t.revenue, { decimals: 0 })}` : 'CA comptable indisponible', 'Coût de main-d\'œuvre / chiffre d\'affaires comptable HT (comptes 71)')}
              {stat(Activity, 'Absentéisme', pct(t.absenteeismRate), `${t.absenceDays} j / ${t.theoreticalDays} j ouvrables pointés`)}
              {stat(Clock, 'Coût horaire', t.costPerHour ? <>{t.costPerHour.toLocaleString("fr-FR")}<small>{currencySymbol()}/h</small></> : '—', `${dh(t.hoursWorked)} h travaillées · HS ${money(t.overtimeCost, { decimals: 0 })}`)}
            </div>
          </section>

          <section aria-label="Évolution mensuelle">
            <div className="kl-sec"><h2>Évolution mensuelle</h2></div>
            <div className="kl-hero">
            <ChartWidget icon={Banknote} title="Coût de main-d'œuvre mensuel" summary={currencySymbol()}>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => dh(Number(v))} width={60} />
                  <Tooltip formatter={(v: number) => money(v, { decimals: 0 })} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="grossPayroll" name="Brut (mensuels)" stackId="c" fill={SERIES.s1} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="employerCharges" name="Charges patronales" stackId="c" fill={SERIES.s2} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="otherPayroll" name="Hebdo / quinzaine" stackId="c" fill={SERIES.s3} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartWidget>

            <ChartWidget icon={Percent} title="Masse salariale / chiffre d'affaires" summary="%">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={months}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" %" width={50} />
                  <Tooltip formatter={(v: number) => pct(v)} />
                  <Line type="monotone" dataKey="laborCostRatio" name="Ratio" stroke={SERIES.s1} strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartWidget>

            <ChartWidget icon={ArrowLeftRight} title="Entrées et sorties">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="30%" barGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="entries" name="Entrées" fill={SERIES.s1} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="exits" name="Sorties" fill={SERIES.s2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartWidget>

            <ChartWidget icon={Activity} title="Taux d'absentéisme (%)" summary="mois non pointés exclus">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" %" width={50} />
                  <Tooltip formatter={(v: number) => pct(v)} />
                  <Bar dataKey="absenteeismRate" name="Absentéisme" fill={SERIES.s1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartWidget>
            </div>
          </section>

          <section aria-label="Répartitions">
            <div className="kl-sec"><h2>Répartitions</h2></div>
            <div className="kl-stats">
              {([['Par poste', data!.breakdowns.byRole], ['Par contrat', data!.breakdowns.byContract],
                ['Par ancienneté', data!.breakdowns.bySeniority], ['Motifs de sortie', data!.breakdowns.exitReasons]] as Array<[string, Array<{ label: string; value: number }>]>)
                .map(([title, rows]) => (
                  <ChartWidget key={title} icon={PieChart} title={title}>
                    <Breakdown rows={rows} />
                  </ChartWidget>
                ))}
              <ChartWidget icon={Users} title="Plus d'absences">
                <Breakdown rows={(data!.topAbsentees as Array<Record<string, any>>).map(r => ({ label: r.name as string, value: r.days as number }))} unit=" j" />
              </ChartWidget>
            </div>
          </section>

          <section aria-label="Détail mensuel">
            <div className="kl-sec"><h2>Détail mensuel</h2></div>
            <div className="prj-panel hr-plain">
            <div className="prj-scroll">
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
            <p className="hr-panel-foot" style={{ margin: 0 }}>
              Coût de main-d'œuvre = brut et charges patronales des bulletins mensuels + net des paies hebdomadaires et par quinzaine.
              CA = chiffre d'affaires comptable HT (comptes 71). Absentéisme = absences pointées, demi-journées et congés non payés par l'employeur, sur les jours ouvrables (hors repos et fériés).
            </p>
            </div>
          </section>
        </>
      )}
    </>
  );
}
