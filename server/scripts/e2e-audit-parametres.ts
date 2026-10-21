// Test de bout en bout du lot 1 Parametres (journal d'audit, acces par droit,
// /auth/users-list) sur la base LOCALE, dans une seule transaction annulee a
// la fin : rien n'est ecrit, migration 328 comprise.
//
// Le vrai serveur Express (routes, middlewares, controleurs) est demarre dans
// le processus sur un port libre ; les requetes HTTP passent par la meme
// connexion en transaction (meme technique que e2e-paie.ts).
//
// Usage :
//   npm run e2e:audit-parametres -w server     (depuis la racine)
//   npx tsx scripts/e2e-audit-parametres.ts    (depuis server/)
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
// Une seule connexion : les requetes HTTP sont traitees l'une apres l'autre (await).
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
  // ── Migration 328 dans la transaction ─────────────────────────────────
  await conn.query(readFileSync(fileURLToPath(new URL('../migrations/328_journal_audit_parametres.sql', import.meta.url)), 'utf8'));

  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const ORIGIN = 'http://localhost:5173';

  // Comptes : admin + gerant de test (seed-test-accounts) s'ils existent, sinon crees ici ;
  // une caissiere de test pour les droits restreints.
  const mkUser = async (email: string, role: string, first: string) => {
    const found = (await conn.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0];
    if (found) return found.id as string;
    return (await conn.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', $2, 'E2E', $3) RETURNING id`,
      [email, first, role])).rows[0].id as string;
  };
  const adminId = await mkUser('admin.test@kalum.local', 'admin', 'Admin');
  const managerId = await mkUser('gerant.test@kalum.local', 'manager', 'Gérant');
  const cashierId = await mkUser('caisse.e2e-audit@kalum.local', 'cashier', 'Caisse');
  await conn.query(`DELETE FROM user_permissions WHERE user_id = ANY($1::uuid[])`, [[managerId, cashierId]]);
  const token = async (id: string) => {
    const u = (await conn.query(`SELECT role, store_id, token_version FROM users WHERE id = $1`, [id])).rows[0];
    return generateToken({ userId: id, role: u.role, storeId: u.store_id ?? undefined, tokenVersion: u.token_version ?? 0 });
  };
  const call = async (method: string, path: string, who: string | null, body?: unknown) => {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (who) headers.Authorization = `Bearer ${await token(who)}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = null;
    try { json = await r.json(); } catch { /* corps vide */ }
    return { status: r.status, json };
  };
  const lastAudit = async (table: string) =>
    (await conn.query(`SELECT * FROM config_audit_log WHERE table_name = $1 ORDER BY id DESC LIMIT 1`, [table])).rows[0];
  const auditCount = async () => Number((await conn.query(`SELECT count(*) FROM config_audit_log`)).rows[0].count);
  const resetCtx = () => conn.query(`SELECT set_config('app.user_id', '', true)`);

  console.log('1. /auth/users-list');
  ok((await call('GET', '/auth/users-list', null)).status === 401, 'sans connexion : 401');
  ok((await call('GET', '/auth/users-list', cashierId)).status === 403, 'caissiere : 403');
  const ul = await call('GET', '/auth/users-list', managerId);
  ok(ul.status === 200 && Array.isArray(ul.json?.data), 'gerant : 200');

  console.log('2. Gerant sans droit Parametres');
  ok((await call('PUT', '/settings', managerId, { legalCity: 'Rabat' })).status === 403, 'PUT /settings refuse');
  ok((await call('GET', '/settings/audit-log', managerId)).status === 403, 'journal refuse');
  ok((await call('POST', '/stores', managerId, { name: 'E2E' })).status === 403, 'creation de magasin refusee');
  ok((await call('GET', '/settings', managerId)).status === 200, 'lecture des parametres toujours ouverte');

  console.log('3. Admin modifie la societe : trace avec auteur et diff');
  await resetCtx();
  const city = (await conn.query(`SELECT legal_city FROM company_settings WHERE id = 1`)).rows[0].legal_city;
  const put = await call('PUT', '/settings', adminId, { legalCity: `${city ?? ''} E2E` });
  ok(put.status === 200, 'PUT /settings admin', put.status);
  let a = await lastAudit('company_settings');
  ok(a?.changed_by === adminId, 'auteur = admin');
  ok(a?.diff?.legal_city?.new === `${city ?? ''} E2E`, 'diff legal_city', a?.diff);
  const n0 = await auditCount();
  await call('PUT', '/settings', adminId, { legalCity: `${city ?? ''} E2E` });
  ok(await auditCount() === n0, 'meme valeur renvoyee : aucune ligne');

  console.log('4. Droits : section Impression seulement pour la caissiere');
  await resetCtx();
  const perms = [
    { module: 'pos', canView: true, canCreate: true, canEdit: true, canDelete: false, config: {} },
    { module: 'settings', canView: true, canCreate: false, canEdit: true, canDelete: false, config: { sections: ['print'] } },
  ];
  const sp1 = await call('PUT', `/users/${cashierId}/permissions`, adminId, { permissions: perms });
  ok(sp1.status === 200, 'enregistrement des droits', sp1.status);
  const permRows = (await conn.query(
    `SELECT operation, record_id, subject_id, changed_by FROM config_audit_log WHERE table_name = 'user_permissions' AND subject_id = $1`, [cashierId])).rows;
  ok(permRows.length === 2 && permRows.every(r => r.operation === 'INSERT' && r.changed_by === adminId), '2 droits crees, auteur admin', permRows.map(r => r.record_id));
  const n1 = await auditCount();
  await call('PUT', `/users/${cashierId}/permissions`, adminId, { permissions: perms });
  ok(await auditCount() === n1, 'droits identiques re-enregistres : aucune ligne (enregistrement differentiel)');
  await call('PUT', `/users/${cashierId}/permissions`, adminId, { permissions: [perms[1]] });
  const del = await lastAudit('user_permissions');
  ok(del?.operation === 'DELETE' && del?.record_id === 'pos', 'retrait du module Point de vente trace');

  console.log('5. Caissiere limitee a Impression');
  const r1 = await call('PUT', '/settings', cashierId, { receiptFooter: 'Merci E2E' });
  ok(r1.status === 200, 'ticket de caisse modifiable', r1.json?.error);
  a = await lastAudit('company_settings');
  ok(a?.changed_by === cashierId, 'auteur = caissiere');
  const r2 = await call('PUT', '/settings', cashierId, { receiptFooter: 'x', legalIce: '000000000000001' });
  ok(r2.status === 403 && /Entreprise/.test(r2.json?.error?.message ?? ''), 'ICE refuse (section Entreprise)', r2.json?.error?.message);
  ok((await call('GET', '/settings/audit-log', cashierId)).status === 403, 'journal refuse (section non accordee)');
  ok((await call('POST', '/params/units', cashierId, { code: 'E2E', label: 'E2E' })).status === 403, 'referentiel refuse');

  console.log('6. Magasin cree puis supprime par l\'admin');
  await resetCtx();
  const st = await call('POST', '/stores', adminId, { name: 'Magasin E2E audit', city: 'Fès' });
  ok(st.status === 201 || st.status === 200, 'creation', st.status);
  const storeId = st.json?.data?.id;
  await resetCtx();
  await call('DELETE', `/stores/${storeId}`, adminId);
  const sRows = (await conn.query(`SELECT operation, changed_by FROM config_audit_log WHERE table_name = 'stores' AND record_id = $1 ORDER BY id`, [storeId])).rows;
  ok(sRows.map(r => r.operation).join(',') === 'INSERT,DELETE' && sRows.every(r => r.changed_by === adminId), 'INSERT puis DELETE, auteur admin', sRows);

  console.log('7. Consultation du journal');
  const j1 = await call('GET', '/settings/audit-log?table=company_settings&limit=5', adminId);
  ok(j1.status === 200 && j1.json.data.rows.length > 0 && j1.json.data.rows[0].changed_by_name, 'journal filtre par objet', j1.json?.data?.total);
  const j2 = await call('GET', `/settings/audit-log?subjectId=${cashierId}`, adminId);
  ok(j2.status === 200 && j2.json.data.rows.every((r: any) => r.subject_id === cashierId) && j2.json.data.rows[0].subject_name, 'journal filtre par utilisateur concerne', j2.json?.data?.total);
  const j3 = await call('GET', '/settings/audit-log?table=referentiel&limit=3', adminId);
  ok(j3.status === 200 && j3.json.data.rows.every((r: any) => r.table_name.startsWith('ref:')), 'historique du referentiel integre', j3.json?.data?.total);
  const j4 = await call('GET', '/settings/audit-log?q=E2E', adminId);
  ok(j4.status === 200 && j4.json.data.total >= 2, 'recherche texte', j4.json?.data?.total);
  const ev = await call('GET', '/settings/auth-events?success=false&limit=5', adminId);
  ok(ev.status === 200 && ev.json.data.rows.every((r: any) => r.success === false), 'journal des connexions (echecs)', ev.json?.data?.total);

  console.log('8. Journal en ajout seul');
  await conn.query('SAVEPOINT ro');
  try {
    await conn.query(`UPDATE config_audit_log SET changed_by = NULL`);
    ok(false, 'UPDATE accepte a tort');
  } catch (e: any) {
    ok(/ajout seul/.test(e.message), 'UPDATE refuse', e.message);
  }
  await conn.query('ROLLBACK TO SAVEPOINT ro');
} finally {
  server?.close();
  const still = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
  if (still !== txid) console.log('  ✗ la transaction a change en cours de route');
  await conn.query('ROLLBACK');
  await conn.end();
  console.log(failures ? `\n${failures} echec(s)` : '\nTout est vert (transaction annulee, rien n\'est ecrit).');
  process.exit(failures ? 1 : 0);
}
