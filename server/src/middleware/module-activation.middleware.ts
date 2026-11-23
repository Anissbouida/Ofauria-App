import type { Response, NextFunction } from 'express';
import { resolveRequestUser, type AuthRequest } from './auth.middleware.js';
import { resolveModuleKeys } from '@ofauria/shared';
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
// mais propres à un module activable.
const EXTRA_RULES: GuardRule[] = [
  { prefix: '/projects', modules: ['projects'] },
  { prefix: '/crm', modules: ['crm'] },
  { prefix: '/maintenance', modules: ['maintenance'] },
  { prefix: '/routings', modules: ['production'] },
  { prefix: '/production-markup', modules: ['production', 'recipes'] },
  { prefix: '/lot-thermal', modules: ['production', 'stock'] },
];

// Routes propres à une OPTION / CAPACITÉ de module : fermées quand elle est éteinte.
// Les capacités du socle (mig 632) sont actives par défaut : ces règles ne changent rien
// tant que la société ne les désactive pas.
const FEATURE_RULES: { prefix?: string; pattern?: RegExp; feature: string }[] = [
  { prefix: '/haccp', feature: 'haccp' },
  { prefix: '/lot-thermal', feature: 'lot_thermal' },
  { prefix: '/traceability', feature: 'tracabilite' },
  { prefix: '/quality', feature: 'controle_qualite' },
  { pattern: /^\/production\/(subcontracting(\/|$)|[^/]+\/subcontract(\/|$))/, feature: 'sous_traitance' },
  { pattern: /^\/production\/(serials(\/|$)|[^/]+\/serials(\/|$))/, feature: 'series' },
];

function featureRuleFor(path: string) {
  return FEATURE_RULES.find(r => (r.prefix && (path === r.prefix || path.startsWith(r.prefix + '/'))) || (r.pattern && r.pattern.test(path)));
}

function extraRuleFor(path: string): GuardRule | undefined {
  return EXTRA_RULES.find(r => path === r.prefix || path.startsWith(r.prefix + '/'));
}

export async function moduleActivationGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.method === 'OPTIONS') { next(); return; }
    const rule = ruleFor(req.path) ?? extraRuleFor(req.path);
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
