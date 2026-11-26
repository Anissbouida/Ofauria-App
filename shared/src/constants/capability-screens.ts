/**
 * Registre des capacités hors Production (feuille de route « Kalum piloté par le profil »,
 * phase 1, étapes 1.3 et 1.4 ; mig 710).
 *
 * Une seule déclaration par capacité, lue :
 *   - par la garde d'activation du serveur (`api`) : route fermée quand la capacité est éteinte ;
 *   - par le menu des modules (`screens`, au format « module:écran ») : entrée masquée ;
 *   - par les tests, qui vérifient que la migration inscrit bien chaque clé dans app_features.
 *
 * Règle : une capacité correspond à un écran (ou un groupe d'écrans) qui existe déjà. Elle est
 * active par défaut (socle) ; un profil peut l'éteindre par défaut (sector_packs.off_features),
 * la société peut toujours la rallumer. Les données ne sont jamais touchées.
 */
export interface CapabilityScreenDef {
  key: string;
  /** Module dont la capacité dépend (une capacité n'est effective que si son module l'est). */
  module: string;
  label: string;
  description: string;
  /** Écrans du menu : « module:clé de l'écran » (clé de ModuleView). */
  screens: string[];
  /** Préfixes d'API, relatifs à /api/v1. */
  api: string[];
  requires?: string[];
}

export const CAPABILITY_SCREENS: CapabilityScreenDef[] = [
  // ── Ventes ──
  { key: 'devis', module: 'sales', label: 'Devis et proformas',
    description: 'Devis clients, proformas et conversion en commande.',
    screens: ['sales:quotes'], api: ['/quotes'] },
  { key: 'contrats_cadres', module: 'sales', label: 'Contrats-cadres',
    description: 'Accords de prix et de volumes sur une période, appelés par les commandes.',
    screens: ['sales:sales-contracts'], api: ['/sales-contracts'] },
  { key: 'ristournes', module: 'sales', label: 'Ristournes',
    description: 'Remises de fin de période calculées sur le chiffre d\'affaires d\'un client.',
    screens: ['sales:rebates'], api: ['/rebates'] },
  { key: 'abonnements', module: 'sales', label: 'Abonnements',
    description: 'Facturation récurrente d\'un client à échéances fixes.',
    screens: ['sales:sales:subscriptions'], api: ['/subscriptions'] },
  { key: 'relances', module: 'sales', label: 'Relances clients',
    description: 'Niveaux de relance des impayés, lettres et blocage du crédit.',
    screens: ['sales:dunning'], api: ['/dunning'] },
  { key: 'objectifs_vente', module: 'sales', label: 'Objectifs de vente',
    description: 'Objectifs par vendeur, par période, comparés au réalisé.',
    screens: ['sales:sales-targets'], api: ['/sales-targets'] },
  { key: 'retours_transferts', module: 'sales', label: 'Retours et transferts',
    description: 'Retours des clients professionnels et transferts de produits entre points de vente.',
    screens: ['sales:pro-returns', 'sales:product-transfers'], api: ['/pro-returns', '/product-transfers'] },
  { key: 'tournees_livraison', module: 'sales', label: 'Tournées de livraison',
    description: 'Tournées, arrêts et ordre de passage des livraisons aux clients.',
    screens: ['sales:sales:routes'], api: ['/delivery-routes'] },
  { key: 'promotions_fidelite', module: 'pos', label: 'Promotions et fidélité',
    description: 'Promotions, codes de réduction et points de fidélité à la caisse.',
    screens: ['sales:promotions'], api: ['/promotions', '/loyalty'] },
  // ── Achats ──
  { key: 'appels_offres', module: 'purchasing', label: 'Demandes de prix',
    description: 'Consultation de plusieurs fournisseurs et comparaison des offres.',
    screens: ['purchasing:rfq'], api: ['/rfqs'] },
  { key: 'frais_approche', module: 'purchasing', label: 'Frais d\'approche',
    description: 'Transport, douane et transit répartis sur le coût des articles reçus.',
    screens: ['purchasing:landed'], api: ['/landed-costs'] },
  { key: 'evaluation_fournisseurs', module: 'purchasing', label: 'Évaluation des fournisseurs',
    description: 'Notes de délai, de qualité et de prix par fournisseur.',
    screens: ['purchasing:scores'], api: ['/supplier-scores'] },
  // ── Comptabilité ──
  { key: 'immobilisations', module: 'accounting', label: 'Immobilisations',
    description: 'Registre des immobilisations, amortissements et cessions.',
    screens: ['accounting:immobilisations'], api: ['/fixed-assets'] },
  { key: 'charges_avance', module: 'accounting', label: 'Charges payées d\'avance',
    description: 'Charges constatées d\'avance étalées sur leur période.',
    screens: ['accounting:cca'], api: ['/prepaid-charges'] },
  { key: 'retenue_source', module: 'accounting', label: 'Retenues à la source',
    description: 'Retenues sur les factures fournisseurs et leur déclaration.',
    screens: ['accounting:ras'], api: ['/withholding'] },
  { key: 'analytique', module: 'accounting', label: 'Comptabilité analytique',
    description: 'Centres de coût et répartition analytique des écritures.',
    screens: ['accounting:costcenters'], api: ['/cost-centers'] },
  // ── Personnel ──
  { key: 'avances_salaire', module: 'employees', label: 'Avances sur salaire',
    description: 'Avances versées aux employés et retenues sur la paie.',
    screens: ['employees:advances'], api: ['/salary-advances'] },
  { key: 'commissions', module: 'employees', label: 'Commissions commerciales',
    description: 'Barèmes de commission par vendeur et relevés par période.',
    screens: ['employees:commissions'], api: ['/commissions'] },
];

const BY_SCREEN = new Map<string, string>(
  CAPABILITY_SCREENS.flatMap(c => c.screens.map(s => [s, c.key] as [string, string])),
);

/** Capacité dont dépend l'écran `view` du module `module` (aucune : undefined). */
export function screenCapability(module: string, view: string): string | undefined {
  return BY_SCREEN.get(`${module}:${view}`);
}

/** Règles d'API des capacités : préfixe → capacité. */
export function capabilityApiRules(): { prefix: string; feature: string }[] {
  return CAPABILITY_SCREENS.flatMap(c => c.api.map(prefix => ({ prefix, feature: c.key })));
}
