import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { BonSortiePanel } from './BonSortiePanel';

/**
 * Page autonome pour la gestion du bon de sortie (route /production/:id/bon-sortie).
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
    <div className="space-y-4 max-w-2xl mx-auto pb-32">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/production/${planId}`)}
          className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-800">Bon de sortie</h1>
        </div>
      </div>

      <BonSortiePanel planId={planId} isChef={isChef} isMagasinier={isMagasinier} variant="page" />
    </div>
  );
}
