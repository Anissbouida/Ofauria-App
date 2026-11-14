import { Radio } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { salesChannelsApi } from '../../api/sales-channels.api';
import SalesChannelsManager from './SalesChannelsManager';
import SalesPageShell from './SalesPageShell';

/**
 * Canaux de vente, écran du module Ventes (rendu sous SalesLayout). Même contenu que
 * la section Paramètres, mais intégré à la coquille Ventes : plus de renvoi vers Paramètres.
 */
export default function SalesChannelsPage() {
  // Même clé que SalesChannelsManager : une seule lecture pour le résumé et la liste.
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: salesChannelsApi.list });
  const active = channels.filter(c => c.is_active).length;
  const byDefault = channels.find(c => c.is_default);
  return (
    <SalesPageShell icon={Radio} parent="Ventes" title="Canaux de vente"
      summary={`${active} actif${active > 1 ? 's' : ''}${byDefault ? ` · par défaut : ${byDefault.label}` : ''}`}>
      <p className="prj-note" style={{ margin: 0 }}>
        Boutique, commande, événement, gros, livraison… Chaque vente est rattachée à un canal.
        Les prix peuvent différer par canal (voir la fiche produit).
      </p>
      <div style={{ maxWidth: 720 }}>
        <SalesChannelsManager />
      </div>
    </SalesPageShell>
  );
}
