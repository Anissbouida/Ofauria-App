import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { BonSortiePanel } from './BonSortiePanel';

/**
 * Page autonome du bon de sortie, vue magasinier : /stock/bsi/:id (id = plan).
 * La logique reelle est dans BonSortiePanel (reutilise aussi inline dans PlanDetailPage).
 */
export default function BonSortiePrelevementPage() {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isChef = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');
  // Admin et manager ont aussi le privilege magasinier (peuvent prendre en charge la preparation)
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');

  if (!planId) return null;

  return (
    <div className="odoo-scope space-y-4 max-w-5xl mx-auto pb-32" style={{ padding: '1rem' }}>
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/stock?tab=bons')} className="odoo-pager-btn" title="Retour aux bons de sortie">
          <ArrowLeft size={14} />
        </button>
        <h1 className="odoo-form-title" style={{ fontSize: '1.125rem' }}>Bon de sortie</h1>
      </div>

      <BonSortiePanel planId={planId} isChef={isChef} isMagasinier={isMagasinier} variant="page" />
    </div>
  );
}
