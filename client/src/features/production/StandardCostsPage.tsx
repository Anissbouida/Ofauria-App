/**
 * Production › Rapports › Coûts standard (mig 661, 2026-11-24).
 *
 * Le coût ne fait plus partie de la fiche technique : chaque article a ici son coût standard,
 * calculé depuis sa fiche (quantités), les prix des lots en cours et les charges des centres du
 * mois. Un calcul validé devient le coût de référence ; « à recalculer » signale une fiche
 * modifiée ou des prix qui ont bougé depuis la validation.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, RefreshCw } from 'lucide-react';
import SalesPageShell from '../sales/SalesPageShell';
import { FilterChips } from '../sales/ListTemplate';
import { DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, NoResultState, SearchBar, SortTh, TableFooter, Toolbar } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol } from '../../utils/money';
import { textIncludes } from '../../utils/searchText';
import { useActionPermissions } from '../../hooks/useActionPermissions';
import { analyticCostApi, type StandardCostRow, type StandardSituation } from '../../api/analytic-cost.api';
import './production.css';

type Filter = '' | StandardSituation | 'labour';
type SortKey = 'name' | 'matiere' | 'coutProduction' | 'coutRevient' | 'priceHt' | 'tauxMarque';

const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthLabel = (m?: string) => {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
/** Seuil de taux de marque sous lequel un article est signalé (orange). */
export const LOW_MARK = 30;

export const SITUATION: Record<StandardSituation, { label: string; tone: 'progress' | 'done' | 'todo' }> = {
  calculated: { label: 'Calculé, à valider', tone: 'progress' },
  validated: { label: 'Validé', tone: 'done' },
  stale: { label: 'À recalculer', tone: 'todo' },
};

export default function StandardCostsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, isLoading: permLoading } = useActionPermissions();
  const allowed = can('production.production_cout.analytique');
  const [filter, setFilter] = useState<Filter>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['standard-costs'], queryFn: () => analyticCostApi.standardCosts(), enabled: allowed,
  });
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const recalc = async () => {
    setRefreshing(true);
    try {
      const fresh = await analyticCostApi.standardCosts(true);
      qc.setQueryData(['standard-costs'], fresh);
      notify.success(`${fresh.rows.length} article(s) recalculé(s)`);
    } catch (e) { notify.error(apiErrorMessage(e)); }
    finally { setRefreshing(false); }
  };

  const counts = useMemo(() => ({
    calculated: rows.filter(r => r.situation === 'calculated').length,
    validated: rows.filter(r => r.situation === 'validated').length,
    stale: rows.filter(r => r.situation === 'stale').length,
    labour: rows.filter(r => r.labourMissing).length,
  }), [rows]);

  const shown = useMemo(() => {
    const list = rows.filter(r => (!filter || (filter === 'labour' ? r.labourMissing : r.situation === filter))
      && textIncludes(search, r.name, r.productName ?? '', r.category ?? ''));
    const val = (r: StandardCostRow): number | string => sort.key === 'name' ? r.name : (r[sort.key] ?? -Infinity);
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y), 'fr') : (x as number) - (y as number);
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, filter, search, sort]);

  const marks = rows.map(r => r.tauxMarque).filter((v): v is number => v != null);
  const avgMark = marks.length ? marks.reduce((t, v) => t + v, 0) / marks.length : null;
  const sym = currencySymbol();
  const onSort = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc' }));
  const th = (key: SortKey, label: string, num = true) => (
    <SortTh label={label} active={sort.key === key} dir={sort.dir} onSort={() => onSort(key)} className={num ? 'ds-num' : undefined} />
  );

  if (permLoading) return <LoadingState />;
  if (!allowed) {
    return (
      <SalesPageShell icon={Calculator} parent="Production › Rapports" title="Coûts standard">
        <EmptyState icon={Calculator} title="Accès réservé"
          text="Les coûts et les marges des articles sont réservés au gérant (droit « comptabilité analytique »)." />
      </SalesPageShell>
    );
  }

  return (
    <SalesPageShell icon={Calculator} parent="Production › Rapports" title="Coûts standard" list
      summary="Coût de chaque article, calculé depuis sa fiche technique, les prix des lots et les charges des centres. Un coût validé devient le coût de référence de l'article."
      actions={
        <button type="button" className="odoo-btn-primary" onClick={recalc} disabled={refreshing || isLoading}
          title="Relance le calcul de tous les articles avec les prix et les charges du jour.">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Recalculer les articles
        </button>
      }>
      {isLoading ? <LoadingState label="Calcul des coûts des articles…" />
        : error ? <ErrorState error={error} onRetry={() => refetch()} />
        : rows.length === 0 ? (
          <EmptyState icon={Calculator} title="Aucun article à chiffrer"
            text="Un article apparaît ici dès qu'une fiche technique est liée à un produit vendu." />
        ) : <>
          <KpiGrid label="Coûts standard">
            <KpiCard label="Articles chiffrés" value={String(rows.length)} sub={`charges de ${monthLabel(rows[0]?.month)}`} />
            <KpiCard label="Coûts validés" value={String(counts.validated + counts.stale)}
              sub={counts.stale ? `dont ${counts.stale} à recalculer` : 'coûts de référence à jour'} tone={counts.stale ? 'orange' : undefined} />
            <KpiCard label="Sans gamme" value={String(counts.labour)} sub="main-d'œuvre directe non comptée" tone={counts.labour ? 'orange' : undefined} />
            <KpiCard label="Taux de marque moyen" value={pct(avgMark)} sub={`moyenne simple de ${marks.length} article(s)`} />
          </KpiGrid>

          <FilterChips label="Filtrer par situation" value={filter} onChange={k => setFilter(k as Filter)} chips={[
            { key: '', label: 'Tous', count: rows.length },
            { key: 'calculated', label: SITUATION.calculated.label, count: counts.calculated },
            { key: 'validated', label: 'Validés', count: counts.validated },
            { key: 'stale', label: 'À recalculer', count: counts.stale, tone: counts.stale ? 'late' : undefined },
            { key: 'labour', label: 'Sans gamme', count: counts.labour },
          ]} />

          <Toolbar>
            <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un article" />
            <span className="ds-grow" />
            <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Montants par pièce</span>
          </Toolbar>

          {shown.length === 0 ? <NoResultState onReset={() => { setFilter(''); setSearch(''); }} text="Aucun article ne correspond aux filtres." /> : (
            <DataPanel label="Coûts standard des articles"
              footer={<TableFooter note={`${shown.length} article(s) · calculé le ${data ? new Date(data.computedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : ''}`} />}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    {th('name', 'Article', false)}
                    <th>Format</th>
                    {th('matiere', `Matières (${sym})`)}
                    {th('coutProduction', `Coût de production (${sym})`)}
                    {th('coutRevient', `Coût de revient (${sym})`)}
                    {th('priceHt', `Prix HT (${sym})`)}
                    {th('tauxMarque', 'Taux de marque')}
                    <th>Situation</th>
                    <th className="ds-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => {
                    const open = () => navigate(`/production/couts-standard/${r.recipeId}${r.formatId ? `?format=${r.formatId}` : ''}`);
                    const low = r.tauxMarque != null && r.tauxMarque < LOW_MARK;
                    return (
                      <tr key={`${r.recipeId}:${r.formatId ?? ''}`} onClick={open} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className="ds-strong">{r.name}</span>
                          {r.category && <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)' }}>{r.category}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.pieces ? `${r.pieces} pièce${r.pieces > 1 ? 's' : ''}` : '—'}</td>
                        <td className="ds-num">{n2(r.matiere)}</td>
                        <td className="ds-num">{n2(r.coutProduction)}</td>
                        <td className="ds-num ds-strong">{n2(r.coutRevient)}</td>
                        <td className="ds-num">{n2(r.priceHt)}</td>
                        <td className="ds-num" style={low ? { color: 'var(--ds-warning)', fontWeight: 600 } : undefined}
                          title={low ? `Sous ${LOW_MARK} % de marque` : undefined}>{pct(r.tauxMarque)}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <StatusTag tone={SITUATION[r.situation].tone} label={SITUATION[r.situation].label} title={r.reason ?? undefined} />
                            {r.labourMissing && <span style={{ fontSize: 12, color: 'var(--ds-warning)' }}>sans gamme</span>}
                          </span>
                        </td>
                        <td className="ds-actions" onClick={e => e.stopPropagation()}>
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={open}>Ouvrir</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataPanel>
          )}
        </>}
    </SalesPageShell>
  );
}
