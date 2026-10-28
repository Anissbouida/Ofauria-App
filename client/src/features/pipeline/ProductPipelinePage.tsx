import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, ChevronRight, ChevronLeft, X, Clock,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight,
  FileText, ChefHat, Calculator, Factory, Star, Shield, Package,
  RotateCw, History, Ban, GitBranch
} from 'lucide-react';
import { productPipelineApi } from '../../api/product-pipeline.api';
import { recipesApi } from '../../api/recipes.api';
import { categoriesApi } from '../../api/categories.api';
import { usersApi } from '../../api/users.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { StagePipeline, StageProgress, type StageDef } from '../../components/purchasing/ProcessBoard';
import { StatusBanner } from '../../components/ui/StatusBanner';

/* ═══ Constants ═══ */
const STAGES = [
  { key: 'proposition', label: 'Proposition', icon: FileText, color: 'blue' },
  { key: 'recipe_development', label: 'Recette', icon: ChefHat, color: 'orange' },
  { key: 'cost_calculation', label: 'Coût', icon: Calculator, color: 'green' },
  { key: 'production_test', label: 'Test prod.', icon: Factory, color: 'purple' },
  { key: 'tasting_evaluation', label: 'Dégustation', icon: Star, color: 'yellow' },
  { key: 'admin_validation', label: 'Validation', icon: Shield, color: 'red' },
  { key: 'catalog_integration', label: 'Catalogue', icon: Package, color: 'emerald' },
] as const;

const STAGE_HINTS: Record<string, string> = {
  proposition: 'Idée soumise',
  recipe_development: 'Mise au point',
  cost_calculation: 'Calcul du revient',
  production_test: 'Essai en production',
  tasting_evaluation: 'Panel de dégustation',
  admin_validation: 'Accord direction',
  catalog_integration: 'Mise en vente',
};
// Les compteurs renvoyés par l'API utilisent des clés abrégées.
const STAGE_STAT_KEY: Record<string, string> = {
  proposition: 'stage_proposition',
  recipe_development: 'stage_recipe',
  cost_calculation: 'stage_cost',
  production_test: 'stage_test',
  tasting_evaluation: 'stage_tasting',
  admin_validation: 'stage_validation',
  catalog_integration: 'stage_integration',
};
const STAGE_DEFS: StageDef[] = STAGES.map(s => ({ key: s.key, label: s.label, hint: STAGE_HINTS[s.key], icon: s.icon }));

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
const fieldInput: React.CSSProperties = { width: '100%', fontSize: '0.875rem', padding: '8px 10px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', boxSizing: 'border-box' };
const odooTile: React.CSSProperties = { background: 'var(--odoo-bg-alt)', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 12 };

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'En cours', color: 'blue', icon: Clock },
  completed: { label: 'Terminé', color: 'green', icon: CheckCircle2 },
  rejected: { label: 'Rejeté', color: 'red', icon: XCircle },
  cancelled: { label: 'Annulé', color: 'gray', icon: Ban },
};

type Pipeline = Record<string, any>;

/** Extract error message from Axios error or plain Error */
function getErrorMsg(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message || (err as Error)?.message || 'Erreur inconnue';
}

function InlineMsg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  const isError = msg.type === 'error';
  return (
    <div className={`mt-3 p-3 rounded-xl text-sm flex items-center gap-2 ${
      isError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'
    }`}>
      {isError ? <AlertTriangle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
      {msg.text}
    </div>
  );
}

/* ═══ Main Page ═══ */
export default function ProductPipelinePage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const { data: statsData } = useQuery({
    queryKey: ['pipeline-stats'],
    queryFn: () => productPipelineApi.stats(),
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['pipelines', statusFilter, search],
    queryFn: () => productPipelineApi.list({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(search ? { search } : {}),
    }),
  });

  const pipelines = (listData?.rows || []) as Pipeline[];
  const stats = statsData || {} as Record<string, number>;
  // Filtrage par étape : fait côté client sur les pipelines déjà chargés.
  const visiblePipelines = stageFilter ? pipelines.filter(p => p.current_stage === stageFilter) : pipelines;
  const stageStats: Record<string, { count: number; sub: string }> = Object.fromEntries(
    STAGES.map(s => [s.key, { count: Number(stats[STAGE_STAT_KEY[s.key]] || 0), sub: '' }])
  );

  const openDetail = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const backToList = () => {
    setView('list');
    setSelectedId(null);
  };

  if (view === 'detail' && selectedId) {
    return <PipelineDetail id={selectedId} onBack={backToList} />;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ══════ Barre d'action ══════ */}
      <div className="odoo-control-bar">
        <button onClick={() => setShowCreate(true)} className="odoo-btn-primary">
          <Plus size={14} /> Nouveau pipeline
        </button>
        <div style={{ flex: 1 }} />
        <span className="odoo-pager">
          <strong>{visiblePipelines.length}</strong> pipeline{visiblePipelines.length > 1 ? 's' : ''}
        </span>
      </div>

      <StatusBanner tone="info" icon={GitBranch} title="Intégration de nouveaux produits en 7 étapes">
        De la proposition au catalogue : chaque produit franchit les étapes recette, coût, test de production,
        dégustation puis validation avant sa mise en vente.
      </StatusBanner>

      {/* ══════ STAT TILES (statut) ══════ */}
      <div className="odoo-stat-grid">
        {([
          { label: 'En cours', value: stats.active_count || 0, filter: 'active', icon: Clock },
          { label: 'Terminés', value: stats.completed_count || 0, filter: 'completed', icon: CheckCircle2 },
          { label: 'Rejetés', value: stats.rejected_count || 0, filter: 'rejected', icon: XCircle },
          { label: 'Total', value: stats.total_count || 0, filter: '', icon: Package },
        ] as const).map(card => {
          const Icon = card.icon;
          return (
            <button key={card.label}
              onClick={() => { setStatusFilter(card.filter); setStageFilter(null); }}
              className={`odoo-stat-card ${statusFilter === card.filter ? 'active' : ''}`}>
              <div className="odoo-stat-card-label"><Icon size={11} style={{ display: 'inline', marginRight: 4 }} />{card.label}</div>
              <div className="odoo-stat-card-value">{String(card.value)}</div>
              <div className="odoo-stat-card-sub">{card.filter === '' ? 'au total' : 'pipeline' + (Number(card.value) > 1 ? 's' : '')}</div>
            </button>
          );
        })}
      </div>

      {/* ══════ Répartition par étape (pipelines actifs) ══════ */}
      <StagePipeline
        title="Répartition par étape"
        summary="Pipelines actifs à chaque étape — cliquez pour filtrer"
        stages={STAGE_DEFS}
        stats={stageStats}
        isActive={(k) => stageFilter === k}
        onPick={(k) => { setStatusFilter('active'); setStageFilter(stageFilter === k ? null : k); }}
      />

      {/* ══════ Recherche ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher un pipeline..."
          value={search} onChange={e => setSearch(e.target.value)} className="odoo-search-input" />
        {search && (
          <span className="odoo-filter-chip">
            Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
        {stageFilter && (
          <span className="odoo-filter-chip">
            {STAGES.find(st => st.key === stageFilter)?.label}
            <span className="odoo-filter-chip-remove" onClick={() => setStageFilter(null)}>×</span>
          </span>
        )}
      </div>

      {/* ══════ Liste (table) ══════ */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : visiblePipelines.length === 0 ? (
        <StatusBanner tone="info" icon={Package} title="Aucun pipeline trouvé">
          Lancez l'intégration d'un nouveau produit avec « Nouveau pipeline ».
        </StatusBanner>
      ) : (
        <div className="odoo-section">
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>Avancement</th>
                <th>Statut</th>
                <th>Responsable</th>
                <th style={{ textAlign: 'right' }}>Créé le</th>
              </tr>
            </thead>
            <tbody>
              {visiblePipelines.map(p => {
                const stageIdx = STAGES.findIndex(st => st.key === p.current_stage);
                const sc = STATUS_CONFIG[String(p.status)] || STATUS_CONFIG.active;
                const tagColor = sc.color === 'blue' ? 'odoo-tag-blue'
                  : sc.color === 'green' ? 'odoo-tag-green'
                  : sc.color === 'red' ? 'odoo-tag-red' : 'odoo-tag-grey';
                const StatusIcon = sc.icon;
                return (
                  <tr key={String(p.id)} onClick={() => openDetail(String(p.id))} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{String(p.name)}</div>
                      {Boolean(p.description) && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(p.description)}
                        </div>
                      )}
                    </td>
                    <td>
                      {Boolean(p.category_name)
                        ? <span className="odoo-tag odoo-tag-grey">{String(p.category_name)}</span>
                        : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <StageProgress count={STAGES.length} current={stageIdx} done={p.status === 'completed'} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                        Étape {stageIdx + 1}/7 — {STAGES[stageIdx]?.label || ''}
                      </span>
                    </td>
                    <td>
                      <span className={`odoo-tag ${tagColor}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <StatusIcon size={11} />{sc.label}
                      </span>
                    </td>
                    <td>
                      {Boolean(p.responsible_first_name)
                        ? `${String(p.responsible_first_name)} ${String(p.responsible_last_name || '')}`.trim()
                        : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>
                      {Boolean(p.created_at) ? format(new Date(String(p.created_at)), 'dd MMM yyyy', { locale: fr }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreatePipelineModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['pipelines'] });
            queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
            openDetail(id);
          }}
        />
      )}
    </div>
  );
}

/* ═══ Pipeline Detail View ═══ */
function PipelineDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);

  const { data: pipeline, isLoading } = useQuery({
    queryKey: ['pipeline', id],
    queryFn: () => productPipelineApi.getById(id),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['pipeline-history', id],
    queryFn: () => productPipelineApi.history(id),
    enabled: showHistory,
  });

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const advanceMutation = useMutation({
    mutationFn: () => { setActionMsg(null); return productPipelineApi.advance(id); },
    onSuccess: () => {
      setActionMsg({ type: 'success', text: 'Étape suivante' });
      queryClient.invalidateQueries({ queryKey: ['pipeline', id] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
    },
    onError: (err: unknown) => setActionMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  const integrateMutation = useMutation({
    mutationFn: () => { setActionMsg(null); return productPipelineApi.integrate(id); },
    onSuccess: () => {
      setActionMsg({ type: 'success', text: 'Produit intégré au catalogue !' });
      queryClient.invalidateQueries({ queryKey: ['pipeline', id] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
    },
    onError: (err: unknown) => setActionMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => productPipelineApi.cancel(id, reason),
    onSuccess: () => {
      setActionMsg(null);
      queryClient.invalidateQueries({ queryKey: ['pipeline', id] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
    onError: (err: unknown) => setActionMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  if (isLoading || !pipeline) {
    return <div className="p-6 text-center text-gray-400">Chargement...</div>;
  }

  const p = pipeline as Pipeline;
  const currentStageIdx = STAGES.findIndex(s => s.key === p.current_stage);
  const isActive = p.status === 'active';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Barre d'action */}
      <div className="odoo-control-bar">
        <button onClick={onBack} className="odoo-pager-btn" title="Retour à la liste"><ChevronLeft size={16} /></button>
        <div className="odoo-breadcrumb">
          <GitBranch size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Pipeline</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{String(p.name)}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowHistory(!showHistory)} className="odoo-btn-secondary"><History size={14} /> Historique</button>
        {isActive && (
          <button onClick={() => { const reason = prompt('Raison de l\'annulation:'); if (reason !== null) cancelMutation.mutate(reason); }} className="odoo-btn-danger"><Ban size={14} /> Annuler</button>
        )}
      </div>

      {/* Frise des étapes */}
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIdx || p.status === 'completed';
            const isCurrent = idx === currentStageIdx && isActive;
            const StageIcon = stage.icon;
            const circleBg = isCompleted ? 'var(--odoo-purple)' : isCurrent ? 'var(--odoo-purple-light)' : 'var(--odoo-border)';
            const circleColor = isCompleted ? '#fff' : isCurrent ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)';
            return (
              <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: idx < STAGES.length - 1 ? 1 : '0 0 auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: circleBg, color: circleColor, boxShadow: isCurrent ? '0 0 0 2px var(--odoo-purple)' : 'none' }}>
                    {isCompleted ? <CheckCircle2 size={18} /> : <StageIcon size={16} />}
                  </div>
                  <span style={{ fontSize: '0.6875rem', marginTop: 6, fontWeight: 600, color: isCurrent ? 'var(--odoo-purple)' : isCompleted ? 'var(--odoo-text)' : 'var(--odoo-text-muted)' }}>{stage.label}</span>
                </div>
                {idx < STAGES.length - 1 && (
                  <div style={{ flex: 1, height: 2, margin: '-18px 8px 0', background: idx < currentStageIdx ? 'var(--odoo-purple)' : 'var(--odoo-border)' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bandeau statut (pipeline non actif) */}
      {!isActive && (
        <StatusBanner
          tone={p.status === 'completed' ? 'success' : p.status === 'rejected' ? 'danger' : 'neutral'}
          icon={p.status === 'completed' ? CheckCircle2 : p.status === 'rejected' ? XCircle : Ban}
          title={p.status === 'completed' ? 'Pipeline terminé — produit intégré au catalogue' : p.status === 'rejected' ? "Pipeline rejeté par l'administration" : 'Pipeline annulé'}>
          {Boolean(p.admin_comments) && String(p.admin_comments)}
        </StatusBanner>
      )}

      {/* Stage-specific content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <StageContent pipeline={p} onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['pipeline', id] });
            queryClient.invalidateQueries({ queryKey: ['pipelines'] });
            queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
          }} />
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          {/* Info card */}
          <div className="odoo-section">
            <div className="odoo-section-header">Informations</div>
            <div style={{ padding: 12, display: 'grid', gap: 8, fontSize: '0.8125rem' }}>
              <InfoRow label="Catégorie" value={String(p.category_name || '—')} />
              <InfoRow label="Responsable" value={p.responsible_first_name ? `${String(p.responsible_first_name)} ${String(p.responsible_last_name)}` : '—'} />
              <InfoRow label="Date cible" value={p.target_date ? format(new Date(String(p.target_date)), 'dd MMM yyyy', { locale: fr }) : '—'} />
              <InfoRow label="Créé par" value={p.creator_first_name ? `${String(p.creator_first_name)} ${String(p.creator_last_name)}` : '—'} />
              <InfoRow label="Créé le" value={p.created_at ? format(new Date(String(p.created_at)), 'dd/MM/yyyy HH:mm', { locale: fr }) : '—'} />
              {Boolean(p.recipe_name) && <InfoRow label="Recette" value={String(p.recipe_name)} />}
              {Boolean(p.estimated_cost) && <InfoRow label="Coût estimé" value={`${Number(p.estimated_cost).toFixed(2)} DH`} />}
              {Boolean(p.target_price) && <InfoRow label="Prix cible" value={`${Number(p.target_price).toFixed(2)} DH`} />}
              {Boolean(p.target_margin) && <InfoRow label="Marge cible" value={`${Number(p.target_margin).toFixed(1)}%`} />}
            </div>
          </div>

          {/* Action button */}
          {isActive && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', padding: 14 }}>
              {p.current_stage === 'catalog_integration' ? (
                <button
                  onClick={() => integrateMutation.mutate()}
                  disabled={integrateMutation.isPending}
                  className="odoo-btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                >
                  <Package size={16} />
                  Intégrer au catalogue
                </button>
              ) : p.current_stage === 'admin_validation' ? (
                <AdminDecisionPanel pipelineId={id} onDecided={() => {
                  queryClient.invalidateQueries({ queryKey: ['pipeline', id] });
                  queryClient.invalidateQueries({ queryKey: ['pipelines'] });
                  queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
                }} />
              ) : (
                <button
                  onClick={() => advanceMutation.mutate()}
                  disabled={advanceMutation.isPending}
                  className="odoo-btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                >
                  <ArrowRight size={16} />
                  Valider et passer à l'étape suivante
                </button>
              )}
              <InlineMsg msg={actionMsg} />
            </div>
          )}

          {/* History panel */}
          {showHistory && (
            <div className="odoo-section">
              <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><History size={14} /> Historique</div>
              <div style={{ padding: 12 }}>
              {(history as Pipeline[]).length === 0 ? (
                <p className="text-xs text-gray-400">Aucun historique</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {(history as Pipeline[]).map(h => (
                    <div key={String(h.id)} className="text-xs border-l-2 border-gray-200 pl-3 py-1">
                      <p className="font-medium text-gray-700">{String(h.action)}</p>
                      {Boolean(h.first_name) && (
                        <p className="text-gray-400">{String(h.first_name)} {String(h.last_name)}</p>
                      )}
                      <p className="text-gray-400">
                        {Boolean(h.created_at) && format(new Date(String(h.created_at)), 'dd/MM HH:mm', { locale: fr })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Info Row ═══ */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

/* ═══ Stage Content (editable forms per stage) ═══ */
function StageContent({ pipeline: p, onRefresh }: { pipeline: Pipeline; onRefresh: () => void }) {
  const stage = String(p.current_stage);
  const isActive = p.status === 'active';

  return (
    <>
      {/* Always show completed stages as read-only summaries */}
      {STAGES.map((s, idx) => {
        const currentIdx = STAGES.findIndex(st => st.key === stage);
        const isCompleted = idx < currentIdx || p.status === 'completed';
        const isCurrent = s.key === stage && isActive;

        if (!isCompleted && !isCurrent) return null;

        return (
          <div key={s.key} style={{ border: `1px solid ${isCurrent ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`, borderRadius: 4, background: 'var(--odoo-bg)', padding: 16, boxShadow: isCurrent ? 'inset 0 0 0 1px var(--odoo-purple)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <s.icon size={16} style={{ color: isCurrent ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)' }} />
              <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>{s.label}</h3>
              {isCompleted && !isCurrent && <CheckCircle2 size={14} style={{ color: 'var(--odoo-purple)' }} />}
              {isCurrent && <span className="odoo-tag odoo-tag-purple">Étape actuelle</span>}
            </div>

            {s.key === 'proposition' && <PropositionStage pipeline={p} editable={isCurrent} onRefresh={onRefresh} />}
            {s.key === 'recipe_development' && <RecipeStage pipeline={p} editable={isCurrent} onRefresh={onRefresh} />}
            {s.key === 'cost_calculation' && <CostStage pipeline={p} editable={isCurrent} onRefresh={onRefresh} />}
            {s.key === 'production_test' && <TestStage pipeline={p} editable={isCurrent} onRefresh={onRefresh} />}
            {s.key === 'tasting_evaluation' && <TastingStage pipeline={p} editable={isCurrent} onRefresh={onRefresh} />}
            {s.key === 'admin_validation' && <ValidationSummary pipeline={p} />}
            {s.key === 'catalog_integration' && Boolean(p.product_id) && <CatalogSummary pipeline={p} />}
          </div>
        );
      })}
    </>
  );
}

/* ═══ Stage 1: Proposition ═══ */
function PropositionStage({ pipeline: p, editable, onRefresh }: { pipeline: Pipeline; editable: boolean; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(String(p.name || ''));
  const [description, setDescription] = useState(String(p.description || ''));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'proposition', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Mis à jour' }); setEditing(false); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  if (!editable || !editing) {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="text-gray-500">Nom:</span> <span className="font-medium">{String(p.name)}</span></p>
        <p><span className="text-gray-500">Description:</span> {String(p.description || '—')}</p>
        <p><span className="text-gray-500">Catégorie:</span> {String(p.category_name || '—')}</p>
        <p><span className="text-gray-500">Responsable:</span> {p.responsible_first_name ? `${String(p.responsible_first_name)} ${String(p.responsible_last_name)}` : '—'}</p>
        <p><span className="text-gray-500">Date cible:</span> {p.target_date ? format(new Date(String(p.target_date)), 'dd MMM yyyy', { locale: fr }) : '—'}</p>
        {editable && (
          <button onClick={() => setEditing(true)} className="odoo-btn-secondary" style={{ marginTop: 8, padding: '4px 8px', fontSize: '0.75rem' }}>
            Modifier
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label style={fieldLabel}>Nom du produit *</label>
        <input value={name} onChange={e => setName(e.target.value)}
          style={fieldInput} />
      </div>
      <div>
        <label style={fieldLabel}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          style={fieldInput} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => updateMutation.mutate({ name, description })}
          className="odoo-btn-primary">
          Sauvegarder
        </button>
        <button onClick={() => setEditing(false)}
          className="odoo-btn-secondary">
          Annuler
        </button>
      </div>
      <InlineMsg msg={msg} />
    </div>
  );
}

/* ═══ Stage 2: Recipe Development ═══ */
function RecipeStage({ pipeline: p, editable, onRefresh }: { pipeline: Pipeline; editable: boolean; onRefresh: () => void }) {
  const [recipeId, setRecipeId] = useState(String(p.recipe_id || ''));
  const [notes, setNotes] = useState(String(p.recipe_notes || ''));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: recipesData = [] } = useQuery({
    queryKey: ['recipes-list'],
    queryFn: () => recipesApi.list(),
  });
  const recipes = recipesData as Pipeline[];

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'recipe_development', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Recette assignée' }); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="space-y-3">
      {p.recipe_name ? (
        <div className="text-sm">
          <p><span className="text-gray-500">Recette assignée:</span> <span className="font-medium">{String(p.recipe_name)}</span></p>
          {Boolean(p.recipe_total_cost) && <p><span className="text-gray-500">Coût recette:</span> <span className="font-medium">{Number(p.recipe_total_cost).toFixed(2)} DH</span></p>}
        </div>
      ) : (
        <p className="text-sm text-gray-400">Aucune recette assignée</p>
      )}

      {Boolean(p.recipe_notes) && (
        <p className="text-sm"><span className="text-gray-500">Notes:</span> {String(p.recipe_notes)}</p>
      )}

      {editable && (
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <div>
            <label style={fieldLabel}>Assigner une recette</label>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)}
              style={fieldInput}>
              <option value="">Choisir une recette...</option>
              {recipes.map(r => (
                <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Notes de développement</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={fieldInput} />
          </div>
          <button
            onClick={() => updateMutation.mutate({ recipeId: recipeId || undefined, recipeNotes: notes || undefined })}
            disabled={updateMutation.isPending}
            className="odoo-btn-primary">
            Sauvegarder
          </button>
          <InlineMsg msg={msg} />
        </div>
      )}
    </div>
  );
}

/* ═══ Stage 3: Cost Calculation ═══ */
function CostStage({ pipeline: p, editable, onRefresh }: { pipeline: Pipeline; editable: boolean; onRefresh: () => void }) {
  const [estimatedCost, setEstimatedCost] = useState(String(p.estimated_cost || p.recipe_total_cost || ''));
  const [targetPrice, setTargetPrice] = useState(String(p.target_price || ''));
  const [targetMargin, setTargetMargin] = useState(String(p.target_margin || ''));
  const [costNotes, setCostNotes] = useState(String(p.cost_notes || ''));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const cost = parseFloat(estimatedCost) || 0;
  const price = parseFloat(targetPrice) || 0;
  const calculatedMargin = price > 0 ? ((price - cost) / price * 100) : 0;

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'cost_calculation', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Coûts mis à jour' }); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div style={{ ...odooTile, textAlign: 'center' }}>
          <p className="text-xs text-gray-500">Coût estimé</p>
          <p className="text-lg font-bold text-gray-900">{cost.toFixed(2)} DH</p>
        </div>
        <div style={{ ...odooTile, textAlign: 'center' }}>
          <p className="text-xs text-gray-500">Prix cible</p>
          <p className="text-lg font-bold text-gray-900">{price.toFixed(2)} DH</p>
        </div>
        <div className={`rounded-lg p-3 text-center ${calculatedMargin >= 30 ? 'bg-green-50' : calculatedMargin >= 15 ? 'bg-amber-50' : 'bg-red-50'}`}>
          <p className="text-xs text-gray-500">Marge</p>
          <p className={`text-lg font-bold ${calculatedMargin >= 30 ? 'text-green-700' : calculatedMargin >= 15 ? 'text-amber-700' : 'text-red-700'}`}>
            {calculatedMargin.toFixed(1)}%
          </p>
        </div>
      </div>

      {Boolean(p.cost_notes) && !editable && (
        <p className="text-sm"><span className="text-gray-500">Notes:</span> {String(p.cost_notes)}</p>
      )}

      {Boolean(p.cost_validated) && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 size={14} />
          Validé par {String(p.cost_validator_first_name || '')} {String(p.cost_validator_last_name || '')}
        </div>
      )}

      {editable && (
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label style={fieldLabel}>Coût estimé (DH) *</label>
              <input type="number" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)}
                style={fieldInput} />
            </div>
            <div>
              <label style={fieldLabel}>Prix cible (DH) *</label>
              <input type="number" step="0.01" value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
                style={fieldInput} />
            </div>
            <div>
              <label style={fieldLabel}>Marge cible (%)</label>
              <input type="number" step="0.1" value={targetMargin} onChange={e => setTargetMargin(e.target.value)}
                style={fieldInput} />
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Notes</label>
            <textarea value={costNotes} onChange={e => setCostNotes(e.target.value)} rows={2}
              style={fieldInput} />
          </div>
          <button
            onClick={() => updateMutation.mutate({
              estimatedCost: parseFloat(estimatedCost) || undefined,
              targetPrice: parseFloat(targetPrice) || undefined,
              targetMargin: parseFloat(targetMargin) || undefined,
              costNotes: costNotes || undefined,
            })}
            disabled={updateMutation.isPending}
            className="odoo-btn-primary">
            Sauvegarder
          </button>
          <InlineMsg msg={msg} />
        </div>
      )}
    </div>
  );
}

/* ═══ Stage 4: Production Test ═══ */
function TestStage({ pipeline: p, editable, onRefresh }: { pipeline: Pipeline; editable: boolean; onRefresh: () => void }) {
  const [testDate, setTestDate] = useState(String(p.test_date || '').slice(0, 10));
  const [testQuantity, setTestQuantity] = useState(String(p.test_quantity || ''));
  const [testYield, setTestYield] = useState(String(p.test_yield || ''));
  const [testObservations, setTestObservations] = useState(String(p.test_observations || ''));
  const [recipeRevised, setRecipeRevised] = useState(Boolean(p.recipe_revised));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'production_test', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Test mis à jour' }); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  if (!editable) {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="text-gray-500">Date de test:</span> {p.test_date ? format(new Date(String(p.test_date)), 'dd MMM yyyy', { locale: fr }) : '—'}</p>
        <p><span className="text-gray-500">Quantité testée:</span> {p.test_quantity ? `${String(p.test_quantity)} unités` : '—'}</p>
        <p><span className="text-gray-500">Rendement:</span> {p.test_yield ? `${String(p.test_yield)} unités` : '—'}</p>
        <p><span className="text-gray-500">Observations:</span> {String(p.test_observations || '—')}</p>
        {Boolean(p.recipe_revised) && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full">
            <RotateCw size={12} /> Recette révisée
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label style={fieldLabel}>Date de test *</label>
          <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)}
            style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>Quantité testée *</label>
          <input type="number" step="0.01" value={testQuantity} onChange={e => setTestQuantity(e.target.value)}
            style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>Rendement obtenu</label>
          <input type="number" step="0.01" value={testYield} onChange={e => setTestYield(e.target.value)}
            style={fieldInput} />
        </div>
      </div>
      <div>
        <label style={fieldLabel}>Observations *</label>
        <textarea value={testObservations} onChange={e => setTestObservations(e.target.value)} rows={3}
          style={fieldInput} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={recipeRevised} onChange={e => setRecipeRevised(e.target.checked)}
          className="rounded border-gray-300" />
        Recette révisée suite au test
      </label>
      <button
        onClick={() => updateMutation.mutate({
          testDate: testDate || undefined,
          testQuantity: parseFloat(testQuantity) || undefined,
          testYield: parseFloat(testYield) || undefined,
          testObservations: testObservations || undefined,
          recipeRevised,
        })}
        disabled={updateMutation.isPending}
        className="odoo-btn-primary">
        Sauvegarder
      </button>
      <InlineMsg msg={msg} />
    </div>
  );
}

/* ═══ Stage 5: Tasting & Evaluation ═══ */
function TastingStage({ pipeline: p, editable, onRefresh }: { pipeline: Pipeline; editable: boolean; onRefresh: () => void }) {
  const scores = (p.tasting_scores || {}) as Record<string, number>;
  const [tastingDate, setTastingDate] = useState(String(p.tasting_date || '').slice(0, 10));
  const [visual, setVisual] = useState(scores.visual || 0);
  const [taste, setTaste] = useState(scores.taste || 0);
  const [texture, setTexture] = useState(scores.texture || 0);
  const [originality, setOriginality] = useState(scores.originality || 0);
  const [comments, setComments] = useState(String(p.tasting_comments || ''));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const overall = (visual + taste + texture + originality) / 4;

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'tasting_evaluation', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Scores mis à jour' }); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  const criteria = [
    { key: 'visual', label: 'Visuel', value: visual, setter: setVisual, emoji: '👁' },
    { key: 'taste', label: 'Goût', value: taste, setter: setTaste, emoji: '👅' },
    { key: 'texture', label: 'Texture', value: texture, setter: setTexture, emoji: '🤲' },
    { key: 'originality', label: 'Originalité', value: originality, setter: setOriginality, emoji: '💡' },
  ];

  return (
    <div className="space-y-4">
      {/* Score grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {criteria.map(c => (
          <div key={c.key} style={{ ...odooTile, textAlign: 'center' }}>
            <p className="text-lg mb-1">{c.emoji}</p>
            <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            {editable ? (
              <input
                type="number" min="0" max="10" step="0.5"
                value={c.value || ''} onChange={e => c.setter(parseFloat(e.target.value) || 0)}
                style={{ ...fieldInput, width: 64, margin: '4px auto 0', textAlign: 'center', fontSize: '1.125rem', fontWeight: 700 }}
              />
            ) : (
              <p className="text-xl font-bold text-gray-900 mt-1">{c.value || '—'}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">/10</p>
          </div>
        ))}
      </div>

      {/* Overall score */}
      <div className={`text-center py-3 rounded-lg ${
        overall >= 7 ? 'bg-green-50' : overall >= 5 ? 'bg-amber-50' : overall > 0 ? 'bg-red-50' : 'bg-gray-50'
      }`}>
        <p className="text-xs text-gray-500">Score global</p>
        <p className={`text-2xl font-bold ${
          overall >= 7 ? 'text-green-700' : overall >= 5 ? 'text-amber-700' : overall > 0 ? 'text-red-700' : 'text-gray-400'
        }`}>
          {overall > 0 ? overall.toFixed(1) : '—'}/10
        </p>
      </div>

      {editable && (
        <>
          <div>
            <label style={fieldLabel}>Date de dégustation</label>
            <input type="date" value={tastingDate} onChange={e => setTastingDate(e.target.value)}
              style={fieldInput} />
          </div>
          <div>
            <label style={fieldLabel}>Commentaires</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
              style={fieldInput} />
          </div>
          <button
            onClick={() => updateMutation.mutate({
              tastingDate: tastingDate || undefined,
              tastingScores: { visual, taste, texture, originality, overall },
              tastingComments: comments || undefined,
            })}
            disabled={updateMutation.isPending}
            className="odoo-btn-primary">
            Sauvegarder les scores
          </button>
          <InlineMsg msg={msg} />
        </>
      )}

      {!editable && Boolean(p.tasting_comments) && (
        <p className="text-sm"><span className="text-gray-500">Commentaires:</span> {String(p.tasting_comments)}</p>
      )}
    </div>
  );
}

/* ═══ Stage 6: Validation Summary (read-only recap) ═══ */
function ValidationSummary({ pipeline: p }: { pipeline: Pipeline }) {
  const scores = (p.tasting_scores || {}) as Record<string, number>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-500 mb-2">Récapitulatif du pipeline pour validation finale:</p>
      <div className="grid grid-cols-2 gap-3">
        <div style={odooTile}>
          <p className="text-xs text-gray-500 font-medium">Coût / Prix / Marge</p>
          <p className="font-medium">
            {p.estimated_cost ? `${Number(p.estimated_cost).toFixed(2)} DH` : '—'} / {p.target_price ? `${Number(p.target_price).toFixed(2)} DH` : '—'} / {p.target_margin ? `${Number(p.target_margin).toFixed(1)}%` : '—'}
          </p>
        </div>
        <div style={odooTile}>
          <p className="text-xs text-gray-500 font-medium">Score dégustation</p>
          <p className="font-medium">{scores.overall ? `${Number(scores.overall).toFixed(1)}/10` : '—'}</p>
        </div>
        <div style={odooTile}>
          <p className="text-xs text-gray-500 font-medium">Test production</p>
          <p className="font-medium">{p.test_yield ? `Rendement: ${String(p.test_yield)}` : '—'}</p>
        </div>
        <div style={odooTile}>
          <p className="text-xs text-gray-500 font-medium">Recette</p>
          <p className="font-medium">{String(p.recipe_name || '—')}</p>
        </div>
      </div>

      {Boolean(p.admin_decision) && (
        <div className={`mt-3 p-3 rounded-lg ${
          p.admin_decision === 'approved' ? 'bg-green-50 text-green-800' :
          p.admin_decision === 'rejected' ? 'bg-red-50 text-red-800' :
          'bg-amber-50 text-amber-800'
        }`}>
          <p className="font-medium">
            Décision: {p.admin_decision === 'approved' ? 'Approuvé' : p.admin_decision === 'rejected' ? 'Rejeté' : 'Révision demandée'}
          </p>
          {Boolean(p.admin_comments) && <p className="text-sm mt-1">{String(p.admin_comments)}</p>}
          {Boolean(p.admin_first_name) && (
            <p className="text-xs mt-1 opacity-70">
              Par {String(p.admin_first_name)} {String(p.admin_last_name)}
              {Boolean(p.admin_decided_at) && ` — ${format(new Date(String(p.admin_decided_at)), 'dd/MM/yyyy HH:mm', { locale: fr })}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══ Stage 7: Catalog Summary ═══ */
function CatalogSummary({ pipeline: p }: { pipeline: Pipeline }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <CheckCircle2 size={20} className="text-emerald-500" />
      <div>
        <p className="font-medium text-emerald-800">Produit intégré au catalogue</p>
        {Boolean(p.integrated_at) && (
          <p className="text-xs text-gray-500">
            Le {format(new Date(String(p.integrated_at)), 'dd/MM/yyyy à HH:mm', { locale: fr })}
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══ Admin Decision Panel ═══ */
function AdminDecisionPanel({ pipelineId, onDecided }: { pipelineId: string; onDecided: () => void }) {
  const [comments, setComments] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const decisionMutation = useMutation({
    mutationFn: ({ decision, comments }: { decision: string; comments: string }) => {
      setMsg(null);
      return productPipelineApi.adminDecision(pipelineId, decision, comments);
    },
    onSuccess: (_, vars) => {
      const labels: Record<string, string> = { approved: 'approuvé', rejected: 'rejeté', revision_requested: 'renvoyé pour révision' };
      setMsg({ type: 'success', text: `Pipeline ${labels[vars.decision]}` });
      onDecided();
    },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="space-y-3">
      <div>
        <label style={fieldLabel}>Commentaires de décision</label>
        <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
          style={fieldInput}
          placeholder="Motif de la décision..." />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => decisionMutation.mutate({ decision: 'approved', comments })}
          disabled={decisionMutation.isPending}
          className="odoo-btn-primary" style={{ justifyContent: 'center' }}
        >
          <CheckCircle2 size={14} />
          Approuver
        </button>
        <button
          onClick={() => decisionMutation.mutate({ decision: 'revision_requested', comments })}
          disabled={decisionMutation.isPending}
          className="odoo-btn-secondary" style={{ justifyContent: 'center' }}
        >
          <RotateCw size={14} />
          Réviser
        </button>
        <button
          onClick={() => decisionMutation.mutate({ decision: 'rejected', comments })}
          disabled={decisionMutation.isPending}
          className="odoo-btn-danger" style={{ justifyContent: 'center' }}
        >
          <XCircle size={14} />
          Rejeter
        </button>
      </div>
      <InlineMsg msg={msg} />
    </div>
  );
}

/* ═══ Create Pipeline Modal ═══ */
function CreatePipelineModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
  });
  const users = (usersData?.rows || usersData || []) as Pipeline[];

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      setMsg(null);
      return productPipelineApi.create(data);
    },
    onSuccess: (result) => {
      onCreated(result.id);
    },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="odoo-scope" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <GitBranch size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Pipeline</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">Nouveau</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div>
            <label style={fieldLabel}>Nom du produit *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={fieldInput}
              placeholder="Ex: Croissant aux amandes" />
          </div>

          <div>
            <label style={fieldLabel}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              style={fieldInput}
              placeholder="Description du nouveau produit..." />
          </div>

          <div>
            <label style={fieldLabel}>Catégorie *</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} required
              style={fieldInput}>
              <option value="">Choisir une catégorie...</option>
              {(categories as Pipeline[]).map(c => (
                <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={fieldLabel}>Responsable *</label>
            <select value={responsibleUserId} onChange={e => setResponsibleUserId(e.target.value)} required
              style={fieldInput}>
              <option value="">Choisir un responsable...</option>
              {users.filter(u => ['baker', 'pastry_chef', 'viennoiserie'].includes(String(u.role))).map(u => (
                <option key={String(u.id)} value={String(u.id)}>
                  {String(u.firstName || u.first_name)} {String(u.lastName || u.last_name)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={fieldLabel}>Date cible</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              style={fieldInput} />
          </div>
        </div>

        <div style={{ padding: '0 16px' }}><InlineMsg msg={msg} /></div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button
            onClick={() => createMutation.mutate({
              name,
              description: description || undefined,
              categoryId: categoryId ? parseInt(categoryId) : undefined,
              responsibleUserId: responsibleUserId || undefined,
              targetDate: targetDate || undefined,
            })}
            disabled={!name || !categoryId || !responsibleUserId || createMutation.isPending}
            className="odoo-btn-primary"
          >
            Créer le pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
