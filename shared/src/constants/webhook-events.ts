/**
 * Événements de webhook (G6-08) : une seule liste, lue par le serveur (émission, description
 * OpenAPI) et par l'écran Paramètres › Intégrations (abonnement). Un événement n'est listé
 * que s'il est réellement émis.
 */
export const WEBHOOK_EVENT_CATALOG = [
  { event: 'order.created', label: 'Commande créée', description: 'Une commande client a été enregistrée (site marchand ou application).' },
  { event: 'order.status_changed', label: 'Statut de commande modifié', description: 'Le statut d\'une commande a changé (confirmée, prête, livrée, annulée…).' },
  { event: 'production.order_confirmed', label: 'Ordre de fabrication confirmé', description: 'Un ordre de fabrication est confirmé : besoins figés, bon de sortie généré selon le type d\'ordre.' },
  { event: 'production.lot_created', label: 'Lot produit', description: 'Une déclaration de production a créé un lot de produit fini.' },
  { event: 'production.order_completed', label: 'Ordre de fabrication terminé', description: 'Tous les articles d\'un ordre de fabrication sont déclarés produits.' },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENT_CATALOG)[number]['event'];
export const WEBHOOK_EVENTS_LIST: string[] = WEBHOOK_EVENT_CATALOG.map(e => e.event);
