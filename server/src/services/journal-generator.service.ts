/**
 * Generateur d'ecritures comptables
 *
 * Convertit les evenements metier (facture, paiement, vente) en ecritures
 * en partie double conformement au CGNC marocain. Les patterns sont :
 *
 *   A) Facture fournisseur (invoice.invoice_type='received')
 *      Journal AC : 6XXX D + 345XX D / 4411 C
 *
 *   B) Facture client (invoice.invoice_type='emitted')
 *      Journal VE : 3421 D / 7XXX C + 4455X C
 *
 *   C) Vente POS comptant (sale.payment_status='paid')
 *      Journal CA ou BQ : 5161/5141 D / 7111 C + 4455X C (+ 7129 D si remise)
 *
 *   D) Paiement espece/virement vers fournisseur
 *      Journal CA ou BQ : 4411 D / 5161 ou 5141 C  (+ lettrage avec facture)
 *
 *   E) Paiement cheque vers fournisseur — DEUX ecritures :
 *      E.1 (emission)    OD : 4411 D / 5111 C   (+ lettrage avec facture)
 *      E.2 (encaissement) BQ : 5111 D / 5141 C
 *
 *   F) Paiement traite vers fournisseur — DEUX ecritures :
 *      F.1 OD : 4411 D / 4415 C  (+ lettrage avec facture)
 *      F.2 BQ : 4415 D / 5141 C
 *
 * Les fonctions sont PURES : elles construisent un GeneratedEntry (forme
 * intermediaire) sans persister. La persistance est faite par persistEntry()
 * qui resout les codes -> ids, lookup auxiliaires, attribue le numero, et
 * insert en transaction.
 */

import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { db } from '../config/database.js';

/* ═══ Types ═══ */
export interface GeneratedLine {
  account_code: string;
  // Pour les comptes collectifs (3421, 4411) on resoud l'auxiliary_id via supplier_id ou customer_id.
  auxiliary_supplier_id?: string | null;
  auxiliary_customer_id?: string | null;
  debit: number;
  credit: number;
  label?: string;
  // Cle logique partagee entre N lignes qui doivent recevoir le meme lettrage_id
  // au moment de la persistance (ex: ligne facture 4411 + ligne paiement 4411).
  lettrage_key?: string;
}

export interface GeneratedEntry {
  journal_code: 'AC' | 'VE' | 'BQ' | 'CA' | 'OD';
  entry_date: string;
  description: string;
  source_kind: 'invoice' | 'payment' | 'sale' | 'backfill' | 'manual';
  source_id: string;
  // Discriminant pour les sources a ecritures multiples (cheque : emission/cashing).
  source_detail?: string | null;
  store_id: string | null;
  lines: GeneratedLine[];
}

/* ═══ Helpers ═══ */
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Format ISO yyyy-MM-dd quel que soit le type renvoye par pg (Date ou string). */
function toIsoDate(raw: unknown): string {
  if (!raw) return '';
  if (raw instanceof Date) {
    // toISOString() peut shifter selon TZ ; on prend les composantes UTC.
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

function tvaAccountForRate(rate: number, direction: 'collected' | 'deductible'): string {
  const r = Math.round(rate);
  if (direction === 'deductible') {
    if (r === 20) return '34552';
    if (r === 14) return '34553';
    if (r === 10) return '34554';
    if (r === 7)  return '34555';
    return '3455';
  }
  if (r === 20) return '44551';
  if (r === 14) return '44552';
  if (r === 10) return '44553';
  if (r === 7)  return '44554';
  return '4455';
}

function computeTvaRate(amountHT: number, tva: number): number {
  if (amountHT <= 0 || tva <= 0) return 0;
  return (tva / amountHT) * 100;
}

/* ═══ Resolution recursive d'un account_id depuis une expense/revenue_category ═══ */
/**
 * Remonte la chaine parent_id jusqu'a trouver un compte associe. Si rien
 * n'est trouve, renvoie le code de fallback 6181 (charges diverses) ou
 * 7585 (autres produits).
 */
async function resolveCategoryAccountCode(
  client: PoolClient | typeof db,
  categoryId: string | null,
  kind: 'expense' | 'revenue'
): Promise<string> {
  const fallback = kind === 'expense' ? '6181' : '7585';
  if (!categoryId) return fallback;

  const table = kind === 'expense' ? 'expense_categories' : 'revenue_categories';
  const result = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, account_id, 0 AS depth
       FROM ${table} WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, c.account_id, ch.depth + 1
       FROM ${table} c
       JOIN chain ch ON ch.parent_id = c.id
     )
     SELECT a.code
     FROM chain c
     JOIN accounts a ON a.id = c.account_id
     WHERE c.account_id IS NOT NULL
     ORDER BY c.depth
     LIMIT 1`,
    [categoryId]
  );
  return result.rows[0]?.code || fallback;
}

/* ═══ Generateur — pattern A : facture fournisseur ═══ */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_type: 'received' | 'emitted';
  supplier_id: string | null;
  customer_id: string | null;
  category_id: string | null;
  invoice_date: string;
  amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  store_id: string | null;
  status: string;
}

export async function fromInvoice(
  client: PoolClient | typeof db,
  inv: InvoiceRow
): Promise<GeneratedEntry | null> {
  if (inv.status === 'cancelled') return null;

  const amount = parseFloat(String(inv.amount)) || 0;
  const tax    = parseFloat(String(inv.tax_amount)) || 0;
  const total  = parseFloat(String(inv.total_amount)) || 0;
  if (total <= 0) return null;

  const lettrageKey = `inv-${inv.id}`;

  if (inv.invoice_type === 'received') {
    // Pattern A : Facture fournisseur
    if (!inv.supplier_id) return null;

    const chargeCode = await resolveCategoryAccountCode(client, inv.category_id, 'expense');
    const tvaCode = tax > 0
      ? tvaAccountForRate(computeTvaRate(amount, tax), 'deductible')
      : null;

    const lines: GeneratedLine[] = [
      { account_code: chargeCode, debit: round2(amount), credit: 0, label: `Achat ${inv.invoice_number}` },
    ];
    if (tvaCode && tax > 0) {
      lines.push({ account_code: tvaCode, debit: round2(tax), credit: 0, label: 'TVA recuperable' });
    }
    lines.push({
      account_code: '4411',
      auxiliary_supplier_id: inv.supplier_id,
      debit: 0,
      credit: round2(total),
      label: `Fournisseur — ${inv.invoice_number}`,
      lettrage_key: lettrageKey,
    });

    return {
      journal_code: 'AC',
      entry_date: toIsoDate(inv.invoice_date),
      description: `Facture fournisseur ${inv.invoice_number}`,
      source_kind: 'invoice',
      source_id: inv.id,
      store_id: inv.store_id,
      lines,
    };
  }

  if (inv.invoice_type === 'emitted') {
    // Pattern B : Facture client
    if (!inv.customer_id) return null;

    const revCode = '7111';
    const tvaCode = tax > 0
      ? tvaAccountForRate(computeTvaRate(amount, tax), 'collected')
      : null;

    const lines: GeneratedLine[] = [
      {
        account_code: '3421',
        auxiliary_customer_id: inv.customer_id,
        debit: round2(total),
        credit: 0,
        label: `Client — ${inv.invoice_number}`,
        lettrage_key: lettrageKey,
      },
      { account_code: revCode, debit: 0, credit: round2(amount), label: `Vente ${inv.invoice_number}` },
    ];
    if (tvaCode && tax > 0) {
      lines.push({ account_code: tvaCode, debit: 0, credit: round2(tax), label: 'TVA facturee' });
    }

    return {
      journal_code: 'VE',
      entry_date: toIsoDate(inv.invoice_date),
      description: `Facture client ${inv.invoice_number}`,
      source_kind: 'invoice',
      source_id: inv.id,
      store_id: inv.store_id,
      lines,
    };
  }

  return null;
}

/* ═══ Generateur — pattern C : vente POS ═══ */
export interface SaleRow {
  id: string;
  sale_number: string;
  customer_id: string | null;
  subtotal: string | number;
  tax_amount: string | number | null;
  discount_amount: string | number | null;
  total: string | number;
  payment_method: string;
  payment_status: string;
  paid_at: string | null;
  created_at: string;
  store_id: string | null;
}

export async function fromSale(
  _client: PoolClient | typeof db,
  s: SaleRow
): Promise<GeneratedEntry | null> {
  // Ventes impayees : pas d'encaissement -> pas d'ecriture caisse/banque.
  // (Une facture emise sera generee separement par fromInvoice si elle existe.)
  if (s.payment_status !== 'paid') return null;

  const subtotal = parseFloat(String(s.subtotal)) || 0;
  const tax      = parseFloat(String(s.tax_amount ?? 0)) || 0;
  const discount = parseFloat(String(s.discount_amount ?? 0)) || 0;
  const total    = parseFloat(String(s.total)) || 0;
  if (total <= 0) return null;

  const isCash = s.payment_method === 'cash';
  const treasuryCode = isCash ? '5161' : '5141';

  const lines: GeneratedLine[] = [
    { account_code: treasuryCode, debit: round2(total), credit: 0, label: `Vente ${s.sale_number}` },
    { account_code: '7111',       debit: 0, credit: round2(subtotal), label: 'Vente du jour' },
  ];

  if (tax > 0) {
    const tvaCode = tvaAccountForRate(computeTvaRate(subtotal, tax), 'collected');
    lines.push({ account_code: tvaCode, debit: 0, credit: round2(tax), label: 'TVA facturee' });
  }
  if (discount > 0) {
    lines.push({ account_code: '7129', debit: round2(discount), credit: 0, label: 'Remise accordee' });
  }

  // Date : paid_at en priorite (encaissement effectif), fallback created_at.
  const dateRaw = s.paid_at || s.created_at;
  return {
    journal_code: isCash ? 'CA' : 'BQ',
    entry_date: toIsoDate(dateRaw),
    description: `Vente POS ${s.sale_number}`,
    source_kind: 'sale',
    source_id: s.id,
    store_id: s.store_id,
    lines,
  };
}

/* ═══ Generateur — patterns D/E/F : paiements ═══ */
export interface PaymentRow {
  id: string;
  reference: string | null;
  type: 'invoice' | 'salary' | 'expense' | 'income';
  category_id: string | null;
  invoice_id: string | null;
  supplier_id: string | null;
  employee_id: string | null;
  amount: string | number;
  payment_method: string;
  payment_date: string;
  cashed_at: string | null;
  description: string | null;
  store_id: string | null;
}

/**
 * Genere l'ecriture d'EMISSION du paiement (toujours generee).
 *  - cash/transfer/bank : 4411 (ou autre) D / tresorerie C
 *  - check             : 4411 D / 5111 C  (l'encaissement vient ensuite)
 *  - traite            : 4411 D / 4415 C  (idem)
 */
export async function fromPaymentEmission(
  client: PoolClient | typeof db,
  p: PaymentRow
): Promise<GeneratedEntry | null> {
  const amount = parseFloat(String(p.amount)) || 0;
  if (amount <= 0) return null;

  // Cote DEBIT : determine selon le type de paiement
  let debitLine: GeneratedLine;
  let lettrageKey: string | undefined;

  if (p.type === 'invoice' && p.invoice_id && p.supplier_id) {
    // Reglement de facture fournisseur : lettrage avec la facture
    lettrageKey = `inv-${p.invoice_id}`;
    debitLine = {
      account_code: '4411',
      auxiliary_supplier_id: p.supplier_id,
      debit: round2(amount),
      credit: 0,
      label: `Reglement ${p.reference || p.invoice_id.slice(0, 8)}`,
      lettrage_key: lettrageKey,
    };
  } else if (p.type === 'salary' && p.employee_id) {
    debitLine = { account_code: '6171', debit: round2(amount), credit: 0, label: 'Paiement salaire' };
  } else if (p.type === 'expense') {
    const code = await resolveCategoryAccountCode(client, p.category_id, 'expense');
    debitLine = { account_code: code, debit: round2(amount), credit: 0, label: p.description || 'Depense' };
  } else if (p.type === 'income') {
    // C'est un encaissement direct sans facture : la TVA n'est pas isolee ici.
    debitLine = { account_code: '5161', debit: round2(amount), credit: 0, label: p.description || 'Revenu' };
    // Cas particulier inverse -> on construit specifiquement
    const revCode = await resolveCategoryAccountCode(client, p.category_id, 'revenue');
    return {
      journal_code: p.payment_method === 'cash' ? 'CA' : 'BQ',
      entry_date: toIsoDate(p.payment_date),
      description: p.description || `Revenu ${p.reference || ''}`,
      source_kind: 'payment',
      source_id: p.id,
      store_id: p.store_id,
      lines: [
        { account_code: p.payment_method === 'cash' ? '5161' : '5141', debit: round2(amount), credit: 0, label: 'Encaissement' },
        { account_code: revCode, debit: 0, credit: round2(amount), label: p.description || 'Revenu' },
      ],
    };
  } else {
    // Paiement sans correlation invoice/employee/category : fallback divers
    debitLine = { account_code: '6181', debit: round2(amount), credit: 0, label: p.description || 'Paiement' };
  }

  // Cote CREDIT : tresorerie ou compte d'attente selon payment_method
  let creditCode: string;
  let journal: GeneratedEntry['journal_code'];
  switch (p.payment_method) {
    case 'cash':
      creditCode = '5161'; journal = 'CA'; break;
    case 'transfer':
    case 'bank':
      creditCode = '5141'; journal = 'BQ'; break;
    case 'check':
      creditCode = '5111'; journal = 'OD'; break;
    case 'traite':
      creditCode = '4415'; journal = 'OD'; break;
    default:
      creditCode = '5161'; journal = 'CA';
  }

  const creditLabel = p.payment_method === 'check'
    ? `Cheque emis ${p.reference || ''}`.trim()
    : p.payment_method === 'traite'
    ? `Traite emise ${p.reference || ''}`.trim()
    : 'Sortie tresorerie';

  return {
    journal_code: journal,
    entry_date: toIsoDate(p.payment_date),
    description: p.description || `Paiement ${p.reference || ''}`.trim(),
    source_kind: 'payment',
    source_id: p.id,
    store_id: p.store_id,
    lines: [
      debitLine,
      { account_code: creditCode, debit: 0, credit: round2(amount), label: creditLabel },
    ],
  };
}

/**
 * Genere l'ecriture d'ENCAISSEMENT (pour cheque/traite uniquement, quand cashed_at est rempli).
 *   - check  : 5111 D / 5141 C
 *   - traite : 4415 D / 5141 C
 */
export function fromPaymentCashing(p: PaymentRow): GeneratedEntry | null {
  if (p.payment_method !== 'check' && p.payment_method !== 'traite') return null;
  if (!p.cashed_at) return null;

  const amount = parseFloat(String(p.amount)) || 0;
  if (amount <= 0) return null;

  const fromCode = p.payment_method === 'check' ? '5111' : '4415';

  return {
    journal_code: 'BQ',
    entry_date: toIsoDate(p.cashed_at),
    description: `Encaissement ${p.payment_method === 'check' ? 'cheque' : 'traite'} ${p.reference || ''}`.trim(),
    source_kind: 'payment',
    source_id: p.id,
    source_detail: 'cashing',
    store_id: p.store_id,
    lines: [
      { account_code: fromCode, debit: round2(amount), credit: 0, label: 'Reprise compte d\'attente' },
      { account_code: '5141',  debit: 0, credit: round2(amount), label: 'Debit bancaire' },
    ],
  };
}

/* ═══ Persistance d'un GeneratedEntry dans la DB ═══ */
/**
 * Resout les codes -> ids, alloue le numero, insert entry + lines, puis passe
 * l'entry en status='posted' (declenche le trigger d'equilibre).
 *
 * Si une entry de meme (source_kind, source_id) existe deja, retourne son id
 * sans rien creer (idempotence).
 */
export async function persistEntry(
  client: PoolClient,
  entry: GeneratedEntry,
  opts: { markAsBackfill?: boolean; userId: string }
): Promise<{ id: string; entry_number: string; created: boolean }> {
  // Idempotence : verifie si l'entry existe deja. Le source_kind a checker
  // depend du mode : en backfill on a marque 'backfill', sinon le kind d'origine.
  // source_detail discrimine les sources a ecritures multiples (cheque : emission/cashing).
  const lookupKind = opts.markAsBackfill ? 'backfill' : entry.source_kind;
  const detail = entry.source_detail ?? null;
  const existing = await client.query(
    `SELECT id, entry_number FROM journal_entries
     WHERE source_kind = $1 AND source_id = $2
       AND COALESCE(source_detail, '') = COALESCE($3::varchar, '')
       AND status != 'reversed'
     LIMIT 1`,
    [lookupKind, entry.source_id, detail]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, entry_number: existing.rows[0].entry_number, created: false };
  }

  // Resolution du journal_id
  const jrn = await client.query(`SELECT id FROM journals WHERE code = $1`, [entry.journal_code]);
  if (!jrn.rows[0]) throw new Error(`Journal ${entry.journal_code} introuvable`);
  const journalId = jrn.rows[0].id;

  // Resolution de la periode fiscale
  const fp = await client.query(
    `SELECT id, status FROM fiscal_periods WHERE $1::DATE BETWEEN start_date AND end_date LIMIT 1`,
    [entry.entry_date]
  );
  if (!fp.rows[0]) throw new Error(`Aucune periode fiscale pour ${entry.entry_date}`);
  if (fp.rows[0].status === 'locked') {
    throw new Error(`Periode verrouillee pour ${entry.entry_date}`);
  }
  const fiscalPeriodId = fp.rows[0].id;

  // Allocation du numero
  const year = parseInt(entry.entry_date.slice(0, 4), 10);
  const numResult = await client.query('SELECT next_entry_number($1, $2) AS num', [journalId, year]);
  const entryNumber = numResult.rows[0].num;

  // Resolution des codes de compte et auxiliaires en bloc
  const allCodes = Array.from(new Set(entry.lines.map(l => l.account_code)));
  const accRes = await client.query(
    `SELECT id, code, is_collective FROM accounts WHERE code = ANY($1::text[])`,
    [allCodes]
  );
  const accountByCode = new Map<string, { id: string; is_collective: boolean }>();
  for (const r of accRes.rows) accountByCode.set(r.code, { id: r.id, is_collective: r.is_collective });

  // Auxiliaires : lookup en bloc
  const supplierIds = Array.from(new Set(entry.lines.map(l => l.auxiliary_supplier_id).filter(Boolean) as string[]));
  const customerIds = Array.from(new Set(entry.lines.map(l => l.auxiliary_customer_id).filter(Boolean) as string[]));
  const auxBySupplier = new Map<string, string>();
  const auxByCustomer = new Map<string, string>();
  if (supplierIds.length) {
    const r = await client.query(`SELECT id, supplier_id FROM account_auxiliaries WHERE supplier_id = ANY($1::uuid[])`, [supplierIds]);
    for (const row of r.rows) auxBySupplier.set(row.supplier_id, row.id);
  }
  if (customerIds.length) {
    const r = await client.query(`SELECT id, customer_id FROM account_auxiliaries WHERE customer_id = ANY($1::uuid[])`, [customerIds]);
    for (const row of r.rows) auxByCustomer.set(row.customer_id, row.id);
  }

  // INSERT entry en draft
  const sourceKind = opts.markAsBackfill ? 'backfill' : entry.source_kind;
  const insRes = await client.query(
    `INSERT INTO journal_entries (
       entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10)
     RETURNING id`,
    [entryNumber, journalId, entry.entry_date, fiscalPeriodId, entry.description,
     sourceKind, entry.source_id, entry.source_detail ?? null, entry.store_id, opts.userId]
  );
  const entryId = insRes.rows[0].id;

  // INSERT lines
  for (let i = 0; i < entry.lines.length; i++) {
    const l = entry.lines[i];
    const acc = accountByCode.get(l.account_code);
    if (!acc) throw new Error(`Compte ${l.account_code} introuvable`);
    let auxId: string | null = null;
    if (acc.is_collective) {
      if (l.auxiliary_supplier_id) auxId = auxBySupplier.get(l.auxiliary_supplier_id) || null;
      else if (l.auxiliary_customer_id) auxId = auxByCustomer.get(l.auxiliary_customer_id) || null;
      if (!auxId) throw new Error(`Auxiliaire manquant pour compte ${l.account_code}`);
    }
    await client.query(
      `INSERT INTO journal_entry_lines (
         journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entryId, i + 1, acc.id, auxId, l.debit, l.credit, l.label || null]
    );
  }

  // Passage en posted (declenche trigger d'equilibre)
  await client.query(
    `UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`,
    [entryId, opts.userId]
  );

  return { id: entryId, entry_number: entryNumber, created: true };
}

/* ═══ Auto-lettrage facture <-> paiement(s) ═══ */
/**
 * Pour une facture donnee, trouve toutes les lignes de tiers (4411 ou 3421)
 * non encore lettrees rattachees a cette facture (entry source = invoiceId)
 * OU a un de ses paiements (payment.invoice_id = invoiceId). Si l'ensemble
 * est equilibre (SUM(D) == SUM(C) +/- 0.01), assigne a toutes les lignes un
 * meme lettrage_id UUID. Sinon, ne fait rien (paiement partiel : on attend
 * les regelements suivants).
 *
 * Idempotent : les lignes deja lettrees sont ignorees, donc rejouer n'a aucun
 * effet visible.
 */
export async function autoLettrer(
  client: PoolClient,
  invoiceId: string
): Promise<{ lettered: boolean; lettrageId?: string; lineCount?: number }> {
  const linesRes = await client.query(
    `SELECT jel.id, jel.debit, jel.credit
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     JOIN accounts a ON a.id = jel.account_id
     WHERE a.code IN ('4411', '3421')
       AND jel.lettrage_id IS NULL
       AND je.status = 'posted'
       AND (
         je.source_id = $1
         OR je.source_id IN (SELECT id::text::uuid FROM payments WHERE invoice_id = $1)
       )`,
    [invoiceId]
  );

  if (linesRes.rows.length < 2) return { lettered: false };

  const sumD = linesRes.rows.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const sumC = linesRes.rows.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);

  if (Math.abs(sumD - sumC) > 0.01) {
    // Paiement partiel — pas de lettrage encore.
    return { lettered: false };
  }

  const lettrageId = crypto.randomUUID();
  await client.query(
    `UPDATE journal_entry_lines SET lettrage_id = $1 WHERE id = ANY($2::uuid[])`,
    [lettrageId, linesRes.rows.map(l => l.id)]
  );

  return { lettered: true, lettrageId, lineCount: linesRes.rows.length };
}

/* ═══ Reversion d'ecritures lors de la suppression d'une source ═══ */
/**
 * Quand une source (paiement, facture, vente) est supprimee, ses ecritures
 * comptables doivent disparaitre du grand livre, ET le lettrage qu'elles
 * portaient doit etre defait (sinon la facture associee reste marquee payee).
 *
 * Comportement selon la periode fiscale :
 *   - periode OUVERTE  : suppression dure de l'ecriture (lignes en cascade).
 *   - periode CLOSE/LOCKED : interdit — on leve une erreur. La suppression de
 *     la source doit alors etre bloquee (une periode close est intouchable ;
 *     il faudrait passer par une extourne manuelle, hors scope auto).
 *
 * Avant de supprimer, on collecte les lettrage_id des lignes concernees pour
 * delettrer les lignes restantes (typiquement la ligne 4411/3421 de la facture).
 *
 * Idempotent : si aucune ecriture n'existe pour la source, ne fait rien.
 */
export async function reverseEntriesForSource(
  client: PoolClient,
  opts: { sourceId: string; sourceKinds?: string[] }
): Promise<{ removed: number; reversed: number; unlettered: number }> {
  const kinds = opts.sourceKinds ?? ['payment', 'invoice', 'sale', 'backfill'];

  // 1. Recuperer les ecritures de cette source + statut de leur periode.
  const entriesRes = await client.query(
    `SELECT je.id, je.entry_number, je.entry_date, je.store_id, je.description,
            je.source_id, je.source_detail, fp.status AS period_status
     FROM journal_entries je
     JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
     WHERE je.source_id = $1
       AND je.source_kind = ANY($2::text[])
       AND je.status != 'reversed'`,
    [opts.sourceId, kinds]
  );

  if (entriesRes.rows.length === 0) return { removed: 0, reversed: 0, unlettered: 0 };

  // 2. Periode 'locked' : verrou dur, aucune correction possible meme par extourne.
  const locked = entriesRes.rows.find((r: { period_status: string }) => r.period_status === 'locked');
  if (locked) {
    throw new Error(
      `Impossible : l'ecriture ${(locked as { entry_number: string }).entry_number} ` +
      `appartient a une periode VERROUILLEE (locked). Aucune correction possible.`
    );
  }

  // 3. Separer les ecritures a SUPPRIMER (periode ouverte) de celles a EXTOURNER
  //    (periode close : immuable, on passe une ecriture inverse en periode ouverte).
  const toDelete = entriesRes.rows.filter((r: { period_status: string }) => r.period_status === 'open');
  const toReverse = entriesRes.rows.filter((r: { period_status: string }) => r.period_status === 'closed');

  const allEntryIds = entriesRes.rows.map((r: { id: string }) => r.id);

  // 4. Collecter les lettrage_id (avant toute modification) pour delettrer.
  const lettrageRes = await client.query(
    `SELECT DISTINCT lettrage_id FROM journal_entry_lines
     WHERE journal_entry_id = ANY($1::uuid[]) AND lettrage_id IS NOT NULL`,
    [allEntryIds]
  );
  const lettrageIds = lettrageRes.rows.map((r: { lettrage_id: string }) => r.lettrage_id);

  // 5a. Periode ouverte : suppression dure (lignes en cascade).
  let removed = 0;
  if (toDelete.length > 0) {
    const ids = toDelete.map((r: { id: string }) => r.id);
    await client.query(`DELETE FROM journal_entries WHERE id = ANY($1::uuid[])`, [ids]);
    removed = ids.length;
  }

  // 5b. Periode close : extourne. On passe une ecriture inverse datee dans la
  //     periode ouverte courante, et on marque l'originale 'reversed'.
  let reversed = 0;
  for (const orig of toReverse) {
    await extourneEntry(client, orig);
    reversed++;
  }

  // 6. Delettrer les lignes restantes (la facture redevient ouverte).
  let unlettered = 0;
  if (lettrageIds.length > 0) {
    const upd = await client.query(
      `UPDATE journal_entry_lines SET lettrage_id = NULL WHERE lettrage_id = ANY($1::uuid[])`,
      [lettrageIds]
    );
    unlettered = upd.rowCount ?? 0;
  }

  return { removed, reversed, unlettered };
}

/**
 * Extourne une ecriture d'une periode close : cree une ecriture inverse
 * (debit<->credit) datee dans la periode ouverte la plus recente, marque
 * l'originale 'reversed' et les relie (reversed_by_entry_id). Conserve la
 * tracabilite DGI sans trou de numerotation (l'originale reste, l'inverse
 * s'ajoute).
 */
async function extourneEntry(
  client: PoolClient,
  orig: { id: string; entry_number: string; store_id: string | null; description: string | null; source_id: string | null; source_detail: string | null }
): Promise<void> {
  // Periode ouverte cible : la plus recente.
  const openPeriod = await client.query(
    `SELECT id, year FROM fiscal_periods WHERE status = 'open' ORDER BY year DESC, month DESC LIMIT 1`
  );
  if (!openPeriod.rows[0]) {
    throw new Error('Aucune periode ouverte pour passer l\'extourne. Reouvrez une periode.');
  }
  const periodId = openPeriod.rows[0].id;
  const periodInfo = await client.query(
    `SELECT start_date FROM fiscal_periods WHERE id = $1`, [periodId]
  );
  const extDate = toIsoDate(periodInfo.rows[0].start_date);

  // Journal OD (operations diverses) pour les extournes.
  const odJournal = await client.query(`SELECT id FROM journals WHERE code = 'OD'`);
  const journalId = odJournal.rows[0].id;

  const year = parseInt(extDate.slice(0, 4), 10);
  const numRes = await client.query('SELECT next_entry_number($1, $2) AS num', [journalId, year]);
  const entryNumber = numRes.rows[0].num;

  const sysUser = await resolveUserId(client, null);

  // Cree l'ecriture d'extourne (en draft puis posted).
  // source_id = celui de l'originale (traçabilite metier), source_detail = 'reversal'
  // pour ne pas entrer en conflit avec l'index d'unicite de la source d'origine.
  const insRes = await client.query(
    `INSERT INTO journal_entries (
       entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by, reversed_by_entry_id
     ) VALUES ($1,$2,$3,$4,$5,'reversal',$6,$7,'draft',$8,$9,NULL)
     RETURNING id`,
    [entryNumber, journalId, extDate, periodId,
     `Extourne de ${orig.entry_number}${orig.description ? ' — ' + orig.description : ''}`,
     orig.source_id, `rev:${orig.source_detail || 'main'}`, orig.store_id, sysUser]
  );
  const extId = insRes.rows[0].id;

  // Copie les lignes de l'originale avec debit/credit INVERSES.
  await client.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label)
     SELECT $1, line_order, account_id, auxiliary_id, credit, debit, 'Extourne: ' || COALESCE(label, '')
     FROM journal_entry_lines WHERE journal_entry_id = $2`,
    [extId, orig.id]
  );

  // Poste l'extourne (declenche le trigger d'equilibre).
  await client.query(
    `UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`,
    [extId, sysUser]
  );

  // Marque l'originale 'reversed' et relie a l'extourne.
  await client.query(
    `UPDATE journal_entries SET status = 'reversed', reversed_by_entry_id = $2 WHERE id = $1`,
    [orig.id, extId]
  );
}

/* ═══ Helpers haut-niveau : (re)synchronisation d'une source ═══ */
//
// Ces fonctions encapsulent le pattern "reverse + regenerate" pour chaque type
// de source. Elles sont appelees par les repositories a chaque mutation
// (creation, modification, annulation) pour garder le grand livre aligne.
// Toutes idempotentes et transactionnelles (le client/transaction est fourni).

/** Resout un userId valide pour created_by/posted_by : celui fourni, sinon un admin. */
async function resolveUserId(client: PoolClient, userId: string | null | undefined): Promise<string> {
  if (userId) return userId;
  const res = await client.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  if (!res.rows[0]) throw new Error('Aucun utilisateur pour created_by/posted_by');
  return res.rows[0].id;
}

const INVOICE_SELECT = `SELECT id, invoice_number, invoice_type, supplier_id, customer_id,
  category_id, invoice_date, amount, tax_amount, total_amount, store_id, status
  FROM invoices WHERE id = $1`;

const PAYMENT_SELECT = `SELECT id, reference, type, category_id, invoice_id, supplier_id,
  employee_id, amount, payment_method, payment_date, cashed_at, description, store_id
  FROM payments WHERE id = $1`;

const SALE_SELECT = `SELECT id, sale_number, customer_id, subtotal, tax_amount, discount_amount,
  total, payment_method, payment_status, paid_at, created_at, store_id
  FROM sales WHERE id = $1`;

/**
 * Resynchronise l'ecriture d'une facture : reverse l'ancienne, regenere depuis
 * l'etat courant (si non annulee), et re-lettre si un paiement la solde.
 * A appeler apres replaceItems/update/cancel.
 */
export async function regenerateInvoiceEntry(
  client: PoolClient,
  invoiceId: string,
  userId: string | null | undefined
): Promise<void> {
  await reverseEntriesForSource(client, { sourceId: invoiceId, sourceKinds: ['invoice', 'backfill'] });

  const inv = await client.query(INVOICE_SELECT, [invoiceId]);
  const row = inv.rows[0];
  if (!row || row.status === 'cancelled') return; // annulee : on s'arrete a la reversion

  const entry = await fromInvoice(client, row);
  if (entry) await persistEntry(client, entry, { userId: await resolveUserId(client, userId) });

  // Re-lettrage : si des paiements existent et soldent la facture.
  await autoLettrer(client, invoiceId);
}

/**
 * Resynchronise les ecritures d'un paiement : reverse les anciennes (emission +
 * encaissement), regenere depuis l'etat courant, et re-lettre la facture liee.
 * A appeler apres payment.update/markCashed/unmarkCashed.
 */
export async function regeneratePaymentEntries(
  client: PoolClient,
  paymentId: string,
  userId: string | null | undefined
): Promise<void> {
  await reverseEntriesForSource(client, { sourceId: paymentId, sourceKinds: ['payment', 'backfill'] });

  const pay = await client.query(PAYMENT_SELECT, [paymentId]);
  const p = pay.rows[0];
  if (!p) return; // paiement supprime : reversion suffit

  const uid = await resolveUserId(client, userId);
  const emission = await fromPaymentEmission(client, p);
  if (emission) await persistEntry(client, emission, { userId: uid });

  const cashing = fromPaymentCashing(p);
  if (cashing) await persistEntry(client, cashing, { userId: uid });

  // Re-lettrage de la facture liee (si reglement de facture).
  if (p.invoice_id) await autoLettrer(client, p.invoice_id);
}

/**
 * Resynchronise l'ecriture d'une vente POS. A appeler apres update/delete vente.
 */
export async function regenerateSaleEntry(
  client: PoolClient,
  saleId: string,
  userId: string | null | undefined
): Promise<void> {
  await reverseEntriesForSource(client, { sourceId: saleId, sourceKinds: ['sale', 'backfill'] });

  const sale = await client.query(SALE_SELECT, [saleId]);
  const s = sale.rows[0];
  if (!s) return;

  const entry = await fromSale(client, s);
  if (entry) await persistEntry(client, entry, { userId: await resolveUserId(client, userId) });
}

