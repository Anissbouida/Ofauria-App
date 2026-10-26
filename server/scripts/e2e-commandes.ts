/**
 * e2e — Commandes clients (mig 354) : particulier en caisse, professionnel par la direction.
 * Tout se passe dans UNE transaction annulée à la fin : la base locale est intacte.
 *   npm run e2e:commandes
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
const r2 = (v: number) => Math.round(v * 100) / 100;
const inDays = (d: number, h = 12) => { const x = new Date(Date.now() + d * 86_400_000); x.setHours(h, 0, 0, 0); return x.toISOString(); };

let server: import('node:http').Server | undefined;
try {
  if (!(await q(`SELECT to_regclass('public.order_reschedules') AS t`))[0].t) {
    await conn.query(readFileSync(fileURLToPath(new URL('../migrations/354_commandes_particuliers_pros.sql', import.meta.url)), 'utf8'));
  }
  const { default: app } = await import('../src/app.js');
  const { generateToken } = await import('../src/utils/jwt.js');
  server = app.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = (await q(`SELECT id, store_id FROM users WHERE role = 'admin' AND is_active ORDER BY email = 'admin.test@kalum.local' DESC LIMIT 1`))[0];
  const [cashA, cashB] = await q(`SELECT id FROM users WHERE role = 'cashier' AND is_active ORDER BY email LIMIT 2`);
  // Même magasin pour tous : les commandes se voient d'une caisse à l'autre.
  await conn.query(`UPDATE users SET store_id = $1 WHERE id = ANY($2::uuid[])`, [admin.store_id, [cashA.id, cashB.id]]);
  for (const u of [cashA, cashB]) {
    if (!(await q(`SELECT 1 FROM cash_register_sessions WHERE user_id = $1 AND status = 'open'`, [u.id])).length) {
      await conn.query(`INSERT INTO cash_register_sessions (user_id, opening_amount, status, store_id) VALUES ($1, 0, 'open', $2)`, [u.id, admin.store_id]);
    }
  }
  const tok = async (u: { id: string }) => {
    const r = (await q(`SELECT role, token_version, store_id FROM users WHERE id = $1`, [u.id]))[0];
    return generateToken({ userId: u.id, role: r.role, tokenVersion: r.token_version ?? 0, storeId: r.store_id ?? undefined } as any);
  };
  const as = (u: { id: string }) => async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Origin: 'http://localhost:5173', Authorization: `Bearer ${await tok(u)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, ct, json: ct.includes('json') ? await r.json().catch(() => null) as any : null };
  };
  const direction = as(admin), caisseA = as(cashA), caisseB = as(cashB);
  const [p1, p2] = await q(`SELECT id, price::numeric AS price FROM products WHERE price > 0 AND is_available ORDER BY name LIMIT 2`);
  const price1 = Number(p1.price), price2 = Number(p2.price);

  console.log('1. Particulier : avance à la commande, solde intégral au retrait');
  const c1 = await caisseA('POST', '/orders', {
    customerName: 'Passager E2E', pickupDate: inDays(3), paymentMethod: 'cash', advanceAmount: 10,
    items: [{ productId: p1.id, quantity: 2 }],
  });
  const total1 = r2(price1 * 2);
  ok(c1.status === 201 && Number(c1.json.data.total) === total1 && Number(c1.json.data.tax_amount) === 0, 'commande créée au prix catalogue TTC, sans TVA', c1.json?.error?.message ?? c1.json?.data?.total);
  const adv = await q(`SELECT s.total, s.session_id, cs.user_id FROM sales s JOIN cash_register_sessions cs ON cs.id = s.session_id
                        WHERE s.order_id = $1 AND s.sale_type = 'advance'`, [c1.json.data.id]);
  ok(adv.length === 1 && Number(adv[0].total) === 10 && adv[0].user_id === cashA.id, 'avance comptée dans la session de la caissière qui prend la commande', adv[0]);
  const deferred = await caisseA('POST', '/orders', { customerName: 'X', pickupDate: inDays(2), paymentMethod: 'deferred', items: [{ productId: p1.id, quantity: 1 }] });
  ok(deferred.status === 400, 'paiement reporté refusé pour un particulier', deferred.json?.error?.message);
  const completeDirect = await caisseA('PUT', `/orders/${c1.json.data.id}/status`, { status: 'completed' });
  ok(completeDirect.status === 400, 'une commande ne se termine pas sans remise', completeDirect.json?.error?.message);
  await caisseA('PUT', `/orders/${c1.json.data.id}/status`, { status: 'ready' });
  const remaining = r2(total1 - 10);
  const partial = await caisseB('POST', `/orders/${c1.json.data.id}/deliver`, { amountPaid: remaining - 1, paymentMethod: 'cash' });
  ok(partial.status === 400, 'remise refusée sans le solde intégral', partial.json?.error?.message);
  const full = await caisseB('POST', `/orders/${c1.json.data.id}/deliver`, { amountPaid: remaining + 5, paymentMethod: 'cash' });
  ok(full.status === 200 && full.json.data.change === 5, 'remise contre le solde, monnaie rendue', full.json?.data ?? full.json?.error);
  const del = await q(`SELECT s.total, cs.user_id FROM sales s JOIN cash_register_sessions cs ON cs.id = s.session_id
                        WHERE s.order_id = $1 AND s.sale_type <> 'advance'`, [c1.json.data.id]);
  ok(del.length === 1 && Number(del[0].total) === remaining && del[0].user_id === cashB.id, 'reste compté dans la session de la caissière qui remet', del[0]);
  const sum = await q(`SELECT SUM(total) AS t FROM sales WHERE order_id = $1`, [c1.json.data.id]);
  ok(Number(sum[0].t) === total1, 'avance + reste = total, sans double comptage', sum[0].t);
  const unbalanced = await q(`SELECT j.entry_number FROM journal_entries j JOIN sales s ON s.id = j.source_id
                               JOIN journal_entry_lines l ON l.journal_entry_id = j.id
                              WHERE s.order_id = $1 GROUP BY j.entry_number HAVING SUM(l.debit) <> SUM(l.credit)`, [c1.json.data.id]);
  const posted = await q(`SELECT count(*) AS n FROM journal_entries j JOIN sales s ON s.id = j.source_id WHERE s.order_id = $1`, [c1.json.data.id]);
  ok(unbalanced.length === 0 && Number(posted[0].n) === 2, 'avance et remise : deux écritures équilibrées', { posted: posted[0].n, unbalanced });

  console.log('2. Particulier : report et annulation');
  const c2 = await caisseA('POST', '/orders', { customerName: 'Report E2E', pickupDate: inDays(3), advanceAmount: 5, paymentMethod: 'cash', items: [{ productId: p1.id, quantity: 1 }] });
  const rs = await caisseA('POST', `/orders/${c2.json.data.id}/reschedule`, { newPickupDate: inDays(6), reason: 'Appel client' });
  ok(rs.status === 200 && rs.json.data.forced === false, 'report libre à plus de 24 h', rs.json?.error?.message);
  const log = await q(`SELECT forced, reason FROM order_reschedules WHERE order_id = $1`, [c2.json.data.id]);
  ok(log.length === 1 && log[0].reason === 'Appel client', 'report journalisé', log[0]);
  const c3 = await caisseA('POST', '/orders', { customerName: 'Tard E2E', pickupDate: inDays(1, 0), paymentMethod: 'cash', items: [{ productId: p1.id, quantity: 1 }] });
  await conn.query(`UPDATE orders SET pickup_date = now() + interval '10 hours' WHERE id = $1`, [c3.json.data.id]);
  const late = await caisseA('POST', `/orders/${c3.json.data.id}/reschedule`, { newPickupDate: inDays(4) });
  ok(late.status === 403, 'à moins de 24 h, la caisse ne peut pas reporter', late.json?.error?.message);
  const noReason = await direction('POST', `/orders/${c3.json.data.id}/reschedule`, { newPickupDate: inDays(4) });
  ok(noReason.status === 400, 'la direction doit donner un motif', noReason.json?.error?.message);
  const forced = await direction('POST', `/orders/${c3.json.data.id}/reschedule`, { newPickupDate: inDays(4), reason: 'Client hospitalisé' });
  ok(forced.status === 200 && forced.json.data.forced === true, 'report forcé par la direction avec motif', forced.json?.error?.message);
  const cancel = await caisseA('PUT', `/orders/${c2.json.data.id}/status`, { status: 'cancelled', reason: 'Client absent' });
  const kept = await q(`SELECT o.status, o.cancelled_by, o.cancel_reason, (SELECT SUM(total) FROM sales WHERE order_id = o.id) AS adv FROM orders o WHERE o.id = $1`, [c2.json.data.id]);
  ok(cancel.status === 200 && kept[0].status === 'cancelled' && kept[0].cancelled_by === cashA.id && Number(kept[0].adv) === 5, 'annulée : avance conservée, annulation tracée', kept[0]);

  console.log('3. Professionnel : prise de commande par la direction');
  const pro = (await q(`INSERT INTO customers (company_name, first_name, customer_type, remise_pct, delai_paiement_jours, credit_limit, billing_frequency)
                        VALUES ('Café E2E', 'Cafe', 'professionnel', 10, 30, 100, 'per_delivery') RETURNING id`))[0];
  const refusedCashier = await caisseA('POST', '/orders', { customerId: pro.id, pickupDate: inDays(2), items: [{ productId: p1.id, quantity: 3 }] });
  ok(refusedCashier.status === 403, 'la caisse ne prend pas de commande de professionnel', refusedCashier.json?.error?.message);
  const po = await direction('POST', '/orders', { customerId: pro.id, pickupDate: inDays(2), advanceAmount: 50, items: [
    { productId: p1.id, quantity: 3, tvaRate: 20 }, { productId: p2.id, quantity: 2, tvaRate: 0 },
  ] });
  const ht1 = r2(price1 * 0.9), ht2 = r2(price2 * 0.9);
  const sub = r2(ht1 * 3 + ht2 * 2), tva = r2(Math.round(ht1 * 3 * 20) / 100);
  const d = po.json?.data;
  ok(po.status === 201 && Number(d.subtotal) === sub && Number(d.tax_amount) === tva && Number(d.total) === r2(sub + tva),
    'prix catalogue − remise 10 %, TVA par ligne, total TTC', d && { sub: d.subtotal, tva: d.tax_amount, total: d.total, expected: [sub, tva] });
  ok(Number(d.advance_amount) === 0 && d.payment_method === 'deferred', 'ni avance ni caisse', { adv: d.advance_amount, pm: d.payment_method });
  ok((await q(`SELECT 1 FROM sales WHERE order_id = $1`, [d.id])).length === 0, 'aucun ticket de caisse');
  ok(!!d.creditWarning && d.creditWarning.creditLimit === 100, 'alerte plafond de crédit (non bloquante)', d.creditWarning?.message);
  const lines = await q(`SELECT tva_rate FROM order_items WHERE order_id = $1 ORDER BY tva_rate`, [d.id]);
  ok(lines.map(l => Number(l.tva_rate)).join(',') === '0,20', 'TVA enregistrée sur les lignes');

  console.log('4. Professionnel : invisible pour la caisse, livré sur BL');
  const list = await caisseA('GET', '/orders?limit=500');
  ok(!(list.json.data ?? []).some((o: any) => o.id === d.id), 'liste caisse sans commande de professionnel');
  ok((await caisseA('GET', `/orders/${d.id}`)).status === 403, 'fiche refusée à la caisse');
  await direction('PUT', `/orders/${d.id}/status`, { status: 'ready' });
  const tillDeliver = await direction('POST', `/orders/${d.id}/deliver`, { amountPaid: 9999, paymentMethod: 'cash' });
  ok(tillDeliver.status === 409, 'pas de remise en caisse pour un professionnel', tillDeliver.json?.error?.message);
  const oLines = await q(`SELECT id, product_id FROM order_items WHERE order_id = $1`, [d.id]);
  const l1 = oLines.find(l => l.product_id === p1.id);
  const bl = await direction('POST', `/delivery-notes/from-order/${d.id}`, { quantities: { [l1.id]: 2 }, receivedByName: 'M. Réception' });
  ok(bl.status === 201 && !!bl.json.data.invoice, 'BL créé, facture immédiate (client facturé à chaque livraison)', bl.json?.error?.message ?? bl.json?.data?.invoice?.invoice_number);
  const inv = (await q(`SELECT amount, tax_amount, total_amount, due_date::text AS due, invoice_date::text AS d FROM invoices WHERE id = $1`, [bl.json.data.invoice?.id]))[0];
  const expHt = r2(ht1 * 2 + ht2 * 2), expTva = r2(Math.round(ht1 * 2 * 20) / 100);
  ok(Number(inv?.amount) === expHt && Number(inv?.tax_amount) === expTva, 'facture sur les quantités livrées (2 au lieu de 3)', inv && { ht: inv.amount, tva: inv.tax_amount, exp: [expHt, expTva] });
  const due = (await q(`SELECT ($1::date + 30)::text AS d`, [inv?.d]))[0].d;
  ok(inv?.due === due, 'échéance = date de facture + délai client', inv?.due);
  const blRow = (await q(`SELECT received_by_name, received_at, status FROM delivery_notes WHERE id = $1`, [bl.json.data.id]))[0];
  ok(blRow.received_by_name === 'M. Réception' && !!blRow.received_at && blRow.status === 'invoiced', 'réceptionnaire enregistré, BL facturé', blRow);
  const after = await direction('GET', `/orders?limit=500&customerId=${pro.id}`);
  const row = (after.json.data ?? []).find((o: any) => o.id === d.id);
  ok(row?.status === 'completed' && row?.invoice_number === bl.json.data.invoice?.invoice_number && row?.delivery_note_number === bl.json.data.number,
    'suivi commande : livrée, facturée (BL + facture)', row && { s: row.status, bl: row.delivery_note_number, inv: row.invoice_number });
  const pdf = await direction('GET', `/delivery-notes/${bl.json.data.id}/pdf`);
  ok(pdf.status === 200 && pdf.ct.includes('application/pdf'), 'BL imprimable en PDF');

  console.log('5. Professionnel mensuel et règlement par la direction');
  await conn.query(`UPDATE customers SET billing_frequency = 'monthly', credit_limit = NULL WHERE id = $1`, [pro.id]);
  const pm = await direction('POST', '/orders', { customerId: pro.id, pickupDate: inDays(2), items: [{ productId: p1.id, quantity: 1, tvaRate: 20 }] });
  ok(pm.status === 201 && !pm.json.data.creditWarning, 'sans plafond : pas d\'alerte');
  await direction('PUT', `/orders/${pm.json.data.id}/status`, { status: 'ready' });
  const blm = await direction('POST', `/delivery-notes/from-order/${pm.json.data.id}`, {});
  ok(blm.status === 201 && blm.json.data.invoice === null && blm.json.data.status === 'delivered', 'client mensuel : BL à facturer, pas de facture immédiate', blm.json?.error?.message);
  const salesBefore = Number((await q(`SELECT count(*) AS n FROM sales`))[0].n);
  const pay = await direction('POST', '/payments', { invoiceId: bl.json.data.invoice.id, type: 'income', amount: Number(inv.total_amount), paymentMethod: 'bank', reference: 'VIR-E2E-1', paymentDate: new Date().toISOString().slice(0, 10), description: 'e2e règlement' });
  const paidInv = (await q(`SELECT status FROM invoices WHERE id = $1`, [bl.json.data.invoice.id]))[0];
  const salesAfter = Number((await q(`SELECT count(*) AS n FROM sales`))[0].n);
  ok(pay.status === 201 && paidInv.status === 'paid', 'facture réglée par la direction', pay.json?.error?.message ?? paidInv.status);
  ok(salesAfter === salesBefore, 'le règlement ne crée aucun ticket de vente (pas de double CA)', { salesBefore, salesAfter });
  const cashierPay = await caisseA('POST', '/payments', { invoiceId: bl.json.data.invoice.id, type: 'income', amount: 1, paymentMethod: 'cash', paymentDate: new Date().toISOString().slice(0, 10) });
  ok(cashierPay.status === 403, 'la caisse ne peut pas encaisser une facture', cashierPay.status);
  const retired = await direction('POST', `/invoices/from-order/${pm.json.data.id}`);
  ok(retired.status === 410, 'facture directe depuis une commande retirée', retired.json?.error?.message);
  const blOnPart = await direction('POST', `/delivery-notes/from-order/${c3.json.data.id}`, {});
  ok(blOnPart.status === 400, 'pas de BL pour une commande de particulier', blOnPart.json?.error?.message);
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
