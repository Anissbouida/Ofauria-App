import { money, currencySymbol } from '../../../utils/money';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, Banknote, Activity, Percent, Download, CalendarRange, BarChart3, ArrowLeftRight, PieChart, type LucideIcon } from 'lucide-react';
import { employeesApi } from '../../../api/employees.api';
import { downloadCsv, MONTH_NAMES } from '../shared';
import { EmptyPanel, LoadingPanel, HrHeaderActions } from '../ui';
import { KpiGrid, KpiCard, SectionHeader, Toolbar, DataPanel, TableFooter, ErrorState } from '../../../components/ds';

// Couleurs des graphiques = jetons du Design System : accent pour la série principale (déclinée
// en teintes pour un empilement), --ds-warning pour la série d'alerte (sorties).
const SERIES = {
  s1: 'var(--ds-accent)',
  s2: 'color-mix(in srgb, var(--ds-accent) 55%, var(--ds-card))',
  s3: 'color-mix(in srgb, var(--ds-accent) 28%, var(--ds-card))',
  warn: 'var(--ds-warning)',
};
const SEP = 'var(--ds-card)';
const GRID = 'var(--ds-hair)';
const TICK = { fontSize: 12, fill: 'var(--ds-muted)' };
const dh = (v: number) => `${Math.round(v).toLocaleString('fr-FR').replace(/ /g, ' ')}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('fr-FR')} %`);
const short = (m: number) => MONTH_NAMES[m - 1].slice(0, 3);

type Months = Array<Record<string, any>>;

/** Bloc graphique du tableau de bord (brique kl-widget du tableau de bord Ventes). */
function ChartWidget({ icon: Icon, title, summary, children }: { icon: LucideIcon; title: ReactNode; summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="kl-widget">
      <div className="kl-wlabel" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="kl-sq"><Icon size={13} aria-hidden="true" /></span>{title}</span>
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
  const { data, isLoading, isError, refetch } = useQuery<Record<string, any>>({
    queryKey: ['hr-analytics', year],
    queryFn: () => employeesApi.hrAnalytics(year),
  });
  const t = data?.totals;
  const months: Months = (data?.months ?? []).map((m: Record<string, any>) => ({ ...m, label: short(m.month) }));

  const exportCsv = () => downloadCsv(`pilotage_rh_${year}.csv`,
    ['Mois', 'Effectif', 'Entrées', 'Sorties', 'Brut', 'Charges patronales', 'Autres paies', 'Coût total', 'CA', 'Ratio CA %', 'Absentéisme %', 'Heures', 'Coût horaire'],
    months.map(m => [MONTH_NAMES[m.month - 1], String(m.headcount), String(m.entries), String(m.exits), m.grossPayroll, m.employerCharges,
      m.otherPayroll, m.laborCost, m.revenue, m.laborCostRatio, m.absenteeismRate, m.hoursWorked, m.costPerHour]));

  // Infobulle d'explication du calcul autour d'une tuile (KpiCard n'a pas d'attribut title).
  const tip = (title: string, card: ReactNode) => <div title={title} style={{ display: 'grid' }}>{card}</div>;

  return (
    <>
      {/* Export : action secondaire, en haut à droite de la page. */}
      <HrHeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={exportCsv} disabled={!months.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} aria-hidden="true" /> Exporter
        </button>
      </HrHeaderActions>

      {/* Barre d'outils : filtre de période. */}
      <Toolbar>
        <label className="hr-tools">
          <CalendarRange size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} /> <span className="hr-tools-label">Année</span>
          <input type="number" className="odoo-filter-dropdown" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        </label>
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState title="Les indicateurs n'ont pas pu être chargés" onRetry={() => void refetch()} />
      ) : !t ? (
        <EmptyPanel icon={BarChart3}>Aucune donnée RH pour {year}</EmptyPanel>
      ) : (
        <>
          <section aria-label={`Indicateurs RH ${year}`} style={{ display: 'grid', gap: 16 }}>
            <SectionHeader title={`Indicateurs RH ${year}`} note="Effectif, coûts, absentéisme et heures sur l'année" />
            {/* Six tuiles en 3 + 3 (jamais 5 + 1). */}
            <KpiGrid label="Effectif et coûts">
              <KpiCard label="Effectif" value={String(t.headcount)} sub={`moyen ${t.averageHeadcount} · +${t.entries} / −${t.exits}`} />
              {tip('Sorties de l\'année / effectif moyen',
                <KpiCard label="Turnover" value={pct(t.turnoverRate)} sub={`rotation ${pct(t.rotationRate)}`} />)}
              <KpiCard label="Coût de main-d'œuvre" value={money(t.laborCost, { decimals: 0 })} sub={`brut ${dh(t.grossPayroll)} · charges ${dh(t.employerCharges)}`} />
            </KpiGrid>
            <KpiGrid label="Ratios et heures">
              {tip('Coût de main-d\'œuvre / chiffre d\'affaires comptable HT (comptes 71)',
                <KpiCard label="Masse salariale / CA" value={pct(t.laborCostRatio)} sub={t.revenue ? `CA ${money(t.revenue, { decimals: 0 })}` : 'CA comptable indisponible'} />)}
              <KpiCard label="Absentéisme" value={pct(t.absenteeismRate)} sub={`${t.absenceDays} j / ${t.theoreticalDays} j ouvrables pointés`} />
              <KpiCard label="Coût horaire" value={t.costPerHour ? `${t.costPerHour.toLocaleString('fr-FR')} ${currencySymbol()}/h` : '—'}
                sub={`${dh(t.hoursWorked)} h travaillées · HS ${money(t.overtimeCost, { decimals: 0 })}`} />
            </KpiGrid>
          </section>

          <section aria-label="Évolution mensuelle" style={{ display: 'grid', gap: 16 }}>
            <SectionHeader title="Évolution mensuelle" />
            <div className="kl-hero">
            <ChartWidget icon={Banknote} title="Coût de main-d'œuvre mensuel" summary={currencySymbol()}>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={months} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => dh(Number(v))} width={60} />
                  <Tooltip formatter={(v: number) => money(v, { decimals: 0 })} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="grossPayroll" name="Brut (mensuels)" stackId="c" fill={SERIES.s1} stroke={SEP} strokeWidth={1} />
                  <Bar dataKey="employerCharges" name="Charges patronales" stackId="c" fill={SERIES.s2} stroke={SEP} strokeWidth={1} />
                  <Bar dataKey="otherPayroll" name="Hebdo / quinzaine" stackId="c" fill={SERIES.s3} stroke={SEP} strokeWidth={1} radius={[4, 4, 0, 0]} />
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
                  <Bar dataKey="exits" name="Sorties" fill={SERIES.warn} radius={[4, 4, 0, 0]} />
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

          <section aria-label="Répartitions" style={{ display: 'grid', gap: 16 }}>
            <SectionHeader title="Répartitions" />
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

          <section aria-label="Détail mensuel" style={{ display: 'grid', gap: 16 }}>
            <SectionHeader title="Détail mensuel" />
            <DataPanel label="Détail mensuel" footer={<TableFooter note={<>
              Coût de main-d'œuvre = brut et charges patronales des bulletins mensuels + net des paies hebdomadaires et par quinzaine.
              CA = chiffre d'affaires comptable HT (comptes 71). Absentéisme = absences pointées, demi-journées et congés non payés par l'employeur, sur les jours ouvrables (hors repos et fériés).
            </>} />}>
              <table className="odoo-table">
                <thead><tr>
                  <th>Mois</th><th className="ds-num">Effectif</th><th className="ds-num">Entrées / sorties</th>
                  <th className="ds-num">Coût total ({currencySymbol()})</th><th className="ds-num">CA ({currencySymbol()})</th><th className="ds-num">Ratio</th>
                  <th className="ds-num">Absentéisme</th><th className="ds-num">Heures (h)</th><th className="ds-num">Coût horaire ({currencySymbol()}/h)</th>
                </tr></thead>
                <tbody>
                  {months.map(m => (
                    <tr key={m.month}>
                      <td className="ds-strong">{MONTH_NAMES[m.month - 1]}</td>
                      <td className="ds-num">{m.headcount}</td>
                      <td className="ds-num">+{m.entries} / −{m.exits}</td>
                      <td className="ds-num">{dh(m.laborCost)}</td>
                      <td className="ds-num">{m.revenue ? dh(m.revenue) : '—'}</td>
                      <td className="ds-num">{pct(m.laborCostRatio)}</td>
                      <td className="ds-num">{m.tracked ? pct(m.absenteeismRate) : 'non pointé'}</td>
                      <td className="ds-num">{m.hoursWorked ? dh(m.hoursWorked) : '—'}</td>
                      <td className="ds-num">{m.costPerHour ? m.costPerHour.toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </section>
        </>
      )}
    </>
  );
}
