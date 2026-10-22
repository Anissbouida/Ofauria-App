// Test de bout en bout des series de numeros des pieces (lot 2 Parametres,
// mig 329) sur la base LOCALE, dans une seule transaction annulee : rien
// n'est ecrit, migrations 328 et 329 comprises.
//
// Verifie : reprise des compteurs, doublon FR/FE corrige, numero rendu sur
// ROLLBACK (factures clients sans trou), facture client non supprimable,
// changement de modele sans doublon, ecran Parametres > Numerotation (API).
//
// Usage :
//   npm run test:e2e-numerotation            (depuis la racine)
//   npx tsx scripts/e2e-numerotation.ts      (depuis server/)
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
  for (const m of ['328_journal_audit_parametres.sql', '329_series_numeros_pieces.sql']) {
    await conn.query(readFileSync(fileURLToPath(new URL(`../migrations/${m}`, import.meta.url)), 'utf8'));
  }
  const { invoiceRepository } = await import('../src/repositories/accounting.repository.js');
  const { purchaseOrderRepository } = await import('../src/repositories/purchase-order.repository.js');
  const { nextDocumentNumber } = await import('../src/utils/document-number.js');
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const admin = (await conn.query(`SELECT id, role, token_version FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`)).rows[0];
  const manager = (await conn.query(`SELECT id, role, token_version FROM users WHERE role = 'manager' AND is_active LIMIT 1`)).rows[0];
  await conn.query(`DELETE FROM user_permissions WHERE user_id = $1`, [manager.id]);
  const tok = (u: any) => generateToken({ userId: u.id, role: u.role, tokenVersion: u.token_version ?? 0 });
  const call = async (method: string, path: string, who: any, body?: unknown) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${tok(who)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  const year = new Date().getFullYear();
  const seqOf = (n: string) => parseInt(n.split(/[^0-9]/).filter(Boolean).pop() ?? '0', 10);
  const maxFr = async () => (await conn.query(
    `SELECT COALESCE(MAX(substring(invoice_number FROM '^FR-${year}-([0-9]+)$')::int), 0) AS m FROM invoices WHERE invoice_number ~ '^FR-${year}-[0-9]+$'`)).rows[0].m as number;
  const newInvoice = (type: 'received' | 'emitted') => invoiceRepository.create({
    invoiceType: type, invoiceDate: `${year}-10-21`, amount: 100, taxAmount: 20, totalAmount: 120,
    createdBy: admin.id, notes: 'E2E numerotation',
  } as any);

  console.log('1. Reprise des compteurs');
  const list = await call('GET', '/settings/document-sequences', admin);
  ok(list.status === 200 && list.json.data.length === 9, '9 series', list.json?.data?.length);
  const fr = list.json.data.find((s: any) => s.doc_type === 'invoice_received');
  ok(seqOf(fr.next_number) === (await maxFr()) + 1, 'FR : prochain = plus grand numero existant + 1', fr.next_number);
  ok((await call('GET', '/settings/document-sequences', manager)).status === 403, 'gerant sans droit Parametres : 403');

  console.log('2. Factures fournisseur : plus de collision');
  const a = await newInvoice('received');
  const b = await newInvoice('received');
  ok(seqOf(b.invoice_number) === seqOf(a.invoice_number) + 1, 'numeros consecutifs', [a.invoice_number, b.invoice_number]);
  // Numero saisi a la main plus loin dans la serie : l'ancien COUNT(*)+1 finissait par
  // regenerer ce numero (violation d'unicite) ; la serie se cale sur le plus grand existant.
  const manual = `FR-${year}-${String(seqOf(b.invoice_number) + 3).padStart(4, '0')}`;
  await invoiceRepository.create({ invoiceNumber: manual, invoiceType: 'received', invoiceDate: `${year}-10-21`,
    amount: 10, taxAmount: 2, totalAmount: 12, createdBy: admin.id, notes: 'E2E saisie manuelle' } as any);
  const c = await newInvoice('received');
  ok(seqOf(c.invoice_number) === seqOf(manual) + 1, 'apres un numero saisi a la main, la serie reprend au-dela', [manual, c.invoice_number]);
  const count = Number((await conn.query(`SELECT count(*) FROM invoices WHERE invoice_type = 'received' AND EXTRACT(YEAR FROM invoice_date) = $1`, [year])).rows[0].count);
  ok(`FR-${year}-${String(count + 1).padStart(4, '0')}` !== c.invoice_number, 'l\'ancien calcul COUNT+1 aurait donne un autre numero', `COUNT+1 = ${count + 1}`);

  console.log('3. Factures clients : continues, non supprimables');
  const e1 = await newInvoice('emitted');
  await conn.query('SAVEPOINT lost');
  const lost = await nextDocumentNumber(conn as any, 'invoice_emitted');
  await conn.query('ROLLBACK TO SAVEPOINT lost');
  const e2 = await newInvoice('emitted');
  ok(lost === e2.invoice_number && seqOf(e2.invoice_number) === seqOf(e1.invoice_number) + 1,
    'numero rendu apres ROLLBACK : aucun trou', [e1.invoice_number, lost, e2.invoice_number]);
  const del = await call('DELETE', `/invoices/${e2.id}`, admin);
  ok(del.status === 409 && /annulez-la/.test(del.json?.error?.message ?? ''), 'suppression refusee (409)', del.json?.error?.message);
  const renum = await conn.query('SAVEPOINT r').then(() => conn.query(`UPDATE invoices SET invoice_number = 'X' WHERE id = $1`, [e2.id])).then(() => 'accepte', (err) => err.message);
  await conn.query('ROLLBACK TO SAVEPOINT r');
  ok(/définitif/.test(renum), 'renumerotation refusee', renum);

  console.log('4. Modele modifiable, compteur continu');
  const bad = await call('PUT', '/settings/document-sequences/purchase_order', admin, { pattern: 'ACH-{SEQ}', padding: 4, resetPeriod: 'year' });
  ok(bad.status === 400 && /annuelle/.test(bad.json?.error?.message ?? ''), 'remise annuelle sans annee : refusee', bad.json?.error?.message);
  const pv = await call('POST', '/settings/document-sequences/preview', admin, { pattern: 'ACH/{YY}/{SEQ}', padding: 5, resetPeriod: 'year' });
  ok(pv.json?.data?.valid && pv.json.data.sample === `ACH/${String(year).slice(2)}/00001`, 'apercu', pv.json?.data);
  const before = list.json.data.find((s: any) => s.doc_type === 'purchase_order').next_number;
  const put = await call('PUT', '/settings/document-sequences/purchase_order', admin, { pattern: 'ACH/{YY}/{SEQ}', padding: 5, resetPeriod: 'year' });
  ok(put.status === 200 && seqOf(put.json.data.next_number) === seqOf(before), 'nouveau modele, meme compteur', [before, put.json?.data?.next_number]);
  const po = await purchaseOrderRepository.generateOrderNumber(conn as any);
  ok(po === put.json.data.next_number, 'le BC suivant prend le nouveau modele', po);
  const audit = (await conn.query(`SELECT changed_by, diff FROM config_audit_log WHERE table_name = 'document_sequences' ORDER BY id DESC LIMIT 1`)).rows[0];
  ok(audit?.changed_by === admin.id && audit?.diff?.pattern, 'changement trace au journal (auteur, avant/apres)', audit?.diff?.pattern);
  console.log('5. Formats des autres series inchanges');
  const { generateSaleNumber } = await import('../src/repositories/sale.repository.js');
  const { orderRepository } = await import('../src/repositories/order.repository.js');
  const { receptionVoucherRepository } = await import('../src/repositories/reception-voucher.repository.js');
  const ymd = (await conn.query(`SELECT to_char((now() AT TIME ZONE 'Africa/Casablanca')::date, 'YYYYMMDD') AS d`)).rows[0].d as string;
  const checks: [string, string, RegExp][] = [
    ['vente', await generateSaleNumber(conn as any), new RegExp(`^VNT-${ymd}-\\d{4}$`)],
    ['commande client', await orderRepository.generateOrderNumber(conn as any), new RegExp(`^CMD-${ymd}-\\d{4}$`)],
    ['bon de reception', await receptionVoucherRepository.generateVoucherNumber(conn as any), new RegExp(`^BR-${year}-\\d{4}$`)],
    ['retour', await nextDocumentNumber(conn as any, 'sale_return'), new RegExp(`^RET-${ymd}-\\d{4}$`)],
    ['cloture Z', await nextDocumentNumber(conn as any, 'cash_closure'), new RegExp(`^Z-${ymd}-\\d{4}$`)],
    ['bon de sortie', await nextDocumentNumber(conn as any, 'bon_sortie'), new RegExp(`^BSI-${ymd.slice(2)}-\\d{3}$`)],
  ];
  for (const [l, n, re] of checks) ok(re.test(n), l, n);
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
