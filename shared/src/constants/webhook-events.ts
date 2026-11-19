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
  { event: 'invoice.issued', label: 'Facture client émise', description: 'Une facture client (facture, facture d\'acompte ou facture depuis un ticket) est émise : numérotée, validée et figée.' },
  { event: 'invoice.validated', label: 'Facture fournisseur validée', description: 'Une facture fournisseur est validée après confrontation avec la pièce du fournisseur.' },
  { event: 'invoice.paid', label: 'Facture réglée', description: 'Une facture (client ou fournisseur) est entièrement réglée : son reste à payer est soldé.' },
  { event: 'credit_note.issued', label: 'Avoir client émis', description: 'Un avoir client est émis sur une facture (annulation, retour, erreur de prix ou geste commercial).' },
  { event: 'stock.received', label: 'Réception de marchandises', description: 'Une réception de bon de commande fait entrer des matières ou des consommables en stock (lots créés).' },
  { event: 'stock.count_validated', label: 'Inventaire validé', description: 'Un inventaire physique est validé : les écarts constatés sont appliqués au stock.' },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENT_CATALOG)[number]['event'];
export const WEBHOOK_EVENTS_LIST: string[] = WEBHOOK_EVENT_CATALOG.map(e => e.event);
