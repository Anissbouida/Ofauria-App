// M2-04 / M2-05 — amorçage du référentiel des permissions et bascule authorize → can.
//
//   npx tsx scripts/permissions-bootstrap.ts --generate
//       Lit les gardes authorize(...) à l'exécution (utils/route-rights.ts) et écrit
//       shared/src/constants/permissions.ts : une clé « module.ressource.action » par
//       groupe de routes qui ont les mêmes rôles aujourd'hui (defaultRoles = ces rôles),
//       et la table route → clé (PERMISSION_ROUTES) qui sert à la bascule.
//       Les clés déjà présentes dans le fichier gardent leur libellé.
//
//   npx tsx scripts/permissions-bootstrap.ts --apply production.routes.ts [autres…]
//       Réécrit les fichiers de routes donnés : chaque authorize(...) d'une déclaration
//       de route devient can('clé') ; une constante de garde [authenticate, authorize(...)]
//       étalée dans la route est remplacée par son contenu avec can('clé').
//       Le test route-rights.test.ts vérifie ensuite qu'aucune décision n'a changé.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET ||= 'bootstrap-'.padEnd(40, 'x');
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

const ROUTES_DIR = fileURLToPath(new URL('../src/routes/', import.meta.url));
const SHARED_FILE = fileURLToPath(new URL('../../shared/src/constants/permissions.ts', import.meta.url));

// ─── Montages : préfixe → (fichier, nom exporté) ─────────────────────────
function mounts() {
  const index = readFileSync(ROUTES_DIR + 'index.ts', 'utf8');
  const varFile = new Map<string, { file: string; exported: string }>();
  for (const m of index.matchAll(/import (\w+)(?:,\s*\{([^}]+)\})? from '\.\/(.+?)\.js'/g)) {
    varFile.set(m[1], { file: m[3], exported: 'default' });
    if (m[2]) for (const n of m[2].split(',').map(x => x.trim()).filter(Boolean)) varFile.set(n, { file: m[3], exported: n });
  }
  for (const m of index.matchAll(/import \{([^}]+)\} from '\.\/(.+?)\.js'/g)) {
    for (const n of m[1].split(',').map(x => x.trim()).filter(Boolean)) varFile.set(n, { file: m[2], exported: n });
  }
  const out: { prefix: string; file: string; exported: string }[] = [];
  for (const m of index.matchAll(/router\.use\('([^']+)',\s*(?:[\w.]+(?:\([^)]*\))?\s*,\s*)*(\w+)\)/g)) {
    const f = varFile.get(m[2]);
    if (f) out.push({ prefix: m[1], ...f });
  }
  return out;
}

/** Fin d'un appel : index de la parenthèse fermante correspondant à `open`. */
function matchParen(src: string, open: number): number {
  let depth = 0; let q: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ─── Clés ───────────────────────────────────────────────────────────────
const snake = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
/** Préfixes hors garde des modules (module-guard) : module de rattachement. */
const PREFIX_MODULE: Record<string, string> = {
  approvals: 'settings', auth: 'users', commissions: 'employees', complaints: 'controle', cost_centers: 'accounting',
  delivery_routes: 'sales', dunning: 'sales', landed_costs: 'purchasing', leaves: 'employees', lot_thermal: 'production',
  loyalty: 'sales', params: 'settings', payment_runs: 'accounting', payroll: 'employees', prepaid_charges: 'accounting',
  pricing: 'sales', printers: 'settings', pro_returns: 'sales', product_transfers: 'sales', promotions: 'sales',
  quality: 'controle', quotes: 'sales', rebates: 'sales', rfqs: 'purchasing', routings: 'production',
  sachet_config: 'production', salary_advances: 'employees', sales_contracts: 'sales', sales_targets: 'sales',
  stock_counts: 'stock', stock_locations: 'stock', subscriptions: 'sales', supplier_items: 'purchasing', supplier_scores: 'purchasing',
};

const ACTION_BY_METHOD: Record<string, string> = { GET: 'view', POST: 'create', PUT: 'edit', PATCH: 'edit', DELETE: 'delete' };

function keyParts(method: string, prefix: string, localPath: string, module: string) {
  const resource = snake(prefix.split('/').filter(Boolean).join('_')) || module;
  const statics = localPath.split('/').filter(s => s && !s.startsWith(':') && s !== '*');
  let action = ACTION_BY_METHOD[method] ?? method.toLowerCase();
  let sub = statics.map(snake);
  // POST /:id/confirm, PUT /:id/approve… : le dernier segment est un verbe.
  if (method !== 'GET' && method !== 'DELETE' && sub.length && localPath.split('/').filter(Boolean).length > 1 && /:/.test(localPath)) {
    action = sub[sub.length - 1]; sub = sub.slice(0, -1);
  } else if (method === 'POST' && sub.length && !/:/.test(localPath)) {
    action = sub[sub.length - 1]; sub = sub.slice(0, -1);
  }
  const base = resource === module ? module : `${module}.${resource}`;
  return { l1: `${base}.${action}`, l2: `${base}${sub.length ? '.' + sub.join('_') : ''}.${action}`, l3: `${base}${sub.length ? '.' + sub.join('_') : ''}.${action}${/\/:[^/]+$/.test(localPath) ? '_detail' : '_list'}` };
}

const ACTION_LABELS: Record<string, string> = { view: 'consulter', create: 'créer', edit: 'modifier', delete: 'supprimer' };
/** Mots fréquents des chemins, en français (libellés de l'écran des rôles). */
const WORDS: Record<string, string> = {
  cancel: 'annuler', confirm: 'confirmer', complete: 'terminer', approve: 'approuver', reject: 'rejeter', validate: 'valider',
  send: 'envoyer', receive: 'réceptionner', close: 'clôturer', reopen: 'rouvrir', export: 'exporter', import: 'importer',
  print: 'imprimer', pdf: 'PDF', submit: 'soumettre', decide: 'décider', execute: 'exécuter', post: 'comptabiliser',
  void: 'annuler', restore: 'restaurer', archive: 'archiver', duplicate: 'dupliquer', convert: 'convertir', assign: 'affecter',
  start: 'démarrer', stop: 'arrêter', pay: 'payer', generate: 'générer', relaunch: 'relancer', transfer: 'transférer',
  bulk: 'en masse', items: 'articles', item: 'article', lines: 'lignes', line: 'ligne', status: 'statut', settings: 'réglages',
  reports: 'rapports', report: 'rapport', summary: 'synthèse', stats: 'statistiques', history: 'historique', search: 'recherche',
  forecast: 'prévision', orders: 'commandes', order: 'commande', invoices: 'factures', invoice: 'facture', payments: 'paiements',
  suppliers: 'fournisseurs', customers: 'clients', products: 'produits', recipes: 'recettes', ingredients: 'ingrédients',
  lots: 'lots', stock: 'stock', inventory: 'inventaire', sales: 'ventes', employees: 'salariés', users: 'utilisateurs',
  rules: 'règles', proposals: 'propositions', apply: 'appliquer', match: 'rapprocher', unmatch: 'défaire', lines_: 'lignes',
  purchase: 'achat', requests: 'demandes', request: 'demande', reception: 'réception', vouchers: 'bons', production: 'production',
  plans: 'plans', categories: 'catégories', delivery: 'livraison', notes: 'notes', returns: 'retours', quotes: 'devis',
  ledger: 'grand livre', entries: 'écritures', accounts: 'comptes', balance: 'balance', closing: 'clôture', budgets: 'budgets',
  attachments: 'pièces jointes', comments: 'commentaires', activities: 'activités', events: 'événements', snapshot: 'instantané',
  sessions: 'sessions', register: 'caisse', cash: 'espèces', count: 'comptage', counts: 'comptages', losses: 'pertes',
  me: 'moi', mine: 'les miens', pending: 'en attente', today: 'aujourd\'hui', dashboard: 'tableau de bord', detail: 'fiche', list: 'liste',
  semi: 'semi', finished: 'fini', detect: 'détecter', needs: 'besoins', verification: 'vérification', restore_: 'restaurer',
};
const fr = (s: string) => s.split(/[_ ]/).map(w => WORDS[w] ?? w).join(' ');
function labelOf(key: string): string {
  const parts = key.split('.');
  const action = parts[parts.length - 1];
  const what = parts.slice(1, -1).map(fr).join(' › ') || fr(parts[0]);
  const m = /^(view|create|edit|delete)_(detail|list)$/.exec(action);
  const verb = m ? `${ACTION_LABELS[m[1]]} (${m[2] === 'detail' ? 'fiche' : 'liste'})` : ACTION_LABELS[action] ?? fr(action);
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} : ${verb}`;
}

async function generate() {
  const { default: router } = await import('../src/routes/index.js');
  const { collectRouteGuards } = await import('../src/utils/route-rights.js');
  const { ruleFor } = await import('../src/middleware/module-guard.middleware.js');
  const mnts = mounts().sort((a, b) => b.prefix.length - a.prefix.length);
  const prefixOf = (path: string) => mnts.find(m => path === m.prefix || path.startsWith(m.prefix + '/'))?.prefix ?? '';
  type R = { route: string; method: string; path: string; prefix: string; module: string; roles: string[] };
  const routes: R[] = [];
  for (const g of collectRouteGuards(router as never)) {
    if (!g.roleLists.length) continue;
    const roles = [...g.roleLists.reduce((acc, l) => new Set([...acc].filter(r => l.includes(r))), new Set(g.roleLists[0]))].sort();
    const prefix = prefixOf(g.path);
    const seg = snake(prefix.split('/')[1] ?? '');
    const module = ruleFor(g.path)?.modules[0] ?? PREFIX_MODULE[seg] ?? (seg || 'general');
    routes.push({ route: g.key, method: g.method, path: g.path, prefix, module, roles });
  }
  // Niveaux de clé : le plus grossier qui garde des rôles identiques dans le groupe.
  const assigned = new Map<string, string>();
  const parts = new Map(routes.map(r => [r.route, keyParts(r.method, r.prefix, r.path.slice(r.prefix.length) || '/', r.module)]));
  const sig = (rs: R[]) => new Set(rs.map(r => r.roles.join(','))).size === 1;
  const byL1 = Map.groupBy(routes, r => parts.get(r.route)!.l1);
  for (const [k1, g1] of byL1) {
    if (sig(g1)) { g1.forEach(r => assigned.set(r.route, k1)); continue; }
    for (const [k2, g2] of Map.groupBy(g1, r => parts.get(r.route)!.l2)) {
      if (sig(g2)) { g2.forEach(r => assigned.set(r.route, k2)); continue; }
      for (const [k3, g3] of Map.groupBy(g2, r => parts.get(r.route)!.l3)) {
        if (sig(g3)) { g3.forEach(r => assigned.set(r.route, k3)); continue; }
        g3.forEach((r, i) => assigned.set(r.route, `${k3}_${i + 1}`));
      }
    }
  }
  // Une clé de niveau 2 peut rejoindre une clé de niveau 1 homonyme : vérification finale.
  const byKey = Map.groupBy(routes, r => assigned.get(r.route)!);
  for (const [k, g] of byKey) if (!sig(g)) throw new Error(`Clé ${k} : rôles divergents`);

  let previous: Record<string, { label: string }> = {};
  try { previous = ((await import("@ofauria/shared") as Record<string, unknown>).PERMISSIONS ?? {}) as never; } catch { /* premier passage */ }
  const keys = [...byKey.keys()].sort();
  const entries = keys.map(k => {
    const g = byKey.get(k)!;
    const label = previous[k]?.label ?? labelOf(k);
    return `  ${JSON.stringify(k)}: { module: ${JSON.stringify(g[0].module)}, label: ${JSON.stringify(label)}, defaultRoles: [${g[0].roles.map(r => JSON.stringify(r)).join(', ')}] },`;
  });
  const routeLines = routes.map(r => r.route).sort().map(r => `  ${JSON.stringify(r)}: ${JSON.stringify(assigned.get(r))},`);
  writeFileSync(SHARED_FILE, `/**
 * Référentiel des permissions (M2-04, plan d'action 2026-11).
 *
 * Une clé par action métier, « module.ressource.action ». Les routes sont gardées par
 * can('clé') (server/src/middleware/permission.middleware.ts) ; la table
 * role_action_permissions dit quel rôle détient quelle clé. \`defaultRoles\` est le
 * jeu de départ : les rôles de base qui passaient la garde authorize(...) d'origine.
 * Un rôle personnalisé reçoit, à l'amorçage d'une clé, les droits de son rôle de base.
 *
 * Amorcé par server/scripts/permissions-bootstrap.ts --generate ; les libellés se
 * corrigent ici à la main, une clé nouvelle s'ajoute ici avec ses rôles par défaut.
 */
import type { Role } from './roles.js';

export interface PermissionDef {
  module: string;
  label: string;
  defaultRoles: readonly Role[];
}

export const PERMISSIONS = {
${entries.join('\n')}
} as const satisfies Record<string, PermissionDef>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/**
 * Route → clé, figé à l'amorçage (référence de la bascule M2-05 ; une route ajoutée
 * ensuite n'a pas à y figurer).
 */
export const PERMISSION_ROUTES: Readonly<Record<string, PermissionKey>> = {
${routeLines.join('\n')}
};
`);
  console.log(`${keys.length} clés pour ${routes.length} routes gardées.`);
  const lv = { l1: 0, l2: 0, l3: 0, idx: 0 };
  for (const r of routes) { const k = assigned.get(r.route)!; const p = parts.get(r.route)!; if (k === p.l1) lv.l1++; else if (k === p.l2) lv.l2++; else if (k === p.l3) lv.l3++; else lv.idx++; }
  console.log('niveaux', lv);
}

async function apply(files: string[]) {
  const { PERMISSION_ROUTES } = await import('@ofauria/shared');
  const mnts = mounts();
  for (const file of files) {
    const path = ROUTES_DIR + file;
    let src = readFileSync(path, 'utf8');
    const base = file.replace(/\.ts$/, '');
    // Variable locale de chaque routeur exporté de ce fichier, et son préfixe.
    const prefixByVar = new Map<string, string>();
    for (const m of mnts.filter(x => x.file === base)) {
      const local = m.exported === 'default' ? (/export default (\w+)/.exec(src)?.[1] ?? 'router') : m.exported;
      prefixByVar.set(local, m.prefix);
    }
    // Constantes de garde : const X = [ ... authorize(...) ... ];
    const guardConsts = new Map<string, string>();
    for (const m of src.matchAll(/const (\w+)\s*(?::[^=]+)?=\s*\[/g)) {
      const open = m.index! + m[0].length - 1;
      const close = matchParen(src, open);
      const body = src.slice(open + 1, close);
      if (/\bauthorize\(/.test(body)) guardConsts.set(m[1], body.trim().replace(/,\s*$/, ''));
    }
    // Gardes mises en variable : const SELL = authorize(...);
    const guardVars = new Set([...src.matchAll(/const (\w+)\s*=\s*authorize\(/g)].map(m => m[1]));
    // router.use(authenticate, authorize(...)) : la garde passe sur chaque route du routeur.
    const usedOnRouter = new Set<string>();
    for (const v of prefixByVar.keys()) {
      const u = new RegExp(`\\b${v}\\.use\\(([^;]*?)\\bauthorize\\(`, 'g').exec(src);
      if (!u) continue;
      const open = u.index + u[0].length - 1;
      const close = matchParen(src, open);
      let tail = close + 1;
      while (/[\s,]/.test(src[tail]) && src[tail] !== ')') tail++;
      src = src.slice(0, u.index + u[0].length - 'authorize('.length).replace(/,\s*$/, '') + src.slice(tail);
      usedOnRouter.add(v);
    }
    let count = 0; const missing: string[] = [];
    const edits: { start: number; end: number; text: string }[] = [];
    for (const [v, prefix] of prefixByVar) {
      const re = new RegExp(`\\b${v}\\.(get|post|put|patch|delete)\\(\\s*'([^']*)'`, 'g');
      for (const m of src.matchAll(re)) {
        const open = m.index! + m[0].indexOf('(');
        const close = matchParen(src, open);
        const decl = src.slice(open, close + 1);
        const routeKey = `${m[1].toUpperCase()} ${(prefix + (m[2] === '/' ? '' : m[2])) || '/'}`;
        const key = (PERMISSION_ROUTES as Record<string, string>)[routeKey];
        const usesVar = [...guardVars].some(g => new RegExp(`[(,]\\s*${g}\\s*[,)]`).test(decl));
        const usesGuard = usedOnRouter.has(v) || usesVar || /\bauthorize\(/.test(decl) || [...guardConsts.keys()].some(c => new RegExp(`\\.\\.\\.${c}\\b`).test(decl));
        if (!usesGuard) continue;
        if (!key) { missing.push(routeKey); continue; }
        let out = '';
        if (usedOnRouter.has(v)) {
          // Garde de routeur : can('clé') juste après le chemin.
          const at = m.index! + m[0].length;
          edits.push({ start: at, end: at, text: `, can('${key}')` }); count++;
          continue;
        }
        let d2 = decl;
        for (const g of guardVars) d2 = d2.replace(new RegExp(`([(,]\\s*)${g}(\\s*[,)])`, 'g'), `$1can('${key}')$2`);
        const decl0 = d2;
        for (let i = 0; i < decl0.length;) {
          const a = /\bauthorize\(/y; a.lastIndex = i;
          if (a.test(decl0) && (i === 0 || !/[\w.]/.test(decl0[i - 1]))) {
            const end = matchParen(decl0, i + 'authorize'.length);
            out += `can('${key}')`; i = end + 1; continue;
          }
          let replaced = false;
          for (const [c, body] of guardConsts) {
            const s = new RegExp(`\\.\\.\\.${c}\\b`, 'y'); s.lastIndex = i;
            if (s.test(decl0)) {
              let b = body; let j = b.search(/\bauthorize\(/);
              while (j >= 0) { const e = matchParen(b, j + 'authorize'.length); b = b.slice(0, j) + `can('${key}')` + b.slice(e + 1); j = b.search(/\bauthorize\(/); }
              out += b; i = s.lastIndex; replaced = true; break;
            }
          }
          if (!replaced) { out += decl0[i]; i++; }
        }
        edits.push({ start: open, end: close + 1, text: out }); count++;
      }
    }
    for (const e of edits.sort((a, b) => b.start - a.start)) src = src.slice(0, e.start) + e.text + src.slice(e.end);
    for (const g of guardVars) {
      if (!new RegExp(`\\b${g}\\b`).test(src.replace(new RegExp(`const ${g}\\s*=\\s*authorize\\([^;]*\\);\\n?`), ''))) {
        src = src.replace(new RegExp(`const ${g}\\s*=\\s*authorize\\([^;]*\\);\\n?`), '');
      }
    }
    // Constantes de garde devenues inutiles, imports.
    for (const c of guardConsts.keys()) {
      if (!new RegExp(`\\b${c}\\b`).test(src.replace(new RegExp(`const ${c}\\s*(?::[^=]+)?=\\s*\\[[\\s\\S]*?\\](?:\\s+as const)?;\\n?`), ''))) {
        src = src.replace(new RegExp(`(?:\\/\\/[^\\n]*\\n)*const ${c}\\s*(?::[^=]+)?=\\s*\\[[\\s\\S]*?\\](?:\\s+as const)?;\\n?`), '');
      }
    }
    if (count && !/import \{ can \}/.test(src)) {
      src = src.replace(/(import \{ authorize \} from '\.\.\/middleware\/role\.middleware\.js';\n?)/, `$1import { can } from '../middleware/permission.middleware.js';\n`);
      if (!/import \{ can \}/.test(src)) src = `import { can } from '../middleware/permission.middleware.js';\n` + src;
    }
    if (!/\bauthorize\(/.test(src)) src = src.replace(/import \{ authorize \} from '\.\.\/middleware\/role\.middleware\.js';\n/, '');
    if (!/ROLE_GROUPS|ROLES\b/.test(src.replace(/import[^;]+from '@ofauria\/shared';/g, ''))) {
      src = src.replace(/import \{ ROLE_GROUPS(?:, ROLES)? \} from '@ofauria\/shared';\n/, '').replace(/import \{ ROLES(?:, ROLE_GROUPS)? \} from '@ofauria\/shared';\n/, '');
    }
    writeFileSync(path, src);
    console.log(`${file} : ${count} routes basculées${missing.length ? ` ; SANS CLÉ : ${missing.join(', ')}` : ''}${/\bauthorize\(/.test(src) ? ' ; authorize restant' : ''}`);
  }
}

if (process.argv.includes('--generate')) await generate();
else if (process.argv.includes('--apply')) await apply(process.argv.slice(process.argv.indexOf('--apply') + 1));
else console.log('Usage : --generate | --apply fichier.routes.ts …');
process.exit(0);
