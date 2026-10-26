/**
 * e2e — commission carte (mig 356). Transaction annulée : aucune donnée ne reste.
 * Taux 2 % : vente carte 100 → 5141 98 + 6147 2 ; mixte 60 espèces / 40 carte →
 * 5161 60, 5141 39.20, 6147 0.80 ; shift carte 500 → 5141 490 + 6147 10 ;
 * espèces inchangées ; taux 0 → pas de ligne 6147 ; Caisse : report carte net.
 */
import { db } from '../src/config/database.js';
import { fromSale, fromManualShiftEntry } from '../src/services/journal-generator.service.js';
import { caisseRepository } from '../src/repositories/accounting.repository.js';

let ok = 0, ko = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { ok++; console.log(`✓ ${label}`); } else { ko++; console.log(`✗ ${label}`, detail ?? ''); }
};
const sum = (lines: { account_code: string; debit: number; credit: number }[], code: string) =>
  Math.round(lines.filter(l => l.account_code === code).reduce((t, l) => t + l.debit - l.credit, 0) * 100) / 100;
const balanced = (lines: { debit: number; credit: number }[]) =>
  Math.abs(lines.reduce((t, l) => t + l.debit - l.credit, 0)) < 0.005;

const client = await db.getClient();
try {
  await client.query('BEGIN');
  const sale = (method: string, total: number, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), sale_number: 'TEST', customer_id: null, subtotal: total, tax_amount: 0, discount_amount: 0,
    total, payment_method: method, payment_status: 'paid', paid_at: '2026-10-26T10:00:00Z', created_at: '2026-10-26T10:00:00Z', store_id: null, ...extra,
  });

  await client.query(`UPDATE module_parameters SET value = '{"pct": 0}' WHERE key = 'accounting.card_commission'`);
  let e = await fromSale(client, sale('card', 100));
  check('taux 0 : 5141 = 100, pas de 6147', sum(e!.lines, '5141') === 100 && !e!.lines.some(l => l.account_code === '6147'), e!.lines);

  await client.query(`UPDATE module_parameters SET value = '{"pct": 2}' WHERE key = 'accounting.card_commission'`);
  e = await fromSale(client, sale('card', 100));
  check('carte 100 à 2 % : 5141 = 98', sum(e!.lines, '5141') === 98, e!.lines);
  check('carte 100 à 2 % : 6147 = 2', sum(e!.lines, '6147') === 2, e!.lines);
  check('carte : écriture équilibrée', balanced(e!.lines));

  e = await fromSale(client, sale('mixed', 100, { cash_amount: 60, card_amount: 40 }));
  check('mixte : 5161 = 60', sum(e!.lines, '5161') === 60, e!.lines);
  check('mixte : 5141 = 39.20 et 6147 = 0.80', sum(e!.lines, '5141') === 39.2 && sum(e!.lines, '6147') === 0.8, e!.lines);
  check('mixte : équilibrée', balanced(e!.lines));

  e = await fromSale(client, sale('cash', 100));
  check('espèces : aucune commission', sum(e!.lines, '5161') === 100 && !e!.lines.some(l => l.account_code === '6147'));

  e = await fromManualShiftEntry(client, { id: crypto.randomUUID(), entry_date: '2026-10-26', store_id: crypto.randomUUID(),
    matin_cash_reel: 300, matin_carte_reel: 200, soir_cash_reel: 0, soir_carte_reel: 300 });
  check('shift carte 500 : 5141 = 490, 6147 = 10', sum(e!.lines, '5141') === 490 && sum(e!.lines, '6147') === 10, e!.lines);
  check('shift : 7111 = 800 et équilibrée', sum(e!.lines, '7111') === -800 && balanced(e!.lines));

  const acc = await client.query(`SELECT 1 FROM accounts WHERE code = '6147'`);
  check('compte 6147 existe au plan', acc.rows.length === 1);
} finally {
  await client.query('ROLLBACK');
  client.release();
}
// Écran Caisse : le registre expose le taux en vigueur (lecture seule).
const reg = await caisseRepository.getRegister(2026, 10) as { cardCommissionPct?: number };
const pct = (await db.query(`SELECT (value->>'pct')::numeric AS pct FROM module_parameters WHERE key = 'accounting.card_commission'`)).rows[0]?.pct;
check('Caisse : cardCommissionPct renvoyé', reg.cardCommissionPct === Number(pct ?? 0), reg.cardCommissionPct);

console.log(`\n${ok} ok, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
