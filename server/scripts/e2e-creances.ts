/**
 * e2e — Créances clients (mig 351, lot 1).
 * Tout se passe dans UNE transaction annulée à la fin : la base locale est intacte.
 *   npm run e2e:creances
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
  const hasCol = (await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'due_date'`)).length > 0;
  if (!hasCol) await conn.query(readFileSync(fileURLToPath(new URL('../migrations/351_creances_clients.sql', import.meta.url)), 'utf8'));
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

  console.log('1. Caisse : un ticket a plus tard exige une fiche client');
  const product = (await q(`SELECT id FROM products LIMIT 1`))[0];
  const noCustomer = await call('POST', '/sales/checkout', { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'credit', paymentStatus: 'unpaid', unpaidCustomerName: 'Joseph' });
  ok(noCustomer.status === 400 && /fiche du client|client/i.test(noCustomer.json?.error?.message ?? ''), 'nom libre sans fiche : refuse', noCustomer.json?.error?.message);

  console.log('2. Echeance et balance agee');
  const cust = (await q(`INSERT INTO customers (first_name, last_name, phone, customer_type, delai_paiement_jours, credit_limit)
                         VALUES ('Creance', 'E2E', '0600000000', 'professionnel', 15, 1000) RETURNING id`))[0];
  const sale = (await q(`INSERT INTO sales (sale_number, user_id, customer_id, subtotal, total, payment_method, payment_status, created_at)
                         VALUES ('E2E-CR-0001', $1, $2, 1200, 1200, 'credit', 'unpaid', now() - interval '40 days') RETURNING id, due_date, created_at`, [admin.id, cust.id]))[0];
  const expectedDue = (await q(`SELECT ((now() - interval '40 days') AT TIME ZONE 'Africa/Casablanca')::date + 15 AS d`))[0].d;
  ok(String(sale.due_date) === String(expectedDue), 'echeance du ticket = date de vente + delai client (15 j)');
  const inv = (await q(`INSERT INTO invoices (invoice_number, invoice_type, customer_id, invoice_date, amount, tax_amount, total_amount, paid_amount, status, created_by)
                        VALUES ('FE-E2E-CR1', 'emitted', $1, CURRENT_DATE - 70, 500, 0, 500, 0, 'pending', $2) RETURNING id`, [cust.id, admin.id]))[0];
  const rec = await call('GET', '/sales/receivables');
  const row = rec.json?.data?.customers?.find((c: any) => c.customerId === cust.id);
  ok(rec.status === 200 && !!row, 'le client apparait dans la balance agee', rec.status);
  ok(row?.total === 1700 && row?.docs?.length === 2, 'total du = ticket 1 200 + facture 500', row?.total);
  ok(row?.buckets?.d30 === 1200 && row?.buckets?.d60 === 500, 'ticket en 1-30 j (25 j de retard), facture en 31-60 j (55 j)', row?.buckets);
  ok(row?.overdue === 1700 && row?.maxDaysLate === 55, 'echu et plus ancien retard', { overdue: row?.overdue, max: row?.maxDaysLate });
  ok(rec.json?.data?.totals?.total >= 1700, 'totaux generaux calcules');

  console.log('3. Fiche client : situation de compte');
  const sit = await call('GET', `/customers/${cust.id}/situation`);
  ok(sit.status === 200 && sit.json.data.total === 1700 && sit.json.data.overdue === 1700, 'doit 1 700 dont 1 700 en retard', sit.json?.data);
  ok(sit.json.data.creditLimit === 1000 && sit.json.data.available === -700, 'plafond 1 000 : depasse de 700');

  console.log('4. Encaissements');
  const partial = await call('POST', '/payments', { invoiceId: inv.id, type: 'income', amount: 200, paymentMethod: 'cash', paymentDate: new Date().toISOString().slice(0, 10), description: 'e2e partiel' });
  ok(partial.status === 201 || partial.status === 200, 'reglement partiel de la facture (200 DH)', partial.json?.error?.message ?? partial.status);
  const afterPartial = (await call('GET', '/sales/receivables')).json.data.customers.find((c: any) => c.customerId === cust.id);
  ok(afterPartial?.docs?.find((d: any) => d.kind === 'invoice')?.remaining === 300, 'reste du sur la facture : 300', afterPartial?.docs);
  const pay = await call('POST', `/sales/${sale.id}/pay`, { paymentMethod: 'cash' });
  ok(pay.status === 200, 'ticket encaisse en entier', pay.json?.error?.message ?? pay.status);
  const afterPay = (await call('GET', '/sales/receivables')).json.data.customers.find((c: any) => c.customerId === cust.id);
  ok(afterPay?.total === 300 && afterPay?.docs?.length === 1, 'il ne reste que la facture (300)', afterPay?.total);
  const paidSale = (await q(`SELECT payment_status, paid_at::date = CURRENT_DATE AS today FROM sales WHERE id = $1`, [sale.id]))[0];
  ok(paidSale.payment_status === 'paid' && paidSale.today === true, 'le ticket entre au CA du jour d\'encaissement');
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
