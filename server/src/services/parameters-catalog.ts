import type { SettingsSection } from '@ofauria/shared';
import { baseCurrencyCode } from './currency.js';
import type { ConfigLevel, ConfigMerge } from './config-resolver.js';

/**
 * Catalogue des paramètres métier (audit Paramètres, lot 4).
 *
 * Comme les paramètres d'Odoo ou les pages de configuration de Business Central,
 * la définition (libellé, type, bornes, valeur par défaut, droit requis) est dans
 * le code ; la valeur est en base, à l'un de deux endroits :
 *   - module_parameters (mig 306) : une ligne par clé, valeur JSON ;
 *   - company_settings : colonnes historiques, lues telles quelles par le code
 *     existant (aucun consommateur à modifier) ;
 *   - policy_values (mig 538) : politique à héritage, réglable à plusieurs niveaux
 *     (société, établissement, atelier, type d'ordre, article) — services/policies.ts.
 * L'écran Paramètres › Paramètres métier est construit à partir de ce catalogue.
 * Ajouter un paramètre = ajouter une entrée ici (et sa valeur initiale en base).
 */

export type FieldType = 'boolean' | 'number' | 'integer' | 'percent' | 'enum' | 'list' | 'date' | 'time';

export interface ParamField {
  name: string;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}

export interface ParamDef {
  key: string;
  domain: 'production' | 'pricing' | 'sales' | 'purchasing' | 'accounting' | 'company';
  label: string;
  help: string;
  /** Section des droits Paramètres requise pour voir et modifier. */
  section: SettingsSection;
  fields: ParamField[];
  defaults: Record<string, unknown>;
  storage: { kind: 'module_parameters' } | { kind: 'company_settings'; columns: Record<string, string> } | { kind: 'policy' };
  /** Politique (stockage `policy`) : niveaux où elle peut être réglée. */
  scopes?: ('company' | 'store' | 'workshop' | 'order_type' | 'product')[];
  /**
   * Politique dont le niveau société est déjà une colonne de company_settings, réglée sur
   * son écran d'origine : champ → colonne. Le niveau société n'est alors pas dans `scopes`
   * (un seul endroit où le modifier) ; les niveaux plus précis le surchargent.
   */
  companyColumns?: Record<string, string>;
  /** Métadonnées de résolution ; les paramètres non migrés gardent leur portée historique. */
  levels?: readonly ConfigLevel[];
  lockable?: boolean;
  merge?: ConfigMerge;
  preference?: boolean;
}

/** Tous les niveaux d'une politique de production. */
const ALL_SCOPES: NonNullable<ParamDef['scopes']> = ['company', 'store', 'workshop', 'order_type', 'product'];

export const DOMAIN_LABELS: Record<ParamDef['domain'], string> = {
  production: 'Production',
  pricing: 'Prix de vente',
  sales: 'Ventes',
  purchasing: 'Achats et réception',
  accounting: 'Comptabilité',
  company: 'Société',
};

const MODE_WARN_BLOCK = [
  { value: 'warn', label: 'Signaler sans bloquer' },
  { value: 'block', label: 'Bloquer' },
];

export const PARAMETERS: ParamDef[] = [
  {
    key: 'production.yield_target', domain: 'production', section: 'production',
    label: 'Rendement cible',
    help: 'Rendement attendu quand ni le contenant ni la recette n\'en fixent : en dessous, le rendement d\'un article est signalé. Se règle par établissement, atelier, type d\'ordre ou article dans Production › Paramétrage › Politiques.',
    fields: [{ name: 'pct', label: 'Rendement cible', type: 'percent', unit: '%', min: 0, max: 100 }],
    defaults: { pct: 90 },
    storage: { kind: 'policy' }, scopes: ALL_SCOPES,
  },
  {
    key: 'production.yield_display', domain: 'production', section: 'production',
    label: 'Seuils d\'affichage du rendement moyen',
    help: 'Couleur d\'un rendement moyen sur les écrans de production : vert à partir du premier seuil, rouge sous le second, orange entre les deux.',
    fields: [
      { name: 'good', label: 'Rendement moyen bon à partir de', type: 'percent', unit: '%', min: 0, max: 100 },
      { name: 'alert', label: 'Rendement moyen critique sous', type: 'percent', unit: '%', min: 0, max: 100 },
    ],
    defaults: { good: 85, alert: 70 },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.cost_allocation_key', domain: 'production', section: 'production',
    label: 'Clé de répartition du coût entre les articles d\'un ordre',
    help: 'Comment le coût réel d\'un ordre (matières, emballages, main-d\'œuvre, énergie, charges) se répartit entre ses articles : au poids produit (défaut), à la quantité, à la valeur de vente, ou selon des parts saisies sur l\'ordre. Se règle par établissement, atelier ou type d\'ordre.',
    fields: [{ name: 'key', label: 'Clé', type: 'enum', options: [
      { value: 'poids', label: 'Poids produit' }, { value: 'quantite', label: 'Quantité produite' },
      { value: 'valeur_de_vente', label: 'Valeur de vente' }, { value: 'manuelle', label: 'Parts saisies sur l\'ordre' },
    ] }],
    defaults: { key: 'poids' },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop', 'order_type'],
  },
  {
    key: 'production.fixed_charges_rate', domain: 'production', section: 'production',
    label: 'Taux de charges fixes',
    help: 'Part de charges indirectes ajoutée au coût matière d\'un plan (mode « Taux sur les matières »). Le taux de la société se règle dans Production › Paramétrage › Coût de revient ; ici, un établissement, un atelier ou un type d\'ordre peut avoir le sien.',
    fields: [{ name: 'rate', label: 'Taux de charges fixes', type: 'number', unit: '× matières', min: 0, max: 5 }],
    defaults: { rate: 0.40 },
    storage: { kind: 'policy' }, scopes: ['store', 'workshop', 'order_type'],
    companyColumns: { rate: 'production_charges_fixes_pct' },
  },
  {
    key: 'production.kwh_price', domain: 'production', section: 'production',
    label: 'Prix du kWh',
    help: 'Prix proposé à la création d\'un équipement ; chaque équipement garde ensuite le sien.',
    fields: [{ name: 'price', label: 'Prix du kWh', type: 'number', unit: '¤ / kWh', min: 0, max: 100 }],
    defaults: { price: 1.5 },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.margin_multiplier', domain: 'production', section: 'production',
    label: 'Multiplicateur de marge',
    help: 'Prix conseillé = coût de production × multiplicateur, quand la recette n\'en porte pas.',
    fields: [{ name: 'value', label: 'Multiplicateur', type: 'number', unit: '× coût', min: 0.1, max: 50 }],
    defaults: { value: 3 },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.demand_source', domain: 'production', section: 'production',
    label: 'Déclenchement de la production',
    help: 'Ce qui crée le besoin de fabrication dans le plan directeur et les besoins nets. Sur stock : la prévision de vente seule. À la commande : les commandes clients seules. Hybride : les deux.',
    fields: [{ name: 'mode', label: 'Déclenchement', type: 'enum', options: [
      { value: 'forecast', label: 'Sur stock' }, { value: 'orders', label: 'À la commande' }, { value: 'both', label: 'Hybride' },
    ] }],
    defaults: { mode: 'both' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'production.rhythm', domain: 'production', section: 'production',
    label: 'Rythme de production',
    help: 'Artisanal : plan du jour, horizon du plan directeur de 3 jours, dépassement de capacité signalé. Industriel : 14 jours, dépassement de capacité bloqué. En continu : 28 jours, capacité bloquée ; incompatible avec une production à la commande. Changer de rythme règle ces deux paramètres, qui restent ajustables ensuite.',
    fields: [{ name: 'mode', label: 'Rythme', type: 'enum', options: [
      { value: 'artisanal', label: 'Artisanal' }, { value: 'industrial', label: 'Industriel' }, { value: 'continuous', label: 'En continu' },
    ] }],
    defaults: { mode: 'artisanal' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'production.flow', domain: 'production', section: 'production',
    label: 'Parcours d\'une production',
    help: 'Étapes obligatoires d\'un ordre. Fiche technique : un article sans fiche bloque la confirmation du plan. Bon de sortie : le démarrage attend la sortie des matières (types d\'ordre qui en prévoient un). Contrôle qualité : le transfert attend les contrôles prévus. Validation du transfert : la boutique confirme la réception ; sinon elle est enregistrée d\'office.',
    fields: [
      { name: 'recipe_required', label: 'Fiche technique obligatoire pour lancer', type: 'boolean' },
      { name: 'material_issue_required', label: 'Bon de sortie des matières avant de démarrer', type: 'boolean' },
      { name: 'quality_before_transfer', label: 'Contrôle qualité avant transfert', type: 'boolean' },
      { name: 'transfer_reception', label: 'Validation du transfert par la boutique', type: 'boolean' },
    ],
    defaults: { recipe_required: false, material_issue_required: true, quality_before_transfer: true, transfer_reception: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'production.mrp_horizon', domain: 'production', section: 'production',
    label: 'Horizon du plan directeur',
    help: 'Nombre maximal de jours calculés par le plan directeur (besoins nets par jour).',
    fields: [{ name: 'days', label: 'Horizon', type: 'integer', unit: 'jours', min: 1, max: 60 }],
    defaults: { days: 14 },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.showcase_time', domain: 'production', section: 'production',
    label: 'Heure de mise en vitrine',
    help: 'Heure cible proposée par le rétro-planning : les étapes sont calées pour que l\'article soit prêt à cette heure. Un article peut porter sa propre heure sur le plan.',
    fields: [{ name: 'time', label: 'Heure de mise en vitrine', type: 'time' }],
    defaults: { time: '07:00' },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.shift_cutoff', domain: 'production', section: 'production',
    label: 'Coupure d\'équipe',
    help: 'Heure qui sépare l\'équipe du matin de celle de l\'après-midi sur les bons de production.',
    fields: [{ name: 'hour', label: 'Coupure d\'équipe', type: 'integer', unit: 'h', min: 0, max: 23 }],
    defaults: { hour: 14 },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.oee_thresholds', domain: 'production', section: 'production',
    label: 'Seuils du TRS',
    help: 'Taux de rendement synthétique d\'un poste de charge : bon au-dessus du premier seuil, en alerte sous le second.',
    fields: [
      { name: 'good', label: 'TRS bon à partir de', type: 'percent', unit: '%', min: 0, max: 100 },
      { name: 'alert', label: 'TRS en alerte sous', type: 'percent', unit: '%', min: 0, max: 100 },
    ],
    defaults: { good: 85, alert: 60 },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.forecast_history', domain: 'production', section: 'production',
    label: 'Historique de la prévision',
    help: 'Nombre de jours de ventes pris en compte pour prévoir la demande (au moins six semaines : la prévision compare six mêmes jours de la semaine).',
    fields: [{ name: 'days', label: 'Historique', type: 'integer', unit: 'jours', min: 42, max: 365 }],
    defaults: { days: 56 },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.replenishment_history', domain: 'production', section: 'production',
    label: 'Historique de l\'approvisionnement boutique',
    help: 'Nombre de jours de ventes regardés pour proposer les quantités à envoyer en boutique (même jour de la semaine).',
    fields: [{ name: 'days', label: 'Historique', type: 'integer', unit: 'jours', min: 14, max: 180 }],
    defaults: { days: 29 },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.fixed_charges', domain: 'production', section: 'production',
    label: 'Charges fixes mensuelles',
    help: 'Charges indirectes du coût de revient d\'un plan. Moteur analytique (recommandé) : charges et personnel répartis par centre de coûts et imputés sur la capacité normale — paramétrage dans Production › Paramétrage › Coût de revient ; les montants ci-dessous ne servent alors plus. Taux sur les matières : un pourcentage du coût matière. Charges mensuelles (ancien) : loyer, énergie et autres répartis sur les seuls plans déjà chiffrés du mois, au prorata de leurs matières.',
    fields: [
      { name: 'method', label: 'Mode de calcul', type: 'enum', options: [{ value: 'analytic', label: 'Moteur analytique (centres de coûts, capacité normale)' }, { value: 'rate', label: 'Taux sur les matières' }, { value: 'monthly', label: 'Charges mensuelles au prorata des matières (ancien)' }] },
      { name: 'loyer', label: 'Loyer de l\'atelier', type: 'number', unit: '¤ / mois', min: 0, max: 10_000_000 },
      { name: 'energie', label: 'Énergie (eau, électricité, gaz)', type: 'number', unit: '¤ / mois', min: 0, max: 10_000_000 },
      { name: 'autres', label: 'Autres charges fixes', type: 'number', unit: '¤ / mois', min: 0, max: 10_000_000 },
    ],
    defaults: { method: 'rate', loyer: 0, energie: 0, autres: 0 },
    storage: { kind: 'company_settings', columns: { method: 'production_charges_method', loyer: 'production_charge_loyer', energie: 'production_charge_energie', autres: 'production_charge_autres' } },
  },
  {
    key: 'quality.auto_release', domain: 'production', section: 'production',
    label: 'Libération automatique des lots contrôlés',
    help: 'Un lot retenu par le plan de contrôle est libéré dès que toutes ses inspections sont réalisées et conformes. Désactivé : un rôle qualité libère chaque lot à la main.',
    fields: [{ name: 'enabled', label: 'Libérer automatiquement', type: 'boolean' }],
    defaults: { enabled: true },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.cost_components', domain: 'production', section: 'production',
    label: 'Composantes du coût de revient',
    help: 'Composantes calculées dans le coût réel d\'un ordre (les matières le sont toujours). Machine : taux horaire du poste × temps réel des étapes rattachées à un poste. Une composante éteinte vaut zéro dans le coût réel.',
    fields: [
      { name: 'emballage', label: 'Emballages', type: 'boolean' },
      { name: 'main_oeuvre', label: 'Main-d\'œuvre', type: 'boolean' },
      { name: 'machine', label: 'Machine (postes de charge)', type: 'boolean' },
      { name: 'energie', label: 'Énergie (équipements)', type: 'boolean' },
      { name: 'sous_traitance', label: 'Sous-traitance (façon)', type: 'boolean' },
      { name: 'pertes', label: 'Pertes (dont)', type: 'boolean' },
      { name: 'charges', label: 'Charges fixes', type: 'boolean' },
    ],
    defaults: { emballage: true, main_oeuvre: true, machine: false, energie: true, sous_traitance: true, pertes: true, charges: true },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop', 'order_type'],
  },
  {
    key: 'production.ledger_entries', domain: 'production', section: 'production',
    label: 'Écritures comptables de production (inventaire permanent)',
    help: 'Désactivé (défaut) : inventaire intermittent, la production ne passe aucune écriture. Activé : à la clôture d\'un ordre, une écriture d\'OD constate la production stockée (3151 Produits finis / 7132 Variation des stocks de produits, au coût de revient) et la consommation de matières (6124 Variation des stocks de matières / 3121 Matières premières). Décision comptable à prendre avec l\'expert-comptable.',
    fields: [{ name: 'enabled', label: 'Passer les écritures de production', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'policy' }, scopes: ['company'],
  },
  {
    key: 'quality.ccp_rule', domain: 'production', section: 'production',
    label: 'Règle de clôture d\'un point critique (CCP)',
    help: 'Ce qu\'il faut pour clôturer une étape critique. « Au moins un relevé » : comportement historique. « Relevés conformes » : le nombre minimal de relevés, tous dans la tolérance. « Dernier relevé conforme » : le nombre minimal de relevés et le dernier dans la tolérance (une correction est possible).',
    fields: [
      { name: 'rule', label: 'Règle', type: 'enum', options: [
        { value: 'au_moins_un', label: 'Au moins un relevé' },
        { value: 'tous_conformes', label: 'Relevés tous conformes' },
        { value: 'dernier_conforme', label: 'Dernier relevé conforme' },
      ] },
      { name: 'min_readings', label: 'Nombre minimal de relevés', type: 'number', min: 1, max: 20 },
    ],
    defaults: { rule: 'au_moins_un', min_readings: 1 },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.enforce_declared_steps', domain: 'production', section: 'production',
    label: 'Étapes obligatoires des types d\'ordre',
    help: 'Rend effectifs les drapeaux « pesée obligatoire » et « contrôle qualité obligatoire » d\'un type d\'ordre : le démarrage attend que toutes les lignes du bon de sortie soient pesées, le transfert attend un contrôle conforme sans contrôle en attente. Désactivé : ces drapeaux restent indicatifs (comportement historique).',
    fields: [{ name: 'enabled', label: 'Appliquer les étapes obligatoires', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop', 'order_type'],
  },
  {
    key: 'production.equipment_capacity', domain: 'production', section: 'production',
    label: 'Capacité des équipements',
    help: 'Contrôle, à la confirmation d\'un ordre, que les fournées du jour tiennent dans la capacité des équipements (plaques par four, kilos par batteur…) déclarée dans Production › Postes de travail et rattachée aux fiches. Signaler : l\'ordre est confirmé avec un avertissement. Bloquer : la confirmation est refusée tant qu\'un équipement est saturé.',
    fields: [{ name: 'mode', label: 'Dépassement de capacité', type: 'enum', options: [{ value: 'off', label: 'Ne pas contrôler' }, ...MODE_WARN_BLOCK] }],
    defaults: { mode: 'warn' },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop'],
  },
  {
    key: 'production.segregation_of_duties', domain: 'production', section: 'production',
    label: 'Séparation des tâches sur les bons de sortie',
    help: 'Activé : la personne qui prépare ou remet un bon de sortie ne peut pas accepter elle-même sa réception au laboratoire, ni enregistrer un retour de matière sur ce bon. Désactivé : une même personne peut tout faire (petites équipes).',
    fields: [{ name: 'enabled', label: 'Séparer préparation et réception', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'production.process_engine', domain: 'production', section: 'production',
    label: 'Moteur de parcours configurable',
    help: 'Éteint : le parcours historique décide seul. Ombre : le moteur évalue le parcours publié du type d\'ordre à côté du code actuel et journalise chaque désaccord, sans jamais bloquer. Actif : les gardes du parcours publié décident (la machine à états reste le filet de sécurité). Ne passer en actif qu\'après une période d\'ombre sans désaccord.',
    fields: [{ name: 'mode', label: 'Mode', type: 'enum', options: [{ value: 'eteint', label: 'Éteint' }, { value: 'ombre', label: 'Ombre (journal des écarts)' }, { value: 'actif', label: 'Actif' }] }],
    defaults: { mode: 'eteint' },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop', 'order_type'],
  },
  {
    key: 'production.steps_source', domain: 'production', section: 'production',
    label: 'Source des étapes exécutées à l\'atelier',
    help: 'Étapes de la fiche (liste JSON, comportement historique) ou opérations de la gamme (postes, temps de réglage et unitaires, quantités par opération). Se bascule atelier par atelier après validation par le chef ; sans gamme active, l\'article garde les étapes de la fiche.',
    fields: [{ name: 'source', label: 'Source', type: 'enum', options: [{ value: 'json', label: 'Étapes de la fiche' }, { value: 'gamme', label: 'Opérations de la gamme' }] }],
    defaults: { source: 'json' },
    storage: { kind: 'policy' }, scopes: ['company', 'store', 'workshop', 'order_type'],
  },
  {
    key: 'production.steps_blocking', domain: 'production', section: 'production',
    label: 'Étapes de production bloquantes',
    help: 'Un article ne peut être déclaré produit que si toutes ses étapes sont terminées.',
    fields: [{ name: 'enabled', label: 'Bloquer tant que les étapes ne sont pas terminées', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'company_settings', columns: { enabled: 'production_steps_blocking' } },
  },
  {
    key: 'pricing.rounding', domain: 'pricing', section: 'production',
    label: 'Arrondi des prix de vente',
    help: 'Appliqué au prix calculé (coût × marge) des fiches techniques et formats. La caisse affiche toujours 2 décimales.',
    fields: [
      { name: 'strategie', label: 'Pas de l\'arrondi', type: 'enum', options: [
        { value: 'aucun', label: 'Aucun (décimales brutes)' }, { value: 'au_demi_dh', label: 'Au 0,5 ¤' },
        { value: 'au_dh', label: 'À 1 ¤' }, { value: 'au_5dh', label: 'Aux 5 ¤' },
      ] },
      { name: 'sens', label: 'Sens', type: 'enum', options: [
        { value: 'superieur', label: 'Vers le haut (protège la marge)' }, { value: 'inferieur', label: 'Vers le bas' },
        { value: 'naturel', label: 'Au plus proche' },
      ] },
    ],
    defaults: { strategie: 'aucun', sens: 'superieur' },
    storage: { kind: 'company_settings', columns: { strategie: 'prix_arrondi_strategie', sens: 'prix_arrondi_sens' } },
  },
  {
    key: 'sales.staff_discount', domain: 'sales', section: 'company',
    label: 'Remise personnel',
    help: 'Remise appliquée aux achats du personnel en caisse.',
    fields: [{ name: 'percent', label: 'Taux', type: 'percent', min: 0, max: 100 }],
    defaults: { percent: 10 },
    storage: { kind: 'company_settings', columns: { percent: 'staff_discount_percent' } },
  },
  {
    key: 'sales.channel', domain: 'sales', section: 'business',
    label: 'Canal de vente principal',
    help: 'Fixe l\'écran d\'accueil « Selon le secteur » : au détail = la caisse, en gros = les ventes, directe = les commandes clients, multicanale = l\'accueil du secteur. Les autres canaux restent disponibles.',
    fields: [{ name: 'channel', label: 'Canal', type: 'enum', options: [
      { value: 'direct', label: 'Directe' }, { value: 'retail', label: 'Au détail' }, { value: 'wholesale', label: 'En gros' }, { value: 'multi', label: 'Multicanale' },
    ] }],
    defaults: { channel: 'multi' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.quotes', domain: 'sales', section: 'business',
    label: 'Devis clients',
    help: 'Durée de validité proposée sur un nouveau devis (modifiable devis par devis). Passé ce délai, un devis envoyé passe en « expiré » et son auteur est prévenu (mig 365).',
    fields: [{ name: 'validity_days', label: 'Validité', type: 'integer', unit: 'jours', min: 1, max: 365 }],
    defaults: { validity_days: 30 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.dunning', domain: 'sales', section: 'business',
    label: 'Relances clients et contrôle du crédit',
    help: 'Chaque jour, les clients en retard reçoivent une proposition de relance au niveau atteint (niveaux dans Ventes › Relances). Envoi automatique : les niveaux « par e-mail » partent sans validation. Plafond bloquant : une vente à crédit au-delà du plafond est refusée au lieu d\'une simple alerte (mig 366).',
    fields: [
      { name: 'enabled', label: 'Relances actives', type: 'boolean' },
      { name: 'auto_send', label: 'Envoyer les e-mails sans validation', type: 'boolean' },
      { name: 'min_amount', label: 'Montant échu minimal', type: 'number', unit: '¤', min: 0, max: 1_000_000 },
      { name: 'credit_control', label: 'Plafond de crédit', type: 'enum', options: [{ value: 'warn', label: 'Alerte seulement' }, { value: 'block', label: 'Bloquant' }] },
      { name: 'auto_release', label: 'Débloquer un client dès qu\'il est à jour', type: 'boolean' },
    ],
    defaults: { enabled: true, auto_send: false, min_amount: 50, credit_control: 'warn', auto_release: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.legal_mentions', domain: 'sales', section: 'business',
    label: 'Mentions légales des factures',
    help: 'Contrôles obligatoires à l\'émission d\'une facture client. ICE exigé : une facture à un client professionnel (ou revendeur) sans ICE est refusée — complétez sa fiche. La numérotation suit la date de la facture : pas d\'antidate (phase 5.6).',
    fields: [{ name: 'enforce_customer_ice', label: 'Exiger l\'ICE d\'un client professionnel', type: 'boolean' }],
    defaults: { enforce_customer_ice: false },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.returns', domain: 'sales', section: 'business',
    label: 'Retours en caisse',
    help: 'Encadre les retours : au-delà du délai (jours depuis la vente) le retour est refusé ; au-delà du seuil de remboursement, l\'approbation d\'un responsable est requise. Désactivé par défaut (phase 8.1).',
    fields: [
      { name: 'enabled', label: 'Encadrer les retours', type: 'boolean' },
      { name: 'max_days', label: 'Délai maximal', type: 'integer', unit: 'jours', min: 0, max: 365 },
      { name: 'max_amount_without_approval', label: 'Seuil sans approbation', type: 'number', unit: '¤', min: 0, max: 1_000_000 },
    ],
    defaults: { enabled: false, max_days: 14, max_amount_without_approval: 500 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.closure', domain: 'sales', section: 'business',
    label: 'Clôture de caisse',
    help: 'Contrôle des invendus à la fermeture : activé (boulangerie), la journée boutique demande l\'inventaire de vitrine ; désactivé (ex. secteur générique), la caisse se ferme sans inventaire (phase 8.2).',
    fields: [{ name: 'require_unsold_inventory', label: 'Inventaire des invendus à la fermeture', type: 'boolean' }],
    defaults: { require_unsold_inventory: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'stock.negative_policy', domain: 'production', section: 'business',
    label: 'Sortie supérieure au stock',
    help: 'Quand une sortie dépasse le stock disponible. Autoriser et tracer : la sortie passe, le stock tombe à zéro et le manque est inscrit dans Stock › Anomalies. Bloquer : la sortie est refusée. Réglable par type d\'article.',
    fields: (['ingredient', 'product', 'packaging', 'semi_finished'] as const).map((name, i) => ({
      name, label: ['Matières premières', 'Produits finis', 'Emballages et consommables', 'Semi-finis'][i], type: 'enum' as const,
      options: [{ value: 'allow_trace', label: 'Autoriser et tracer' }, { value: 'block', label: 'Bloquer' }],
    })),
    defaults: { ingredient: 'allow_trace', product: 'allow_trace', packaging: 'allow_trace', semi_finished: 'allow_trace' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'hr.documents_due', domain: 'company', section: 'business',
    label: 'Échéances du personnel',
    help: 'Prévient le gérant quand une échéance d\'un salarié actif approche : carte d\'identité, documents datés (visite médicale, certificat…), fin de CDD, fin de période d\'essai. Une alerte par échéance et par seuil.',
    fields: [
      { name: 'days', label: 'Seuils', type: 'list', unit: 'jours avant l\'échéance' },
      { name: 'email', label: 'Envoyer aussi un e-mail aux responsables', type: 'boolean' },
    ],
    defaults: { days: [30, 7], email: false },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'stock.organization', domain: 'production', section: 'business',
    label: 'Organisation du stock',
    help: 'Par établissement : chacun achète et suit son stock. Centralisée : les bons de commande sont livrés au dépôt central (premier établissement de type dépôt, sinon mixte, sinon production) et le tableau « À commander » regroupe tous les établissements.',
    fields: [{ name: 'mode', label: 'Organisation', type: 'enum', options: [
      { value: 'per_store', label: 'Par établissement' }, { value: 'central', label: 'Centralisée' },
    ] }],
    defaults: { mode: 'per_store' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'stock.low_stock_alerts', domain: 'production', section: 'business',
    label: 'Alertes de stock bas',
    help: 'Signale les matières et produits sous leur seuil d\'alerte (listes, tableau de bord) et alimente les propositions d\'achat automatiques.',
    fields: [{ name: 'enabled', label: 'Alertes de stock bas', type: 'boolean' }],
    defaults: { enabled: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'stock.dlc_alerts', domain: 'production', section: 'business',
    label: 'Alertes de DLC',
    help: 'Prévient quand un lot de matière ou de produit fini encore en stock approche de sa date limite. Une alerte par lot et par seuil : le magasinier est notifié pour les matières, le gérant pour les produits finis. Seuils en jours avant l\'échéance.',
    fields: [
      { name: 'days', label: 'Seuils', type: 'list', unit: 'jours avant l\'échéance' },
      { name: 'email', label: 'Envoyer aussi un e-mail aux responsables', type: 'boolean' },
    ],
    defaults: { days: [7, 2], email: false },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.vat_regime', domain: 'sales', section: 'business',
    label: 'Régime de TVA',
    help: 'Débit : la TVA est déclarée dès la facture. Encaissement : la TVA des factures et tickets à crédit est déclarée au fur et à mesure des règlements, à partir de la date de bascule (les factures antérieures restent déclarées à la facturation). Sans date de bascule, la déclaration reste au régime des débits.',
    fields: [
      { name: 'mode', label: 'Régime', type: 'enum', options: [{ value: 'debit', label: 'Débit (à la facture)' }, { value: 'encaissement', label: 'Encaissement (au paiement)' }] },
      { name: 'since', label: 'Encaissement appliqué aux factures à partir du', type: 'date' },
    ],
    defaults: { mode: 'debit', since: null },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.stamp_duty', domain: 'sales', section: 'business',
    label: 'Droit de timbre',
    help: 'Timbre sur les règlements en espèces : pourcentage du montant, borné à un minimum. Désactivé par défaut, en attente des règles fiscales (phase 5.7, expert-comptable).',
    fields: [
      { name: 'enabled', label: 'Appliquer le droit de timbre', type: 'boolean' },
      { name: 'rate_pct', label: 'Taux', type: 'percent', min: 0, max: 100 },
      { name: 'min_dh', label: 'Minimum', type: 'number', unit: '¤', min: 0, max: 1000 },
      { name: 'cash_only', label: 'Espèces uniquement', type: 'boolean' },
    ],
    defaults: { enabled: false, rate_pct: 0.25, min_dh: 1, cash_only: true },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.pricing', domain: 'sales', section: 'business',
    label: 'Prix et remises sur commandes',
    help: 'Remise manuelle maximale accordée par une vendeuse ou une caissière, puis par un gérant (l\'administrateur n\'est pas limité ; la remise personnel suit le paramètre de la société). Un prix différent du prix grille est une dérogation réservée à la direction, motivée et tracée ; au-delà de l\'écart indiqué, seul l\'administrateur peut la faire (O2C L3).',
    fields: [
      { name: 'max_discount_pct_sales', label: 'Remise maximale — vente et caisse', type: 'number', unit: '%', min: 0, max: 100 },
      { name: 'max_discount_pct_manager', label: 'Remise maximale — gérant', type: 'number', unit: '%', min: 0, max: 100 },
      { name: 'max_price_override_pct', label: 'Écart maximal au prix grille — gérant', type: 'number', unit: '%', min: 0, max: 100 },
    ],
    defaults: { max_discount_pct_sales: 10, max_discount_pct_manager: 30, max_price_override_pct: 30 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.person_sizes', domain: 'sales', section: 'business',
    label: 'Entremets vendus par personne — tailles',
    help: 'Nombre de personnes proposés en caisse pour un entremet vendu au nombre de parts (mode de vente « par personne »). Séparez les valeurs par une virgule. Le prix = prix/personne du produit × le nombre de parts choisi (mig 377).',
    fields: [{ name: 'sizes', label: 'Nombres de personnes', type: 'list', unit: 'personnes' }],
    defaults: { sizes: [4, 6, 8, 10, 12, 16] },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'sales.pos_stock', domain: 'sales', section: 'business',
    label: 'Caisse : produits sans stock vitrine',
    help: 'Stock respecté : un produit dont la vitrine est à zéro apparaît grisé dans « En rupture » et sa vente est refusée. Tout vendre : tous les produits actifs se vendent quel que soit le stock vitrine, qui peut alors passer en négatif (utile si la vitrine n\'est pas tenue au réel ou en attendant un approvisionnement). S\'applique aux ventes en caisse (mig 374).',
    fields: [{ name: 'mode', label: 'Produits sans stock', type: 'enum', options: [{ value: 'block', label: 'Stock respecté : vente refusée' }, { value: 'allow', label: 'Tout vendre, même sans stock' }] }],
    defaults: { mode: 'block' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.expense_requires_po', domain: 'purchasing', section: 'business',
    label: 'Bon de commande obligatoire pour les dépenses',
    help: 'Une dépense d\'une catégorie « BC requis » à partir du seuil doit être rattachée à un bon de commande engagé.',
    fields: [
      { name: 'enabled', label: 'Exiger un bon de commande', type: 'boolean' },
      { name: 'threshold', label: 'À partir de', type: 'number', unit: '¤', min: 0, max: 10_000_000 },
    ],
    defaults: { enabled: false, threshold: 2000, get currency() { return baseCurrencyCode(); } },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.supplier_score', domain: 'purchasing', section: 'business',
    label: 'Évaluation des fournisseurs',
    help: 'Poids des critères de la note (délais tenus, livraisons complètes, conformité à réception, prix stables, absence de litige), nombre de BC minimal pour noter, période glissante et seuils des classes A / B / C. Rapport : Achats › Évaluation des fournisseurs (mig 362).',
    fields: [
      { name: 'on_time', label: 'Poids délais', type: 'integer', min: 0, max: 100 },
      { name: 'fill_rate', label: 'Poids complétude', type: 'integer', min: 0, max: 100 },
      { name: 'quality', label: 'Poids conformité', type: 'integer', min: 0, max: 100 },
      { name: 'price', label: 'Poids prix', type: 'integer', min: 0, max: 100 },
      { name: 'disputes', label: 'Poids litiges', type: 'integer', min: 0, max: 100 },
      { name: 'min_orders', label: 'BC minimum pour noter', type: 'integer', min: 1, max: 100 },
      { name: 'months', label: 'Période (mois)', type: 'integer', min: 1, max: 60 },
      { name: 'a_min', label: 'Seuil classe A', type: 'integer', min: 0, max: 100 },
      { name: 'b_min', label: 'Seuil classe B', type: 'integer', min: 0, max: 100 },
      { name: 'c_min', label: 'Seuil classe C', type: 'integer', min: 0, max: 100 },
    ],
    defaults: { on_time: 30, fill_rate: 20, quality: 20, price: 20, disputes: 10, min_orders: 3, months: 12, a_min: 85, b_min: 70, c_min: 50 },
    storage: { kind: 'module_parameters' },
  },
  // Notation des demandes de prix : remplacée par des critères configurables
  // (table rfq_scoring_criteria, mig 459) éditables dans Paramètres › Achats.
  {
    key: 'purchasing.over_receipt_tolerance_pct', domain: 'purchasing', section: 'business',
    label: 'Sur-livraison tolérée',
    help: 'Écart accepté par ligne de bon de commande ; au-delà, la réception est refusée.',
    fields: [{ name: 'pct', label: 'Tolérance', type: 'percent', min: 0, max: 100 }],
    defaults: { pct: 10 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.sod_mode', domain: 'purchasing', section: 'business',
    label: 'Séparation des tâches (achats)',
    help: 'Sur la chaîne bon de commande → réception → facture → paiement, la personne qui fait une étape ne peut pas en faire une autre censée la contrôler : l\'auteur du BC ne le réceptionne pas, le réceptionnaire ne valide pas la facture, le valideur ne la paie pas, le payeur ne lève pas un blocage. « Observer » journalise les manquements sans bloquer (le temps de voir ce qui serait rejeté) ; « Bloquer » refuse l\'action ; « Bloquer sauf administrateur » laisse un administrateur passer outre (son action reste journalisée) — utile pour une petite équipe ; « Désactivé » ne contrôle rien. Une dérogation motivée reste possible au cas par cas (mig 442). Réglable aussi dans Utilisateurs › Contrôles internes.',
    // Même vocabulaire que le cumul de rôles (Utilisateurs › Contrôles internes, refonte lot 5).
    fields: [{ name: 'mode', label: 'Contrôle', type: 'enum', options: [{ value: 'warn', label: 'Observer' }, { value: 'block', label: 'Bloquer' }, { value: 'block_except_admin', label: 'Bloquer sauf administrateur' }, { value: 'off', label: 'Désactivé' }] }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.receipt_correction_window_hours', domain: 'purchasing', section: 'business',
    label: 'Délai de correction d\'une réception',
    help: 'Pendant ce délai le gérant peut corriger une ligne de réception ; l\'administrateur n\'est pas limité.',
    fields: [{ name: 'hours', label: 'Délai', type: 'integer', unit: 'heures', min: 0, max: 720 }],
    defaults: { hours: 72 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.reception_quarantine', domain: 'purchasing', section: 'business',
    label: 'Quarantaine de tout lot reçu',
    help: 'Chaque lot reçu reste en quarantaine (ni consommé, ni vendu) jusqu\'à un contrôle de réception conforme, même si l\'article ne l\'exige pas. Activé par défaut dans le profil Santé et pharmacie (mig 712).',
    fields: [{ name: 'enabled', label: 'Mettre en quarantaine à la réception', type: 'boolean' }],
    defaults: { enabled: false },
    storage: { kind: 'policy' }, scopes: ['company', 'store'],
  },
  {
    key: 'purchasing.lot_dlc_enforcement', domain: 'purchasing', section: 'business',
    label: 'Lot fournisseur et DLC à la réception',
    help: 'Que faire quand le lot ou la date limite exigés pour un article ne sont pas saisis.',
    fields: [{ name: 'mode', label: 'Si manquant', type: 'enum', options: MODE_WARN_BLOCK }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.off_contract_enforcement', domain: 'purchasing', section: 'business',
    label: 'Prix hors tarif contractuel (à l\'envoi du BC)',
    help: 'À l\'envoi d\'un bon de commande, le prix de chaque ligne est comparé au tarif contractuel du fournisseur (un tarif saisi ou négocié, pas un prix appris d\'une réception passée). Au-delà de la tolérance, « Bloquer » met le BC en blocage — ni réception ni facture tant qu\'un responsable ne le lève pas ; « Observer » journalise seulement. « Tarif contractuel exigé » étend le contrôle aux articles référencés chez le fournisseur mais sans tarif contractuel. Dormant tant qu\'aucun tarif contractuel n\'est saisi (mig 453).',
    fields: [
      { name: 'mode', label: 'Contrôle', type: 'enum', options: [
        { value: 'off', label: 'Désactivé' },
        { value: 'warn', label: 'Observer (journaliser sans bloquer)' },
        { value: 'block', label: 'Bloquer (poser un blocage)' },
      ] },
      { name: 'price_tol_pct', label: 'Tolérance de dépassement', type: 'percent', min: 0, max: 100 },
      { name: 'require_contract_price', label: 'Tarif contractuel exigé', type: 'boolean' },
    ],
    defaults: { mode: 'warn', price_tol_pct: 5, require_contract_price: false },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.po_requires_request', domain: 'purchasing', section: 'business',
    label: 'Demande d\'achat obligatoire pour un BC',
    help: 'Un bon de commande doit référencer une demande d\'achat pour être envoyé. « Bloquer » refuse l\'envoi d\'un BC sans demande d\'achat, sauf à préciser un motif d\'urgence (tracé sur le BC) ; « Observer » journalise seulement. Beaucoup de BC étant aujourd\'hui des régularisations sans demande, laissez « Observer » tant que le flux demande → BC n\'est pas généralisé (mig 454).',
    fields: [{ name: 'mode', label: 'Contrôle', type: 'enum', options: MODE_WARN_BLOCK }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.invoice_holds_enforcement', domain: 'purchasing', section: 'business',
    label: 'Blocages de facture fournisseur',
    help: 'Un écart de rapprochement (prix, quantité, doublon) bloque-t-il le paiement de la facture ?',
    fields: [{ name: 'mode', label: 'En cas d\'écart', type: 'enum', options: [
      { value: 'block', label: 'Bloquer le paiement' }, { value: 'warn', label: 'Signaler seulement' },
    ] }],
    defaults: { mode: 'block' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'purchasing.cash_limit_enforcement', domain: 'purchasing', section: 'business',
    label: 'Plafond des paiements en espèces',
    help: 'Au-delà du plafond légal par fournisseur, le paiement en espèces n\'est pas déductible.',
    fields: [{ name: 'mode', label: 'Au-delà du plafond', type: 'enum', options: [
      { value: 'warn', label: 'Accepter et marquer non déductible' }, { value: 'block', label: 'Refuser (dérogation administrateur motivée)' },
    ] }],
    defaults: { mode: 'warn' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'accounting.vat_periodicity', domain: 'accounting', section: 'business',
    label: 'Périodicité de la déclaration de TVA',
    help: 'Mensuelle ou trimestrielle selon le régime de l\'entreprise. L\'écran Comptabilité › TVA calcule la déclaration sur un mois ou sur un trimestre en conséquence. Les taux restent ceux du référentiel légal.',
    fields: [{ name: 'mode', label: 'Périodicité', type: 'enum', options: [{ value: 'monthly', label: 'Mensuelle' }, { value: 'quarterly', label: 'Trimestrielle' }] }],
    defaults: { mode: 'monthly' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'accounting.card_commission', domain: 'accounting', section: 'business',
    label: 'Commission sur paiement par carte',
    help: 'Retenue par le prestataire du terminal sur chaque transaction : à 2 %, une vente carte de 100 ¤ crédite 98 ¤ en banque. Appliquée au solde carte de la Caisse et aux écritures de vente (6147 Services bancaires).',
    fields: [{ name: 'pct', label: 'Taux', type: 'percent', min: 0, max: 20 }],
    defaults: { pct: 0 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'payment.rib_change_control', domain: 'accounting', section: 'business',
    label: 'Changement du RIB d\'un fournisseur',
    help: 'Le RIB d\'un fournisseur déjà pourvu d\'un RIB est le premier outil d\'une fraude au virement. Soumis à approbation, le nouveau RIB ne sert qu\'une fois approuvé ; le premier RIB saisi s\'applique sans approbation.',
    fields: [{ name: 'mode', label: 'Changement de RIB', type: 'enum', options: [
      { value: 'approval', label: 'Soumettre à approbation (le RIB actuel reste en place jusque-là)' },
      { value: 'off', label: 'Appliquer tout de suite' },
    ] }],
    defaults: { mode: 'approval' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'payment.rib_freeze_days', domain: 'accounting', section: 'business',
    label: 'Gel des paiements après un changement de RIB',
    help: 'Une campagne de paiement refuse un fournisseur dont le RIB a changé depuis moins de ce nombre de jours. 0 = pas de gel.',
    fields: [{ name: 'days', label: 'Jours de gel', type: 'number', unit: 'jours', min: 0, max: 30 }],
    defaults: { days: 0 },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'ledger.closed_period_policy', domain: 'accounting', section: 'business',
    label: 'Pièce datée d\'une période fermée',
    help: 'Que faire quand la période de la pièce est fermée : l\'écriture est passée au premier jour de la période ouverte (la date de la pièce est conservée et le redatage est tracé), ou la pièce est refusée et part dans « À comptabiliser ».',
    fields: [{ name: 'policy', label: 'Politique', type: 'enum', options: [
      { value: 'redate', label: 'Redater l\'écriture au premier jour de la période ouverte' },
      { value: 'refuse', label: 'Refuser : mettre la pièce en attente' },
    ] }],
    defaults: { policy: 'redate' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'ledger.posting_mode', domain: 'accounting', section: 'business',
    label: 'Comptabilisation automatique',
    help: 'Que faire si l\'écriture comptable d\'une pièce échoue.',
    fields: [{ name: 'mode', label: 'En cas d\'échec', type: 'enum', options: [
      { value: 'outbox', label: 'Enregistrer la pièce, mettre l\'écriture en file à rejouer' },
      { value: 'strict', label: 'Annuler la pièce' },
    ] }],
    defaults: { mode: 'outbox' },
    storage: { kind: 'module_parameters' },
  },
  {
    key: 'company.country_code', domain: 'company', section: 'business',
    label: 'Pays de la société',
    help: 'Choisit le pack pays : codes TVA et identifiants légaux exigés.',
    fields: [{ name: 'code', label: 'Pays', type: 'enum', options: [{ value: 'MA', label: 'Maroc' }] }],
    defaults: { code: 'MA' },
    storage: { kind: 'module_parameters' },
  },
];

export const parameterByKey = (key: string) => PARAMETERS.find(p => p.key === key);

/**
 * Contrôle et normalisation d'une valeur saisie. Les champs absents gardent leur
 * valeur actuelle ; un champ inconnu est refusé. Retourne la valeur complète ou
 * un message d'erreur.
 */
export function validateParameter(def: ParamDef, input: unknown, current: Record<string, unknown>): Record<string, unknown> | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Valeur attendue : un objet de champs';
  const out: Record<string, unknown> = { ...def.defaults, ...current };
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = def.fields.find(x => x.name === name);
    if (!f) return `Champ inconnu : ${name}`;
    switch (f.type) {
      case 'boolean':
        if (typeof raw !== 'boolean') return `${f.label} : oui ou non attendu`;
        out[name] = raw;
        break;
      case 'enum':
        if (!f.options?.some(o => o.value === raw)) return `${f.label} : valeur non proposée`;
        out[name] = raw;
        break;
      case 'list': {
        const arr: unknown[] = Array.isArray(raw)
          ? raw
          : typeof raw === 'string' ? raw.split(/[,;\s]+/).filter(Boolean) : [];
        const nums = arr.map(x => (typeof x === 'number' ? x : Number(x)));
        if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 200)) return `${f.label} : des nombres entiers de 1 à 200 sont attendus`;
        const uniq = [...new Set(nums)].sort((a, b) => a - b);
        if (uniq.length === 0) return `${f.label} : au moins une valeur`;
        out[name] = uniq;
        break;
      }
      case 'time': {
        if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return `${f.label} : heure attendue (HH:MM)`;
        out[name] = raw;
        break;
      }
      case 'date': {
        if (raw === null || raw === '') { out[name] = null; break; }
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return `${f.label} : date attendue`;
        out[name] = raw;
        break;
      }
      default: {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) return `${f.label} : nombre attendu`;
        if (f.type === 'integer' && !Number.isInteger(n)) return `${f.label} : nombre entier attendu`;
        if (f.min !== undefined && n < f.min) return `${f.label} : minimum ${f.min}`;
        if (f.max !== undefined && n > f.max) return `${f.label} : maximum ${f.max}`;
        out[name] = n;
      }
    }
  }
  return out;
}
