import { Radio } from 'lucide-react';
import SalesChannelsManager from './SalesChannelsManager';

/**
 * Canaux de vente, écran du module Ventes (rendu sous SalesLayout). Même contenu que
 * la section Paramètres, mais intégré à la coquille Ventes : plus de renvoi vers Paramètres.
 */
const muted: React.CSSProperties = { color: 'var(--odoo-text-muted)', fontSize: '0.75rem' };

export default function SalesChannelsPage() {
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={18} /> Canaux de vente
        </h1>
        <p style={{ ...muted, margin: '2px 0 0', fontSize: '0.8125rem' }}>
          Boutique, commande, événement, gros, livraison… Chaque vente est rattachée à un canal.
          Les prix peuvent différer par canal (voir la fiche produit).
        </p>
      </div>
      <div style={{ maxWidth: 720 }}>
        <SalesChannelsManager />
      </div>
    </div>
  );
}
