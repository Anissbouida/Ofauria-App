// Test de bout en bout du lot 6 Parametres (modeles de documents, regles de
// notification, mig 332) sur la base LOCALE, dans une seule transaction
// annulee : rien n'est ecrit, migration 332 comprise.
// Avec E2E_PDF_DIR=<dossier>, les apercus PDF y sont enregistres pour relecture.
//
// Usage :
//   npm run test:e2e-documents            (depuis la racine)
//   npx tsx scripts/e2e-documents.ts      (depuis server/)
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
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
  if (!(await conn.query(`SELECT to_regclass('public.document_templates') AS t`)).rows[0].t) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/332_modeles_documents_notifications.sql', import.meta.url)), 'utf8'));
  }
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  const { createNotification } = await import('../src/utils/notify.js');
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
    const isPdf = (r.headers.get('content-type') ?? '').includes('pdf');
    return { status: r.status, json: isPdf ? null : await r.json().catch(() => null) as any, pdf: isPdf ? Buffer.from(await r.arrayBuffer()) : null };
  };

  console.log('1. Modeles de documents');
  const docs = await call('GET', '/settings/documents', admin);
  ok(docs.status === 200 && docs.json.data.map((d: any) => d.doc_type).join(',') === 'invoice,purchase_order', 'facture et bon de commande', docs.json?.data?.length);
  ok((await call('GET', '/settings/documents', manager)).status === 403, 'gerant sans droit : 403');
  const tooLong = await call('PUT', '/settings/documents/invoice', admin, { footerNote: 'x'.repeat(301) });
  ok(tooLong.status === 400, 'note trop longue refusee', tooLong.json?.error?.message);
  // Compte bancaire et fiche societe pour l'apercu.
  const rib = '0077800000123456789012' + String(97n - (BigInt('0077800000123456789012') * 100n) % 97n).padStart(2, '0');
  await conn.query(`INSERT INTO company_bank_accounts (label, bank_name, rib, is_default) VALUES ('Courant', 'Banque Exemple', $1, true)`, [rib]);
  await conn.query(`UPDATE company_settings SET legal_form = 'SARL', legal_capital = 100000, legal_website = 'www.ofauria.ma' WHERE id = 1`);
  const up = await call('PUT', '/settings/documents/invoice', admin, { paymentTerms: 'Paiement à 30 jours.', footerNote: 'Merci de votre confiance' });
  ok(up.status === 200 && up.json.data.payment_terms === 'Paiement à 30 jours.' && up.json.data.updated_by === admin.id, 'conditions enregistrees avec l\'auteur');
  const inv = await call('GET', '/settings/documents/invoice/preview', admin);
  ok(inv.status === 200 && inv.pdf!.subarray(0, 4).toString() === '%PDF', 'apercu facture : PDF', inv.status);
  const po = await call('GET', '/settings/documents/purchase_order/preview', admin);
  ok(po.status === 200 && po.pdf!.subarray(0, 4).toString() === '%PDF', 'apercu bon de commande : PDF', po.status);
  if (process.env.E2E_PDF_DIR) {
    writeFileSync(`${process.env.E2E_PDF_DIR}/apercu-facture.pdf`, inv.pdf!);
    writeFileSync(`${process.env.E2E_PDF_DIR}/apercu-bc.pdf`, po.pdf!);
  }
  await call('PUT', '/settings/documents/invoice', admin, { showBank: false });
  const noBank = await call('GET', '/settings/documents/invoice/preview', admin);
  ok(noBank.pdf!.length !== inv.pdf!.length, 'masquer le compte bancaire change la piece');

  console.log('2. Regles de notification');
  const rules = await call('GET', '/settings/notification-rules', admin);
  ok(rules.status === 200 && rules.json.data.length >= 20, 'types de notification listes', rules.json?.data?.length);
  ok((await call('PUT', '/settings/notification-rules/order_ready', admin, { extraRoles: ['inexistant'] })).status === 400, 'role inconnu refuse');
  await call('PUT', '/settings/notification-rules/bsi_ready', admin, { enabled: false });
  await call('PUT', '/settings/notification-rules/order_ready', admin, { extraRoles: ['admin', 'manager'] });
  const before = Number((await conn.query(`SELECT count(*) FROM notifications`)).rows[0].count);
  await createNotification({ targetRole: 'magasinier', type: 'bsi_ready', title: 'E2E', message: 'desactive' });
  await createNotification({ targetRole: 'manager', type: 'order_ready', title: 'E2E', message: 'copie admin' });
  await createNotification({ targetRole: 'cashier', type: 'nouveau_type_e2e', title: 'E2E', message: 'type non configure' });
  const sent = (await conn.query(`SELECT type, target_role FROM notifications WHERE title = 'E2E' ORDER BY type, target_role`)).rows;
  ok(Number((await conn.query(`SELECT count(*) FROM notifications`)).rows[0].count) === before + 3, '3 notifications creees sur 4 attendues sans regles', sent);
  ok(!sent.some(x => x.type === 'bsi_ready'), 'type desactive : aucune notification');
  ok(sent.filter(x => x.type === 'order_ready').map(x => x.target_role).join(',') === 'admin,manager', 'role supplementaire : copie pour l\'administrateur, sans doublon');
  ok(sent.some(x => x.type === 'nouveau_type_e2e'), 'type non configure : envoye comme avant');
  const audit = (await conn.query(`SELECT table_name FROM config_audit_log WHERE table_name IN ('document_templates', 'notification_rules') AND changed_by = $1`, [admin.id])).rows;
  ok(new Set(audit.map(a => a.table_name)).size === 2, 'modifications tracees au journal', audit.length);
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
