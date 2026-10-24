import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X, TrendingDown, ClipboardCheck, Scale, Undo2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { controleApi, type ProductionIssue } from '../../api/controle.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StagePipeline, Pager, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';

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
const KIND_DOT: Record<Kind, string> = { qc: '#dc3545', rendement: '#d9822b', pesee: '#c99a06', refus: '#3b82f6' };
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
      <StagePipeline
        title="Anomalies de production"
        summary={totalIssues ? `${totalIssues} anomalie${totalIssues > 1 ? 's' : ''} · ${periodText}` : `Aucune anomalie · ${periodText}`}
        stages={KINDS}
        stats={Object.fromEntries(KINDS.map(k => [k.key, { count: counts[k.key] ?? 0, sub: '' }]))}
        isActive={k => kind === k}
        onPick={k => setKind(kind === k ? '' : (k as Kind))}
      />

      {(counts.qc ?? 0) > 0 && kind !== 'qc' && (
        <StatusBanner tone="danger" icon={ClipboardCheck}
          title={`${counts.qc} contrôle${counts.qc > 1 ? 's' : ''} qualité non conforme${counts.qc > 1 ? 's' : ''} ou non renseigné${counts.qc > 1 ? 's' : ''}`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setKind('qc')}>Les afficher</button>}>
          Une étape à contrôle qualité a été terminée avec un point refusé, ou sans résultat : vérifiez le lot avant sa mise en vente.
        </StatusBanner>
      )}

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)} aria-label="Rechercher une anomalie"
          placeholder="Rechercher un produit, un ingrédient, un bon, un motif..." className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        {(kind || search) && (
          <button type="button" onClick={() => { setKind(''); setSearchInput(''); setSearch(''); }} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={22} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <CheckCircle2 size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{kind || search ? 'Aucune anomalie pour ces filtres.' : 'Aucune anomalie de production sur la période.'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Anomalie</th>
                <th>Concerne</th>
                <th>Détail</th>
                <th>Par</th>
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                    {r.occurred_at ? format(new Date(r.occurred_at), 'dd/MM/yyyy HH:mm', { locale: fr }) : '—'}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: KIND_DOT[r.kind] }} />
                      {KINDS.find(k => k.key === r.kind)?.label}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{r.label}</span>
                    {r.plan_date && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>Plan du {format(new Date(r.plan_date), 'dd MMM yyyy', { locale: fr })}</div>}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: r.kind === 'qc' ? '#b71c1c' : 'var(--odoo-text)', maxWidth: 380 }}>
                    {r.detail ?? '—'}
                    {r.value && Number(r.value) !== 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>écart de coût estimé {Number(r.value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</div>}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{r.by_name ?? '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.plan_id ? (
                      <button type="button" onClick={() => navigate(`/production/${r.plan_id}`)}
                        className={r.kind === 'qc' ? 'odoo-btn-danger' : 'odoo-btn-secondary'}>
                        {ACTION[r.kind]}
                      </button>
                    ) : <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>plan introuvable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} total={data?.total ?? 0} onPage={setPage} note={`Anomalies de production · ${periodText}`} />
        </div>
      )}
    </>
  );
}
