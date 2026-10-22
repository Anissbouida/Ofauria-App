import type { Response, NextFunction } from 'express';
import { resolveRequestUser, type AuthRequest } from './auth.middleware.js';
import { effectiveRights, enforcementMode, hasRight, type RightAction } from '../services/access-rights.js';
import { authEventRepository } from '../repositories/auth-event.repository.js';

/**
 * Garde des droits par module (audit Paramètres, lot 3, mig 330).
 *
 * Les routes restent protégées par leur liste de rôles (authorize) : elle fixe
 * le périmètre technique. La garde ajoute le droit par module, montée une fois
 * devant toutes les routes (routes/index.ts) : un module retiré à un utilisateur
 * ou à un rôle bloque désormais l'API, plus seulement le menu.
 *
 * Règle : l'appel est accordé si l'utilisateur a, sur l'un des modules du
 * préfixe, le droit correspondant à la méthode HTTP (GET voir, POST créer,
 * PUT/PATCH modifier, DELETE supprimer). Les listes de référence lues par
 * d'autres écrans (catalogue, catégories) restent ouvertes en lecture.
 *
 * Mode (Utilisateurs › Rôles) : « log » journalise les refus sans bloquer
 * (Journal › Connexions, « Accès hors droits »), « enforce » répond 403.
 */

interface Rule {
  prefix: string;
  modules: string[];
  /** GET ouvert à tout utilisateur connecté (listes de référence). */
  readOpen?: boolean;
  /** Modules supplémentaires donnant la seule lecture (écrans voisins). */
  alsoRead?: string[];
}

// Les préfixes non listés ne passent pas par la garde : authentification, comptes
// (administrateur), Personnel (déjà contrôlé par module), Paramètres et listes de
// paramétrage (droit « Paramètres »), notifications, téléversements.
const RULES: Rule[] = [
  { prefix: '/categories', modules: ['products'], readOpen: true },
  { prefix: '/products', modules: ['products'], readOpen: true },
  { prefix: '/product-pipeline', modules: ['products'], readOpen: true },
  { prefix: '/customers', modules: ['customers', 'pos', 'orders'] },
  { prefix: '/orders', modules: ['orders', 'pos'], alsoRead: ['production'] },
  { prefix: '/sales', modules: ['sales', 'pos', 'reports', 'reconciliation', 'dashboard'] },
  { prefix: '/returns', modules: ['pos', 'sales'] },
  { prefix: '/cash-register', modules: ['pos', 'sales', 'accounting'] },
  { prefix: '/caisse-import', modules: ['accounting', 'pos'] },
  { prefix: '/caisse', modules: ['accounting', 'pos'] },
  { prefix: '/manual-shift-entries', modules: ['accounting', 'pos', 'reconciliation'] },
  { prefix: '/inventory-checks', modules: ['pos', 'unsold', 'reconciliation', 'controle'] },
  { prefix: '/unsold-decisions', modules: ['unsold', 'pos'], alsoRead: ['production'] },
  { prefix: '/reconciliation', modules: ['reconciliation', 'pos', 'unsold'] },
  { prefix: '/inventory', modules: ['stock', 'purchasing'] },
  { prefix: '/ingredients', modules: ['stock', 'purchasing', 'recipes', 'production'] },
  { prefix: '/ingredient-lots', modules: ['stock', 'production'] },
  { prefix: '/bons-sortie', modules: ['stock', 'production'] },
  { prefix: '/packaging-items', modules: ['packaging', 'stock'], alsoRead: ['pos'] },
  { prefix: '/product-lots', modules: ['production', 'stock'] },
  { prefix: '/stock-frigo', modules: ['production', 'stock'] },
  { prefix: '/recipes', modules: ['recipes', 'production'], alsoRead: ['stock'] },
  { prefix: '/production-etapes', modules: ['production'], alsoRead: ['stock'] },
  { prefix: '/production-cout', modules: ['production', 'recipes'], alsoRead: ['stock'] },
  { prefix: '/production', modules: ['production'], alsoRead: ['stock'] },
  { prefix: '/contenants', modules: ['production', 'stock'] },
  { prefix: '/replenishment', modules: ['replenishment'] },
  { prefix: '/product-losses', modules: ['controle', 'production', 'pos', 'unsold', 'stock'] },
  { prefix: '/purchase-orders', modules: ['purchasing', 'stock'] },
  { prefix: '/purchase-requests', modules: ['purchasing', 'stock', 'replenishment'] },
  { prefix: '/reception-vouchers', modules: ['purchasing', 'stock'] },
  { prefix: '/purchasing-settings', modules: ['purchasing', 'accounting'] },
  { prefix: '/purchasing/reports', modules: ['purchasing', 'stock', 'reports'] },
  { prefix: '/suppliers', modules: ['purchasing', 'accounting', 'stock'] },
  { prefix: '/expense-categories', modules: ['accounting', 'purchasing'], readOpen: true },
  { prefix: '/revenue-categories', modules: ['accounting'], readOpen: true },
  { prefix: '/invoices', modules: ['accounting', 'purchasing'] },
  { prefix: '/payments', modules: ['accounting', 'purchasing'] },
  { prefix: '/ledger', modules: ['accounting'] },
  { prefix: '/fixed-assets', modules: ['accounting'] },
  { prefix: '/bank-reconciliation', modules: ['accounting'] },
  { prefix: '/withholding', modules: ['accounting'] },
  { prefix: '/payment-schedules', modules: ['accounting'] },
  { prefix: '/debts', modules: ['accounting'] },
  { prefix: '/recurring-charges', modules: ['accounting'] },
  { prefix: '/reports', modules: ['reports', 'dashboard'] },
  { prefix: '/gestion', modules: ['reports', 'accounting', 'dashboard'] },
  { prefix: '/controle', modules: ['controle'] },
  { prefix: '/traceability', modules: ['controle', 'production'] },
  { prefix: '/haccp', modules: ['controle', 'production', 'pos', 'stock'] },
  { prefix: '/forecast', modules: ['production', 'replenishment', 'reports', 'controle'] },
];

/** Règle du préfixe le plus long correspondant au chemin (relatif à /api/v1). */
export function ruleFor(path: string): Rule | undefined {
  let best: Rule | undefined;
  for (const r of RULES) {
    if ((path === r.prefix || path.startsWith(r.prefix + '/')) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best;
}

export function actionFor(method: string): RightAction {
  switch (method.toUpperCase()) {
    case 'GET': case 'HEAD': return 'view';
    case 'POST': return 'create';
    case 'DELETE': return 'delete';
    default: return 'edit';
  }
}

// Un refus observé (mode « log ») n'est journalisé qu'une fois par jour et par
// utilisateur / route, pour ne pas noyer le journal des connexions.
const seen = new Set<string>();
let seenDay = '';
const routeShape = (path: string) =>
  path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');

export async function moduleGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rule = ruleFor(req.path);
    if (!rule || req.method === 'OPTIONS') { next(); return; }
    const action = actionFor(req.method);
    if (rule.readOpen && action === 'view') { next(); return; }

    const mode = await enforcementMode();
    if (mode === 'off') { next(); return; }

    // Jeton absent ou invalide : l'authentification de la route répondra 401.
    if (!req.user) {
      const r = await resolveRequestUser(req);
      if ('error' in r) { next(); return; }
      req.user = r.user;
    }
    if (req.user.role === 'admin') { next(); return; }

    const rights = await effectiveRights(req.user.userId);
    const modules = action === 'view' ? [...rule.modules, ...(rule.alsoRead ?? [])] : rule.modules;
    if (hasRight(rights, modules, action)) { next(); return; }

    const shape = `${req.method} ${routeShape(req.path)}`;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== seenDay) { seen.clear(); seenDay = day; }
    const key = `${req.user.userId}|${shape}`;
    if (mode === 'enforce' || !seen.has(key)) {
      seen.add(key);
      await authEventRepository.recordFromRequest(req, {
        eventType: 'access_denied', userId: req.user.userId, success: false,
        details: { route: shape, modules, action, role: rights.roleCode, source: rights.source, mode },
      });
    }
    if (mode === 'enforce') {
      res.status(403).json({ success: false, error: { message: 'Accès interdit : droit manquant sur ce module' } });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
