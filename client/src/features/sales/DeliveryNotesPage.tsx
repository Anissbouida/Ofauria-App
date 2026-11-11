import ProSalesTab from './ProSalesTab';

/**
 * Écran autonome des bons de livraison, séparé des commandes — comme dans les ERP
 * standards (Odoo « Livraisons », SAP « Outbound Delivery »). ProSalesTab porte sa
 * propre coquille (SalesPageShell), alignée sur les autres onglets du module Ventes.
 */
export default function DeliveryNotesPage() {
  return <ProSalesTab />;
}
