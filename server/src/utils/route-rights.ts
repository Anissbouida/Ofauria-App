/**
 * M2-04 — droits effectifs de chaque route, lus à l'exécution dans la pile du routeur
 * Express 4 (pas d'analyse du texte : les constantes de garde, les routeurs imbriqués
 * et les spreads sont résolus par Express lui-même).
 *
 * Les gardes s'étiquettent :
 *   authorize(...roles)  → handler.allowedRoles = roles
 *   can('clé')           → handler.permissionKey = 'clé'
 * Une route est accessible à un rôle de base si TOUTES ses gardes l'acceptent
 * (intersection) ; une route sans garde de rôle vaut `null` (tout utilisateur connecté).
 */
type Handle = ((...a: unknown[]) => unknown) & { stack?: Layer[]; allowedRoles?: string[]; permissionKey?: string };
type Layer = {
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Layer[] };
  handle: Handle;
  regexp?: RegExp & { fast_slash?: boolean };
};

export interface RouteGuard {
  /** « GET /production/:id » */
  key: string;
  method: string;
  path: string;
  /** Listes de rôles des gardes authorize (une par garde), dans l'ordre. */
  roleLists: string[][];
  /** Clés des gardes can(). */
  permissionKeys: string[];
}

/** Préfixe d'un routeur monté (Express 4 : /^\/production\/?(?=\/|$)/i). */
function mountPrefix(layer: Layer): string {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';
  const m = /^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/.exec(re.source);
  return m ? '/' + m[1].replace(/\\(.)/g, '$1') : '';
}

export function collectRouteGuards(router: { stack: Layer[] }, prefix = '', inherited: Layer[] = []): RouteGuard[] {
  const out: RouteGuard[] = [];
  const pending: Layer[] = [...inherited];
  for (const layer of router.stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const handlers = [...pending, ...layer.route.stack];
      const roleLists = handlers.map(h => h.handle?.allowedRoles).filter((r): r is string[] => Array.isArray(r));
      const permissionKeys = handlers.map(h => h.handle?.permissionKey).filter((k): k is string => typeof k === 'string');
      for (const method of Object.keys(layer.route.methods).filter(m => layer.route!.methods[m] && m !== '_all')) {
        for (const p of paths) {
          const path = (prefix + (p === '/' ? '' : p)) || '/';
          out.push({ key: `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), path, roleLists, permissionKeys });
        }
      }
    } else if (layer.handle?.stack) {
      out.push(...collectRouteGuards(layer.handle as unknown as { stack: Layer[] }, prefix + mountPrefix(layer), pending));
    } else if (layer.handle?.allowedRoles || layer.handle?.permissionKey) {
      // router.use(authorize(...)) : s'applique aux routes déclarées après.
      pending.push(layer);
    }
  }
  return out;
}

/**
 * Rôles de base acceptés par une route : intersection des gardes. `rolesOfKey` donne,
 * pour une clé de permission, les rôles de base qui la détiennent. `null` = toute
 * personne connectée (aucune garde de rôle).
 */
export function allowedBaseRoles(g: RouteGuard, rolesOfKey: (key: string) => string[]): string[] | null {
  const lists = [...g.roleLists, ...g.permissionKeys.map(rolesOfKey)];
  if (lists.length === 0) return null;
  return [...lists.reduce((acc, l) => new Set([...acc].filter(r => l.includes(r))), new Set(lists[0]))].sort();
}
