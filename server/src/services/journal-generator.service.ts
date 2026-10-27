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
  // Mig 311 (G-D8-05) : axes de lettrage GR/IR (compte 4417) par ligne de BC.
  po_line_id?: string | null;
  receipt_item_id?: string | null;
  supplier_id?: string | null;
}

export interface GeneratedEntry {
  journal_code: 'AC' | 'VE' | 'BQ' | 'CA' | 'OD';
  entry_date: string;
  description: string;
  source_kind: 'invoice' | 'payment' | 'sale' | 'backfill' | 'manual' | 'shift_entry' | 'advance_repayment' | 'product_loss' | 'closure_diff'
    | 'goods_receipt' | 'goods_receipt_return' | 'loyalty';
  source_id: string;
  // Discriminant pour les sources a ecritures multiples (cheque : emission/cashing).
  source_detail?: string | null;
  store_id: string | null;
  lines: GeneratedLine[];
}

/* ═══ Helpers ═══ */
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Commission du prestataire carte (mig 356, paramètre accounting.card_commission), en %. */
export async function cardCommissionPct(client: PoolClient | typeof db): Promise<number> {
  const r = await client.query(`SELECT value->>'pct' AS pct FROM module_parameters WHERE key = 'accounting.card_commission'`);
  const pct = parseFloat(r.rows[0]?.pct ?? '0');
  return Number.isFinite(pct) && pct > 0 ? pct : 0;
}

/**
 * Encaissement carte : la banque ne reçoit que le net, la commission retenue par
 * le prestataire est une charge (6147 Services bancaires).
 */
function cardLines(amount: number, pct: number, label: string): GeneratedLine[] {
  const commission = round2(amount * pct / 100);
  const lines: GeneratedLine[] = [{ account_code: '5141', debit: round2(amount - commission), credit: 0, label }];
  if (commission > 0) lines.push({ account_code: '6147', debit: commission, credit: 0, label: `Commission carte ${pct} %` });
  return lines;
}

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

/**
 * TVA ventilee par taux a partir des lignes de la facture (invoice_items).
 * Ne renvoie que les groupes ayant un taux explicite (tva_rate NOT NULL) ;
 * un tableau vide signifie "pas de TVA par ligne" -> l'appelant retombe sur
 * la TVA globale d'en-tete. Chaque groupe est deja mappe sur son compte CGNC.
 */
async function tvaGroupsForInvoice(
  client: PoolClient | typeof db,
  invoiceId: string,
  direction: 'collected' | 'deductible'
): Promise<{ accountCode: string; rate: number; tva: number }[]> {
  const res = await client.query(
    `SELECT tva_rate, SUM(tva_amount) AS tva
       FROM invoice_items
      WHERE invoice_id = $1 AND tva_rate IS NOT NULL AND tva_amount IS NOT NULL
      GROUP BY tva_rate
     HAVING ROUND(SUM(tva_amount)::numeric, 2) <> 0
      ORDER BY tva_rate`,
    [invoiceId]
  );
  return res.rows.map((r: { tva_rate: string; tva: string }) => {
    const rate = parseFloat(r.tva_rate);
    return { accountCode: tvaAccountForRate(rate, direction), rate, tva: round2(parseFloat(r.tva)) };
  });
}

/* ═══ Resolution recursive d'un account_id depuis une expense/revenue_category ═══ */
/**
 * Remonte la chaine parent_id jusqu'a trouver un compte associe. Si rien
 * n'est trouve, renvoie le code de fallback 6181 (charges diverses) ou
 * 7585 (autres produits).
 */
export async function resolveCategoryAccountCode(
  client: PoolClient | typeof db,
  categoryId: string | null,
  kind: 'expense' | 'revenue'
): Promise<string> {
  // Mig 311 (G-D8-09) : plus de repli silencieux en 6181 pour une charge. Une
  // catégorie sans compte (ni chez ses parents) est une erreur de paramétrage :
  // la pièce part en file d'attente (mode outbox) ou est refusée (mode strict).
  const fallback = kind === 'expense' ? null : '7585';
  if (!categoryId) {
    if (fallback) return fallback;
    throw new Error('Charge sans catégorie : compte comptable indéterminable');
  }

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
  if (result.rows[0]?.code) return result.rows[0].code;
  if (fallback) return fallback;
  const name = await client.query(`SELECT name FROM expense_categories WHERE id = $1`, [categoryId]);
  throw new Error(`Catégorie « ${name.rows[0]?.name ?? categoryId} » sans compte comptable (ni chez ses parents) : renseignez-le dans le référentiel`);
}

/** Compte paramétré pour un événement (table posting_profiles, mig 311). */
export async function postingAccount(client: PoolClient | typeof db, event: string): Promise<string> {
  const r = await client.query(
    `SELECT account_code FROM posting_profiles WHERE event_type = $1 AND category_id IS NULL AND is_active LIMIT 1`, [event]);
  if (!r.rows[0]) throw new Error(`Paramétrage comptable manquant pour l'événement « ${event} »`);
  return r.rows[0].account_code;
}

/**
 * Solde ouvert du compte d'attente GR/IR (4417) sur une ligne de BC :
 * > 0 = reçu non facturé. Les écritures extournées comptent avec leur extourne.
 */
async function grirOpenAmount(client: PoolClient | typeof db, poLineId: string, grirCode: string): Promise<number> {
  const r = await client.query(
    `SELECT COALESCE(SUM(l.credit) - SUM(l.debit), 0) AS open
       FROM journal_entry_lines l
       JOIN accounts a ON a.id = l.account_id AND a.code = $2
       JOIN journal_entries je ON je.id = l.journal_entry_id AND je.status IN ('posted','reversed')
      WHERE l.po_line_id = $1`, [poLineId, grirCode]);
  return round2(parseFloat(r.rows[0].open) || 0);
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

    // Mig 311 (G-D8-08) : imputation PAR LIGNE de facture (catégorie de la ligne,
    // sinon celle de l'en-tête) ; (G-D8-05) une ligne rattachée à une ligne de BC
    // solde d'abord le compte d'attente GR/IR de cette ligne (reçu non facturé),
    // le reste (écart de prix, quantité non réceptionnée) va en charge.
    const lines: GeneratedLine[] = [];
    const items = await client.query(
      `SELECT category_id, purchase_order_item_id, COALESCE(subtotal, 0) AS subtotal
         FROM invoice_items WHERE invoice_id = $1 ORDER BY id`, [inv.id]);
    const itemsTotal = round2(items.rows.reduce((t: number, r: { subtotal: string }) => t + (parseFloat(r.subtotal) || 0), 0));
    if (items.rows.length > 0 && Math.abs(itemsTotal - amount) <= 0.05) {
      const grirCode = await postingAccount(client, 'grir');
      const byAccount = new Map<string, number>();
      for (const it of items.rows as { category_id: string | null; purchase_order_item_id: string | null; subtotal: string }[]) {
        let rest = round2(parseFloat(it.subtotal) || 0);
        if (it.purchase_order_item_id && rest > 0) {
          const open = await grirOpenAmount(client, it.purchase_order_item_id, grirCode);
          const take = round2(Math.min(open, rest));
          if (take > 0) {
            lines.push({ account_code: grirCode, debit: take, credit: 0, label: `Réception facturée ${inv.invoice_number}`,
              po_line_id: it.purchase_order_item_id, supplier_id: inv.supplier_id });
            rest = round2(rest - take);
          }
        }
        if (rest !== 0) {
          const code = await resolveCategoryAccountCode(client, it.category_id ?? inv.category_id, 'expense');
          byAccount.set(code, round2((byAccount.get(code) ?? 0) + rest));
        }
      }
      for (const [code, value] of byAccount) {
        if (value > 0) lines.push({ account_code: code, debit: value, credit: 0, label: `Achat ${inv.invoice_number}` });
        else if (value < 0) lines.push({ account_code: code, debit: 0, credit: -value, label: `Achat ${inv.invoice_number}` });
      }
      // Arrondi entre lignes et en-tête : sur la première ligne de charge.
      const diff = round2(amount - itemsTotal);
      if (diff !== 0) {
        const code = await resolveCategoryAccountCode(client, inv.category_id ?? items.rows[0].category_id, 'expense');
        lines.push({ account_code: code, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0, label: 'Ajustement arrondi' });
      }
    } else {
      // Facture sans lignes (ou lignes incohérentes avec l'en-tête) : imputation d'en-tête.
      const chargeCode = await resolveCategoryAccountCode(client, inv.category_id, 'expense');
      lines.push({ account_code: chargeCode, debit: round2(amount), credit: 0, label: `Achat ${inv.invoice_number}` });
    }
    // TVA deductible : une ligne par taux si la facture a un detail par ligne,
    // sinon une seule ligne sur le taux global deduit du HT/TVA.
    const tvaGroups = await tvaGroupsForInvoice(client, inv.id, 'deductible');
    if (tvaGroups.length > 0) {
      for (const g of tvaGroups) {
        lines.push({ account_code: g.accountCode, debit: round2(g.tva), credit: 0, label: `TVA recuperable ${g.rate}%` });
      }
    } else if (tax > 0) {
      const tvaCode = tvaAccountForRate(computeTvaRate(amount, tax), 'deductible');
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
    // TVA collectee : une ligne par taux si detail par ligne, sinon ligne unique.
    const tvaGroups = await tvaGroupsForInvoice(client, inv.id, 'collected');
    if (tvaGroups.length > 0) {
      for (const g of tvaGroups) {
        lines.push({ account_code: g.accountCode, debit: 0, credit: round2(g.tva), label: `TVA facturee ${g.rate}%` });
      }
    } else if (tax > 0) {
      const tvaCode = tvaAccountForRate(computeTvaRate(amount, tax), 'collected');
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

/* ═══ Generateur — réception (GR/IR, mig 311, G-D8-05) ═══ */
/**
 * Réception d'une ligne de BC : charge (ou stock) au débit, compte d'attente
 * « factures non parvenues » 4417 au crédit, au PRIX DU BC, lettré par ligne
 * de BC. Une ligne négative (extourne, correction à la baisse) produit
 * l'écriture inverse. Une écriture par ligne de réception (idempotence).
 */
export async function fromGoodsReceipt(
  client: PoolClient | typeof db,
  rviId: string
): Promise<GeneratedEntry | null> {
  const r = await client.query(
    `SELECT rvi.id, rvi.purchase_order_item_id, rvi.kind, rvi.signed_quantity, rvi.quantity_received,
            COALESCE(rvi.po_unit_price, poi.unit_price, rvi.unit_price) AS price,
            COALESCE(rvi.category_id, poi.category_id, ing.category_id, pkg.category_id) AS category_id,
            rv.voucher_number, rv.store_id, rv.created_at, po.supplier_id, po.order_number,
            COALESCE(ing.name, pkg.name, poi.description) AS item_name
       FROM reception_voucher_items rvi
       JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
       JOIN purchase_order_items poi ON poi.id = rvi.purchase_order_item_id
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       LEFT JOIN ingredients ing ON ing.id = COALESCE(rvi.ingredient_id, poi.ingredient_id)
       LEFT JOIN packaging_items pkg ON pkg.id = COALESCE(rvi.packaging_id, poi.packaging_id)
      WHERE rvi.id = $1`, [rviId]);
  const it = r.rows[0];
  if (!it) return null;
  const qty = parseFloat(it.signed_quantity ?? it.quantity_received) || 0;
  if (it.price == null) throw new Error(`Réception ${it.voucher_number} : prix BC non renseigné pour « ${it.item_name} »`);
  const value = round2(qty * parseFloat(it.price));
  if (value === 0) return null;
  const chargeCode = await resolveCategoryAccountCode(client, it.category_id, 'expense');
  const grirCode = await postingAccount(client, 'grir');
  const abs = Math.abs(value);
  const label = `${it.order_number} · ${it.item_name ?? ''}`.trim();
  const axis = { po_line_id: it.purchase_order_item_id as string, receipt_item_id: it.id as string, supplier_id: it.supplier_id as string };
  return {
    journal_code: 'AC',
    entry_date: toIsoDate(it.created_at),
    description: `${value > 0 ? 'Réception' : 'Retour / correction'} ${it.voucher_number} — ${label}`,
    source_kind: value > 0 ? 'goods_receipt' : 'goods_receipt_return',
    source_id: it.id,
    store_id: it.store_id,
    lines: value > 0
      ? [{ account_code: chargeCode, debit: abs, credit: 0, label, ...axis },
         { account_code: grirCode, debit: 0, credit: abs, label: 'Réception à facturer', ...axis }]
      : [{ account_code: grirCode, debit: abs, credit: 0, label: 'Réception à facturer (retour)', ...axis },
         { account_code: chargeCode, debit: 0, credit: abs, label, ...axis }],
  };
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
  // mig 250 — ventilation d'un paiement mixte (payment_method='mixed')
  cash_amount?: string | number | null;
  card_amount?: string | number | null;
}

export async function fromSale(
  client: PoolClient | typeof db,
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

  // GARDE-FOU : la saisie manuelle par shift est AUTORITAIRE (montant
  // physiquement compte). Si une saisie manuelle existe pour ce jour/magasin,
  // elle comptabilise deja le CA reel -> on n'emet PAS d'ecriture pour la vente
  // POS (qui correspond au montant "systeme" theorique, deja couvert).
  //
  // C7 — Le calcul de la date en LOCAL (Casablanca UTC+1) est fait par
  // Postgres et non par JS. Avant, toIsoDate() prenait les composantes UTC
  // (getUTC*) : une vente encaissee a 00h30 local (= 23h30 UTC la veille)
  // etait rattachee au jour UTC (la veille) alors que entry_date manuelle
  // est en local (aujourd'hui) -> le NOT EXISTS ratait -> double comptage
  // ledger. Meme fix cote regenerateShiftEntry (voir plus bas).
  if (s.store_id) {
    const shift = await client.query(
      `SELECT 1 FROM manual_shift_entries
         WHERE store_id = $1
           AND entry_date = DATE(COALESCE($2::timestamptz, $3::timestamptz) AT TIME ZONE 'Africa/Casablanca')
         LIMIT 1`,
      [s.store_id, s.paid_at, s.created_at]
    );
    if (shift.rows.length > 0) return null;
  }

  const isCash = s.payment_method === 'cash';
  const isMixed = s.payment_method === 'mixed';
  const treasuryCode = isCash ? '5161' : '5141';

  const lines: GeneratedLine[] = [];
  if (isMixed) {
    // Paiement mixte (mig 250) : la tresorerie se ventile entre caisse (5161)
    // et banque (5141) selon les parts reellement encaissees.
    const cashPart = parseFloat(String(s.cash_amount ?? 0)) || 0;
    const cardPart = parseFloat(String(s.card_amount ?? 0)) || 0;
    if (cashPart > 0) lines.push({ account_code: '5161', debit: round2(cashPart), credit: 0, label: `Vente ${s.sale_number} (especes)` });
    if (cardPart > 0) lines.push(...cardLines(cardPart, await cardCommissionPct(client), `Vente ${s.sale_number} (carte)`));
  } else if (s.payment_method === 'card') {
    lines.push(...cardLines(total, await cardCommissionPct(client), `Vente ${s.sale_number}`));
  } else {
    lines.push({ account_code: treasuryCode, debit: round2(total), credit: 0, label: `Vente ${s.sale_number}` });
  }
  lines.push({ account_code: '7111', debit: 0, credit: round2(subtotal), label: 'Vente du jour' });

  if (tax > 0) {
    const tvaCode = tvaAccountForRate(computeTvaRate(subtotal, tax), 'collected');
    lines.push({ account_code: tvaCode, debit: 0, credit: round2(tax), label: 'TVA facturee' });
  }
  if (discount > 0) {
    lines.push({ account_code: '7129', debit: round2(discount), credit: 0, label: 'Remise accordee' });
  }

  // Date : paid_at en priorite (encaissement effectif), fallback created_at.
  const dateRaw = s.paid_at || s.created_at;
  // Mixte : classe au journal caisse (des especes entrent physiquement en
  // caisse), la ligne 5141 reste tracee dans la meme ecriture.
  return {
    journal_code: isCash || isMixed ? 'CA' : 'BQ',
    entry_date: toIsoDate(dateRaw),
    description: `Vente POS ${s.sale_number}`,
    source_kind: 'sale',
    source_id: s.id,
    store_id: s.store_id,
    lines,
  };
}

/* ═══ Generateur — pattern G : ventes saisies manuellement par shift ═══ */
export interface ShiftEntryRow {
  id: string;
  entry_date: string;
  store_id: string;
  matin_cash_reel: string | number | null;
  matin_carte_reel: string | number | null;
  soir_cash_reel: string | number | null;
  soir_carte_reel: string | number | null;
}

/**
 * Genere l'ecriture des ventes journalieres saisies manuellement (matin/soir).
 * La saisie manuelle est AUTORITAIRE : c'est le montant physiquement compte
 * (montant "reel"), qui prime sur le POS. On comptabilise les montants reels :
 *   especes (matin+soir) -> 5161 Caisse D
 *   carte   (matin+soir) -> 5141 Banque D (net) + 6147 commission D (mig 356)
 *   total                -> 7111 Ventes C
 *
 * L'anti-double-comptage est gere cote POS (fromSale ignore les jours ayant une
 * saisie manuelle), donc ici on genere toujours des qu'il y a un montant.
 */
export async function fromManualShiftEntry(
  client: PoolClient | typeof db,
  e: ShiftEntryRow
): Promise<GeneratedEntry | null> {
  const cash = (parseFloat(String(e.matin_cash_reel ?? 0)) || 0) + (parseFloat(String(e.soir_cash_reel ?? 0)) || 0);
  const carte = (parseFloat(String(e.matin_carte_reel ?? 0)) || 0) + (parseFloat(String(e.soir_carte_reel ?? 0)) || 0);
  const total = round2(cash + carte);
  if (total <= 0) return null;

  const date = toIsoDate(e.entry_date);

  const lines: GeneratedLine[] = [];
  if (cash > 0)  lines.push({ account_code: '5161', debit: round2(cash),  credit: 0, label: 'Especes (matin+soir)' });
  if (carte > 0) lines.push(...cardLines(carte, await cardCommissionPct(client), 'Carte (matin+soir)'));
  lines.push({ account_code: '7111', debit: 0, credit: total, label: `Ventes du jour ${date}` });

  return {
    journal_code: 'CA',
    entry_date: date,
    description: `Ventes journalieres (saisie manuelle) ${date}`,
    source_kind: 'shift_entry',
    source_id: e.id,
    store_id: e.store_id,
    lines,
  };
}

/* ═══ Generateur — patterns D/E/F : paiements ═══ */
export interface PaymentRow {
  id: string;
  reference: string | null;
  type: 'invoice' | 'salary' | 'expense' | 'income' | 'advance' | 'internal_transfer';
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
  withholding_type_id?: string | null;
  withholding_amount?: string | number | null;
  // Mig 310 (G-D7-03/17) : mode typé et comptes de trésorerie.
  payment_mode?: string | null;
  treasury_account_id?: string | null;
  to_treasury_account_id?: string | null;
  // Mig 368 : règlement en devise — part de facture soldée (taux facture) et écart de change.
  settled_amount?: string | number | null;
  fx_difference?: string | number | null;
}

/** Compte général et nature (caisse/banque) d'un compte de trésorerie (mig 310). */
async function treasuryAccount(
  client: PoolClient | typeof db, id: string | null | undefined
): Promise<{ account_code: string; kind: 'cash' | 'bank' } | null> {
  if (!id) return null;
  const r = await client.query(`SELECT account_code, kind FROM treasury_accounts WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
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

  // Virement interne (mig 310, G-D7-17) : mouvement entre nos comptes, ni charge
  // ni tiers. Destination au debit, source au credit (ex. versement : 5141 D / 5161 C).
  if (p.type === 'internal_transfer') {
    const from = await treasuryAccount(client, p.treasury_account_id);
    const to = await treasuryAccount(client, p.to_treasury_account_id);
    if (!from || !to) throw new Error(`Virement interne ${p.id} : compte de tresorerie introuvable`);
    return {
      journal_code: from.kind === 'cash' ? 'CA' : 'BQ',
      entry_date: toIsoDate(p.payment_date),
      description: p.description || `Virement interne ${p.reference || ''}`.trim(),
      source_kind: 'payment',
      source_id: p.id,
      store_id: p.store_id,
      lines: [
        { account_code: to.account_code, debit: round2(amount), credit: 0, label: 'Virement interne (entree)' },
        { account_code: from.account_code, debit: 0, credit: round2(amount), label: 'Virement interne (sortie)' },
      ],
    };
  }

  // Cote DEBIT : determine selon le type de paiement
  let debitLine: GeneratedLine;
  let lettrageKey: string | undefined;

  // Règlement en devise (mig 368) : le fournisseur est soldé au taux de la facture
  // (settled_amount), la trésorerie sort le montant au taux du jour, l'écart va en 6331 / 7331.
  const fxDiff = p.type === 'invoice' && p.fx_difference != null ? round2(parseFloat(String(p.fx_difference)) || 0) : 0;
  if (p.type === 'invoice' && p.invoice_id && p.supplier_id) {
    // Reglement de facture fournisseur : lettrage avec la facture
    lettrageKey = `inv-${p.invoice_id}`;
    const settled = p.settled_amount != null ? parseFloat(String(p.settled_amount)) : amount;
    debitLine = {
      account_code: '4411',
      auxiliary_supplier_id: p.supplier_id,
      debit: round2(settled),
      credit: 0,
      label: `Reglement ${p.reference || p.invoice_id.slice(0, 8)}`,
      lettrage_key: lettrageKey,
    };
  } else if (p.type === 'salary' && p.employee_id) {
    debitLine = { account_code: '6171', debit: round2(amount), credit: 0, label: 'Paiement salaire' };
  } else if (p.type === 'advance') {
    // Avance sur salaire : creance sur l'employe (3431), PAS une charge.
    // La charge 6171 sera reconnue au fil des retenues sur paie
    // (ecritures 'advance_repayment' : 6171 D / 3431 C).
    debitLine = { account_code: '3431', debit: round2(amount), credit: 0, label: p.description || 'Avance sur salaire' };
  } else if (p.type === 'expense') {
    const code = await resolveCategoryAccountCode(client, p.category_id, 'expense');
    debitLine = { account_code: code, debit: round2(amount), credit: 0, label: p.description || 'Depense' };
  } else if (p.type === 'income') {
    // Encaissement : tresorerie au debit. Cheque / traite recus attendent leur
    // remise en banque (5111 / 5113, soldes par l'ecriture d'encaissement).
    const method = p.payment_method;
    let treasuryCode = method === 'cash' ? '5161' : method === 'check' ? '5111' : method === 'traite' ? '5113' : '5141';
    let journal: GeneratedEntry['journal_code'] = method === 'cash' ? 'CA' : method === 'check' || method === 'traite' ? 'OD' : 'BQ';
    if (['cash', 'transfer', 'bank', 'card', 'mobile'].includes(method) && p.treasury_account_id) {
      const ta = await treasuryAccount(client, p.treasury_account_id);
      if (ta) { treasuryCode = ta.account_code; journal = ta.kind === 'cash' ? 'CA' : 'BQ'; }
    }
    // Reglement d'une facture client (correctif 2026-10-26) : il solde la creance 3421 du
    // client, lettree avec la facture. Le chiffre d'affaires est deja porte par
    // la facture (7111) : le recrediter en produit le comptait deux fois.
    const inv = p.invoice_id
      ? (await client.query(`SELECT invoice_type, customer_id, invoice_number FROM invoices WHERE id = $1`, [p.invoice_id])).rows[0]
      : null;
    const creditLine: GeneratedLine = inv?.invoice_type === 'emitted' && inv.customer_id
      ? {
          account_code: '3421', auxiliary_customer_id: inv.customer_id, debit: 0, credit: round2(amount),
          label: `Reglement ${inv.invoice_number}`, lettrage_key: `inv-${p.invoice_id}`,
        }
      : { account_code: await resolveCategoryAccountCode(client, p.category_id, 'revenue'), debit: 0, credit: round2(amount), label: p.description || 'Revenu' };
    return {
      journal_code: journal,
      entry_date: toIsoDate(p.payment_date),
      description: p.description || `Revenu ${p.reference || ''}`,
      source_kind: 'payment',
      source_id: p.id,
      store_id: p.store_id,
      lines: [
        { account_code: treasuryCode, debit: round2(amount), credit: 0, label: 'Encaissement' },
        creditLine,
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
    case 'card':
    case 'mobile':
      // Carte et paiement mobile sortent de la banque, pas de la caisse (mig 310).
      creditCode = '5141'; journal = 'BQ'; break;
    case 'check':
      creditCode = '5111'; journal = 'OD'; break;
    case 'traite':
      creditCode = '4415'; journal = 'OD'; break;
    default:
      creditCode = '5161'; journal = 'CA';
  }
  // Compte de tresorerie explicite (mig 310) : pour les sorties immediates
  // (especes, virement, carte), le compte general vient du compte choisi.
  if (['cash', 'transfer', 'bank', 'card', 'mobile'].includes(p.payment_method) && p.treasury_account_id) {
    const ta = await treasuryAccount(client, p.treasury_account_id);
    if (ta) { creditCode = ta.account_code; journal = ta.kind === 'cash' ? 'CA' : 'BQ'; }
  }

  const creditLabel = p.payment_method === 'check'
    ? `Cheque emis ${p.reference || ''}`.trim()
    : p.payment_method === 'traite'
    ? `Traite emise ${p.reference || ''}`.trim()
    : 'Sortie tresorerie';

  // Retenue a la source : amount = BRUT (l'obligation, cote debit). On verse le
  // NET au beneficiaire (brut - retenue) et on credite le compte RAS 4452x du
  // montant retenu (dette envers l'Etat). L'ecriture reste equilibree :
  //   debit brut = credit (net + retenue).
  const withholding = round2(parseFloat(String(p.withholding_amount ?? 0)) || 0);
  const lines: GeneratedLine[] = [debitLine];
  if (fxDiff > 0) {
    lines.push({ account_code: await postingAccount(client, 'fx_loss'), debit: fxDiff, credit: 0, label: 'Perte de change' });
  } else if (fxDiff < 0) {
    lines.push({ account_code: await postingAccount(client, 'fx_gain'), debit: 0, credit: -fxDiff, label: 'Gain de change' });
  }
  if (withholding > 0 && p.withholding_type_id) {
    const ras = await client.query(
      `SELECT a.code FROM withholding_tax_types w JOIN accounts a ON a.id = w.account_id WHERE w.id = $1`,
      [p.withholding_type_id]
    );
    const rasCode = ras.rows[0]?.code;
    if (!rasCode) throw new Error(`Type de RAS ${p.withholding_type_id} introuvable`);
    const net = round2(amount - withholding);
    lines.push({ account_code: creditCode, debit: 0, credit: net, label: `${creditLabel} (net)` });
    lines.push({ account_code: rasCode, debit: 0, credit: withholding, label: 'Retenue a la source' });
  } else {
    lines.push({ account_code: creditCode, debit: 0, credit: round2(amount), label: creditLabel });
  }

  return {
    journal_code: journal,
    entry_date: toIsoDate(p.payment_date),
    description: p.description || `Paiement ${p.reference || ''}`.trim(),
    source_kind: 'payment',
    source_id: p.id,
    store_id: p.store_id,
    lines,
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

  // Cheque / traite RECU d'un client : la remise en banque debite la banque et
  // solde 5111 / 5113 (sens inverse d'un effet emis).
  if (p.type === 'income') {
    return {
      journal_code: 'BQ',
      entry_date: toIsoDate(p.cashed_at),
      description: `Remise en banque ${p.payment_method === 'check' ? 'cheque' : 'traite'} ${p.reference || ''}`.trim(),
      source_kind: 'payment',
      source_id: p.id,
      source_detail: 'cashing',
      store_id: p.store_id,
      lines: [
        { account_code: '5141', debit: round2(amount), credit: 0, label: 'Credit bancaire' },
        { account_code: p.payment_method === 'check' ? '5111' : '5113', debit: 0, credit: round2(amount), label: 'Effet remis a l\'encaissement' },
      ],
    };
  }

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
  opts: { markAsBackfill?: boolean; userId: string | null }
): Promise<{ id: string; entry_number: string; created: boolean }> {
  // Idempotence : verifie si une ecriture existe deja pour cette source.
  // IMPORTANT : on ne filtre PAS sur source_kind. Un meme evenement economique
  // (facture, paiement, vente) ne doit avoir qu'une ecriture, qu'elle ait ete
  // posee par l'AUTOGEN (source_kind='invoice'/'payment'/'sale') ou par le
  // backfill (source_kind='backfill'). Filtrer sur le kind laissait le backfill
  // ignorer une ecriture AUTOGEN existante et en creer une seconde -> doublon
  // qui doublait le solde du tiers dans la reconciliation. source_id est un UUID
  // de PK (invoices/payments/sales), aucune collision possible entre tables.
  // source_detail discrimine les sources a ecritures multiples (cheque : emission/cashing).
  const detail = entry.source_detail ?? null;
  const existing = await client.query(
    `SELECT id, entry_number FROM journal_entries
     WHERE source_id = $1
       AND COALESCE(source_detail, '') = COALESCE($2::varchar, '')
       AND status != 'reversed'
     LIMIT 1`,
    [entry.source_id, detail]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, entry_number: existing.rows[0].entry_number, created: false };
  }

  // Resolution du journal_id
  const jrn = await client.query(`SELECT id FROM journals WHERE code = $1`, [entry.journal_code]);
  if (!jrn.rows[0]) throw new Error(`Journal ${entry.journal_code} introuvable`);
  const journalId = jrn.rows[0].id;

  // Mig 311 (G-D8-16) : date comptable = date de la pièce si sa période est
  // ouverte, sinon premier jour de la période ouverte suivante ; les périodes
  // manquantes sont créées à la demande (plus de blocage au 1er janvier).
  const accDate = await client.query(`SELECT fn_accounting_date($1::date)::text AS d`, [entry.entry_date]);
  entry = { ...entry, entry_date: accDate.rows[0].d };
  const fp = await client.query(
    `SELECT id, status FROM fiscal_periods WHERE $1::DATE BETWEEN start_date AND end_date LIMIT 1`,
    [entry.entry_date]
  );
  if (!fp.rows[0]) throw new Error(`Aucune periode fiscale pour ${entry.entry_date}`);
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
    // Provision a la volee des auxiliaires manquants. Les tiers crees apres le
    // seed (migration 179) n'avaient aucun auxiliaire : persistEntry levait
    // "Auxiliaire manquant" et l'ecriture echouait silencieusement -> facture
    // "sans ecriture". On cree l'auxiliaire avec la meme convention de code que
    // le seed (4411-FOUR-<6 lettres>-<4 chars id>), idempotent via ON CONFLICT.
    const missing = supplierIds.filter(id => !auxBySupplier.has(id));
    if (missing.length) {
      await client.query(
        `INSERT INTO account_auxiliaries (account_id, supplier_id, code, label)
         SELECT (SELECT id FROM accounts WHERE code = '4411'), s.id,
           '4411-FOUR-' || UPPER(SUBSTR(REGEXP_REPLACE(s.name, '[^A-Za-z0-9]', '', 'g'), 1, 6))
                        || '-' || SUBSTR(s.id::TEXT, 1, 4),
           s.name
         FROM suppliers s WHERE s.id = ANY($1::uuid[])
         ON CONFLICT DO NOTHING`,
        [missing]
      );
      const r2 = await client.query(`SELECT id, supplier_id FROM account_auxiliaries WHERE supplier_id = ANY($1::uuid[])`, [missing]);
      for (const row of r2.rows) auxBySupplier.set(row.supplier_id, row.id);
    }
  }
  if (customerIds.length) {
    const r = await client.query(`SELECT id, customer_id FROM account_auxiliaries WHERE customer_id = ANY($1::uuid[])`, [customerIds]);
    for (const row of r.rows) auxByCustomer.set(row.customer_id, row.id);
    const missing = customerIds.filter(id => !auxByCustomer.has(id));
    if (missing.length) {
      await client.query(
        `INSERT INTO account_auxiliaries (account_id, customer_id, code, label)
         SELECT (SELECT id FROM accounts WHERE code = '3421'), c.id,
           '3421-CLI-' || UPPER(SUBSTR(REGEXP_REPLACE(
             COALESCE(c.first_name, '') || COALESCE(c.last_name, ''), '[^A-Za-z0-9]', '', 'g'), 1, 6))
                       || '-' || SUBSTR(c.id::TEXT, 1, 4),
           TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
         FROM customers c WHERE c.id = ANY($1::uuid[])
         ON CONFLICT DO NOTHING`,
        [missing]
      );
      const r2 = await client.query(`SELECT id, customer_id FROM account_auxiliaries WHERE customer_id = ANY($1::uuid[])`, [missing]);
      for (const row of r2.rows) auxByCustomer.set(row.customer_id, row.id);
    }
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
         journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label,
         po_line_id, receipt_item_id, supplier_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [entryId, i + 1, acc.id, auxId, l.debit, l.credit, l.label || null,
       l.po_line_id ?? null, l.receipt_item_id ?? null, l.supplier_id ?? null]
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
       AND je.source_kind <> 'reversal'
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

/* ═══ Extourne des écritures d'une source (mig 311, G-D8-02) ═══ */
/**
 * Annule comptablement les écritures actives d'une source (facture, paiement,
 * vente…) : jamais de suppression. Chaque écriture reçoit une extourne
 * (débit ↔ crédit), datée comme l'original si sa période est ouverte, sinon au
 * premier jour ouvert ; l'original passe 'reversed' et les deux sont liés
 * (reversed_by_entry_id / reversal_of_entry_id). Le lettrage qu'elles portaient
 * est défait, puis l'original et son extourne sont lettrés ensemble sur les
 * comptes de tiers (ils se soldent mutuellement).
 *
 * Période 'locked' : refus (aucune correction possible).
 * Idempotent : sans écriture active, ne fait rien.
 */
export async function reverseEntriesForSource(
  client: PoolClient,
  opts: {
    sourceId: string; sourceKinds?: string[];
    /** Conservé pour compatibilité : l'extourne est désormais systématique. */
    forceExtourne?: boolean;
    /** Date souhaitée de l'extourne (sinon : date de l'original, ou premier jour ouvert). */
    extourneDate?: string;
  }
): Promise<{ removed: number; reversed: number; unlettered: number }> {
  const kinds = opts.sourceKinds ?? ['payment', 'invoice', 'sale', 'backfill'];
  const entriesRes = await client.query(
    `SELECT je.id, je.entry_number, je.entry_date, je.store_id, je.description, je.journal_id,
            je.source_id, je.source_detail, fp.status AS period_status
     FROM journal_entries je
     JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
     WHERE je.source_id = $1
       AND je.source_kind = ANY($2::text[])
       AND je.status = 'posted'`,
    [opts.sourceId, kinds]
  );
  if (entriesRes.rows.length === 0) return { removed: 0, reversed: 0, unlettered: 0 };

  const locked = entriesRes.rows.find((r: { period_status: string }) => r.period_status === 'locked');
  if (locked) {
    throw new Error(
      `Impossible : l'ecriture ${(locked as { entry_number: string }).entry_number} ` +
      `appartient a une periode VERROUILLEE (locked). Aucune correction possible.`
    );
  }

  const allEntryIds = entriesRes.rows.map((r: { id: string }) => r.id);
  const lettrageRes = await client.query(
    `SELECT DISTINCT lettrage_id FROM journal_entry_lines
     WHERE journal_entry_id = ANY($1::uuid[]) AND lettrage_id IS NOT NULL`,
    [allEntryIds]
  );
  const lettrageIds = lettrageRes.rows.map((r: { lettrage_id: string }) => r.lettrage_id);
  let unlettered = 0;
  if (lettrageIds.length > 0) {
    const upd = await client.query(
      `UPDATE journal_entry_lines SET lettrage_id = NULL WHERE lettrage_id = ANY($1::uuid[])`,
      [lettrageIds]
    );
    unlettered = upd.rowCount ?? 0;
  }

  let reversed = 0;
  for (const orig of entriesRes.rows) {
    await extourneEntry(client, orig, opts.extourneDate);
    reversed++;
  }
  return { removed: 0, reversed, unlettered };
}

/** Extourne une écriture précise (ex. dotation d'une immobilisation supprimée). */
export async function extourneEntryById(client: PoolClient, entryId: string, preferredDate?: string): Promise<boolean> {
  const r = await client.query(
    `SELECT je.id, je.entry_number, je.entry_date, je.store_id, je.description, je.journal_id,
            je.source_id, je.source_detail, fp.status AS period_status
       FROM journal_entries je JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
      WHERE je.id = $1 AND je.status = 'posted'`, [entryId]);
  if (!r.rows[0]) return false;
  if (r.rows[0].period_status === 'locked') throw new Error(`Ecriture ${r.rows[0].entry_number} en periode verrouillee`);
  await extourneEntry(client, r.rows[0], preferredDate);
  return true;
}

async function extourneEntry(
  client: PoolClient,
  orig: { id: string; entry_number: string; entry_date: unknown; journal_id: string; store_id: string | null;
          description: string | null; source_id: string | null; source_detail: string | null },
  preferredDate?: string
): Promise<void> {
  const target = preferredDate || toIsoDate(orig.entry_date);
  const d = await client.query(`SELECT fn_accounting_date($1::date)::text AS d`, [target]);
  const extDate: string = d.rows[0].d;
  const fp = await client.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [extDate]);
  const periodId = fp.rows[0].id;

  const year = parseInt(extDate.slice(0, 4), 10);
  const numRes = await client.query('SELECT next_entry_number($1, $2::smallint) AS num', [orig.journal_id, year]);
  const entryNumber = numRes.rows[0].num;
  const sysUser = await resolveUserId(client, null);

  // source_detail = 'rev:<id original>' : unique par original, plusieurs
  // régénérations successives d'une même pièce ne se télescopent pas.
  const insRes = await client.query(
    `INSERT INTO journal_entries (
       entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by, reversal_of_entry_id
     ) VALUES ($1,$2,$3,$4,$5,'reversal',$6,$7,'draft',$8,$9,$10)
     RETURNING id`,
    [entryNumber, orig.journal_id, extDate, periodId,
     `Extourne de ${orig.entry_number}${orig.description ? ' — ' + orig.description : ''}`,
     orig.source_id, `rev:${orig.id}`, orig.store_id, sysUser, orig.id]
  );
  const extId = insRes.rows[0].id;

  await client.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label,
                                      po_line_id, receipt_item_id, supplier_id)
     SELECT $1, line_order, account_id, auxiliary_id, credit, debit, 'Extourne: ' || COALESCE(label, ''),
            po_line_id, receipt_item_id, supplier_id
     FROM journal_entry_lines WHERE journal_entry_id = $2`,
    [extId, orig.id]
  );
  await client.query(
    `UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`,
    [extId, sysUser]
  );
  await client.query(
    `UPDATE journal_entries SET status = 'reversed', reversed_by_entry_id = $2 WHERE id = $1`,
    [orig.id, extId]
  );
  // Original et extourne se soldent : lettrage commun sur les comptes de tiers.
  await client.query(
    `UPDATE journal_entry_lines jel SET lettrage_id = $3
       FROM accounts a
      WHERE a.id = jel.account_id AND a.is_collective
        AND jel.journal_entry_id IN ($1, $2) AND jel.lettrage_id IS NULL`,
    [orig.id, extId, crypto.randomUUID()]
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
  employee_id, amount, payment_method, payment_date, cashed_at, description, store_id,
  withholding_type_id, withholding_amount, payment_mode, treasury_account_id, to_treasury_account_id
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

const SHIFT_ENTRY_SELECT = `SELECT id, entry_date, store_id,
  matin_cash_reel, matin_carte_reel, soir_cash_reel, soir_carte_reel
  FROM manual_shift_entries WHERE id = $1`;

/**
 * Resynchronise l'ecriture d'une saisie manuelle de ventes (matin/soir).
 * A appeler apres upsert/delete d'une manual_shift_entry. Reverse l'ancienne
 * puis regenere depuis l'etat courant (ou rien si supprimee / montants nuls /
 * jour deja couvert par le POS).
 */
export async function regenerateShiftEntry(
  client: PoolClient,
  shiftEntryId: string,
  userId: string | null | undefined
): Promise<void> {
  await reverseEntriesForSource(client, { sourceId: shiftEntryId, sourceKinds: ['shift_entry', 'backfill'] });

  const res = await client.query(SHIFT_ENTRY_SELECT, [shiftEntryId]);
  const row = res.rows[0];
  if (!row) return;

  // La saisie manuelle est autoritaire : reverser les ecritures POS de ce
  // jour/magasin (elles seraient un double comptage du CA).
  // C7 — DATE en local (Africa/Casablanca) pour matcher les entry_date
  // saisies en local, et aligner avec la garde de fromSale.
  const day = toIsoDate(row.entry_date);
  const posSales = await client.query(
    `SELECT id FROM sales
      WHERE store_id = $1 AND payment_status = 'paid'
        AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE 'Africa/Casablanca') = $2::date`,
    [row.store_id, day]
  );
  for (const ps of posSales.rows) {
    await reverseEntriesForSource(client, { sourceId: ps.id, sourceKinds: ['sale', 'backfill'] });
  }

  const entry = await fromManualShiftEntry(client, row);
  if (entry) await persistEntry(client, entry, { userId: await resolveUserId(client, userId) });
}

/* ═══ Generateur — perte produit (section 3.3) ═══ */

export interface ProductLossRow {
  id: string;
  product_id: string;
  quantity: string | number;
  loss_type: string;   // 'production' | 'vitrine' | 'perime' | 'recyclage'
  reason: string;
  unit_cost: string | number;
  total_cost: string | number;
  created_at: string;
  store_id: string | null;
  ingredients_consumed?: boolean;
}

/**
 * Section 3.3 — Comptabilise une perte produit fini.
 *   6114 Variations stock produits finis (D) — charge de gestion
 *   7132 Variations stock produits finis (C) — mais on utilise plutot
 *          3421 Stock produits finis (C) pour materialiser la sortie
 *          de stock, coherent avec le CGNC.
 *
 * loss_type = 'production' : les ingredients ont deja ete consommes cote
 *   plan de production, aucune sortie supplementaire de stock produit fini
 *   -> on ne genere PAS d'ecriture ici (evite double comptage).
 * Autres types (vitrine/perime/recyclage) : la vitrine a ete decrementee ->
 *   on trace la sortie en compta.
 */
export async function fromProductLoss(
  _client: PoolClient | typeof db,
  loss: ProductLossRow
): Promise<GeneratedEntry | null> {
  if (loss.loss_type === 'production') return null;
  const totalCost = round2(parseFloat(String(loss.total_cost)) || 0);
  if (totalCost <= 0) return null;

  const date = toIsoDate(loss.created_at);

  return {
    journal_code: 'OD',
    entry_date: date,
    description: `Perte ${loss.loss_type} (${loss.reason}) x${loss.quantity}`,
    source_kind: 'product_loss',
    source_id: loss.id,
    store_id: loss.store_id,
    lines: [
      { account_code: '6114', debit: totalCost, credit: 0, label: `Perte ${loss.loss_type}` },
      { account_code: '3421', debit: 0, credit: totalCost, label: 'Sortie stock produit fini' },
    ],
  };
}

/* ═══ Generateur — ecart de caisse (section 4.3) ═══ */

export interface ClosureDiffRow {
  id: string;
  closure_number: string | null;
  difference: string | number | null;
  difference_reason: string | null;
  closed_at: string | null;
  store_id: string | null;
}

/**
 * Section 4.3 — Comptabilise l'ecart de caisse constate au submit.
 *   difference > 0 (excedent) : 5161 Caisse D / 758 Autres produits non
 *                                courants (excedent) C
 *   difference < 0 (manque)   : 6588 Autres charges non courantes (manque) D
 *                               / 5161 Caisse C
 *
 * Seuil : les ecarts <= 5 DH (rendu-monnaie) sont ignores. Au dela, motif
 * obligatoire (verifie par le repo submitActualAmount).
 */
export async function fromClosureDiff(
  _client: PoolClient | typeof db,
  session: ClosureDiffRow
): Promise<GeneratedEntry | null> {
  const diff = round2(parseFloat(String(session.difference ?? 0)) || 0);
  if (Math.abs(diff) <= 5) return null;
  if (!session.closed_at) return null;

  const date = toIsoDate(session.closed_at);
  const label = session.closure_number
    ? `Ecart caisse ${session.closure_number} (${session.difference_reason || 'motif non precise'})`
    : `Ecart caisse (${session.difference_reason || 'motif non precise'})`;

  const lines: GeneratedLine[] = diff > 0
    ? [
        { account_code: '5161', debit: round2(diff), credit: 0, label: 'Excedent tiroir' },
        { account_code: '7588', debit: 0, credit: round2(diff), label },
      ]
    : [
        { account_code: '6588', debit: round2(-diff), credit: 0, label },
        { account_code: '5161', debit: 0, credit: round2(-diff), label: 'Manque tiroir' },
      ];

  return {
    journal_code: 'OD',
    entry_date: date,
    description: label,
    source_kind: 'closure_diff',
    source_id: session.id,
    store_id: session.store_id,
    lines,
  };
}

