import { db, withTransaction } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { approvalService } from '../services/approval.service.js';
import { buildTransferCsv, formatRib, normalizeRib, ribKeyValid, type TransferLine } from '../services/salary-transfer.js';
import { enqueueEmail } from '../services/mailer.js';
import { currencySymbol } from '../services/currency.js';

/**
 * Paiements fournisseurs en lot (G4-01, mig 543).
 *
 * Analogie Oracle : le « Payment Batch » d'Oracle Payables — sélection des factures,
 * revue et approbation, formatage du fichier banque, confirmation.
 *
 *   candidates()  factures payables jusqu'à une date, avec leur reste à payer et le RIB
 *   create()      campagne en brouillon : lignes contrôlées, RIB figé, total
 *   submit()      contrôles (RIB valides) puis approbation (moteur d'approbation, règle
 *                 « payment_run » ; sans règle applicable : approuvée directement)
 *   transferFile()  CSV pour le portail de la banque ; la campagne passe « fichier édité »
 *   execute()     UN règlement par ligne, par le chemin habituel (écriture comptable,
 *                 lettrage, reste à payer de la facture), tout ou rien ; avis par e-mail
 *   rejectLine()  ligne rejetée par la banque : le règlement est annulé (contre-pièce)
 *
 * Une facture est PAYABLE si elle est reçue, validée, ni soldée, ni annulée, ni en
 * litige, sans blocage de paiement, en dirhams (une facture en devise se règle au taux du
 * jour, hors lot), avec un reste à payer.
 */
type Line = { invoiceId: string; amount: number };
type RunLine = {
  id: string; invoice_id: string; supplier_id: string; rib: string | null; bank_name: string | null; amount: number; status: string;
  payment_id: string | null; invoice_number: string; supplier_name: string; ribValid: boolean;
};
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Campagnes encore ouvertes : une facture ne peut être que dans une seule. */
const OPEN = `('draft', 'pending_approval', 'approved', 'file_generated')`;

const PAYABLE = `
  i.invoice_type = 'received' AND i.validation_status = 'validated'
  AND i.status NOT IN ('paid', 'cancelled', 'disputed')
  AND COALESCE(i.currency_code, fn_base_currency()) = fn_base_currency()
  AND i.total_amount - COALESCE(i.paid_amount, 0) > 0.005
  AND NOT EXISTS (SELECT 1 FROM invoice_holds h WHERE h.invoice_id = i.id AND h.released_at IS NULL AND h.blocks_payment)`;

export const paymentRunRepository = {
  /** Factures payables échues au plus tard à `dueBefore` (sans échéance comprises). */
  async candidates(opts: { dueBefore: string; storeId?: string | null }) {
    return (await db.query(
      `SELECT i.id AS invoice_id, i.invoice_number, i.supplier_invoice_number, i.invoice_date::text AS invoice_date,
              i.due_date::text AS due_date, i.total_amount::float8 AS total_amount,
              ROUND(i.total_amount - COALESCE(i.paid_amount, 0), 2)::float8 AS remaining,
              s.id AS supplier_id, s.name AS supplier_name, s.rib, s.bank_name, s.email AS supplier_email,
              (SELECT r.run_number FROM payment_run_lines l JOIN payment_runs r ON r.id = l.run_id
                WHERE l.invoice_id = i.id AND l.status = 'pending' AND r.status IN ${OPEN} LIMIT 1) AS open_run
         FROM invoices i
         JOIN suppliers s ON s.id = i.supplier_id
        WHERE ${PAYABLE}
          AND (i.due_date IS NULL OR i.due_date::date <= $1::date)
          AND ($2::uuid IS NULL OR i.store_id IS NULL OR i.store_id = $2::uuid)
        ORDER BY s.name, i.due_date NULLS LAST, i.invoice_number`, [opts.dueBefore, opts.storeId ?? null])).rows.map(r => {
      const rib = normalizeRib(r.rib);
      return { ...r, rib, ribValid: rib ? ribKeyValid(rib) : false };
    });
  },

  async list(limit = 50) {
    return (await db.query(
      `SELECT r.id, r.run_number, r.payment_date::text AS payment_date, r.status, r.total_amount::float8 AS total_amount,
              r.created_at, r.executed_at, t.label AS treasury_label,
              (SELECT COUNT(*) FROM payment_run_lines l WHERE l.run_id = r.id)::int AS lines,
              (SELECT COUNT(*) FROM payment_run_lines l WHERE l.run_id = r.id AND l.status = 'rejected')::int AS rejected,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS created_by_name
         FROM payment_runs r
         JOIN treasury_accounts t ON t.id = r.treasury_account_id
         LEFT JOIN users u ON u.id = r.created_by
        ORDER BY r.created_at DESC LIMIT $1`, [limit])).rows;
  },

  async get(id: string) {
    const run = (await db.query(
      `SELECT r.*, r.payment_date::text AS payment_date, r.total_amount::float8 AS total_amount,
              t.label AS treasury_label, t.kind AS treasury_kind, t.bank_name AS treasury_bank, t.iban AS treasury_iban
         FROM payment_runs r JOIN treasury_accounts t ON t.id = r.treasury_account_id WHERE r.id = $1`, [id])).rows[0];
    if (!run) return null;
    const lines = (await db.query(
      `SELECT l.id, l.invoice_id, l.supplier_id, l.rib, l.bank_name, l.amount::float8 AS amount, l.status, l.payment_id,
              l.reject_reason, l.rejected_at, i.invoice_number, i.supplier_invoice_number, i.due_date::text AS due_date,
              s.name AS supplier_name
         FROM payment_run_lines l
         JOIN invoices i ON i.id = l.invoice_id
         JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.run_id = $1 ORDER BY s.name, i.invoice_number`, [id])).rows.map(l => {
      const rib = normalizeRib(l.rib);
      return { ...l, ribValid: rib ? ribKeyValid(rib) : false } as RunLine;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...run, lines } as Record<string, any> & { lines: RunLine[] };
  },

  /** Crée une campagne en brouillon. Chaque ligne est contrôlée ; un refus annule tout. */
  async create(input: { paymentDate: string; treasuryAccountId: string; lines: Line[]; notes?: string | null; userId: string; storeId?: string | null }) {
    if (!input.lines.length) throw bad('Sélectionnez au moins une facture');
    return withTransaction(async () => {
      // Un seul préparateur à la fois : la règle « une facture, une campagne ouverte » tient.
      await db.query(`SELECT pg_advisory_xact_lock(hashtext('payment_runs'))`);
      const account = (await db.query(`SELECT kind, is_active FROM treasury_accounts WHERE id = $1`, [input.treasuryAccountId])).rows[0];
      if (!account || !account.is_active) throw bad('Compte de trésorerie introuvable');
      if (account.kind !== 'bank') throw bad('Un virement part d\'un compte bancaire, pas de la caisse');

      const ids = input.lines.map(l => l.invoiceId);
      if (new Set(ids).size !== ids.length) throw bad('Une facture apparaît deux fois');
      const invoices = new Map((await db.query(
        `SELECT i.id, i.invoice_number, i.supplier_id, s.rib, s.bank_name,
                ROUND(i.total_amount - COALESCE(i.paid_amount, 0), 2)::float8 AS remaining, (${PAYABLE}) AS payable
           FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
          WHERE i.id = ANY($1) FOR UPDATE OF i`, [ids])).rows.map(r => [r.id as string, r]));
      const taken = new Map((await db.query(
        `SELECT l.invoice_id, r.run_number FROM payment_run_lines l JOIN payment_runs r ON r.id = l.run_id
          WHERE l.invoice_id = ANY($1) AND l.status = 'pending' AND r.status IN ${OPEN}`, [ids])).rows.map(r => [r.invoice_id as string, r.run_number as string]));

      for (const l of input.lines) {
        const inv = invoices.get(l.invoiceId);
        if (!inv) throw bad('Facture introuvable');
        if (!inv.payable) throw conflict(`La facture ${inv.invoice_number} n'est pas payable (non validée, soldée, en litige, bloquée ou en devise)`);
        if (taken.has(l.invoiceId)) throw conflict(`La facture ${inv.invoice_number} est déjà dans la campagne ${taken.get(l.invoiceId)}`);
        const amount = round2(Number(l.amount));
        if (!(amount > 0)) throw bad(`Montant invalide pour la facture ${inv.invoice_number}`);
        if (amount > inv.remaining + 0.005) throw conflict(`Le montant dépasse le reste à payer de la facture ${inv.invoice_number} (${inv.remaining.toFixed(2)} ${currencySymbol()})`);
      }

      const day = input.paymentDate.replace(/-/g, '');
      const seq = Number((await db.query(`SELECT COUNT(*) AS n FROM payment_runs WHERE run_number LIKE $1`, [`CP-${day}-%`])).rows[0].n) + 1;
      const total = round2(input.lines.reduce((t, l) => t + Number(l.amount), 0));
      const run = (await db.query(
        `INSERT INTO payment_runs (run_number, payment_date, treasury_account_id, total_amount, notes, store_id, created_by)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7) RETURNING id`,
        [`CP-${day}-${String(seq).padStart(2, '0')}`, input.paymentDate, input.treasuryAccountId, total, input.notes ?? null, input.storeId ?? null, input.userId])).rows[0];
      for (const l of input.lines) {
        const inv = invoices.get(l.invoiceId)!;
        await db.query(
          `INSERT INTO payment_run_lines (run_id, invoice_id, supplier_id, rib, bank_name, amount) VALUES ($1, $2, $3, $4, $5, $6::numeric)`,
          [run.id, l.invoiceId, inv.supplier_id, normalizeRib(inv.rib), inv.bank_name, round2(Number(l.amount))]);
      }
      return run.id as string;
    });
  },

  /** Contrôles puis approbation. Sans règle d'approbation applicable : approuvée directement. */
  async submit(id: string, userId: string) {
    const run = await this.get(id);
    if (!run) throw Object.assign(new Error('Campagne introuvable'), { statusCode: 404 });
    if (run.status !== 'draft') throw conflict('Seule une campagne en brouillon se soumet');
    const badRib = run.lines.filter(l => !l.ribValid).map(l => l.supplier_name as string);
    if (badRib.length) throw conflict(`RIB absent ou invalide pour : ${[...new Set(badRib)].join(', ')}. Complétez la fiche fournisseur, puis recréez la campagne.`);
    const approval = await approvalService.submit({
      docType: 'payment_run', docId: id, docLabel: `Campagne ${run.run_number} — ${run.lines.length} facture(s)`,
      amount: run.total_amount, values: { amount: run.total_amount, lines: run.lines.length }, requestedBy: userId, storeId: run.store_id,
    });
    if (approval.outcome === 'not_required') {
      await db.query(`UPDATE payment_runs SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, userId]);
      return { status: 'approved' as const };
    }
    await db.query(`UPDATE payment_runs SET status = 'pending_approval' WHERE id = $1`, [id]);
    return { status: 'pending_approval' as const };
  },

  /** Effet d'une décision du circuit d'approbation. */
  async decide(id: string, approved: boolean, actorId: string) {
    const r = await db.query(
      `UPDATE payment_runs SET status = $2, approved_by = CASE WHEN $3::boolean THEN $4::uuid END, approved_at = CASE WHEN $3::boolean THEN now() END
        WHERE id = $1 AND status = 'pending_approval' RETURNING id`, [id, approved ? 'approved' : 'draft', approved, actorId]);
    if (!r.rows.length) throw new Error('La campagne n\'est plus en attente d\'approbation');
  },

  /** Lignes du fichier de virement : une par fournisseur, total de ses factures de la campagne. */
  async transferLines(id: string) {
    const run = await this.get(id);
    if (!run) throw Object.assign(new Error('Campagne introuvable'), { statusCode: 404 });
    if (!['approved', 'file_generated', 'executed'].includes(run.status)) throw conflict('Le fichier s\'édite une fois la campagne approuvée');
    const bySupplier = new Map<string, TransferLine>();
    for (const l of run.lines.filter(x => x.status !== 'rejected')) {
      const cur = bySupplier.get(l.supplier_id);
      if (cur) cur.amount = round2(cur.amount + l.amount);
      else bySupplier.set(l.supplier_id, { payrollId: run.id, employeeId: l.supplier_id, name: l.supplier_name, rib: normalizeRib(l.rib), bankName: l.bank_name, amount: l.amount });
    }
    return { run, lines: [...bySupplier.values()] };
  },

  /** CSV pour le portail de la banque ; la campagne passe « fichier édité ». */
  async transferFile(id: string) {
    const { run, lines } = await this.transferLines(id);
    if (run.status === 'approved') await db.query(`UPDATE payment_runs SET status = 'file_generated', file_generated_at = now() WHERE id = $1`, [id]);
    return { filename: `virement_fournisseurs_${run.run_number}.csv`, csv: buildTransferCsv(lines, `REGLEMENT ${run.run_number}`) };
  },

  /** Exécution : un règlement par ligne, tout ou rien ; puis avis de paiement par e-mail. */
  async execute(id: string, user: { userId: string; storeId?: string | null }) {
    const executed = await withTransaction(async () => {
      const run = (await db.query(
        `SELECT *, payment_date::text AS payment_day FROM payment_runs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!run) throw Object.assign(new Error('Campagne introuvable'), { statusCode: 404 });
      if (run.status !== 'file_generated') throw conflict('Éditez le fichier de virement avant d\'exécuter la campagne');
      const lines = (await db.query(
        `SELECT l.*, i.invoice_number FROM payment_run_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.run_id = $1 AND l.status = 'pending' ORDER BY l.created_at`, [id])).rows;
      for (const l of lines) {
        try {
          const payment = await paymentRepository.create({
            invoiceId: l.invoice_id, type: 'invoice', amount: Number(l.amount), supplierId: l.supplier_id,
            paymentMode: 'virement', paymentMethod: 'transfer', paymentDate: run.payment_day, treasuryAccountId: run.treasury_account_id,
            reference: run.run_number, description: `Campagne de paiement ${run.run_number}`,
            createdBy: user.userId, storeId: run.store_id ?? user.storeId ?? undefined,
          });
          await db.query(`UPDATE payment_run_lines SET status = 'paid', payment_id = $2 WHERE id = $1`, [l.id, payment.id]);
        } catch (e) {
          throw Object.assign(new Error(`Facture ${l.invoice_number} : ${(e as Error).message}`), { statusCode: (e as { statusCode?: number }).statusCode ?? 409 });
        }
      }
      await db.query(`UPDATE payment_runs SET status = 'executed', executed_by = $2, executed_at = now() WHERE id = $1`, [id, user.userId]);
      return { runNumber: run.run_number as string, paymentDay: run.payment_day as string, count: lines.length };
    });

    // Avis de paiement par fournisseur (hors transaction : un e-mail en file ne doit pas annuler les règlements).
    const advices = (await db.query(
      `SELECT s.name, s.email, SUM(l.amount)::float8 AS amount,
              string_agg(COALESCE(i.supplier_invoice_number, i.invoice_number), ', ' ORDER BY i.invoice_number) AS invoices
         FROM payment_run_lines l JOIN suppliers s ON s.id = l.supplier_id JOIN invoices i ON i.id = l.invoice_id
        WHERE l.run_id = $1 AND l.status = 'paid' AND COALESCE(s.email, '') <> '' GROUP BY s.id, s.name, s.email`, [id])).rows;
    let queued = 0;
    for (const a of advices) {
      const day = executed.paymentDay.split('-').reverse().join('/');
      await enqueueEmail({
        to: a.email, toName: a.name, type: 'payment_advice', referenceType: 'payment_run', referenceId: id, createdBy: user.userId,
        subject: `Avis de paiement — ${executed.runNumber}`,
        text: `Bonjour,\n\nNous vous informons du virement de ${a.amount.toFixed(2)} ${currencySymbol()} émis le ${day} en règlement de : ${a.invoices}.\n\n`
          + `Référence : ${executed.runNumber}\n\nCordialement.`,
      }).then(() => { queued++; }).catch(() => undefined);
    }
    return { executed: executed.count, advices: queued };
  },

  /** Ligne rejetée par la banque après exécution : le règlement est annulé, la facture redevient à payer. */
  async rejectLine(lineId: string, input: { reasonCodeId: string; note?: string | null; userId: string }) {
    return withTransaction(async () => {
      const l = (await db.query(
        `SELECT l.*, r.status AS run_status FROM payment_run_lines l JOIN payment_runs r ON r.id = l.run_id WHERE l.id = $1 FOR UPDATE OF l`, [lineId])).rows[0];
      if (!l) throw Object.assign(new Error('Ligne introuvable'), { statusCode: 404 });
      if (l.run_status !== 'executed' || l.status !== 'paid') throw conflict('Seule une ligne réglée d\'une campagne exécutée peut être rejetée');
      await paymentRepository.voidPayment(l.payment_id, { reasonCodeId: input.reasonCodeId, note: input.note ?? 'Rejet bancaire', userId: input.userId });
      await db.query(`UPDATE payment_run_lines SET status = 'rejected', reject_reason = $2, rejected_at = now() WHERE id = $1`, [lineId, input.note ?? null]);
      return { ok: true };
    });
  },

  /** Abandon d'une campagne non exécutée. */
  async cancel(id: string, userId: string) {
    const r = await db.query(
      `UPDATE payment_runs SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND status IN ${OPEN} RETURNING id`, [id]);
    if (!r.rows.length) throw conflict('Une campagne exécutée ou déjà annulée ne s\'annule pas');
    await approvalService.cancelPending('payment_run', id, userId, 'Campagne annulée').catch(() => undefined);
  },

  /** Données de la lettre d'ordre (PDF). */
  async orderLetter(id: string) {
    const { run, lines } = await this.transferLines(id);
    const iban = normalizeRib(run.treasury_iban);
    return {
      run, lines: lines.map(l => ({ name: l.name, rib: formatRib(l.rib ?? ''), bank: l.bankName, amount: l.amount })),
      total: round2(lines.reduce((t, l) => t + l.amount, 0)), employerRib: iban ? formatRib(iban) : null, employerBank: run.treasury_bank ?? null,
    };
  },
};
