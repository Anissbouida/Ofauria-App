// Non-regression de la garde des modules (mig 330) : pour chaque route metier,
// chaque role systeme autorise aujourd'hui par authorize(...) doit aussi etre
// accepte par la garde avec les droits de role repris de DEFAULT_ROLE_MODULES.
// Lit le code des routes (analyse statique) et les droits de role en base, dans
// une transaction annulee (migration 330 appliquee a la volee si absente).
//
// Usage : npx tsx scripts/audit-droits-routes.ts   (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_GROUPS, ROLES } from '@ofauria/shared';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const { ruleFor, actionFor } = await import('../src/middleware/module-guard.middleware.js');
const { moduleKeys } = await import('../src/services/access-rights.js');

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error('Base non locale : refuse.');
const ROUTES_DIR = fileURLToPath(new URL('../src/routes/', import.meta.url));
const SYSTEM = Object.values(ROLES) as string[];

// ─── Montages : variable de routeur -> prefixe ───────────────────────────
const index = readFileSync(ROUTES_DIR + 'index.ts', 'utf8');
const varFile = new Map<string, { file: string; name: string }>();
for (const m of index.matchAll(/import (\w+) from '\.\/(.+?)\.js'/g)) varFile.set(m[1], { file: m[2], name: 'router' });
for (const m of index.matchAll(/import \{([^}]+)\} from '\.\/(.+?)\.js'/g)) {
  for (const n of m[1].split(',').map(x => x.trim()).filter(Boolean)) varFile.set(n, { file: m[2], name: n });
}
const mounts: { prefix: string; file: string; name: string }[] = [];
for (const m of index.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)) {
  const f = varFile.get(m[2]);
  if (f) mounts.push({ prefix: m[1], ...f });
}

// ─── Roles d'un appel authorize(...) ─────────────────────────────────────
function rolesOf(args: string): string[] {
  const out = new Set<string>();
  for (const m of args.matchAll(/\.\.\.ROLE_GROUPS\.(\w+)/g)) (ROLE_GROUPS as Record<string, string[]>)[m[1]]?.forEach(r => out.add(r));
  for (const m of args.matchAll(/(?<!\.\.\.ROLE_GROUPS)\bROLES\.(\w+)/g)) out.add((ROLES as Record<string, string>)[m[1]]);
  for (const m of args.matchAll(/'([a-z_]+)'/g)) if (SYSTEM.includes(m[1])) out.add(m[1]);
  return [...out];
}

type Route = { method: string; path: string; roles: string[] | null };
function routesOf(file: string, routerName: string): Route[] {
  const src = readFileSync(ROUTES_DIR + file + '.ts', 'utf8');
  // Constantes locales de garde : const AM = [authenticate, authorize(...ROLE_GROUPS.X)] ou ROLE_GROUPS.X
  const consts = new Map<string, string[]>();
  for (const m of src.matchAll(/const (\w+)\s*=\s*\[([^\]]*)\]/g)) {
    const a = /authorize\(([^)]*)\)/.exec(m[2]);
    if (a) consts.set(m[1], rolesOf(a[1]));
  }
  for (const m of src.matchAll(/const (\w+)\s*(?::[^=]+)?=\s*(\[[^\]]*\]|ROLE_GROUPS\.\w+)/g)) {
    if (!consts.has(m[1]) && /ROLE_GROUPS|ROLES\.|'/.test(m[2])) consts.set(m[1], rolesOf(m[2].startsWith('ROLE_GROUPS') ? '...' + m[2] : m[2]));
  }
  const out: Route[] = [];
  // Declaration complete de la route, y compris sur plusieurs lignes, jusqu'au « ); » final.
  const re = new RegExp(`\\b${routerName}\\.(get|post|put|patch|delete)\\(\\s*'([^']*)'([\\s\\S]*?)\\);\\s*\\n`, 'g');
  for (const m of src.matchAll(re)) {
    const tail = m[3];
    let roles: string[] | null = null;
    const a = /authorize\(([^)]*(?:\)[^)]*)?)\)/.exec(tail);
    if (a) {
      // authorize(...X) : resoudre aussi les constantes de roles passees en spread.
      roles = rolesOf(a[1]);
      for (const s of a[1].matchAll(/\.\.\.(\w+)(?!\.)/g)) if (consts.has(s[1])) consts.get(s[1])!.forEach(r => roles!.push(r));
    } else {
      for (const s of tail.matchAll(/\.\.\.(\w+)\b/g)) if (consts.has(s[1])) roles = [...(roles ?? []), ...consts.get(s[1])!];
    }
    out.push({ method: m[1].toUpperCase(), path: m[2], roles });
  }
  return out;
}

// ─── Droits de role (transaction annulee) ────────────────────────────────
const conn = new pg.Client({ connectionString: url });
await conn.connect();
await conn.query('BEGIN');
try {
  if (!(await conn.query(`SELECT to_regclass('public.roles') AS r`)).rows[0].r) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/330_roles_editables_droits.sql', import.meta.url)), 'utf8'));
  }
  const perms = (await conn.query(`SELECT role_code, module, can_view, can_create, can_edit, can_delete FROM role_permissions`)).rows;
  const allowed = (role: string, modules: string[], action: string) => {
    const keys = new Set(modules.flatMap(moduleKeys));
    return perms.some(p => p.role_code === role && keys.has(p.module) &&
      (action === 'view' ? p.can_view : action === 'create' ? p.can_create : action === 'edit' ? p.can_edit : p.can_delete));
  };

  let checked = 0;
  const problems: string[] = [];
  const unguarded = new Set<string>();
  for (const mnt of mounts) {
    let routes: Route[];
    try { routes = routesOf(mnt.file, mnt.name); } catch { continue; }
    for (const r of routes) {
      const full = (mnt.prefix + (r.path === '/' ? '' : r.path)) || '/';
      const rule = ruleFor(full);
      if (!rule) { unguarded.add(mnt.prefix); continue; }
      const action = actionFor(r.method);
      if (rule.readOpen && action === 'view') continue;
      const roles = (r.roles ?? SYSTEM).filter(x => x !== 'admin');
      for (const role of new Set(roles)) {
        checked++;
        const mods = action === 'view' ? [...rule.modules, ...(rule.alsoRead ?? [])] : rule.modules;
        if (!allowed(role, mods, action)) {
          problems.push(`${r.method.padEnd(6)} ${full.padEnd(48)} ${role.padEnd(13)} ${action.padEnd(6)} modules=${mods.join('|')}${r.roles ? '' : ' (authentifie seulement)'}`);
        }
      }
    }
  }
  console.log(`${checked} couples (route, role) verifies ; ${problems.length} refus potentiels.`);
  for (const p of problems.sort()) console.log('  ' + p);
  console.log(`Prefixes hors garde : ${[...unguarded].sort().join(' ')}`);
} finally {
  await conn.query('ROLLBACK');
  await conn.end();
}
