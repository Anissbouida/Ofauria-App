/**
 * e2e — Ventes aux professionnels (mig 352, lot 2) : BL client → facture groupée.
 * Tout se passe dans UNE transaction annulée à la fin : la base locale est intacte.
 *   npm run e2e:ventes-pros
 */
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
let sp = 0;
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };
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
const q = async (text: string, params?: unknown[]) => (await conn.query(text, params)).rows;

let server: import('node:http').Server | undefined;
try {
  if (!(await q(`SELECT to_regclass('public.delivery_notes') AS t`))[0].t) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/352_bons_livraison_clients.sql', import.meta.url)), 'utf8'));
  }
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = (await q(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`))[0];
  const tok = async (u: { id: string }) => {
    const r = (await q(`SELECT role, token_version, store_id FROM users WHERE id = $1`, [u.id]))[0];
    return generateToken({ userId: u.id, role: r.role, tokenVersion: r.token_version ?? 0, storeId: r.store_id ?? undefined } as any);
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(admin)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };

  const cust = (await q(`INSERT INTO customers (company_name, first_name, customer_type, delai_paiement_jours, remise_pct)
                         VALUES ('Hôtel E2E', 'Hotel', 'professionnel', 30, 10) RETURNING id`))[0];
  const [p1, p2] = await q(`SELECT id, name, price FROM products WHERE price > 0 ORDER BY name LIMIT 2`);

  console.log('1. Bon de livraison');
  const defaults = await call('GET', `/delivery-notes/line-defaults?customerId=${cust.id}&productIds=${p1.id}`);
  const expected = Math.round(Number(p1.price) * 0.9 * 100) / 100;
  ok(defaults.status === 200 && defaults.json.data[p1.id].unitPrice === expected, 'prix par defaut = catalogue - remise client 10 %', defaults.json?.data?.[p1.id]);
  const blA = await call('POST', '/delivery-notes', { customerId: cust.id, items: [
    { productId: p1.id, quantity: 10, unitPrice: 5, tvaRate: 20 },
    { productId: p2.id, quantity: 4, unitPrice: 12.5, tvaRate: 0 },
  ] });
  ok(blA.status === 201 && /^BL-\d{4}-\d{4}$/.test(blA.json.data.number), 'BL cree et numerote', blA.json?.data?.number ?? blA.json?.error);
  const blB = await call('POST', '/delivery-notes', { customerId: cust.id, items: [{ description: 'Pain de mie tranché', quantity: 3, unitPrice: 20, tvaRate: 0 }] });
  ok(blB.status === 201, 'BL avec ligne libre (sans produit)');
  const detail = await call('GET', `/delivery-notes/${blA.json.data.id}`);
  ok(Number(detail.json.data.total_ht) === 100 && Number(detail.json.data.total_tva) === 10 && detail.json.data.items.length === 2, 'BL A : 100 HT, 10 TVA, 2 lignes', { ht: detail.json?.data?.total_ht, tva: detail.json?.data?.total_tva });
  const noJournal = await q(`SELECT 1 FROM journal_entries WHERE source_id = $1`, [blA.json.data.id]);
  ok(noJournal.length === 0, 'le BL ne passe aucune ecriture');

  console.log('2. A facturer et facture groupee');
  const todo = await call('GET', '/delivery-notes/to-invoice');
  const group = todo.json.data.find((g: any) => g.customerId === cust.id);
  ok(group?.notes?.length === 2 && group.totalHt === 160 && group.totalTtc === 170, 'client a facturer : 2 BL, 160 HT, 170 TTC', group && { n: group.notes.length, ht: group.totalHt, ttc: group.totalTtc });
  const inv = await call('POST', '/delivery-notes/invoice', { deliveryNoteIds: [blA.json.data.id, blB.json.data.id], invoiceDate: '2026-10-20' });
  ok(inv.status === 201 && /^FE-/.test(inv.json.data.invoice_number), 'facture FE creee pour les 2 BL', inv.json?.data?.invoice_number ?? inv.json?.error);
  const invRow = (await q(`SELECT amount, tax_amount, total_amount, due_date::text, customer_id, invoice_type FROM invoices WHERE id = $1`, [inv.json.data.id]))[0];
  ok(Number(invRow.amount) === 160 && Number(invRow.tax_amount) === 10 && Number(invRow.total_amount) === 170, 'montants : 160 HT + 10 TVA = 170');
  ok(invRow.due_date === '2026-11-19', 'echeance = 20/10 + 30 jours', invRow.due_date);
  const lines = await q(`SELECT description FROM invoice_items WHERE invoice_id = $1`, [inv.json.data.id]);
  ok(lines.length === 3 && lines.every((l: any) => /^BL-/.test(l.description)), 'lignes de facture prefixees par leur BL', lines.map((l: any) => l.description));
  const notes = await q(`SELECT status, invoice_id FROM delivery_notes WHERE id = ANY($1::uuid[])`, [[blA.json.data.id, blB.json.data.id]]);
  ok(notes.every((n: any) => n.status === 'invoiced' && n.invoice_id === inv.json.data.id), 'les 2 BL passent « factures »');
  const journal = await q(`SELECT a.code, l.debit, l.credit FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
                           JOIN accounts a ON a.id = l.account_id WHERE je.source_id = $1`, [inv.json.data.id]);
  const codes = journal.map((r: any) => r.code);
  ok(codes.includes('3421') && codes.includes('7111'), 'ecriture de vente : client 3421 / ventes 7111', codes);
  const again = await call('POST', '/delivery-notes/invoice', { deliveryNoteIds: [blA.json.data.id] });
  ok(again.status === 409, 'un BL deja facture ne se refacture pas', again.json?.error?.message);
  const rec = await call('GET', '/sales/receivables');
  ok(rec.json.data.customers.some((c: any) => c.customerId === cust.id && c.total === 170), 'la facture apparait dans les creances clients (170)');

  console.log('3. Annulations');
  const cancelInvoiced = await call('POST', `/delivery-notes/${blA.json.data.id}/cancel`);
  ok(cancelInvoiced.status === 409, 'un BL facture ne s\'annule pas');
  const cancelInv = await call('POST', `/invoices/${inv.json.data.id}/cancel`);
  ok(cancelInv.status === 200, 'facture annulee par l\'admin', cancelInv.json?.error?.message ?? cancelInv.status);
  const todo2 = await call('GET', '/delivery-notes/to-invoice');
  ok(todo2.json.data.find((g: any) => g.customerId === cust.id)?.notes?.length === 2, 'facture annulee : les BL redeviennent a facturer');
  const blC = await call('POST', '/delivery-notes', { customerId: cust.id, items: [{ productId: p1.id, quantity: 1, unitPrice: 5 }] });
  const cancelC = await call('POST', `/delivery-notes/${blC.json.data.id}/cancel`);
  ok(cancelC.status === 200 && cancelC.json.data.status === 'cancelled', 'BL livre non facture : annule');

  console.log('4. Depuis une commande');
  const order = (await q(`INSERT INTO orders (order_number, customer_id, user_id, type, status, subtotal, total)
                          VALUES ('CMD-E2E-PRO', $1, $2, 'custom', 'ready', 50, 50) RETURNING id`, [cust.id, admin.id]))[0];
  await conn.query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 5, 10, 50)`, [order.id, p1.id]);
  const eligible = await call('GET', `/delivery-notes/orders/${cust.id}`);
  ok(eligible.json.data.some((o: any) => o.id === order.id), 'commande prete proposee pour le BL');
  const olines = await call('GET', `/delivery-notes/order-lines/${order.id}`);
  ok(olines.json.data.length === 1 && Number(olines.json.data[0].quantity) === 5, 'lignes reprises de la commande');
  const blD = await call('POST', '/delivery-notes', { customerId: cust.id, orderId: order.id, items: [{ productId: p1.id, quantity: 5, unitPrice: 10, tvaRate: 20 }] });
  ok(blD.status === 201, 'BL cree depuis la commande');
  ok((await q(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status === 'completed', 'la commande passe « terminee »');
  const dup = await call('POST', '/delivery-notes', { customerId: cust.id, orderId: order.id, items: [{ productId: p1.id, quantity: 5, unitPrice: 10 }] });
  ok(dup.status === 409, 'une commande ne donne qu\'un seul BL', dup.json?.error?.message);

  console.log('5. Livrer depuis le module Commandes');
  const order2 = (await q(`INSERT INTO orders (order_number, customer_id, user_id, type, status, subtotal, total, store_id)
                           VALUES ('CMD-E2E-PRO2', $1, $2, 'custom', 'ready', 30, 30, (SELECT store_id FROM users WHERE id = $2)) RETURNING id`, [cust.id, admin.id]))[0];
  await conn.query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 3, 10, 30)`, [order2.id, p1.id]);
  const fromOrder = await call('POST', `/delivery-notes/from-order/${order2.id}`);
  ok(fromOrder.status === 201 && fromOrder.json.data.order_id === order2.id, 'BL cree en un clic depuis la commande', fromOrder.json?.error?.message ?? fromOrder.status);
  const fromOrderDetail = await call('GET', `/delivery-notes/${fromOrder.json.data.id}`);
  ok(fromOrderDetail.json.data.items.length === 1 && Number(fromOrderDetail.json.data.items[0].tva_rate) === 20, 'lignes de la commande, TVA = dernier taux du produit (20 %)', fromOrderDetail.json?.data?.items?.[0]?.tva_rate);
  const ordersList = await call('GET', `/orders?limit=500&customerId=${cust.id}`);
  const listed = (ordersList.json.data ?? []).find((o: any) => o.id === order2.id);
  ok(listed?.status === 'completed' && listed?.customer_type === 'professionnel' && /^BL-/.test(listed?.delivery_note_number ?? ''), 'liste des commandes : terminee, client pro, n° de BL', listed && { s: listed.status, t: listed.customer_type, bl: listed.delivery_note_number });
  const noCustomer = (await q(`INSERT INTO orders (order_number, user_id, type, status, subtotal, total) VALUES ('CMD-E2E-NOC', $1, 'custom', 'ready', 10, 10) RETURNING id`, [admin.id]))[0];
  const refused = await call('POST', `/delivery-notes/from-order/${noCustomer.id}`);
  ok(refused.status === 400, 'commande sans fiche client : livraison avec encaissement uniquement', refused.json?.error?.message);

  console.log('6. Facture directe depuis une commande : retirée (mig 354)');
  const o3 = (await q(`INSERT INTO orders (order_number, customer_id, user_id, type, status, subtotal, total, completed_at)
                       VALUES ('CMD-E2E-FAC1', $1, $2, 'custom', 'completed', 40, 40, now()) RETURNING id`, [cust.id, admin.id]))[0];
  const fac = await call('POST', `/invoices/from-order/${o3.id}`);
  ok(fac.status === 410, 'la facture suit le bon de livraison, plus la commande', fac.json?.error?.message ?? fac.status);
} catch (err) {
  failures++;
  console.error('ERREUR', err);
} finally {
  server?.close();
  await conn.query('ROLLBACK');
  await conn.end();
  console.log(failures ? `\n${failures} echec(s)` : '\nTout est vert (transaction annulee).');
  process.exit(failures ? 1 : 0);
}
