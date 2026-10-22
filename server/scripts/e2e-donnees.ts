// Test de bout en bout du lot 7 Parametres (import guide, exports) sur la base
// LOCALE, dans une seule transaction annulee : rien n'est ecrit.
//
// Usage :
//   npm run test:e2e-donnees            (depuis la racine)
//   npx tsx scripts/e2e-donnees.ts      (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
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
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = (await conn.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`)).rows[0];
  const manager = (await conn.query(`SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY email = 'gerant.test@kalum.local' DESC LIMIT 1`)).rows[0];
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager.id]);
  const tok = async (u: { id: string }) => {
    const r = (await conn.query(`SELECT role, token_version FROM users WHERE id = $1`, [u.id])).rows[0];
    return generateToken({ userId: u.id, role: r.role, tokenVersion: r.token_version ?? 0 });
  };
  const call = async (method: string, path: string, who: { id: string }, file?: Buffer) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(who)}` };
    let body: FormData | undefined;
    if (file) { body = new FormData(); body.append('file', new Blob([file]), 'import.xlsx'); }
    const r = await fetch(base + path, { method, headers, body });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, ct, json: ct.includes('json') ? await r.clone().json().catch(() => null) as any : null, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const book = (header: string[], ...lines: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...lines]), 'Import');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  console.log('1. Modele et droits');
  const tpl = await call('GET', '/settings/data/import/suppliers/template', admin);
  const tplHeaders = (XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(tpl.buf).Sheets['Fournisseurs'], { header: 1 })[0] as string[]);
  ok(tpl.status === 200 && tplHeaders.includes('Nom') && tplHeaders.includes('ICE'), 'modele fournisseurs avec ses colonnes', tplHeaders);
  ok((await call('GET', '/settings/data/status', manager)).status === 403, 'gerant sans droit Donnees : 403');

  console.log('2. Import fournisseurs : apercu puis tout ou rien');
  const existing = (await conn.query(`SELECT name FROM suppliers ORDER BY name LIMIT 1`)).rows[0]?.name as string;
  const header = ['Nom', 'ICE', 'Téléphone', 'Ville', 'Colonne inconnue'];
  const withErrors = book(header,
    ['Fournisseur E2E Un', '001234567000089', '0522 11 22 33', 'Rabat', 'x'],
    [existing, '', '', 'Ville E2E', ''],
    ['Fournisseur E2E Deux', '12345', '', '', ''],
    ['Fournisseur E2E Un', '', '', '', ''],
    ['', '', '', '', ''],
  );
  const pv = await call('POST', '/settings/data/import/suppliers/preview', admin, withErrors);
  const s = pv.json?.data?.summary;
  ok(pv.status === 200 && s.create === 1 && s.update === 1 && s.error === 2 && s.skip === 1, 'apercu : 1 creation, 1 mise a jour, 2 erreurs, 1 ligne vide', s);
  ok(pv.json.data.unknownHeaders.includes('Colonne inconnue'), 'colonne inconnue signalee');
  const errs = pv.json.data.rows.filter((r: any) => r.action === 'error').map((r: any) => r.errors[0].message);
  ok(errs.some((m: string) => /15 chiffres/.test(m)) && errs.some((m: string) => /en double/.test(m)), 'motifs : ICE invalide, doublon dans le fichier', errs);
  const n0 = Number((await conn.query(`SELECT count(*) FROM suppliers`)).rows[0].count);
  const refused = await call('POST', '/settings/data/import/suppliers/commit', admin, withErrors);
  ok(refused.status === 409 && Number((await conn.query(`SELECT count(*) FROM suppliers`)).rows[0].count) === n0, 'validation refusee tant qu\'il reste des erreurs, rien ecrit');
  const clean = book(header, ['Fournisseur E2E Un', '001234567000089', '0522 11 22 33', 'Rabat', ''], [existing, '', '', 'Ville E2E', '']);
  const done = await call('POST', '/settings/data/import/suppliers/commit', admin, clean);
  const upd = (await conn.query(`SELECT city, phone FROM suppliers WHERE name = $1`, [existing])).rows[0];
  ok(done.status === 200 && done.json.data.created === 1 && done.json.data.updated === 1, 'import valide : 1 cree, 1 mis a jour', done.json?.data ?? done.json?.error);
  ok(upd.city === 'Ville E2E', 'mise a jour : cellule renseignee appliquee', upd);
  const again = await call('POST', '/settings/data/import/suppliers/preview', admin, clean);
  ok(again.json.data.summary.create === 0 && again.json.data.summary.update === 2, 'reimport du meme fichier : que des mises a jour (pas de doublon)', again.json?.data?.summary);

  console.log('3. Import clients');
  const cust = book(['Prénom', 'Nom', 'Type', 'Téléphone', 'E-mail'],
    ['Salma', 'E2E', 'Particulier', '0661 00 11 22', 'salma.e2e@example.ma'],
    ['', '', 'grossiste', '0661 00 11 23', ''],
  );
  const cp = await call('POST', '/settings/data/import/customers/preview', admin, cust);
  ok(cp.json.data.summary.create === 1 && cp.json.data.summary.error === 1, 'type hors liste et nom absent refuses', cp.json?.data?.rows?.[1]?.errors);
  const cc = await call('POST', '/settings/data/import/customers/commit', admin, book(['Prénom', 'Nom', 'Type', 'Téléphone', 'E-mail'], ['Salma', 'E2E', 'Particulier', '0661 00 11 22', 'salma.e2e@example.ma']));
  ok(cc.status === 200 && (await conn.query(`SELECT customer_type FROM customers WHERE email = 'salma.e2e@example.ma'`)).rows[0]?.customer_type === 'particulier', 'client cree, type normalise');

  console.log('4. Exports');
  const conf = await call('GET', '/settings/data/export/configuration', admin);
  const cj = JSON.parse(conf.buf.toString('utf8'));
  ok(conf.status === 200 && cj.format === 'kalum-configuration' && Array.isArray(cj.roles) && Array.isArray(cj.series_de_numeros), 'configuration : roles, series, …', Object.keys(cj).length);
  const txt = conf.buf.toString('utf8');
  ok(!/password_hash|pin_code|logo_url/.test(txt), 'aucun secret ni logo dans la configuration');
  const data = await call('GET', '/settings/data/export/base', admin);
  const sheets = XLSX.read(data.buf).SheetNames;
  ok(data.status === 200 && ['Produits', 'Ingrédients', 'Fournisseurs', 'Clients', 'Personnel', 'Sommaire'].every(n => sheets.includes(n)), 'donnees de base : une feuille par referentiel', sheets);
  const st = await call('GET', '/settings/data/status', admin);
  const kinds = st.json.data.exports.map((e: any) => e.event_type);
  ok(st.status === 200 && ['data_import', 'config_export', 'data_export'].every(k => kinds.includes(k)), 'imports et exports traces (auteur, date)', kinds.slice(0, 4));
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
