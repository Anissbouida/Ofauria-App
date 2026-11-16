// Analyse statique des routes Express : quelles mutations (POST, PUT, PATCH,
// DELETE avec corps) passent par un schéma de validation ?
//
// G0-07 (plan d'action 2026-11). Utilisé par :
//   - scripts/audit-validation-routes.ts (rapport lisible) ;
//   - src/__tests__/route-validation-guard.test.ts (garde en CI).
//
// Une mutation est « validée » si sa déclaration contient validate(...) ou
// validateBody(...), ou si son gestionnaire en ligne appelle .parse( / .safeParse(.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface ScannedRoute {
  /** Clé stable : « METHODE fichier chemin ». */
  key: string;
  file: string;
  method: string;
  path: string;
  validated: boolean;
}

const MUTATION = /\b(\w+)\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3([\s\S]*?)\);[ \t]*\r?\n/g;

export function scanRoutes(routesDir: string): ScannedRoute[] {
  const out: ScannedRoute[] = [];
  for (const f of readdirSync(routesDir).filter(n => n.endsWith('.routes.ts')).sort()) {
    const src = readFileSync(path.join(routesDir, f), 'utf8');
    for (const m of src.matchAll(MUTATION)) {
      const [, router, method, , routePath, tail] = m;
      // Un appel client (api.post, axios.post…) n'est pas une déclaration de route.
      if (!/router|Router$/i.test(router)) continue;
      const validated = /\bvalidate(Body)?\(/.test(tail) || /\.(safeParse|parse)\(/.test(tail);
      const file = f.replace(/\.routes\.ts$/, '');
      // Un fichier peut porter plusieurs routeurs (factures, règlements…) : le nom du
      // routeur entre dans la clé quand ce n'est pas le « router » par défaut.
      const scope = router === 'router' ? file : `${file}:${router}`;
      out.push({ key: `${method.toUpperCase()} ${scope} ${routePath}`, file, method: method.toUpperCase(), path: routePath, validated });
    }
  }
  return out;
}
