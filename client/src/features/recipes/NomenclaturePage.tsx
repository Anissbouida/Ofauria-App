import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Layers } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import NomenclatureEditor, { type FormatKpi } from './NomenclatureEditor';

const dh = (v: number) => `${v.toFixed(2)} DH`;

export default function NomenclaturePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [kpi, setKpi] = useState<FormatKpi | null>(null);

  const { data: recipe, isLoading } = useQuery({ queryKey: ['recipe', id], queryFn: () => recipesApi.getById(id!), enabled: !!id });

  if (isLoading) {
    return <div className="odoo-scope"><div style={{ padding: '1.5rem' }} className="text-sm text-gray-400">Chargement…</div></div>;
  }
  if (!recipe) {
    return (
      <div className="odoo-scope">
        <div style={{ padding: '1.5rem' }} className="text-sm">
          Recette introuvable. <button onClick={() => navigate('/recipes?tab=product')} className="text-amber-600 hover:underline">Retour aux recettes</button>
        </div>
      </div>
    );
  }

  const margeColor = kpi && kpi.margePct >= 50 ? '#28a745' : kpi && kpi.margePct >= 30 ? '#b85d1a' : '#dc3545';

  return (
    <div className="odoo-scope">
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/recipes?tab=product')} className="odoo-btn-secondary inline-flex items-center gap-1.5" title="Retour aux recettes">
          <ArrowLeft size={15} /> Retour aux recettes
        </button>
        <div className="odoo-breadcrumb" style={{ marginLeft: '0.75rem' }}>
          <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/recipes?tab=product')}>Recettes</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{recipe.name}</span>
        </div>
      </div>

      {/* Bandeau KPI (rendement / coût / prix / marge du format affiché) */}
      <div className="odoo-smart-button-row">
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{kpi ? kpi.rendement : '—'}</div>
          <div className="odoo-smart-button-label"><Layers size={11} /> Rendement {kpi?.contenantNom ? `(${kpi.contenantNom})` : '(pièces/fournée)'}</div>
        </div>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{kpi ? dh(kpi.coutPiece) : '—'}</div>
          <div className="odoo-smart-button-label">Coût / pièce</div>
        </div>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{kpi ? dh(kpi.prix) : '—'}</div>
          <div className="odoo-smart-button-label">Prix / pièce</div>
        </div>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value" style={{ color: kpi ? margeColor : undefined }}>{kpi ? `${kpi.margePct.toFixed(1)}%` : '—'}</div>
          <div className="odoo-smart-button-label">Marge</div>
        </div>
      </div>

      <div style={{ padding: '1.25rem', maxWidth: 1320, margin: '0 auto' }}>
        <div className="flex items-center gap-2 mb-1">
          <Layers size={20} style={{ color: 'var(--theme-accent)' }} />
          <h1 className="text-xl font-semibold" style={{ color: 'var(--theme-text-strong)' }}>{recipe.name}</h1>
          {recipe.product_name && <span className="text-sm text-gray-500">· {recipe.product_name}</span>}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          La composition est définie <strong>par format (contenant)</strong> : chaque contenant a sa propre liste de quantités. Sélectionne ou ajoute un format ci-dessous.
        </p>

        <NomenclatureEditor recipeId={recipe.id} onFinance={setKpi} onCancel={() => navigate('/recipes?tab=product')} onSaved={() => qc.invalidateQueries({ queryKey: ['recipe', id] })} />
      </div>
    </div>
  );
}
