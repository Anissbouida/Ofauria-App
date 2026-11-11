import { Truck } from 'lucide-react';
import SalesPageShell from './SalesPageShell';
import ProSalesTab from './ProSalesTab';

/**
 * Écran autonome des bons de livraison, séparé des commandes — comme dans les ERP
 * standards (Odoo « Livraisons », SAP « Outbound Delivery »), où la commande et le
 * BL sont deux documents distincts de la chaîne O2C.
 */
export default function DeliveryNotesPage() {
  return (
    <SalesPageShell icon={Truck} title="Bons de livraison" parent="Ventes">
      <ProSalesTab />
    </SalesPageShell>
  );
}
