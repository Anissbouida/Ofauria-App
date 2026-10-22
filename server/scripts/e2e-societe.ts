// Test de bout en bout du lot 5 Parametres (societe, etablissements, TVA, mig 331)
// sur la base LOCALE, dans une seule transaction annulee : rien n'est ecrit,
// migration 331 comprise.
//
// Usage :
//   npm run test:e2e-societe            (depuis la racine)
//   npx tsx scripts/e2e-societe.ts      (depuis server/)
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
  if (!(await conn.query(`SELECT to_regclass('public.company_bank_accounts') AS t`)).rows[0].t) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/331_societe_etablissements_tva.sql', import.meta.url)), 'utf8'));
  }
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
  const call = async (method: string, path: string, who: { id: string }, body?: unknown) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(who)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  const refused = (r: { status: number; json: any }, status: number, re: RegExp, label: string) =>
    ok(r.status === status && re.test(r.json?.error?.message ?? ''), label, r.json?.error?.message ?? r.status);
  // RIB valide : 22 chiffres + cle telle que les 24 chiffres soient divisibles par 97.
  const rib = (body22: string) => body22 + String(97n - (BigInt(body22) * 100n) % 97n).padStart(2, '0');

  console.log('1. Fiche societe');
  const put = await call('PUT', '/settings', admin, { legalForm: 'SARL', legalCapital: 100000, legalWebsite: 'www.ofauria.ma' });
  ok(put.status === 200 && put.json.data.legalForm === 'SARL' && put.json.data.legalCapital === 100000, 'forme juridique et capital', put.json?.error?.message);
  refused(await call('PUT', '/settings', admin, { legalIf: '12AB' }), 400, /chiffres/, 'IF non numerique refuse');
  refused(await call('PUT', '/settings', admin, { legalForm: 'GIE' }), 400, /Forme juridique/, 'forme juridique hors liste refusee');
  refused(await call('PUT', '/settings', admin, { legalCapital: -5 }), 400, /Capital/, 'capital negatif refuse');
  ok('employerCnssNumber' in (await call('GET', '/settings', admin)).json.data, 'CNSS employeur expose (lecture seule, tenu en paie)');

  console.log('2. Comptes bancaires');
  const r1 = rib('0077800000123456789012');
  refused(await call('POST', '/settings/bank-accounts', admin, { label: 'Courant', bankName: 'Banque', rib: r1.slice(0, 22) + '00' }), 400, /clé/, 'cle RIB incorrecte refusee');
  refused(await call('POST', '/settings/bank-accounts', admin, { label: 'Courant', bankName: 'Banque', rib: r1, ledgerAccount: '4411' }), 400, /514/, 'compte comptable hors 514 refuse');
  refused(await call('POST', '/settings/bank-accounts', admin, { label: 'Courant', bankName: 'Banque', rib: r1, swift: 'ABC' }), 400, /SWIFT/, 'SWIFT invalide refuse');
  const a1 = await call('POST', '/settings/bank-accounts', admin, { label: 'Courant', bankName: 'Banque A', rib: r1, swift: 'BCMAMAMC', ledgerAccount: '5141', isDefault: true });
  ok(a1.status === 201 && a1.json.data.is_default, 'compte cree, par defaut', a1.json?.error?.message);
  refused(await call('POST', '/settings/bank-accounts', admin, { label: 'Doublon', bankName: 'Banque A', rib: r1 }), 409, /déjà/, 'RIB en double refuse');
  const a2 = await call('POST', '/settings/bank-accounts', admin, { label: 'Second', bankName: 'Banque B', rib: rib('2307800000999888777666'), isDefault: true });
  const list = (await call('GET', '/settings/bank-accounts', admin)).json.data;
  ok(a2.status === 201 && list.filter((x: any) => x.is_default).length === 1 && list.find((x: any) => x.id === a2.json.data.id)?.is_default, 'un seul compte par defaut');
  ok((await call('GET', '/settings/bank-accounts', manager)).status === 403, 'gerant sans droit Parametres : 403');

  console.log('3. Etablissements');
  const s1 = await call('POST', '/stores', admin, { name: 'Labo E2E', code: 'lab9', kind: 'workshop', patente: '12345678',
    openingHours: { mon: { closed: false, open: '06:00', close: '14:00' }, sun: { closed: true } }, isHeadquarters: true });
  ok(s1.status === 201 && s1.json.data.code === 'LAB9' && s1.json.data.kind === 'workshop', 'code mis en majuscules, type atelier', s1.json?.error?.message);
  refused(await call('POST', '/stores', admin, { name: 'Autre', code: 'LAB9' }), 409, /déjà utilisé/, 'code en double refuse');
  refused(await call('POST', '/stores', admin, { name: 'Autre', openingHours: { mon: { open: '20:00', close: '08:00' } } }), 400, /précéder/, 'horaires incoherents refuses');
  refused(await call('POST', '/stores', admin, { name: 'Autre', kind: 'usine' }), 400, /Type/, 'type inconnu refuse');
  refused(await call('POST', '/stores', admin, { name: 'Autre', managerUserId: '00000000-0000-0000-0000-000000000001' }), 400, /Responsable/, 'responsable inconnu refuse');
  const s2 = await call('POST', '/stores', admin, { name: 'Siege E2E', kind: 'office', isHeadquarters: true, managerUserId: manager.id });
  const hq = (await conn.query(`SELECT name FROM stores WHERE is_headquarters`)).rows;
  ok(s2.status === 201 && hq.length === 1 && hq[0].name === 'Siege E2E', 'un seul siege', hq);

  console.log('4. TVA datee');
  const codes = (await call('GET', '/settings/tax-codes', admin)).json.data;
  ok(codes.some((c: any) => c.code === 'N20' && c.status === 'current') && codes.some((c: any) => c.code === 'R14' && c.status === 'past'), 'taux en vigueur et historique', codes.length);
  const n = await call('POST', '/settings/tax-codes', admin, { code: 'N20', label: 'TVA 20 %', rate: 18, kind: 'standard', validFrom: '2027-01-01', legalRef: 'Hypothese E2E' });
  const n20 = (await conn.query(`SELECT rate, valid_from::text, valid_to::text FROM tax_codes WHERE code = 'N20' ORDER BY valid_from`)).rows;
  ok(n.status === 201 && n20.length === 2 && n20[0].valid_to === '2026-12-31' && n20[1].valid_to === null, 'nouveau taux : l\'ancien s\'arrete la veille', n20);
  refused(await call('POST', '/settings/tax-codes', admin, { code: 'N20', label: 'TVA 19 %', rate: 19, kind: 'standard', validFrom: '2026-06-01' }), 409, /déjà un taux/, 'periode qui chevauche un taux a venir refusee');
  refused(await call('POST', '/settings/tax-codes', admin, { code: 'EXO2', label: 'Exonere', rate: 5, kind: 'exempt_without_credit', validFrom: '2026-01-01' }), 400, /0 %/, 'exonere a 5 % refuse');
  refused(await call('PUT', `/settings/tax-codes/${codes[0].id}`, admin, { rate: 12 }), 400, /figés/, 'taux non modifiable');
  ok((await call('GET', '/settings/tax-codes', manager)).status === 403, 'gerant sans droit TVA : 403');
  const audit = (await conn.query(`SELECT table_name FROM config_audit_log WHERE table_name IN ('company_bank_accounts', 'tax_codes', 'stores') AND changed_by = $1`, [admin.id])).rows;
  ok(new Set(audit.map(a => a.table_name)).size === 3, 'comptes, taux et etablissements traces au journal', audit.length);
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
