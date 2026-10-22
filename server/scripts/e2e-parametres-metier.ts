// Test de bout en bout du lot 4 Parametres (centre des parametres metier) sur
// la base LOCALE, dans une seule transaction annulee : rien n'est ecrit.
//
// Usage :
//   npm run test:e2e-parametres-metier            (depuis la racine)
//   npx tsx scripts/e2e-parametres-metier.ts      (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
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

  const admin = (await conn.query(`SELECT id, role, token_version FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`)).rows[0];
  const manager = (await conn.query(`SELECT id, role, token_version FROM users WHERE role = 'manager' AND is_active ORDER BY email = 'gerant.test@kalum.local' DESC LIMIT 1`)).rows[0];
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
  const hasMp = (await conn.query(`SELECT to_regclass('public.module_parameters') AS t`)).rows[0].t !== null;

  console.log('1. Catalogue');
  const list = await call('GET', '/settings/parameters', admin);
  ok(list.status === 200 && list.json.data.length === 12, '12 parametres pour l\'administrateur', list.json?.data?.length);
  const byKey = (k: string) => list.json.data.find((p: any) => p.key === k);
  ok(byKey('production.fixed_charges')?.available && byKey('pricing.rounding')?.value?.strategie !== undefined, 'valeurs lues dans company_settings');
  ok(byKey('purchasing.over_receipt_tolerance_pct')?.available === hasMp, 'parametres achats disponibles si module_parameters existe', hasMp);
  const m = await call('GET', '/settings/parameters', manager);
  ok(m.status === 200 && m.json.data.length === 0, 'gerant sans droit Parametres : liste vide');
  ok((await call('PUT', '/settings/parameters/sales.staff_discount', manager, { value: { percent: 5 } })).status === 403, 'gerant : modification refusee');

  console.log('2. Droit limite a la section Production');
  await call('PUT', `/users/${manager.id}/permissions`, admin, { permissions: [
    { module: 'settings', canView: true, canCreate: false, canEdit: true, canDelete: false, config: { sections: ['production'] } },
  ] });
  const lim = await call('GET', '/settings/parameters', manager);
  ok(lim.json.data.map((p: any) => p.key).sort().join(',') === 'pricing.rounding,production.fixed_charges,production.steps_blocking', 'ne voit que la production', lim.json?.data?.map((p: any) => p.key));
  ok((await call('PUT', '/settings/parameters/purchasing.over_receipt_tolerance_pct', manager, { value: { pct: 5 } })).status === 403, 'achats : 403');
  const r1 = await call('PUT', '/settings/parameters/pricing.rounding', manager, { value: { strategie: 'au_dh', sens: 'naturel' } });
  ok(r1.status === 200, 'arrondi modifie par le gerant', r1.json?.error?.message);
  const s1 = await call('GET', '/settings', admin);
  ok(s1.json.data.prixArrondiStrategie === 'au_dh' && s1.json.data.prixArrondiSens === 'naturel', 'meme valeur lue par l\'ecran existant (company_settings)');
  ok(r1.json.data.history[0]?.by_name && r1.json.data.history[0].diff?.prix_arrondi_strategie, 'historique : auteur et ancienne valeur', r1.json?.data?.history?.[0]?.by_name);

  console.log('3. Controles de saisie');
  const bad = async (key: string, value: unknown, re: RegExp, label: string) => {
    const r = await call('PUT', `/settings/parameters/${key}`, admin, { value });
    ok(r.status === 400 && re.test(r.json?.error?.message ?? ''), label, r.json?.error?.message);
  };
  await bad('sales.staff_discount', { percent: 150 }, /maximum 100/, 'pourcentage > 100 refuse');
  await bad('pricing.rounding', { strategie: 'au_centime' }, /non propos/, 'valeur hors liste refusee');
  await bad('production.fixed_charges', { loyer: 1000, tva: 20 }, /inconnu/, 'champ inconnu refuse');
  await bad('production.fixed_charges', { loyer: 'abc' }, /nombre/, 'texte au lieu d\'un nombre refuse');
  if (hasMp) await bad('purchasing.receipt_correction_window_hours', { hours: 1.5 }, /entier/, 'decimal au lieu d\'un entier refuse');
  ok((await call('PUT', '/settings/parameters/inconnu.cle', admin, { value: {} })).status === 404, 'parametre inconnu : 404');

  console.log('4. Ecriture et retour a la valeur par defaut');
  const fc = await call('PUT', '/settings/parameters/production.fixed_charges', admin, { value: { loyer: 12000 } });
  const row = (await conn.query(`SELECT production_charge_loyer, production_charge_energie FROM company_settings WHERE id = 1`)).rows[0];
  ok(fc.status === 200 && Number(row.production_charge_loyer) === 12000, 'champ modifie, autres champs conserves', row);
  const sb = await call('PUT', '/settings/parameters/production.steps_blocking', admin, { value: { enabled: true } });
  ok(sb.status === 200 && (await conn.query(`SELECT production_steps_blocking AS b FROM company_settings WHERE id = 1`)).rows[0].b === true, 'etapes bloquantes activees (lues par la production)');
  if (hasMp) {
    const tol = await call('PUT', '/settings/parameters/purchasing.over_receipt_tolerance_pct', admin, { value: { pct: 5 } });
    const v = (await conn.query(`SELECT value, updated_by FROM module_parameters WHERE key = 'purchasing.over_receipt_tolerance_pct'`)).rows[0];
    ok(tol.status === 200 && v.value.pct === 5 && v.updated_by === admin.id, 'module_parameters : valeur et auteur', v.value);
    const po = await call('PUT', '/settings/parameters/purchasing.expense_requires_po', admin, { value: { enabled: true } });
    const pv = (await conn.query(`SELECT value FROM module_parameters WHERE key = 'purchasing.expense_requires_po'`)).rows[0].value;
    ok(po.status === 200 && pv.enabled === true && pv.currency === 'MAD' && pv.threshold !== undefined, 'champs non exposes (devise) conserves', pv);
  }
  const d = await call('PUT', '/settings/parameters/sales.staff_discount', admin, { value: { percent: 10 } });
  ok(d.status === 200 && (await call('GET', '/settings', admin)).json.data.staffDiscountPercent === 10, 'remise personnel remise a 10 %');
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
