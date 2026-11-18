/**
 * Vocabulaire modifiable (M8-03, mig 583) : les termes métier que l'application affiche
 * selon le secteur (sector_labels) et que la société peut renommer (company_label_overrides).
 * `fallback` = terme affiché quand ni le secteur ni la société n'en fixent un (terme historique,
 * boulangerie). Une clé absente de ce catalogue est refusée par le serveur.
 */
export interface VocabularyKey { key: string; group: string; designates: string; fallback: string }

export const VOCABULARY_KEYS: VocabularyKey[] = [
  { key: 'production', group: 'Navigation', designates: 'Module de production', fallback: 'Production' },
  { key: 'product', group: 'Navigation', designates: 'Article vendu ou fabriqué', fallback: 'Produit' },
  { key: 'products', group: 'Navigation', designates: 'Articles (pluriel)', fallback: 'Produits' },
  { key: 'production_plan', group: 'Ordres', designates: 'Ordre de fabrication', fallback: 'Plan de production' },
  { key: 'production_plans', group: 'Ordres', designates: 'Ordres de fabrication (pluriel)', fallback: 'Plans de production' },
  { key: 'new_plan', group: 'Ordres', designates: 'Bouton de création d\'un ordre', fallback: 'Nouveau plan' },
  { key: 'batch', group: 'Ordres', designates: 'Unité de fabrication (lot)', fallback: 'Fournée' },
  { key: 'batch_cost', group: 'Ordres', designates: 'Coût d\'une unité de fabrication', fallback: 'Coût fournée' },
  { key: 'recipe', group: 'Nomenclatures', designates: 'Nomenclature (fiche de composition)', fallback: 'Recette' },
  { key: 'recipes', group: 'Nomenclatures', designates: 'Nomenclatures (pluriel)', fallback: 'Recettes' },
  { key: 'finished_product', group: 'Nomenclatures', designates: 'Produit fini', fallback: 'Produit fini' },
  { key: 'finished_products_tab', group: 'Nomenclatures', designates: 'Onglet des produits finis', fallback: 'Recettes produits finis' },
  { key: 'base_prep', group: 'Nomenclatures', designates: 'Sous-ensemble (préparation intermédiaire)', fallback: 'Préparation de base' },
  { key: 'base_preps', group: 'Nomenclatures', designates: 'Sous-ensembles (pluriel)', fallback: 'Préparations de base' },
  { key: 'formats_tab', group: 'Nomenclatures', designates: 'Onglet des conditionnements', fallback: 'Formats de production' },
  { key: 'yield', group: 'Nomenclatures', designates: 'Quantité produite par la nomenclature', fallback: 'Rendement' },
  { key: 'search_recipes', group: 'Nomenclatures', designates: 'Texte d\'aide de la recherche', fallback: 'Rechercher une recette ou un produit...' },
  { key: 'search_base_preps', group: 'Nomenclatures', designates: 'Texte d\'aide de la recherche des sous-ensembles', fallback: 'Rechercher une préparation de base...' },
];

export const VOCABULARY_KEY_SET = new Set(VOCABULARY_KEYS.map(k => k.key));
