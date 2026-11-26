import type { Response, NextFunction } from 'express';
import { resolveRequestUser, type AuthRequest } from './auth.middleware.js';
import { resolveModuleKeys, capabilityApiRules } from '@ofauria/shared';
import { ruleFor, type GuardRule } from './module-guard.middleware.js';
import { sectorRepository } from '../repositories/sector.repository.js';

/**
 * Garde d'activation des modules (plan Production générique, lot P0a, mig 507).
 *
 * Un module désactivé (par le secteur ou par un ajustement dans Paramètres ›
 * Secteur et modules) est fermé côté API, plus seulement masqué dans les menus.
 * La règle vaut pour TOUS les utilisateurs, administrateur compris : c'est la
 * configuration de la société, pas un droit personnel. Pilotes et établissements
 * (mig 509) : on lit les modules visibles par l'utilisateur de la requête ; sans
 * jeton valide, ceux de la société (l'authentification de la route répondra 401).
 *
 * Elle réutilise la table préfixe → modules de la garde des droits : l'appel passe
 * si l'un des modules du préfixe est actif. Les modules « alsoRead » n'en font pas
 * partie : ils ouvrent la LECTURE à un autre rôle (le magasinier lit la production),
 * pas l'activation (sans Production, ses écrans n'ont rien à lire). Les données ne
 * sont jamais touchées : réactiver le module rouvre l'API telle quelle.
 */

// Préfixes absents de la garde des droits (contrôlés par module dans leurs routes)
// mais propres à un module activable. Feuille de route, étape 1.2 : toute route métier montée
// dans routes/index.ts est déclarée ici, dans RULES (garde des droits) ou dans EXEMPT_PREFIXES ;
// le test route-activation-coverage-guard le vérifie. La liste des modules d'une règle inclut
// ceux dont les écrans LISENT la route : elle reste ouverte tant que l'un d'eux est actif.
const EXTRA_RULES: GuardRule[] = [
  { prefix: '/projects', modules: ['projects'] },
  { prefix: '/crm', modules: ['crm'] },
  { prefix: '/maintenance', modules: ['maintenance'] },
  { prefix: '/routings', modules: ['production'] },
  { prefix: '/production-markup', modules: ['production', 'recipes'] },
  { prefix: '/lot-thermal', modules: ['production', 'stock'] },
  // Personnel
  { prefix: '/attendance', modules: ['employees', 'production'] },
  { prefix: '/shifts', modules: ['employees', 'production'] },
  { prefix: '/schedules', modules: ['employees', 'production'] },
  { prefix: '/leaves', modules: ['employees'] },
  { prefix: '/payroll', modules: ['employees'] },
  { prefix: '/weekly-payroll', modules: ['employees'] },
  { prefix: '/salary-advances', modules: ['employees'] },
  { prefix: '/commissions', modules: ['employees', 'sales'] },
  // Ventes
  { prefix: '/quotes', modules: ['sales', 'orders', 'crm'] },
  { prefix: '/sales-contracts', modules: ['sales', 'orders'] },
  { prefix: '/sales-targets', modules: ['sales'] },
  { prefix: '/rebates', modules: ['sales'] },
  { prefix: '/subscriptions', modules: ['sales'] },
  { prefix: '/dunning', modules: ['sales', 'accounting'] },
  { prefix: '/delivery-routes', modules: ['sales', 'orders'] },
  { prefix: '/pro-returns', modules: ['sales', 'orders'] },
  { prefix: '/product-transfers', modules: ['sales', 'orders'] },
  { prefix: '/pricing', modules: ['sales', 'pos', 'products'] },
  { prefix: '/sales-channels', modules: ['sales', 'pos', 'products'] },
  { prefix: '/promotions', modules: ['pos', 'sales', 'customers'] },
  { prefix: '/loyalty', modules: ['pos', 'sales', 'customers'] },
  { prefix: '/pos', modules: ['pos'] },
  { prefix: '/sachet-config', modules: ['pos'] },
  { prefix: '/complaints', modules: ['controle', 'sales'] },
  { prefix: '/progress-billings', modules: ['sales'] },
  // Achats
  { prefix: '/rfqs', modules: ['purchasing'] },
  { prefix: '/landed-costs', modules: ['purchasing'] },
  { prefix: '/supplier-scores', modules: ['purchasing', 'accounting'] },
  { prefix: '/supplier-items', modules: ['purchasing', 'stock', 'accounting', 'production'] },
  { prefix: '/payment-runs', modules: ['accounting', 'purchasing'] },
  // Comptabilité
  { prefix: '/cost-centers', modules: ['accounting'] },
  { prefix: '/prepaid-charges', modules: ['accounting'] },
  // Stock
  { prefix: '/stock-counts', modules: ['stock', 'production'] },
  { prefix: '/stock-locations', modules: ['stock', 'production'] },
];

/**
 * Routes du socle, jamais fermées par l'activation : chacune se justifie ici.
 * Connexion et comptes, paramètres et référentiels (droit « Paramètres »), recherche,
 * notifications, fichiers, moteur d'approbation (transversal), devises, champs personnalisés
 * (lus par tous les modules), annuaire du personnel (lu par Utilisateurs, Production,
 * Commandes), établissements, imprimantes (matériel), règles d'automatisation (Paramètres).
 */
export const EXEMPT_PREFIXES: readonly string[] = [
  '/auth', '/users', '/settings', '/params', '/search', '/notifications', '/upload', '/files',
  '/approvals', '/currencies', '/custom-fields', '/employees', '/stores', '/printers', '/automation',
];

// Routes propres à une OPTION / CAPACITÉ de module : fermées quand elle est éteinte.
// Les capacités du socle (mig 632, 710) sont actives par défaut : ces règles ne changent rien
// tant que la société ne les désactive pas. Celles des modules hors Production viennent du
// registre partagé (CAPABILITY_SCREENS), qui masque aussi l'écran correspondant.
const FEATURE_RULES: { prefix?: string; pattern?: RegExp; feature: string }[] = [
  { prefix: '/haccp', feature: 'haccp' },
  { prefix: '/lot-thermal', feature: 'lot_thermal' },
  { prefix: '/traceability', feature: 'tracabilite' },
  { prefix: '/quality', feature: 'controle_qualite' },
  { pattern: /^\/production\/(subcontracting(\/|$)|[^/]+\/subcontract(\/|$))/, feature: 'sous_traitance' },
  { pattern: /^\/production\/(serials(\/|$)|[^/]+\/serials(\/|$))/, feature: 'series' },
  ...capabilityApiRules(),
];

// Appels qu'une capacité éteinte ne ferme pas : la caisse calcule toujours son total par
// /promotions/evaluate (sans promotion quand la capacité est éteinte, voir services/promotions).
const FEATURE_OPEN = new Set<string>(['/promotions/evaluate']);

export function featureRuleFor(path: string) {
  if (FEATURE_OPEN.has(path)) return undefined;
  return FEATURE_RULES.find(r => (r.prefix && (path === r.prefix || path.startsWith(r.prefix + '/'))) || (r.pattern && r.pattern.test(path)));
}

function extraRuleFor(path: string): GuardRule | undefined {
  let best: GuardRule | undefined;
  for (const r of EXTRA_RULES) {
    if ((path === r.prefix || path.startsWith(r.prefix + '/')) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best;
}

/** Règle d'activation d'un chemin : garde des droits d'abord, puis règles propres. */
export function activationRuleFor(path: string): GuardRule | undefined {
  return ruleFor(path) ?? extraRuleFor(path);
}

export async function moduleActivationGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.method === 'OPTIONS') { next(); return; }
    const rule = activationRuleFor(req.path);
    const featureRule = featureRuleFor(req.path);
    if (!rule && !featureRule) { next(); return; }
    if (!req.user) {
      const r = await resolveRequestUser(req);
      if (!('error' in r)) req.user = r.user;
    }
    const { modules: active, features } = req.user
      ? await sectorRepository.forUser(req.user)
      : await sectorRepository.activation();
    if (rule && !rule.modules.some(m => resolveModuleKeys(m).some(k => active.has(k as never)))) {
      res.status(403).json({
        success: false,
        error: { code: 'MODULE_DISABLED', message: 'Ce module est désactivé pour la société (Paramètres › Secteur et modules)' },
      });
      return;
    }
    if (featureRule && !features.has(featureRule.feature)) {
      res.status(403).json({
        success: false,
        error: { code: 'FEATURE_DISABLED', message: 'Cette option est désactivée pour la société (Paramètres › Secteur et modules)' },
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
