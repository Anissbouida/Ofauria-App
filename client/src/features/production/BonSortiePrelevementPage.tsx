import { useParams, useNavigate } from 'react-router-dom';
import { useWorkshops } from '../../api/production.api';
import { useAuth } from '../../context/AuthContext';
import { ArrowLeft, Truck } from 'lucide-react';
import { BonSortiePanel } from './BonSortiePanel';
import './production.css';

/**
 * Page autonome du bon de sortie, vue magasinier : /stock/bsi/:id (id = plan).
 * La logique reelle est dans BonSortiePanel (reutilise aussi inline dans PlanDetailPage).
 */
export default function BonSortiePrelevementPage() {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { mine } = useWorkshops(); // membre d'un atelier (mig 511) ou direction
  const isChef = ['admin', 'manager'].includes(user?.role || '') || mine.length > 0;
  // Admin et manager ont aussi le privilege magasinier (peuvent prendre en charge la preparation)
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');

  if (!planId) return null;

  return (
    <div className="odoo-scope pd">
      {/* Barre : retour + fil d'Ariane (design Ventes) ; l'en-tête de fiche est dans le panneau. */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/stock?tab=bons')} className="odoo-pager-btn" title="Retour aux bons de sortie" aria-label="Retour aux bons de sortie">
          <ArrowLeft size={14} />
        </button>
        <div className="odoo-breadcrumb">
          <Truck size={14} style={{ color: 'var(--ds-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/stock?tab=bons')}>Bons de sortie</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">Bon de sortie</span>
        </div>
      </div>

      <div className="pd-page" style={{ paddingBottom: 128 }}>
        <BonSortiePanel planId={planId} isChef={isChef} isMagasinier={isMagasinier} variant="page" />
      </div>
    </div>
  );
}
