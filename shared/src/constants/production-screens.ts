/**
 * Écrans de fabrication (M8-01 suite, mig 591) : catalogue des éléments de l'ordre de fabrication
 * et de la fenêtre de lancement, avec la règle qui les affiche (en clair) et la possibilité de
 * les masquer pour toute la société ou pour un type d'ordre.
 * Masquer seulement : forcer l'affichage d'un panneau sans ses données (bon de sortie absent,
 * aucun numéro de série…) donnerait un panneau vide. Les éléments indispensables au parcours
 * ne se masquent pas (raison dans `locked`).
 * Les clés reprennent les identifiants du registre client (planPanelRules.ts, launchStepRules.ts).
 */
export interface ProductionScreenElement {
  key: string;
  area: 'plan' | 'launch';
  /** Onglet de l'ordre (plan) ou étape de la fenêtre de lancement. */
  place: string;
  label: string;
  /** Quand l'élément s'affiche, sans réglage. */
  rule: string;
  /** Raison pour laquelle il ne se masque pas ; absent = masquable. */
  locked?: string;
}

export const PRODUCTION_SCREEN_ELEMENTS: ProductionScreenElement[] = [
  { key: 'bon-sortie', area: 'plan', place: 'Ingrédients', label: 'Bon de sortie', rule: 'Quand le type d\'ordre prévoit un bon de sortie et qu\'il est généré.', locked: 'Le magasinier en a besoin pour servir l\'ordre.' },
  { key: 'stock-warnings', area: 'plan', place: 'Ingrédients', label: 'Alertes de disponibilité', rule: 'Pour le magasinier, quand des ingrédients manquent.', locked: 'Alerte de blocage : la masquer cacherait un manque.' },
  { key: 'no-needs', area: 'plan', place: 'Ingrédients', label: 'Aucun besoin calculé', rule: 'Quand les produits de l\'ordre n\'ont pas de nomenclature.', locked: 'Alerte de blocage : l\'ordre ne peut pas avancer.' },
  { key: 'lot-traceability', area: 'plan', place: 'Ingrédients', label: 'Traçabilité des lots', rule: 'Ordre en cours ou terminé.' },
  { key: 'subcontract', area: 'plan', place: 'Synthèse', label: 'Sous-traitance', rule: 'Ordre d\'un type « sous-traité ».', locked: 'Envoi des composants et réception passent par ce panneau.' },
  { key: 'linked-order', area: 'plan', place: 'Synthèse', label: 'Commande client liée', rule: 'Ordre rattaché à une commande client.' },
  { key: 'consumption', area: 'plan', place: 'Synthèse', label: 'Consommation des matières', rule: 'Ordre confirmé, en cours ou terminé.' },
  { key: 'custom-fields', area: 'plan', place: 'Synthèse', label: 'Champs personnalisés', rule: 'Toujours.' },
  { key: 'history', area: 'plan', place: 'Synthèse', label: 'Historique', rule: 'Toujours.' },
  { key: 'quality', area: 'plan', place: 'Synthèse', label: 'Contrôle qualité', rule: 'Ordre confirmé, en cours ou terminé.' },
  { key: 'retro-planning', area: 'plan', place: 'Production', label: 'Rétro-planning (heure de vitrine)', rule: 'Ordre en cours, avec l\'option « vitrine ».' },
  { key: 'serials', area: 'plan', place: 'Production', label: 'Numéros de série', rule: 'Une ligne suit un article par numéro de série.' },
  { key: 'steps', area: 'plan', place: 'Production', label: 'Étapes', rule: 'Fonction « Étapes » active dans les réglages.' },
  { key: 'yield', area: 'plan', place: 'Production', label: 'Rendement', rule: 'Fonction « Rendement » active dans les réglages.' },
  { key: 'cost', area: 'plan', place: 'Coûts', label: 'Coût de revient', rule: 'Fonction « Coût de revient » active dans les réglages.' },
  { key: 'launch.bases', area: 'launch', place: 'Étape 1', label: 'Étape « Sous-ensembles »', rule: 'Quand l\'ordre a des sous-ensembles partagés.', locked: 'Leur production doit être déclarée avant les produits finis.' },
  { key: 'launch.losses', area: 'launch', place: 'Étape 3', label: 'Étape « Pertes et observations »', rule: 'Toujours.' },
];

export const PRODUCTION_SCREEN_KEYS = new Set(PRODUCTION_SCREEN_ELEMENTS.map(e => e.key));
export const isMaskableScreenElement = (key: string) => {
  const e = PRODUCTION_SCREEN_ELEMENTS.find(x => x.key === key);
  return !!e && !e.locked;
};
