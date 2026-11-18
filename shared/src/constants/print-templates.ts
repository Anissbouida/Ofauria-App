/**
 * Gabarits d'impression du module de fabrication (M8-04, mig 582).
 *
 * Catalogue figé : pour chaque document, les colonnes (ou rubriques) que l'utilisateur peut
 * afficher ou masquer, et les valeurs par défaut (titre, signatures, mention de pied de page).
 * Le paramétrage enregistré (document_templates + variantes par type d'ordre) ne fait que
 * choisir dans ce catalogue : une colonne inconnue est refusée par le serveur.
 * Les numéros (lot, bon de sortie) restent toujours fournis par le serveur (G0-25).
 */
export type ProductionPrintDoc = 'production_ticket' | 'production_bon_sortie' | 'production_fiche' | 'recipe_fiche';

export interface PrintDocDefinition {
  label: string;
  defaultTitle: string;
  /** Colonnes ou rubriques affichables, dans l'ordre d'impression. */
  columns: { key: string; label: string }[];
  defaultSignatures: string[];
  defaultFooter: string | null;
  /** Le document a-t-il des cases de signature (le ticket et la fiche technique non). */
  hasSignatures: boolean;
}

export const PRODUCTION_PRINT_DOCS: Record<ProductionPrintDoc, PrintDocDefinition> = {
  production_ticket: {
    label: 'Ticket de lot',
    defaultTitle: 'Ticket de lot',
    columns: [
      { key: 'quantity', label: 'Quantité produite' },
      { key: 'production_date', label: 'Date de production' },
      { key: 'produced_by', label: 'Produit par' },
      { key: 'expiry', label: "Date d'expiration" },
      { key: 'plan_number', label: 'N° d\'ordre' },
      { key: 'workshop', label: 'Atelier' },
      { key: 'cycle', label: 'Cycle de vente' },
      { key: 'barcode', label: 'Numéro de lot en pied' },
    ],
    defaultSignatures: [],
    defaultFooter: 'Conservez ce ticket pour la traçabilité',
    hasSignatures: false,
  },
  production_bon_sortie: {
    label: 'Bon de sortie',
    defaultTitle: 'Bon de sortie ingrédients',
    columns: [
      { key: 'index', label: '#' },
      { key: 'ingredient', label: 'Article' },
      { key: 'quantity', label: 'Qté requise' },
      { key: 'unit', label: 'Unité' },
      { key: 'lot', label: 'Lot à utiliser' },
      { key: 'expiry', label: "Date d'exp." },
      { key: 'served', label: 'Servi' },
      { key: 'observations', label: 'Cadre Observations' },
    ],
    defaultSignatures: ['Chef de production', 'Magasinier'],
    defaultFooter: null,
    hasSignatures: true,
  },
  production_fiche: {
    label: 'Fiche de production',
    defaultTitle: 'Fiche de production',
    columns: [
      { key: 'product', label: 'Produit' },
      { key: 'planned', label: 'Planifié' },
      { key: 'produced', label: 'Produit' },
      { key: 'gap', label: 'Écart' },
      { key: 'produced_by', label: 'Produit par' },
      { key: 'production_date', label: 'Date production' },
      { key: 'expiry', label: 'Date expiration' },
      { key: 'status', label: 'Statut' },
    ],
    defaultSignatures: ['Chef de production', 'Responsable qualité', 'Direction'],
    defaultFooter: null,
    hasSignatures: true,
  },
  recipe_fiche: {
    label: 'Fiche technique',
    defaultTitle: 'Fiche technique',
    columns: [],
    defaultSignatures: [],
    defaultFooter: null,
    hasSignatures: false,
  },
};

export const PRODUCTION_PRINT_DOC_TYPES = Object.keys(PRODUCTION_PRINT_DOCS) as ProductionPrintDoc[];

/** Gabarit résolu (base + variante du type d'ordre), prêt à l'impression. */
export interface ResolvedPrintTemplate {
  docType: ProductionPrintDoc;
  title: string;
  columns: string[];
  signatures: string[];
  footer: string | null;
  /** Origine du réglage : défaut du code, modèle général ou variante du type d'ordre. */
  source: 'default' | 'base' | 'variant';
}

/** Gabarit par défaut (aucun réglage enregistré) : reproduit l'impression historique. */
export function defaultPrintTemplate(docType: ProductionPrintDoc): ResolvedPrintTemplate {
  const d = PRODUCTION_PRINT_DOCS[docType];
  return {
    docType, title: d.defaultTitle, columns: d.columns.map(c => c.key),
    signatures: [...d.defaultSignatures], footer: d.defaultFooter, source: 'default',
  };
}
