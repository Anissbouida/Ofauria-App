/**
 * Catalogue des écrans configurables (plan d'exécution multi-industries, étape 10, pas 10a,
 * 10b, 10g ; mig 646).
 *
 * Le configurateur ne propose QUE les éléments déclarés ici. Un élément verrouillé (numéro,
 * statut, alerte de blocage) ne se masque pas ; l'ordre de tous se règle. Les clés des
 * sections de l'ordre reprennent celles du registre client (planPanelRules.ts).
 */
export type ScreenElementKind = 'columns' | 'sections' | 'filters';
export interface ScreenElement { key: string; label: string; locked?: string; group?: string }
export interface ScreenDef { key: string; label: string; kinds: Partial<Record<ScreenElementKind, ScreenElement[]>> }

export const SCREEN_CATALOG: ScreenDef[] = [
  {
    key: 'production.plans', label: 'Liste des ordres de fabrication',
    kinds: {
      columns: [
        { key: 'number', label: 'N° d\'ordre', locked: 'Identifie l\'ordre.' },
        { key: 'date', label: 'Date' },
        { key: 'status', label: 'Statut', locked: 'Dit où en est l\'ordre.' },
        { key: 'type', label: 'Type' },
        { key: 'workshop', label: 'Atelier' },
        { key: 'items', label: 'Produits' },
        { key: 'created_by', label: 'Créé par' },
        { key: 'order', label: 'Commande liée' },
      ],
    },
  },
  {
    key: 'production.plan', label: 'Fiche de l\'ordre de fabrication',
    kinds: {
      sections: [
        { key: 'bon-sortie', label: 'Bon de sortie', group: 'preparation', locked: 'Le magasinier en a besoin pour servir l\'ordre.' },
        { key: 'stock-warnings', label: 'Alertes de disponibilité', group: 'preparation', locked: 'Alerte de blocage.' },
        { key: 'no-needs', label: 'Aucun besoin calculé', group: 'preparation', locked: 'Alerte de blocage.' },
        { key: 'lot-traceability', label: 'Traçabilité des lots', group: 'preparation' },
        { key: 'subcontract', label: 'Sous-traitance', group: 'synthese', locked: 'Envoi et réception passent par ce panneau.' },
        { key: 'linked-order', label: 'Commande client liée', group: 'synthese' },
        { key: 'consumption', label: 'Consommation des matières', group: 'synthese' },
        { key: 'custom-fields', label: 'Champs personnalisés', group: 'synthese' },
        { key: 'history', label: 'Historique', group: 'synthese' },
        { key: 'quality', label: 'Contrôle qualité', group: 'synthese' },
        { key: 'retro-planning', label: 'Rétro-planning', group: 'production' },
        { key: 'serials', label: 'Numéros de série', group: 'production' },
        { key: 'steps', label: 'Étapes', group: 'production' },
        { key: 'yield', label: 'Rendement', group: 'production' },
        { key: 'observations', label: 'Observations du lancement', group: 'production' },
        { key: 'cost', label: 'Coût de revient', group: 'couts' },
      ],
    },
  },
  {
    // Étape 10e : tableau de bord de production, par profil et par rôle.
    key: 'production.dashboard', label: 'Tableau de bord de production',
    kinds: {
      sections: [
        { key: 'blocked-alert', label: 'Alerte : ordres à relancer', locked: 'Alerte de blocage.' },
        { key: 'kpis', label: 'Chiffres de la période' },
        { key: 'relaunch', label: 'Ordres à relancer' },
        { key: 'cost-split', label: 'Répartition des coûts' },
        { key: 'yield', label: 'Rendement par produit' },
        { key: 'cost-per-day', label: 'Coûts par jour' },
        { key: 'reports', label: 'Rapports du profil' },
      ],
    },
  },
  {
    key: 'recipes.list', label: 'Liste des fiches techniques',
    kinds: {
      columns: [
        { key: 'name', label: 'Fiche', locked: 'Identifie la fiche.' },
        { key: 'type', label: 'Type' },
        { key: 'format', label: 'Format' },
        { key: 'yield', label: 'Rendement' },
        { key: 'loss', label: 'Perte (%)' },
        { key: 'net', label: 'Rendement net' },
        { key: 'cost', label: 'Coût matière' },
        { key: 'unit_cost', label: 'Coût par unité' },
        { key: 'used_by', label: 'Utilisée par' },
        { key: 'margin', label: 'Marge matière' },
      ],
    },
  },
];

export const screenDef = (key: string) => SCREEN_CATALOG.find(s => s.key === key);

/** Définition d'un écran : éléments ordonnés et visibilité, par nature. */
export type ScreenDefinition = Partial<Record<ScreenElementKind, { key: string; visible: boolean; order: number }[]>> & {
  custom_fields?: { key: string; section: string }[];
};

/**
 * Applique une définition à une liste de clés (ordre du code par défaut) : ordre de la
 * définition, éléments masqués retirés (sauf verrouillés). Un élément absent de la définition
 * garde sa place relative, après les éléments ordonnés.
 */
export function applyScreenDefinition(screenKey: string, kind: ScreenElementKind, keys: string[], def?: ScreenDefinition | null): string[] {
  const rows = def?.[kind];
  if (!rows?.length) return keys;
  const locked = new Set((screenDef(screenKey)?.kinds[kind] ?? []).filter(e => e.locked).map(e => e.key));
  const byKey = new Map(rows.map(r => [r.key, r]));
  const visible = keys.filter(k => locked.has(k) || byKey.get(k)?.visible !== false);
  return visible
    .map((k, i) => ({ k, o: byKey.get(k)?.order ?? 10_000 + i }))
    .sort((a, b) => a.o - b.o)
    .map(x => x.k);
}
