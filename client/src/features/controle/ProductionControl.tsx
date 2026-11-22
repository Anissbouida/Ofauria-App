import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X, TrendingDown, ClipboardCheck, Scale, Undo2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { controleApi, type ProductionIssue } from '../../api/controle.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';
import { ListToolbar, ListEmpty } from '../sales/ListTemplate';
import { StageChips, Panel, PagerFoot, PageLoading } from './KlUi';
import { NoResultState } from '../../components/ds';
import { money } from '../../utils/money';

/**
 * Contrôle & Qualité › Production : toutes les anomalies de fabrication au même
 * endroit — rendement sous le seuil, contrôle qualité non conforme ou non fait,
 * pesées hors tolérance, bons refusés par le chef. Une ligne = une anomalie, avec
 * l'accès au plan concerné. Remplace le tableau de bord production intégré.
 */

type Kind = ProductionIssue['kind'];
const KINDS: Array<StageDef & { key: Kind }> = [
  { key: 'qc', label: 'Contrôle qualité', hint: 'non conforme ou non renseigné', icon: ClipboardCheck },
  { key: 'rendement', label: 'Rendement sous le seuil', hint: 'moins que prévu par la fiche', icon: TrendingDown },
  { key: 'pesee', label: 'Pesées hors tolérance', hint: 'écart de pesée motivé', icon: Scale },
  { key: 'refus', label: 'Refus du chef', hint: 'préparation à reprendre', icon: Undo2 },
];
const KIND_DOT: Record<Kind, string> = { qc: 'var(--ds-danger)', rendement: 'var(--ds-warning)', pesee: '#c99a06', refus: 'var(--ds-accent)' };
const ACTION: Record<Kind, string> = {
  qc: 'Voir le contrôle', rendement: 'Analyser le plan', pesee: 'Voir le plan', refus: 'Voir le bon',
};

export default function ProductionControl({ range, periodText }: { range: Record<string, string>; periodText: string }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [kind, search, range]);

  const params = useMemo(() => {
    const p: Record<string, string> = { ...range, page: String(page), pageSize: String(PAGE_SIZE) };
    if (kind) p.kind = kind;
    if (search) p.search = search;
    return p;
  }, [range, kind, search, page]);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['controle-production', params], queryFn: () => controleApi.production(params), placeholderData: prev => prev,
  });
  const counts = data?.counts ?? {};
  const totalIssues = KINDS.reduce((s, k) => s + (counts[k.key] ?? 0), 0);
  const rows = data?.rows ?? [];

  return (
    <>
      {(counts.qc ?? 0) > 0 && kind !== 'qc' && (
        <StatusBanner tone="danger" icon={ClipboardCheck}
          title={`${counts.qc} contrôle${counts.qc > 1 ? 's' : ''} qualité non conforme${counts.qc > 1 ? 's' : ''} ou non renseigné${counts.qc > 1 ? 's' : ''}`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setKind('qc')}>Les afficher</button>}>
          Une étape à contrôle qualité a été terminée avec un point refusé, ou sans résultat : vérifiez le lot avant sa mise en vente.
        </StatusBanner>
      )}


      <StageChips
        title="Anomalies de production"
        summary={totalIssues ? `${totalIssues} anomalie${totalIssues > 1 ? 's' : ''} · ${periodText}` : `Aucune anomalie · ${periodText}`}
        stages={KINDS}
        stats={Object.fromEntries(KINDS.map(k => [k.key, { count: counts[k.key] ?? 0, sub: '' }]))}
        isActive={k => kind === k}
        onPick={k => setKind(kind === k ? '' : (k as Kind))}
      />


      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher un produit, un ingrédient, un bon, un motif...">
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
        {(kind || search) && (
          <button type="button" onClick={() => { setKind(''); setSearchInput(''); setSearch(''); }} className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer les filtres
          </button>
        )}
      </ListToolbar>

      {isLoading ? <PageLoading /> : rows.length === 0 ? (
        kind || search
          ? <NoResultState text="Aucune anomalie ne correspond aux filtres." onReset={() => { setKind(''); setSearchInput(''); setSearch(''); }} />
          : <ListEmpty icon={CheckCircle2} title="Aucune anomalie de production sur la période" text="Rendements, contrôles qualité, pesées et bons refusés : tout est conforme." />
      ) : (
        <Panel style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}
          footer={<PagerFoot page={page} total={data?.total ?? 0} onPage={setPage} note={`Anomalies de production · ${periodText}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Anomalie</th>
                <th>Concerne</th>
                <th>Détail</th>
                <th>Par</th>
                <th className="ds-actions">Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td style={{ color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>
                    {r.occurred_at ? format(new Date(r.occurred_at), 'd MMM yyyy HH:mm', { locale: fr }) : '—'}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: KIND_DOT[r.kind] }} />
                      {KINDS.find(k => k.key === r.kind)?.label}
                    </span>
                  </td>
                  <td>
                    <span className="ds-strong">{r.label}</span>
                    {r.plan_date && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Plan du {format(new Date(r.plan_date), 'd MMM yyyy', { locale: fr })}</div>}
                  </td>
                  <td style={{ color: r.kind === 'qc' ? 'var(--ds-danger)' : undefined, maxWidth: 380 }}>
                    {r.detail ?? '—'}
                    {r.value && Number(r.value) !== 0 && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>écart de coût estimé {money(Number(r.value))}</div>}
                  </td>
                  <td style={{ color: 'var(--ds-muted)' }}>{r.by_name ?? '—'}</td>
                  <td className="ds-actions">
                    {r.plan_id ? (
                      <button type="button" onClick={() => navigate(`/production/${r.plan_id}`)}
                        className="odoo-btn-secondary ds-btn-sm">
                        {ACTION[r.kind]}
                      </button>
                    ) : <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>plan introuvable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
