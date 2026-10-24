import { db } from '../config/database.js';
import type { PoolClient } from 'pg';

/**
 * Echeancier des sorties d'argent : dettes echelonnees + charges fixes.
 *
 * TROIS SOURCES D'ECHEANCE, un seul calendrier (cf. migration 258) :
 *
 *   1. FACTURE ECHELONNEE (source_kind='invoice')
 *      Materiel achete a credit dont la facture est saisie. On decoupe le
 *      montant en N mensualites. Le SOLDE reste porte par la facture
 *      (invoices.paid_amount) : l'echeancier n'est qu'un calendrier, sinon la
 *      meme dette serait comptee deux fois dans l'onglet Dettes.
 *
 *   2. DETTE AUTONOME (source_kind='debt')
 *      Achat a credit sans facture dans le systeme. Ici c'est la dette qui
 *      porte le solde (total_amount - somme des reglements).
 *
 *   3. CHARGE FIXE RECURRENTE (source_kind='recurring')
 *      Loyer, electricite, eau... Un modele genere les echeances a l'avance
 *      (fn_generate_recurring_schedules, idempotent). Montant NULL = variable,
 *      a completer a reception de la facture.
 *
 * Dans les trois cas le REGLEMENT est un `payment` ordinaire portant
 * scheduled_payment_id : meme caisse, meme suivi des cheques, meme ledger.
 * Le trigger trg_sync_scheduled_payment resynchronise amount_paid/status.
 */

/** Horizon de generation des charges fixes : ~3 mois d'avance. */
const HORIZON_DAYS = 90;

/**
 * Repartit un montant en n echeances a 2 decimales, le dernier terme absorbant
 * l'arrondi. 10 000 / 3 -> [3333.33, 3333.33, 3333.34] (somme exacte).
 */
export function splitInstallments(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100;
  const parts = Array<number>(count).fill(base);
  const reste = Math.round((total - base * count) * 100) / 100;
  parts[count - 1] = Math.round((base + reste) * 100) / 100;
  return parts;
}

/**
 * Date de la n-ieme echeance a partir d'une date de depart, par pas de mois.
 * Le jour est borne a la fin du mois (31 janvier + 1 mois -> 28/29 fevrier),
 * pour ne jamais produire de date invalide.
 */
export function addMonthsClamped(startISO: string, monthsToAdd: number): string {
  const [y, m, d] = startISO.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + monthsToAdd, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const paymentScheduleRepository = {
  /* ══════════════════════ CALENDRIER (lecture) ══════════════════════ */

  /**
   * Materialise les echeances recurrentes a venir puis renvoie le calendrier.
   *
   * La generation est idempotente (index unique modele/periode) : on peut donc
   * l'appeler a chaque chargement de l'onglet sans cron ni doublon. C'est ce
   * qui garantit qu'un loyer non saisi APPARAIT quand meme comme du.
   */
  async findSchedule(params: {
    storeId?: string;
    from?: string;
    to?: string;
    status?: 'open' | 'all';
    sourceKind?: 'invoice' | 'debt' | 'recurring';
  }) {
    await db.query('SELECT fn_generate_recurring_schedules($1)', [HORIZON_DAYS]);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.status !== 'all') conditions.push(`sp.status IN ('pending', 'partial')`);
    if (params.storeId) { conditions.push(`(sp.store_id IS NULL OR sp.store_id = $${i++})`); values.push(params.storeId); }
    if (params.from) { conditions.push(`sp.due_date >= $${i++}`); values.push(params.from); }
    if (params.to) { conditions.push(`sp.due_date <= $${i++}`); values.push(params.to); }
    if (params.sourceKind) { conditions.push(`sp.source_kind = $${i++}`); values.push(params.sourceKind); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT sp.id, sp.source_kind, sp.invoice_id, sp.debt_id, sp.recurring_charge_id,
              sp.label, sp.due_date, sp.amount_due, sp.amount_paid, sp.status,
              sp.installment_no, sp.installment_total, sp.period_label,
              sp.expected_payment_mode, sp.notes,
              COALESCE(sp.amount_due, 0) - sp.amount_paid AS remaining_amount,
              (sp.amount_due IS NULL)                     AS amount_pending,
              (sp.due_date < CURRENT_DATE)                AS is_overdue,
              sp.supplier_id, s.name AS supplier_name,
              sp.category_id, ec.name AS category_name,
              inv.invoice_number, d.label AS debt_label
         FROM scheduled_payments sp
         LEFT JOIN suppliers s           ON s.id = sp.supplier_id
         LEFT JOIN expense_categories ec ON ec.id = sp.category_id
         LEFT JOIN invoices inv          ON inv.id = sp.invoice_id
         LEFT JOIN debts d               ON d.id = sp.debt_id
         ${where}
         ORDER BY sp.due_date ASC, sp.label ASC`,
      values
    );
    return result.rows;
  },

  /** Echeances d'une source donnee (detail d'une facture echelonnee / d'une dette). */
  async findBySource(kind: 'invoice' | 'debt' | 'recurring', sourceId: string) {
    const col = kind === 'invoice' ? 'invoice_id' : kind === 'debt' ? 'debt_id' : 'recurring_charge_id';
    const result = await db.query(
      `SELECT sp.*, COALESCE(sp.amount_due, 0) - sp.amount_paid AS remaining_amount
         FROM scheduled_payments sp
        WHERE sp.${col} = $1
        ORDER BY sp.due_date ASC`,
      [sourceId]
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT sp.*, COALESCE(sp.amount_due, 0) - sp.amount_paid AS remaining_amount,
              inv.invoice_number, inv.supplier_id AS invoice_supplier_id
         FROM scheduled_payments sp
         LEFT JOIN invoices inv ON inv.id = sp.invoice_id
        WHERE sp.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  /* ══════════════════════ ECHELONNEMENT D'UNE FACTURE ══════════════════════ */

  /**
   * Decoupe une facture recue en N echeances.
   *
   * Garde-fous :
   *   - la facture doit exister et ne pas etre annulee ;
   *   - le total echelonne ne peut pas depasser le reste a payer (on echelonne
   *     ce qui reste du, pas ce qui est deja regle) ;
   *   - un echeancier existant est remplace, mais seulement si aucune de ses
   *     echeances n'a deja recu un reglement (sinon on perdrait le lien
   *     paiement <-> echeance).
   */
  async createInvoiceSchedule(invoiceId: string, data: {
    installments: number;
    firstDueDate: string;
    intervalMonths?: number;
    amount?: number;          // defaut : reste a payer de la facture
    expectedPaymentMode?: string | null;
    notes?: string | null;
    createdBy: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const inv = await client.query(
        `SELECT id, invoice_number, invoice_type, status, total_amount, paid_amount,
                supplier_id, category_id, store_id
           FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!inv.rows[0]) throw httpError('Facture introuvable', 404);
      const invoice = inv.rows[0];
      if (invoice.status === 'cancelled') throw httpError('Facture annulée : échelonnement impossible', 400);

      const remaining = parseFloat(invoice.total_amount) - parseFloat(invoice.paid_amount || '0');
      const montant = data.amount ?? remaining;
      if (montant <= 0) throw httpError('Cette facture est déjà réglée', 400);
      if (montant > remaining + 0.01) {
        throw httpError(
          `Le montant à échelonner (${montant.toFixed(2)} DH) dépasse le reste à payer ` +
          `(${remaining.toFixed(2)} DH) de la facture ${invoice.invoice_number}.`, 400
        );
      }

      // Un echeancier deja regle (meme partiellement) n'est pas remplacable.
      const paid = await client.query(
        `SELECT COUNT(*)::int AS n FROM scheduled_payments
          WHERE invoice_id = $1 AND amount_paid > 0`,
        [invoiceId]
      );
      if (paid.rows[0].n > 0) {
        throw httpError(
          'Des échéances de cette facture ont déjà reçu un règlement : '
          + 'supprimez ces règlements avant de refaire l\'échéancier.', 409
        );
      }
      await client.query(`DELETE FROM scheduled_payments WHERE invoice_id = $1`, [invoiceId]);

      const rows = await insertInstallments(client, {
        sourceKind: 'invoice',
        sourceId: invoiceId,
        baseLabel: `Facture ${invoice.invoice_number}`,
        supplierId: invoice.supplier_id,
        categoryId: invoice.category_id,
        storeId: invoice.store_id,
        total: montant,
        installments: data.installments,
        firstDueDate: data.firstDueDate,
        intervalMonths: data.intervalMonths ?? 1,
        expectedPaymentMode: data.expectedPaymentMode ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      });

      // L'echeance la plus lointaine devient la due_date de la facture : les
      // alertes existantes (PaymentAlertsWidget) restent coherentes.
      await client.query(
        `UPDATE invoices SET due_date = $1 WHERE id = $2`,
        [rows[rows.length - 1].due_date, invoiceId]
      );

      await client.query('COMMIT');
      return rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ══════════════════════ DETTE AUTONOME ══════════════════════ */

  /** Liste des dettes autonomes avec leur solde. */
  async findDebts(params: { storeId?: string; includeSettled?: boolean }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (!params.includeSettled) conditions.push(`d.status = 'active'`);
    if (params.storeId) { conditions.push(`(d.store_id IS NULL OR d.store_id = $${i++})`); values.push(params.storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT d.id, d.label, d.total_amount, d.start_date, d.status, d.notes,
              d.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
              d.category_id, ec.name AS category_name,
              d.fixed_asset_id, fa.label AS fixed_asset_label,
              COALESCE(sp.paid, 0)                    AS paid_amount,
              d.total_amount - COALESCE(sp.paid, 0)   AS remaining_amount,
              COALESCE(sp.nb, 0)                      AS installments_total,
              COALESCE(sp.nb_paid, 0)                 AS installments_paid,
              sp.next_due_date,
              COALESCE(sp.nb_overdue, 0) > 0          AS is_overdue
         FROM debts d
         LEFT JOIN suppliers s           ON s.id = d.supplier_id
         LEFT JOIN expense_categories ec ON ec.id = d.category_id
         LEFT JOIN fixed_assets fa       ON fa.id = d.fixed_asset_id
         LEFT JOIN LATERAL (
           SELECT SUM(x.amount_paid) AS paid,
                  COUNT(*)::int      AS nb,
                  COUNT(*) FILTER (WHERE x.status = 'paid')::int AS nb_paid,
                  COUNT(*) FILTER (WHERE x.status IN ('pending','partial')
                                     AND x.due_date < CURRENT_DATE)::int AS nb_overdue,
                  MIN(x.due_date) FILTER (WHERE x.status IN ('pending','partial')) AS next_due_date
             FROM scheduled_payments x WHERE x.debt_id = d.id
         ) sp ON true
         ${where}
         ORDER BY sp.next_due_date ASC NULLS LAST, d.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Cree une dette autonome et son echeancier.
   * `installments = 1` -> une dette a echeance unique (pas d'etalement).
   */
  async createDebt(data: {
    label: string;
    totalAmount: number;
    installments: number;
    firstDueDate: string;
    intervalMonths?: number;
    supplierId?: string | null;
    categoryId?: string | null;
    fixedAssetId?: string | null;
    startDate?: string;
    expectedPaymentMode?: string | null;
    notes?: string | null;
    storeId?: string | null;
    createdBy: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const debt = await client.query(
        `INSERT INTO debts (label, supplier_id, category_id, fixed_asset_id,
                            total_amount, start_date, notes, store_id, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9) RETURNING *`,
        [data.label, data.supplierId || null, data.categoryId || null, data.fixedAssetId || null,
         data.totalAmount, data.startDate || null, data.notes || null,
         data.storeId || null, data.createdBy]
      );

      const echeances = await insertInstallments(client, {
        sourceKind: 'debt',
        sourceId: debt.rows[0].id,
        baseLabel: data.label,
        supplierId: data.supplierId || null,
        categoryId: data.categoryId || null,
        storeId: data.storeId || null,
        total: data.totalAmount,
        installments: data.installments,
        firstDueDate: data.firstDueDate,
        intervalMonths: data.intervalMonths ?? 1,
        expectedPaymentMode: data.expectedPaymentMode ?? null,
        notes: null,
        createdBy: data.createdBy,
      });

      await client.query('COMMIT');
      return { ...debt.rows[0], schedule: echeances };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Supprime une dette autonome. Refuse si un reglement a deja ete enregistre :
   * la trace comptable prime, on annule (status='cancelled') dans ce cas.
   */
  async deleteDebt(id: string) {
    const paid = await db.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM scheduled_payments WHERE debt_id = $1`,
      [id]
    );
    if (parseFloat(paid.rows[0].paid) > 0) {
      throw httpError(
        'Cette dette a déjà reçu des règlements : elle ne peut pas être supprimée. '
        + 'Annulez-la plutôt pour la sortir du suivi.', 409
      );
    }
    await db.query(`DELETE FROM debts WHERE id = $1`, [id]);
    return { deleted: true };
  },

  async updateDebtStatus(id: string, status: 'active' | 'cancelled') {
    const result = await db.query(
      `UPDATE debts SET status = $1 WHERE id = $2 RETURNING *`, [status, id]
    );
    // Une dette annulee sort de l'echeancier : ses echeances ouvertes aussi.
    if (status === 'cancelled') {
      await db.query(
        `UPDATE scheduled_payments SET status = 'cancelled'
          WHERE debt_id = $1 AND status IN ('pending', 'partial')`, [id]
      );
    }
    return result.rows[0] || null;
  },

  /* ══════════════════════ CHARGES FIXES RECURRENTES ══════════════════════ */

  async findRecurringCharges(params: { storeId?: string; includeInactive?: boolean }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (!params.includeInactive) conditions.push('rc.is_active');
    if (params.storeId) { conditions.push(`(rc.store_id IS NULL OR rc.store_id = $${i++})`); values.push(params.storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT rc.*, ec.name AS category_name, s.name AS supplier_name,
              nxt.due_date  AS next_due_date,
              nxt.id        AS next_schedule_id,
              COALESCE(ov.nb, 0) AS overdue_count
         FROM recurring_charges rc
         LEFT JOIN expense_categories ec ON ec.id = rc.category_id
         LEFT JOIN suppliers s           ON s.id = rc.supplier_id
         LEFT JOIN LATERAL (
           SELECT sp.id, sp.due_date FROM scheduled_payments sp
            WHERE sp.recurring_charge_id = rc.id AND sp.status IN ('pending','partial')
            ORDER BY sp.due_date LIMIT 1
         ) nxt ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS nb FROM scheduled_payments sp
            WHERE sp.recurring_charge_id = rc.id AND sp.status IN ('pending','partial')
              AND sp.due_date < CURRENT_DATE
         ) ov ON true
         ${where}
         ORDER BY rc.is_active DESC, rc.label`,
      values
    );
    return result.rows;
  },

  async createRecurringCharge(data: {
    label: string; categoryId: string; supplierId?: string | null;
    amount?: number | null; intervalMonths?: number; dueDay?: number;
    startDate?: string; endDate?: string | null;
    expectedPaymentMode?: string | null; notes?: string | null;
    storeId?: string | null; createdBy: string;
  }) {
    const result = await db.query(
      `INSERT INTO recurring_charges (label, category_id, supplier_id, amount,
              interval_months, due_day, start_date, end_date,
              expected_payment_mode, notes, store_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9,$10,$11,$12)
       RETURNING *`,
      [data.label, data.categoryId, data.supplierId || null, data.amount ?? null,
       data.intervalMonths ?? 1, data.dueDay ?? 1, data.startDate || null, data.endDate || null,
       data.expectedPaymentMode || null, data.notes || null, data.storeId || null, data.createdBy]
    );
    // Materialise immediatement les echeances du modele qu'on vient de creer.
    await db.query('SELECT fn_generate_recurring_schedules($1)', [HORIZON_DAYS]);
    return result.rows[0];
  },

  /**
   * Met a jour un modele. Les echeances DEJA generees ne bougent pas (une
   * hausse de loyer ne doit pas reecrire les mois passes) ; on nettoie
   * seulement les echeances futures non reglees pour qu'elles soient
   * regenerees avec les nouveaux parametres.
   */
  async updateRecurringCharge(id: string, data: {
    label?: string; categoryId?: string; supplierId?: string | null;
    amount?: number | null; intervalMonths?: number; dueDay?: number;
    startDate?: string; endDate?: string | null;
    expectedPaymentMode?: string | null; notes?: string | null; isActive?: boolean;
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    const map: Record<string, unknown> = {
      label: data.label, category_id: data.categoryId, supplier_id: data.supplierId,
      amount: data.amount, interval_months: data.intervalMonths, due_day: data.dueDay,
      start_date: data.startDate, end_date: data.endDate,
      expected_payment_mode: data.expectedPaymentMode, notes: data.notes,
      is_active: data.isActive,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { sets.push(`${col} = $${i++}`); values.push(val); }
    }
    if (!sets.length) {
      const cur = await db.query('SELECT * FROM recurring_charges WHERE id = $1', [id]);
      return cur.rows[0] || null;
    }
    values.push(id);
    const result = await db.query(
      `UPDATE recurring_charges SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values
    );

    await db.query(
      `DELETE FROM scheduled_payments
        WHERE recurring_charge_id = $1 AND amount_paid = 0
          AND status <> 'cancelled' AND due_date > CURRENT_DATE`,
      [id]
    );
    await db.query('SELECT fn_generate_recurring_schedules($1)', [HORIZON_DAYS]);
    return result.rows[0] || null;
  },

  /**
   * Supprime un modele. Les echeances deja reglees sont conservees (trace
   * comptable) et deviennent orphelines du modele -> on refuse la suppression
   * dans ce cas et on desactive a la place.
   */
  async deleteRecurringCharge(id: string) {
    const paid = await db.query(
      `SELECT COUNT(*)::int AS n FROM scheduled_payments
        WHERE recurring_charge_id = $1 AND amount_paid > 0`, [id]
    );
    if (paid.rows[0].n > 0) {
      throw httpError(
        'Cette charge fixe a déjà des échéances réglées : désactivez-la '
        + 'au lieu de la supprimer (l\'historique doit rester).', 409
      );
    }
    await db.query('DELETE FROM recurring_charges WHERE id = $1', [id]);
    return { deleted: true };
  },

  /* ══════════════════════ EDITION D'UNE ECHEANCE ══════════════════════ */

  /**
   * Renseigne / corrige le montant d'une echeance (cas type : la facture
   * d'electricite arrive, on saisit son montant sur l'echeance generee vide).
   */
  async updateScheduled(id: string, data: {
    amountDue?: number | null; dueDate?: string; notes?: string | null;
    expectedPaymentMode?: string | null; status?: 'pending' | 'cancelled';
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    const map: Record<string, unknown> = {
      amount_due: data.amountDue, due_date: data.dueDate, notes: data.notes,
      expected_payment_mode: data.expectedPaymentMode, status: data.status,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { sets.push(`${col} = $${i++}`); values.push(val); }
    }
    if (!sets.length) return this.findById(id);

    // Baisser le montant du en dessous de ce qui est deja regle rendrait
    // l'echeance incoherente (reste a payer negatif).
    if (data.amountDue !== undefined && data.amountDue !== null) {
      const cur = await db.query('SELECT amount_paid FROM scheduled_payments WHERE id = $1', [id]);
      if (cur.rows[0] && data.amountDue < parseFloat(cur.rows[0].amount_paid) - 0.01) {
        throw httpError(
          `Montant inférieur au déjà réglé (${parseFloat(cur.rows[0].amount_paid).toFixed(2)} DH).`, 400
        );
      }
    }

    values.push(id);
    const result = await db.query(
      `UPDATE scheduled_payments SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    // Le montant du a change -> le statut derive doit suivre.
    if (data.amountDue !== undefined) {
      await db.query('SELECT fn_recompute_scheduled_payment($1)', [id]);
      return this.findById(id);
    }
    return result.rows[0] || null;
  },
};

/* ══════════════════════ helpers internes ══════════════════════ */

function httpError(message: string, statusCode: number): Error & { statusCode?: number } {
  const e: Error & { statusCode?: number } = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/**
 * Insere les N echeances d'un plan (facture ou dette) dans la transaction
 * courante. Le dernier terme absorbe l'arrondi (cf. splitInstallments).
 */
async function insertInstallments(client: PoolClient, opts: {
  sourceKind: 'invoice' | 'debt';
  sourceId: string;
  baseLabel: string;
  supplierId: string | null;
  categoryId: string | null;
  storeId: string | null;
  total: number;
  installments: number;
  firstDueDate: string;
  intervalMonths: number;
  expectedPaymentMode: string | null;
  notes: string | null;
  createdBy: string;
}) {
  const n = Math.max(1, Math.floor(opts.installments));
  const parts = splitInstallments(opts.total, n);
  const col = opts.sourceKind === 'invoice' ? 'invoice_id' : 'debt_id';
  const rows = [];
  for (let k = 0; k < n; k++) {
    const due = addMonthsClamped(opts.firstDueDate, k * opts.intervalMonths);
    const label = n > 1 ? `${opts.baseLabel} — échéance ${k + 1}/${n}` : opts.baseLabel;
    const res = await client.query(
      `INSERT INTO scheduled_payments (source_kind, ${col}, label, supplier_id, category_id,
              due_date, amount_due, installment_no, installment_total,
              expected_payment_mode, notes, store_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [opts.sourceKind, opts.sourceId, label, opts.supplierId, opts.categoryId,
       due, parts[k], k + 1, n, opts.expectedPaymentMode, opts.notes,
       opts.storeId, opts.createdBy]
    );
    rows.push(res.rows[0]);
  }
  return rows;
}
