import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, ChevronRight, ChevronLeft, X, Clock,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight,
  FileText, ChefHat, Calculator, Factory, Star, Shield, Package,
  RotateCw, History, Ban
} from 'lucide-react';
import { productPipelineApi } from '../../api/product-pipeline.api';
import { recipesApi } from '../../api/recipes.api';
import { categoriesApi } from '../../api/categories.api';
import { usersApi } from '../../api/users.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'En cours', color: 'blue', icon: Clock },
  completed: { label: 'Terminé', color: 'green', icon: CheckCircle2 },
  rejected: { label: 'Rejeté', color: 'red', icon: XCircle },
  cancelled: { label: 'Annulé', color: 'gray', icon: Ban },
};

type Pipeline = Record<string, unknown>;

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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Produits</h1>
          <p className="text-sm text-gray-500 mt-1">
            Workflow d'intégration de nouveaux produits en 7 étapes
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          <Plus size={18} />
          Nouveau pipeline
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'En cours', value: stats.active_count || 0, color: 'blue', filter: 'active' },
          { label: 'Terminés', value: stats.completed_count || 0, color: 'green', filter: 'completed' },
          { label: 'Rejetés', value: stats.rejected_count || 0, color: 'red', filter: 'rejected' },
          { label: 'Total', value: stats.total_count || 0, color: 'gray', filter: '' },
        ].map(card => (
          <button
            key={card.label}
            onClick={() => setStatusFilter(card.filter)}
            className={`p-4 rounded-xl border transition-all text-left ${
              statusFilter === card.filter
                ? `bg-${card.color}-50 border-${card.color}-200 ring-2 ring-${card.color}-200`
                : 'bg-white border-gray-100 hover:border-gray-200'
            }`}
          >
            <p className="text-xs text-gray-500 font-medium">{card.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{String(card.value)}</p>
          </button>
        ))}
      </div>

      {/* Stage funnel (active pipelines) */}
      {statusFilter === 'active' && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Répartition par étape</h3>
          <div className="flex items-center gap-1 overflow-x-auto">
            {STAGES.map((stage, idx) => {
              const count = stats[`stage_${stage.key === 'recipe_development' ? 'recipe' : stage.key === 'cost_calculation' ? 'cost' : stage.key === 'production_test' ? 'test' : stage.key === 'tasting_evaluation' ? 'tasting' : stage.key === 'admin_validation' ? 'validation' : stage.key === 'catalog_integration' ? 'integration' : stage.key}`] || 0;
              const StageIcon = stage.icon;
              return (
                <div key={stage.key} className="flex items-center">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-${stage.color}-50 min-w-[110px]`}>
                    <StageIcon size={14} className={`text-${stage.color}-600`} />
                    <div>
                      <p className="text-xs font-medium text-gray-700">{stage.label}</p>
                      <p className={`text-sm font-bold text-${stage.color}-700`}>{String(count)}</p>
                    </div>
                  </div>
                  {idx < STAGES.length - 1 && <ChevronRight size={14} className="text-gray-300 mx-1 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un pipeline..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : pipelines.length === 0 ? (
        <div className="text-center py-12">
          <Package size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Aucun pipeline trouvé</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map(p => (
            <PipelineCard key={String(p.id)} pipeline={p} onClick={() => openDetail(String(p.id))} />
          ))}
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

/* ═══ Pipeline Card ═══ */
function PipelineCard({ pipeline: p, onClick }: { pipeline: Pipeline; onClick: () => void }) {
  const stageIdx = STAGES.findIndex(s => s.key === p.current_stage);
  const statusConf = STATUS_CONFIG[String(p.status)] || STATUS_CONFIG.active;
  const StatusIcon = statusConf.icon;

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-sm transition-all text-left"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{String(p.name)}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${statusConf.color}-50 text-${statusConf.color}-700`}>
              <StatusIcon size={12} />
              {statusConf.label}
            </span>
          </div>
          {Boolean(p.description) && (
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{String(p.description)}</p>
          )}
        </div>
        <div className="text-right text-xs text-gray-400">
          {Boolean(p.created_at) && format(new Date(String(p.created_at)), 'dd MMM yyyy', { locale: fr })}
        </div>
      </div>

      {/* Mini stepper */}
      <div className="flex items-center gap-0.5">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < stageIdx;
          const isCurrent = idx === stageIdx;
          return (
            <div key={stage.key} className="flex items-center flex-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  isCompleted ? 'bg-green-400' :
                  isCurrent ? `bg-${stage.color}-400` :
                  'bg-gray-100'
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">
          Étape {stageIdx + 1}/7 — {STAGES[stageIdx]?.label || ''}
        </span>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {Boolean(p.responsible_first_name) && (
            <span>{String(p.responsible_first_name)} {String(p.responsible_last_name)}</span>
          )}
          {Boolean(p.category_name) && (
            <span className="px-2 py-0.5 bg-gray-100 rounded-full">{String(p.category_name)}</span>
          )}
        </div>
      </div>
    </button>
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{String(p.name)}</h1>
          {Boolean(p.description) && <p className="text-sm text-gray-500">{String(p.description)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            <History size={14} />
            Historique
          </button>
          {isActive && (
            <button
              onClick={() => {
                const reason = prompt('Raison de l\'annulation:');
                if (reason !== null) cancelMutation.mutate(reason);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-xl hover:bg-red-50"
            >
              <Ban size={14} />
              Annuler
            </button>
          )}
        </div>
      </div>

      {/* Visual Stepper */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIdx || p.status === 'completed';
            const isCurrent = idx === currentStageIdx && isActive;
            const isFuture = idx > currentStageIdx;
            const StageIcon = stage.icon;

            return (
              <div key={stage.key} className="flex items-center flex-1 last:flex-initial">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      isCompleted ? 'bg-green-100 text-green-600' :
                      isCurrent ? `bg-${stage.color}-100 text-${stage.color}-600 ring-2 ring-${stage.color}-300` :
                      'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 size={20} /> : <StageIcon size={18} />}
                  </div>
                  <span className={`text-xs mt-1.5 font-medium ${
                    isCurrent ? `text-${stage.color}-700` :
                    isCompleted ? 'text-green-700' :
                    'text-gray-400'
                  }`}>
                    {stage.label}
                  </span>
                </div>
                {idx < STAGES.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mt-[-18px] ${
                    idx < currentStageIdx ? 'bg-green-300' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status banner for non-active */}
      {!isActive && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${
          p.status === 'completed' ? 'bg-green-50 text-green-800' :
          p.status === 'rejected' ? 'bg-red-50 text-red-800' :
          'bg-gray-50 text-gray-800'
        }`}>
          {p.status === 'completed' && <CheckCircle2 size={20} />}
          {p.status === 'rejected' && <XCircle size={20} />}
          {p.status === 'cancelled' && <Ban size={20} />}
          <div>
            <p className="font-medium">
              {p.status === 'completed' && 'Pipeline terminé — produit intégré au catalogue'}
              {p.status === 'rejected' && 'Pipeline rejeté par l\'administration'}
              {p.status === 'cancelled' && 'Pipeline annulé'}
            </p>
            {Boolean(p.admin_comments) && <p className="text-sm mt-0.5 opacity-80">{String(p.admin_comments)}</p>}
          </div>
        </div>
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
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Informations</h3>
            <div className="space-y-2 text-sm">
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
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              {p.current_stage === 'catalog_integration' ? (
                <button
                  onClick={() => integrateMutation.mutate()}
                  disabled={integrateMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
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
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <History size={14} />
                Historique
              </h3>
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
          <div key={s.key} className={`bg-white rounded-xl border p-5 ${
            isCurrent ? `border-${s.color}-200 ring-1 ring-${s.color}-100` : 'border-gray-100'
          }`}>
            <div className="flex items-center gap-2 mb-4">
              <s.icon size={18} className={isCurrent ? `text-${s.color}-600` : 'text-green-600'} />
              <h3 className="font-semibold text-gray-900">{s.label}</h3>
              {isCompleted && !isCurrent && (
                <CheckCircle2 size={14} className="text-green-500" />
              )}
              {isCurrent && (
                <span className={`text-xs px-2 py-0.5 bg-${s.color}-50 text-${s.color}-700 rounded-full font-medium`}>
                  Étape actuelle
                </span>
              )}
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
    mutationFn: (data: Record<string, unknown>) => {
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
          <button onClick={() => setEditing(true)} className="text-primary-600 text-xs hover:underline mt-2">
            Modifier
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Nom du produit *</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => updateMutation.mutate({ name, description })}
          className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700">
          Sauvegarder
        </button>
        <button onClick={() => setEditing(false)}
          className="px-4 py-2 border border-gray-200 rounded-xl text-sm hover:bg-gray-50">
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
    mutationFn: (data: Record<string, unknown>) => {
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Assigner une recette</label>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Choisir une recette...</option>
              {recipes.map(r => (
                <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes de développement</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <button
            onClick={() => updateMutation.mutate({ recipeId: recipeId || undefined, recipeNotes: notes || undefined })}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 disabled:opacity-50">
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
    mutationFn: (data: Record<string, unknown>) => {
      setMsg(null);
      return productPipelineApi.updateStageData(String(p.id), { stage: 'cost_calculation', ...data });
    },
    onSuccess: () => { setMsg({ type: 'success', text: 'Coûts mis à jour' }); onRefresh(); },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500">Coût estimé</p>
          <p className="text-lg font-bold text-gray-900">{cost.toFixed(2)} DH</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
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
              <label className="block text-xs font-medium text-gray-500 mb-1">Coût estimé (DH) *</label>
              <input type="number" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Prix cible (DH) *</label>
              <input type="number" step="0.01" value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Marge cible (%)</label>
              <input type="number" step="0.1" value={targetMargin} onChange={e => setTargetMargin(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={costNotes} onChange={e => setCostNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <button
            onClick={() => updateMutation.mutate({
              estimatedCost: parseFloat(estimatedCost) || undefined,
              targetPrice: parseFloat(targetPrice) || undefined,
              targetMargin: parseFloat(targetMargin) || undefined,
              costNotes: costNotes || undefined,
            })}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 disabled:opacity-50">
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
    mutationFn: (data: Record<string, unknown>) => {
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
          <label className="block text-xs font-medium text-gray-500 mb-1">Date de test *</label>
          <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Quantité testée *</label>
          <input type="number" step="0.01" value={testQuantity} onChange={e => setTestQuantity(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Rendement obtenu</label>
          <input type="number" step="0.01" value={testYield} onChange={e => setTestYield(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Observations *</label>
        <textarea value={testObservations} onChange={e => setTestObservations(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
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
        className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 disabled:opacity-50">
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
    mutationFn: (data: Record<string, unknown>) => {
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
          <div key={c.key} className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-lg mb-1">{c.emoji}</p>
            <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            {editable ? (
              <input
                type="number" min="0" max="10" step="0.5"
                value={c.value || ''} onChange={e => c.setter(parseFloat(e.target.value) || 0)}
                className="w-16 mx-auto mt-1 px-2 py-1 border border-gray-200 rounded-lg text-center text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary-500"
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Date de dégustation</label>
            <input type="date" value={tastingDate} onChange={e => setTastingDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Commentaires</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <button
            onClick={() => updateMutation.mutate({
              tastingDate: tastingDate || undefined,
              tastingScores: { visual, taste, texture, originality, overall },
              tastingComments: comments || undefined,
            })}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 disabled:opacity-50">
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
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 font-medium">Coût / Prix / Marge</p>
          <p className="font-medium">
            {p.estimated_cost ? `${Number(p.estimated_cost).toFixed(2)} DH` : '—'} / {p.target_price ? `${Number(p.target_price).toFixed(2)} DH` : '—'} / {p.target_margin ? `${Number(p.target_margin).toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 font-medium">Score dégustation</p>
          <p className="font-medium">{scores.overall ? `${Number(scores.overall).toFixed(1)}/10` : '—'}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 font-medium">Test production</p>
          <p className="font-medium">{p.test_yield ? `Rendement: ${String(p.test_yield)}` : '—'}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
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
        <label className="block text-xs font-medium text-gray-500 mb-1">Commentaires de décision</label>
        <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Motif de la décision..." />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => decisionMutation.mutate({ decision: 'approved', comments })}
          disabled={decisionMutation.isPending}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          <CheckCircle2 size={14} />
          Approuver
        </button>
        <button
          onClick={() => decisionMutation.mutate({ decision: 'revision_requested', comments })}
          disabled={decisionMutation.isPending}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
        >
          <RotateCw size={14} />
          Réviser
        </button>
        <button
          onClick={() => decisionMutation.mutate({ decision: 'rejected', comments })}
          disabled={decisionMutation.isPending}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
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
    mutationFn: (data: Record<string, unknown>) => {
      setMsg(null);
      return productPipelineApi.create(data);
    },
    onSuccess: (result) => {
      onCreated(result.id);
    },
    onError: (err: unknown) => setMsg({ type: 'error', text: getErrorMsg(err) }),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold">Nouveau pipeline produit</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nom du produit *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Ex: Croissant aux amandes" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Description du nouveau produit..." />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Catégorie *</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Choisir une catégorie...</option>
              {(categories as Pipeline[]).map(c => (
                <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Responsable *</label>
            <select value={responsibleUserId} onChange={e => setResponsibleUserId(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Choisir un responsable...</option>
              {users.filter(u => ['baker', 'pastry_chef', 'viennoiserie'].includes(String(u.role))).map(u => (
                <option key={String(u.id)} value={String(u.id)}>
                  {String(u.firstName || u.first_name)} {String(u.lastName || u.last_name)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date cible</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>

        <div className="px-5"><InlineMsg msg={msg} /></div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={() => createMutation.mutate({
              name,
              description: description || undefined,
              categoryId: categoryId ? parseInt(categoryId) : undefined,
              responsibleUserId: responsibleUserId || undefined,
              targetDate: targetDate || undefined,
            })}
            disabled={!name || !categoryId || !responsibleUserId || createMutation.isPending}
            className="px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            Créer le pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
