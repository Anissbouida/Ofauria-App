/**
 * Ce dont un écran a besoin pour exister (audit de cohérence des profils, lot L0).
 *
 * Complète le registre des capacités (capability-screens.ts) : un écran déclare ici le ou les
 * modules dont il lit les données, et les capacités qui lui donnent un sens. Le gabarit de module
 * (useCapabilityScreens), la garde de route (AppLayout) et le test des 18 profils lisent cette
 * même déclaration : plus de masquage écrit à la main d'après le rôle ou le secteur.
 *
 *   modules     tous requis
 *   anyModules  au moins un requis
 *   features    toutes les capacités requises
 *
 * Analogie Oracle : la table des fonctions d'un menu (FND_FORM_FUNCTIONS) avec, pour chacune,
 * les modules sous licence qu'elle exige.
 */
export interface ScreenNeeds { modules?: string[]; anyModules?: string[]; features?: string[] }

export const SCREEN_NEEDS: Readonly<Record<string, ScreenNeeds>> = {
  // Ventes — la caisse et ce qui en dérive.
  'sales:sales:sales': { modules: ['pos'] },
  'sales:sales:returns': { modules: ['pos'] },
  'sales:sales:sessions': { modules: ['pos'] },
  'sales:sales:routes': { modules: ['orders'] },
  'sales:reports:margins': { anyModules: ['recipes', 'production'] },
  'sales:reports:menu': { modules: ['pos'], anyModules: ['recipes', 'production'] },
  // Rapports (mêmes écrans par /reports).
  'reports:menu': { modules: ['pos'], anyModules: ['recipes', 'production'] },
  'reports:margins': { anyModules: ['recipes', 'production'] },
  'reports:cost': { modules: ['production'] },
  // Production.
  'production:costs': { modules: ['production'] },
  'production:replenishment': { modules: ['replenishment'] },
  // Stock.
  'stock:pesee': { features: ['pesage'] },
  'stock:bons': { modules: ['production'] },
  'stock:reservations': { anyModules: ['orders', 'production'] },
  'stock:registre': { features: ['lots'] },
  'stock:aging': { features: ['lots'] },
  'stock:quarantaine': { features: ['quarantaine'] },
  // Achats.
  'purchasing:identification': { modules: ['stock'] },
  'purchasing:price_variances': { modules: ['stock'] },
  // Contrôle.
  'controle:achats': { modules: ['purchasing'] },
  'controle:production': { modules: ['production'] },
  'controle:sav': { modules: ['customers'] },
  // Comptabilité.
  'accounting:caisse': { modules: ['pos'] },
  'accounting:resume': { modules: ['pos'] },
  'accounting:losses': { modules: ['stock', 'products'] },
  // Personnel : commissions des vendeurs, calculées sur les tickets de caisse.
  'employees:commissions': { modules: ['pos'] },
  // Maintenance : renvoi vers les immobilisations de la comptabilité.
  'maintenance:assets': { modules: ['accounting'], features: ['immobilisations'] },
};

/**
 * Adresses d'écran (préfixe) → besoins. Une adresse tapée à la main n'ouvre pas un écran dont le
 * module est éteint (sinon toutes ses API répondraient 403). Les écrans des capacités du registre
 * sont déjà gardés par routeCapability.
 */
export const ROUTE_NEEDS: ReadonlyArray<{ prefix: string; needs: ScreenNeeds }> = [
  { prefix: '/pos', needs: { modules: ['pos'] } },
  { prefix: '/boutique', needs: { anyModules: ['unsold', 'reconciliation'] } },
  { prefix: '/unsold', needs: { modules: ['unsold'] } },
  { prefix: '/reconciliation', needs: { modules: ['reconciliation'] } },
  { prefix: '/replenishment', needs: { modules: ['replenishment'] } },
  { prefix: '/production', needs: { anyModules: ['production', 'replenishment', 'recipes'] } },
  { prefix: '/forecast', needs: { anyModules: ['production', 'replenishment'] } },
  { prefix: '/recipes', needs: { modules: ['recipes'] } },
  { prefix: '/haccp', needs: { anyModules: ['production', 'controle'], features: ['haccp'] } },
  { prefix: '/traceability', needs: { features: ['tracabilite'] } },
  { prefix: '/stock', needs: { modules: ['stock'] } },
  { prefix: '/inventory', needs: { modules: ['stock'] } },
  { prefix: '/warehouse', needs: { modules: ['stock'] } },
  { prefix: '/packaging', needs: { modules: ['stock'] } },
  { prefix: '/orders', needs: { modules: ['orders'] } },
  { prefix: '/delivery-notes', needs: { modules: ['orders'] } },
  { prefix: '/crm', needs: { modules: ['crm'] } },
  { prefix: '/customers', needs: { modules: ['customers'] } },
  { prefix: '/products', needs: { modules: ['products'] } },
  { prefix: '/purchasing', needs: { modules: ['purchasing'] } },
  { prefix: '/accounting', needs: { modules: ['accounting'] } },
  { prefix: '/employees', needs: { modules: ['employees'] } },
  { prefix: '/projects', needs: { modules: ['projects'] } },
  { prefix: '/maintenance', needs: { modules: ['maintenance'] } },
  { prefix: '/controle', needs: { modules: ['controle'] } },
  { prefix: '/reports', needs: { modules: ['reports'] } },
];

/**
 * Paramètres et politiques → besoins (lot L5) : un réglage n'est proposé (Paramètres, Politiques,
 * assistant) que si ce qu'il règle existe pour la société.
 */
export const PARAM_NEEDS: Readonly<Record<string, ScreenNeeds>> = {
  'sales.closure': { modules: ['unsold'] },
  'sales.pos_stock': { modules: ['pos'], features: ['vitrine'] },
  'sales.person_sizes': { modules: ['pos'], features: ['vitrine'] },
  'sales.returns': { modules: ['pos'] },
  'sales.staff_discount': { modules: ['pos'] },
  'sales.quotes': { features: ['devis'] },
  'sales.dunning': { features: ['relances'] },
  'accounting.card_commission': { modules: ['pos'] },
  'purchasing.lot_dlc_enforcement': { modules: ['stock'], features: ['lots'] },
  'purchasing.reception_quarantine': { modules: ['stock'], features: ['quarantaine'] },
  'purchasing.supplier_score': { features: ['evaluation_fournisseurs'] },
  'production.showcase_time': { features: ['vitrine'] },
  'quality.ccp_rule': { features: ['ccp_cuisson'] },
  'quality.auto_release': { features: ['controle_qualite'] },
  'stock.dlc_alerts': { modules: ['stock'], features: ['dlc_ddm'] },
  'stock.negative_policy': { modules: ['stock'] },
  'stock.low_stock_alerts': { modules: ['stock'] },
  'stock.organization': { modules: ['stock'] },
};

export interface NeedsContext { moduleActive: (m: string) => boolean; hasFeature: (f: string) => boolean }

/** Les besoins sont-ils remplis pour la société ? */
export function needsMet(needs: ScreenNeeds | undefined, ctx: NeedsContext): boolean {
  if (!needs) return true;
  if (needs.modules && !needs.modules.every(m => ctx.moduleActive(m))) return false;
  if (needs.anyModules && !needs.anyModules.some(m => ctx.moduleActive(m))) return false;
  if (needs.features && !needs.features.every(f => ctx.hasFeature(f))) return false;
  return true;
}

/** Besoins de l'écran `view` du module `module`. */
export function screenNeeds(module: string, view: string): ScreenNeeds | undefined {
  return SCREEN_NEEDS[`${module}:${view}`];
}

/** Besoins d'une adresse d'écran (préfixe le plus long), ou undefined. */
export function routeNeeds(pathname: string): ScreenNeeds | undefined {
  let best: { prefix: string; needs: ScreenNeeds } | undefined;
  for (const r of ROUTE_NEEDS) {
    if ((pathname === r.prefix || pathname.startsWith(r.prefix + '/')) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best?.needs;
}
