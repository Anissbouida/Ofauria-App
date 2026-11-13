import type { Request, Response, NextFunction } from 'express';
import { resolveModuleKeys } from '@ofauria/shared';
import { ruleFor, type GuardRule } from './module-guard.middleware.js';
import { sectorRepository } from '../repositories/sector.repository.js';

/**
 * Garde d'activation des modules (plan Production générique, lot P0a, mig 507).
 *
 * Un module désactivé (par le secteur ou par un ajustement dans Paramètres ›
 * Secteur et modules) est fermé côté API, plus seulement masqué dans les menus.
 * La règle vaut pour TOUS les utilisateurs, administrateur compris : c'est la
 * configuration de la société, pas un droit personnel.
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

function extraRuleFor(path: string): GuardRule | undefined {
  return EXTRA_RULES.find(r => path === r.prefix || path.startsWith(r.prefix + '/'));
}

export async function moduleActivationGuard(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method === 'OPTIONS') { next(); return; }
    const rule = ruleFor(req.path) ?? extraRuleFor(req.path);
    if (!rule) { next(); return; }
    const { modules: active } = await sectorRepository.activation();
    const open = rule.modules.some(m => resolveModuleKeys(m).some(k => active.has(k as never)));
    if (open) { next(); return; }
    res.status(403).json({
      success: false,
      error: { code: 'MODULE_DISABLED', message: 'Ce module est désactivé pour la société (Paramètres › Secteur et modules)' },
    });
  } catch (err) {
    next(err);
  }
}
