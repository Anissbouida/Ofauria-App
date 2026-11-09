import { Radio } from 'lucide-react';
import SalesChannelsManager from './SalesChannelsManager';
import SalesPageShell from './SalesPageShell';

/**
 * Canaux de vente, écran du module Ventes (rendu sous SalesLayout). Même contenu que
 * la section Paramètres, mais intégré à la coquille Ventes : plus de renvoi vers Paramètres.
 */
export default function SalesChannelsPage() {
  return (
    <SalesPageShell icon={Radio} title="Canaux de vente">
      <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem', margin: 0 }}>
        Boutique, commande, événement, gros, livraison… Chaque vente est rattachée à un canal.
        Les prix peuvent différer par canal (voir la fiche produit).
      </p>
      <div style={{ maxWidth: 720 }}>
        <SalesChannelsManager />
      </div>
    </SalesPageShell>
  );
}
