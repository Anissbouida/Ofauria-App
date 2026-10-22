// Test de bout en bout de l'accueil de la configuration (refonte Parametres,
// lot B) sur la base LOCALE, dans une seule transaction annulee : rien n'est ecrit.
//
// Usage :
//   npm run test:e2e-accueil-config            (depuis la racine)
//   npx tsx scripts/e2e-accueil-config.ts      (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  // Socket Unix plutot qu'un port TCP : insensible a l'epuisement des ports locaux.
  const sock = path.join(os.tmpdir(), `kalum-e2e-${process.pid}.sock`);
  server = app.listen(sock);
  await new Promise(r => server!.once('listening', r));
  const admin = (await conn.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`)).rows[0];
  const manager = (await conn.query(`SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY email = 'gerant.test@kalum.local' DESC LIMIT 1`)).rows[0];
  const tok = async (u: { id: string }) => {
    const r = (await conn.query(`SELECT role, token_version FROM users WHERE id = $1`, [u.id])).rows[0];
    return generateToken({ userId: u.id, role: r.role, tokenVersion: r.token_version ?? 0 });
  };
  const call = async (who: { id: string }) => {
    const headers = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(who)}` };
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      http.get({ socketPath: sock, path: '/api/v1/settings/setup', headers }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch { /* corps non JSON */ } resolve({ status: res.statusCode ?? 0, json }); });
      }).on('error', reject);
    });
  };
  const status = (checks: any[], key: string) => checks.find(c => c.key === key)?.status;

  console.log('1. Etat de la configuration (administrateur)');
  const a = await call(admin);
  const checks = a.json?.data?.checks ?? [];
  ok(a.status === 200 && checks.length >= 15, 'tous les domaines sont evalues', checks.length);
  ok(checks.every((c: any) => ['ok', 'todo', 'warn', 'info'].includes(c.status) && c.page && c.label && c.detail), 'chaque point a un statut, une page, un libelle et un detail');
  ok(new Set(checks.map((c: any) => c.key)).size === checks.length, 'cles uniques');
  ok(Array.isArray(a.json.data.recent), 'dernieres modifications jointes', a.json.data.recent.length);

  console.log('2. Les statuts suivent les donnees');
  await conn.query(`UPDATE company_settings SET legal_rc = NULL WHERE id = 1`);
  await conn.query(`UPDATE tax_codes SET valid_to = current_date - 1 WHERE valid_to IS NULL OR valid_to >= current_date`);
  await conn.query(`UPDATE document_templates SET late_penalty = NULL WHERE doc_type = 'invoice'`);
  let c2 = (await call(admin)).json.data.checks;
  ok(status(c2, 'company.legal') === 'todo' && /RC/.test(c2.find((c: any) => c.key === 'company.legal').detail), 'RC manquant cite');
  ok(status(c2, 'tax.rates') === 'todo', 'aucun taux de TVA en vigueur : a faire');
  ok(status(c2, 'documents.invoice') === 'todo', 'penalites de retard absentes : a faire');
  await conn.query(`UPDATE company_settings SET legal_ice = '001234567000089', legal_rc = '12345', legal_name = 'X', legal_address = 'Y', legal_city = 'Z', legal_if = '1' WHERE id = 1`);
  c2 = (await call(admin)).json.data.checks;
  ok(status(c2, 'company.legal') === 'ok', 'identite complete : fait');

  console.log('3. Droits');
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager.id]);
  await conn.query(
    `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config)
     VALUES ($1, 'settings', true, false, false, false, '{"sections": ["tax"]}'::jsonb)`, [manager.id]);
  const m = await call(manager);
  const mc = m.json?.data?.checks ?? [];
  ok(m.status === 200 && mc.length > 0 && mc.every((c: any) => c.section === 'tax'), 'section TVA seule : seuls les points TVA', mc.map((c: any) => c.key));
  ok(m.json?.data?.recent === null, 'sans la section Journal : pas de dernieres modifications');
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager.id]);
  await conn.query(
    `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config)
     VALUES ($1, 'sales', true, false, false, false, '{}'::jsonb)`, [manager.id]);
  ok((await call(manager)).status === 403, 'sans droit Parametres : 403');
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
