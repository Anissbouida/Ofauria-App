// Test de bout en bout du lot 3 Parametres (roles editables, droits appliques
// cote serveur, mig 330) sur la base LOCALE, dans une seule transaction
// annulee : rien n'est ecrit, migration 330 comprise.
//
// Usage :
//   npm run test:e2e-roles-droits            (depuis la racine)
//   npx tsx scripts/e2e-roles-droits.ts      (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error('Base non locale : test refuse.');

const conn = new pg.Client({ connectionString: url });
await conn.connect();
await conn.query('BEGIN');
const txid = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
let sp = 0;
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
};
const tx = {
  query: (text: any, params?: any) => serial(async () => {
    const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
    if (t === 'BEGIN') { sp++; return conn.query(`SAVEPOINT s${sp}`); }
    if (t === 'COMMIT') return conn.query(`RELEASE SAVEPOINT s${sp--}`);
    if (t === 'ROLLBACK') return conn.query(`ROLLBACK TO SAVEPOINT s${sp--}`);
    return conn.query(text, params);
  }),
  release: () => undefined,
};
(pg.Pool.prototype as any).query = function (text: any, params?: any) { return tx.query(text, params); };
(pg.Pool.prototype as any).connect = async function () { return tx; };

let failures = 0;
const ok = (cond: boolean, label: string, detail?: unknown) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};

let server: import('node:http').Server | undefined;
try {
  if (!(await conn.query(`SELECT to_regclass('public.roles') AS r`)).rows[0].r) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/330_roles_editables_droits.sql', import.meta.url)), 'utf8'));
  }
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  const access = await import('../src/services/access-rights.js');
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const admin = (await conn.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`)).rows[0].id as string;
  const manager = (await conn.query(`SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY email = 'gerant.test@kalum.local' DESC LIMIT 1`)).rows[0].id as string;
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager]);
  const token = async (id: string) => {
    const u = (await conn.query(`SELECT role, store_id, token_version FROM users WHERE id = $1`, [id])).rows[0];
    const r = await access.resolveRole(u.role);
    return generateToken({ userId: id, role: r.baseRole, storeId: u.store_id ?? undefined, tokenVersion: u.token_version ?? 0 });
  };
  const call = async (method: string, path: string, who: string | null, body?: unknown, bearer?: string) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173' };
    if (who || bearer) headers.Authorization = `Bearer ${bearer ?? await token(who!)}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  const setMode = async (mode: string) => {
    await conn.query(`UPDATE company_settings SET security_module_enforcement = $1 WHERE id = 1`, [mode]);
    access.invalidateEnforcementMode();
  };
  const denials = async (userId: string) => Number((await conn.query(
    `SELECT count(*) FROM auth_events WHERE event_type = 'access_denied' AND user_id = $1`, [userId])).rows[0].count);

  console.log('1. Roles');
  const list = await call('GET', '/users/roles', admin);
  ok(list.status === 200 && list.json.data.filter((r: any) => r.is_system).length === 9, '9 roles systeme', list.json?.data?.length);
  ok((await call('GET', '/users/roles', manager)).status === 403, 'gerant : 403');
  const bad = await call('POST', '/users/roles', admin, { label: 'Super', baseRole: 'admin' });
  ok(bad.status === 400, 'role de base administrateur refuse', bad.json?.error?.message);
  const created = await call('POST', '/users/roles', admin, { label: 'Responsable boutique E2E', baseRole: 'cashier' });
  ok(created.status === 201 && created.json.data.code === 'responsable_boutique_e2e', 'role cree (code tire du libelle)', created.json?.data?.code);
  const code = created.json.data.code as string;
  const perms = await call('GET', `/users/roles/${code}/permissions`, admin);
  ok(perms.json.data.map((p: any) => p.module).sort().join(',') === 'customers,orders,pos,production,replenishment,unsold', 'droits copies du role de base', perms.json?.data?.length);

  console.log('2. Utilisateur du role cree');
  const email = `resp.e2e.${Date.now()}@kalum.local`;
  const u = await call('POST', '/users', admin, { email, password: 'KalumTest-2026!', firstName: 'Resp', lastName: 'E2E', role: code });
  ok(u.status === 201 || u.status === 200, 'creation avec le role cree', u.json?.error?.message ?? u.status);
  const userId = u.json.data.id as string;
  ok((await call('POST', '/users', admin, { email: 'x' + email, password: 'KalumTest-2026!', firstName: 'X', lastName: 'X', role: 'inexistant' })).status === 400, 'role inconnu refuse');
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ email, password: 'KalumTest-2026!' }) }).then(r => r.json()) as any;
  ok(login?.data?.user?.role === 'cashier' && login.data.user.roleCode === code && login.data.user.roleLabel === 'Responsable boutique E2E',
    'connexion : role de base dans le jeton, role et libelle propres', login?.data?.user ?? login?.error);
  const me = await call('GET', '/users/me/permissions', null, undefined, login.data.token);
  ok(me.json.data.length === 6, 'droits effectifs = droits du role', me.json?.data?.length);

  console.log('3. Garde en observation puis en blocage');
  // Caisse : prefixe /cash-register (modules pos, sales, accounting) ; la route accepte le
  // role de base caissier. On retire Point de vente au role cree.
  await conn.query(`DELETE FROM role_permissions WHERE role_code = $1 AND module = 'pos'`, [code]);
  await setMode('log');
  const d0 = await denials(userId);
  const r1 = await call('GET', '/cash-register/last-amount', userId);
  ok(r1.status === 200 && (await denials(userId)) === d0 + 1, 'observation : appel servi et journalise', r1.status);
  await call('GET', '/cash-register/last-amount', userId);
  ok((await denials(userId)) === d0 + 1, 'observation : meme route le meme jour journalisee une seule fois');
  await setMode('enforce');
  const r2 = await call('GET', '/cash-register/last-amount', userId);
  ok(r2.status === 403 && /droit manquant/.test(r2.json?.error?.message ?? ''), 'blocage : 403', r2.json?.error?.message);
  ok((await call('GET', '/products?limit=1', userId)).status === 200, 'liste de reference (catalogue) toujours lisible');
  ok((await call('GET', '/orders', userId)).status === 200, 'lecture voisine accordee (Production lit les commandes)');
  await call('PUT', `/users/roles/${code}/permissions`, admin, { permissions: perms.json.data });
  ok((await call('GET', '/cash-register/last-amount', userId)).status === 200, 'droit rendu au role : immediat');
  const sec = await call('GET', '/users/security', admin);
  ok(sec.json.data.mode === 'enforce' && sec.json.data.denials.some((d: any) => d.route === 'GET /cash-register/last-amount' && d.role_code === code),
    'ecran de controle : appel hors droits liste', sec.json?.data?.denials?.length);

  console.log('4. Exceptions de l\'utilisateur');
  await call('PUT', `/users/${userId}/permissions`, admin, { permissions: [{ module: 'pos', canView: true, canCreate: true, canEdit: true, canDelete: false }] });
  ok((await call('GET', '/cash-register/last-amount', userId)).status === 200, 'exceptions : Point de vente suffit pour la caisse');
  ok((await call('GET', '/replenishment', userId)).status === 403, 'exceptions : remplacent les droits du role (approvisionnement retire)');
  await call('PUT', `/users/${userId}/permissions`, admin, { permissions: [] });

  console.log('5. Droits deja controles par module (Personnel) : role sans le module');
  await call('PUT', '/users/roles/manager/permissions', admin, {
    permissions: (await call('GET', '/users/roles/manager/permissions', admin)).json.data.filter((p: any) => p.module !== 'employees'),
  });
  ok((await call('GET', '/employees', manager)).status === 403, 'gerant sans Personnel : 403 sur /employees');
  await setMode('off');
  ok((await call('GET', '/employees', manager)).status === 403, 'independant du mode (authorizeModule)');

  console.log('6. Cycle de vie du role');
  const tv0 = (await conn.query(`SELECT token_version FROM users WHERE id = $1`, [userId])).rows[0].token_version;
  ok((await call('PUT', `/users/roles/${code}`, admin, { baseRole: 'saleswoman' })).status === 200, 'changement de role de base');
  const tv1 = (await conn.query(`SELECT token_version FROM users WHERE id = $1`, [userId])).rows[0].token_version;
  ok(tv1 === tv0 + 1, 'sessions des utilisateurs du role invalidees', [tv0, tv1]);
  ok((await call('GET', '/orders', null, undefined, login.data.token)).status === 401, 'ancien jeton refuse');
  ok((await call('DELETE', `/users/roles/${code}`, admin)).status === 409, 'suppression refusee tant que des utilisateurs l\'ont');
  ok((await call('PUT', '/users/roles/cashier', admin, { baseRole: 'manager' })).status === 400, 'role systeme : role de base fige');
  const audit = (await conn.query(`SELECT table_name, operation FROM config_audit_log WHERE table_name IN ('roles', 'role_permissions') AND changed_by = $1`, [admin])).rows;
  ok(audit.some(a => a.table_name === 'roles') && audit.some(a => a.table_name === 'role_permissions'), 'creations et droits traces au journal', audit.length);
} catch (err) {
  failures++;
  console.log('  ✗ exception :', (err as Error).message);
} finally {
  server?.close();
  const still = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
  if (still !== txid) console.log('  ✗ la transaction a change en cours de route');
  await conn.query('ROLLBACK');
  await conn.end();
  console.log(failures ? `\n${failures} echec(s)` : '\nTout est vert (transaction annulee, rien n\'est ecrit).');
  process.exit(failures ? 1 : 0);
}
