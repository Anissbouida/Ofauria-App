import { db, withTransaction } from '../config/database.js';
import { computeProgressBilling, progressRegressions } from '@ofauria/shared';
import { invoiceRepository } from './accounting.repository.js';

/**
 * Situations de travaux (facturation à l'avancement, mig 713, feuille de route étape 3.3).
 * Le marché est un devis accepté ou converti ; ses lignes « article » et « libres » sont les
 * ouvrages, ses sections les lots. Une situation fixe le % cumulé de chaque ouvrage.
 */
export class ProgressBillingError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

type QuoteRow = {
  id: string; number: string; status: string; customer_id: string | null; title: string | null;
  retention_pct: string; advance_amount: string; advance_recovery_pct: string;
};

const BILLABLE_QUOTE = ['accepted', 'converted'];

async function quoteFor(quoteId: string): Promise<QuoteRow> {
  const q = (await db.query(
    `SELECT id, number, status, customer_id, title, retention_pct, advance_amount, advance_recovery_pct FROM quotes WHERE id = $1`,
    [quoteId])).rows[0] as QuoteRow | undefined;
  if (!q) throw new ProgressBillingError('Marché introuvable', 404);
  if (!BILLABLE_QUOTE.includes(q.status)) throw new ProgressBillingError('Seul un devis accepté peut être facturé à l’avancement');
  return q;
}

/** Ouvrages du marché (lignes du devis), rangés sous leur lot (section précédente). */
async function workItems(quoteId: string) {
  const rows = (await db.query(
    `SELECT id, line_type, description, tva_rate, subtotal, display_order
       FROM quote_items WHERE quote_id = $1 ORDER BY display_order, id`, [quoteId])).rows;
  let lot: string | null = null;
  const items: { quoteItemId: string; lot: string | null; label: string; contractAmount: number; tvaRate: number }[] = [];
  for (const r of rows) {
    if (r.line_type === 'section') { lot = r.description; continue; }
    items.push({ quoteItemId: r.id, lot, label: r.description ?? '', contractAmount: Number(r.subtotal), tvaRate: Number(r.tva_rate ?? 0) });
  }
  return items;
}

/** Dernière situation validée : cumul par ouvrage et avance déjà remboursée. */
async function previousState(quoteId: string) {
  const last = (await db.query(
    `SELECT id, situation_no FROM progress_billings WHERE quote_id = $1 AND status = 'validated' ORDER BY situation_no DESC LIMIT 1`,
    [quoteId])).rows[0];
  const recovered = Number((await db.query(
    `SELECT COALESCE(SUM(advance_recovery_amount), 0) AS v FROM progress_billings WHERE quote_id = $1 AND status = 'validated'`,
    [quoteId])).rows[0].v);
  const byItem = new Map<string, { amount: number; pct: number }>();
  if (last) {
    for (const l of (await db.query(
      `SELECT quote_item_id, amount_cumulative, pct_cumulative FROM progress_billing_lines WHERE billing_id = $1`, [last.id])).rows) {
      byItem.set(l.quote_item_id, { amount: Number(l.amount_cumulative), pct: Number(l.pct_cumulative) });
    }
  }
  return { lastNo: Number(last?.situation_no ?? 0), nextNo: Number(last?.situation_no ?? 0) + 1, recovered, byItem };
}

export const progressBillingRepository = {
  /** Marchés facturables (devis acceptés ou convertis) avec leur avancement. */
  async contracts() {
    return (await db.query(
      `SELECT q.id, q.number, q.title, q.status, q.subtotal::float8 AS contract_ht, q.retention_pct::float8, q.advance_amount::float8,
              q.advance_recovery_pct::float8,
              COALESCE(c.company_name, NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), ''), q.prospect_company, q.prospect_name) AS customer_name,
              (SELECT COUNT(*)::int FROM progress_billings b WHERE b.quote_id = q.id AND b.status = 'validated') AS situations,
              COALESCE((SELECT b.cumulative_ht::float8 FROM progress_billings b WHERE b.quote_id = q.id AND b.status = 'validated'
                ORDER BY b.situation_no DESC LIMIT 1), 0) AS cumulative_ht,
              (SELECT COALESCE(SUM(b.retention_amount), 0)::float8 FROM progress_billings b WHERE b.quote_id = q.id AND b.status = 'validated') AS retention_held,
              EXISTS (SELECT 1 FROM progress_billings b WHERE b.quote_id = q.id AND b.status = 'draft') AS has_draft
         FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.status IN ('accepted', 'converted')
        ORDER BY q.quote_date DESC, q.number DESC`)).rows;
  },

  async list(quoteId?: string) {
    const params: unknown[] = [];
    const where = quoteId ? (params.push(quoteId), `WHERE b.quote_id = $1 AND b.status <> 'cancelled'`) : `WHERE b.status <> 'cancelled'`;
    return (await db.query(
      `SELECT b.*, q.number AS quote_number, q.title AS quote_title
         FROM progress_billings b JOIN quotes q ON q.id = b.quote_id ${where}
        ORDER BY b.situation_no DESC, b.created_at DESC`, params)).rows;
  },

  async get(id: string) {
    const b = (await db.query(
      `SELECT b.*, q.number AS quote_number, q.title AS quote_title FROM progress_billings b JOIN quotes q ON q.id = b.quote_id WHERE b.id = $1`,
      [id])).rows[0];
    if (!b) throw new ProgressBillingError('Situation introuvable', 404);
    const lines = (await db.query(
      `SELECT l.* FROM progress_billing_lines l JOIN quote_items qi ON qi.id = l.quote_item_id
        WHERE l.billing_id = $1 ORDER BY qi.display_order, qi.id`, [id])).rows;
    return { ...b, lines };
  },

  /** Base de la prochaine situation : ouvrages, cumul précédent, réglages du marché. */
  async prepare(quoteId: string) {
    const q = await quoteFor(quoteId);
    const [items, prev] = await Promise.all([workItems(quoteId), previousState(quoteId)]);
    return {
      quote: { id: q.id, number: q.number, title: q.title },
      situationNo: prev.nextNo,
      settings: { retentionPct: Number(q.retention_pct), advanceAmount: Number(q.advance_amount), advanceRecoveryPct: Number(q.advance_recovery_pct), advanceRecoveredBefore: prev.recovered },
      items: items.map(i => ({ ...i, previousCumulative: prev.byItem.get(i.quoteItemId)?.amount ?? 0, previousPct: prev.byItem.get(i.quoteItemId)?.pct ?? 0 })),
    };
  },

  /** Conditions du marché : retenue de garantie, avance de démarrage et son remboursement. */
  async setTerms(quoteId: string, t: { retentionPct: number; advanceAmount: number; advanceRecoveryPct: number }) {
    await quoteFor(quoteId);
    const validated = (await db.query(`SELECT 1 FROM progress_billings WHERE quote_id = $1 AND status = 'validated' LIMIT 1`, [quoteId])).rowCount;
    if (validated) throw new ProgressBillingError('Une situation est déjà validée : les conditions du marché sont figées');
    if (![t.retentionPct, t.advanceRecoveryPct].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) throw new ProgressBillingError('Taux attendu entre 0 et 100');
    if (!(Number.isFinite(t.advanceAmount) && t.advanceAmount >= 0)) throw new ProgressBillingError('Avance attendue positive ou nulle');
    await db.query(`UPDATE quotes SET retention_pct = $2, advance_amount = $3, advance_recovery_pct = $4, updated_at = now() WHERE id = $1`,
      [quoteId, t.retentionPct, t.advanceAmount, t.advanceRecoveryPct]);
    await db.query(`DELETE FROM progress_billings WHERE quote_id = $1 AND status = 'draft'`, [quoteId]);
  },

  /** Crée (ou remplace) la situation en préparation du marché. */
  async saveDraft(quoteId: string, data: { periodEnd: string; notes?: string | null; lines: { quoteItemId: string; pctCumulative: number }[] }, userId: string) {
    return withTransaction(async () => {
      const base = await this.prepare(quoteId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.periodEnd ?? '')) throw new ProgressBillingError('Date de fin de période attendue (AAAA-MM-JJ)');
      const known = new Set(base.items.map(i => i.quoteItemId));
      if (data.lines.some(l => !known.has(l.quoteItemId))) throw new ProgressBillingError('Ouvrage inconnu pour ce marché');
      const wanted = new Map(data.lines.map(l => [l.quoteItemId, Number(l.pctCumulative)]));
      const rows = base.items.map(i => ({ ...i, pctCumulative: wanted.get(i.quoteItemId) ?? i.previousPct }));
      if (rows.some(r => !(Number.isFinite(r.pctCumulative) && r.pctCumulative >= 0 && r.pctCumulative <= 100))) throw new ProgressBillingError('Avancement attendu entre 0 et 100 %');
      const back = progressRegressions(rows);
      if (back.length) throw new ProgressBillingError(`L'avancement ne peut pas reculer : ${back.join(', ')}`);
      const calc = computeProgressBilling(rows, base.settings);
      await db.query(`DELETE FROM progress_billings WHERE quote_id = $1 AND status = 'draft'`, [quoteId]);
      // Une situation annulée garde son numéro : on numérote après la plus haute existante.
      const n = Number((await db.query(`SELECT COALESCE(MAX(situation_no), 0) AS n FROM progress_billings WHERE quote_id = $1`, [quoteId])).rows[0].n) + 1;
      const situationNo = Math.max(base.situationNo, n);
      const b = (await db.query(
        `INSERT INTO progress_billings (number, quote_id, situation_no, period_end, status, retention_pct, advance_recovery_pct,
            contract_ht, cumulative_ht, previous_ht, period_ht, retention_amount, advance_recovery_amount, net_ht, tax_amount, total_ttc, notes, created_by)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [`${base.quote.number}-S${situationNo}`, quoteId, situationNo, data.periodEnd, base.settings.retentionPct, base.settings.advanceRecoveryPct,
         calc.contractHt, calc.cumulativeHt, calc.previousHt, calc.periodHt, calc.retentionAmount, calc.advanceRecoveryAmount,
         calc.netHt, calc.taxAmount, calc.totalTtc, data.notes?.trim() || null, userId])).rows[0];
      for (const [i, r] of rows.entries()) {
        const c = calc.lines[i];
        await db.query(
          `INSERT INTO progress_billing_lines (billing_id, quote_item_id, label, contract_amount, tva_rate, pct_cumulative, amount_cumulative, amount_previous, amount_period)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [b.id, r.quoteItemId, r.lot ? `${r.lot} — ${r.label}` : r.label, r.contractAmount, r.tvaRate, r.pctCumulative, c.amountCumulative, c.amountPrevious, c.amountPeriod]);
      }
      return this.get(b.id);
    });
  },

  /** Valide la situation : ses cumuls deviennent la base de la suivante. */
  async validate(id: string, userId: string) {
    return withTransaction(async () => {
      const b = (await db.query(`SELECT * FROM progress_billings WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!b) throw new ProgressBillingError('Situation introuvable', 404);
      if (b.status !== 'draft') throw new ProgressBillingError('Seule une situation en préparation se valide');
      const prev = await previousState(b.quote_id);
      if (Number(b.previous_ht) !== Number((await db.query(
        `SELECT COALESCE((SELECT cumulative_ht FROM progress_billings WHERE quote_id = $1 AND status = 'validated' ORDER BY situation_no DESC LIMIT 1), 0) AS v`,
        [b.quote_id])).rows[0].v) || prev.lastNo >= b.situation_no) {
        throw new ProgressBillingError('Une autre situation a été validée entre-temps : enregistrez de nouveau', 409);
      }
      if (Number(b.period_ht) === 0) throw new ProgressBillingError('Aucun avancement sur la période');
      await db.query(`UPDATE progress_billings SET status = 'validated', validated_by = $2, validated_at = now() WHERE id = $1`, [id, userId]);
      return this.get(id);
    });
  },

  /**
   * Facture la situation validée (mig 725) : facture client émise, une ligne par ouvrage au net
   * de la période (après retenue et remboursement d'avance), TVA et TTC de la situation.
   */
  async invoice(id: string, userId: string) {
    return withTransaction(async () => {
      const b = (await db.query(
        `SELECT b.*, q.customer_id, q.number AS quote_number, q.store_id,
                (SELECT COALESCE(delai_paiement_jours, 0) FROM customers c WHERE c.id = q.customer_id) AS term
           FROM progress_billings b JOIN quotes q ON q.id = b.quote_id WHERE b.id = $1 FOR UPDATE OF b`, [id])).rows[0];
      if (!b) throw new ProgressBillingError('Situation introuvable', 404);
      if (b.status !== 'validated') throw new ProgressBillingError('Seule une situation validée se facture');
      if (b.invoice_id) throw new ProgressBillingError('Cette situation est déjà facturée', 409);
      if (!b.customer_id) throw new ProgressBillingError('Le marché n’a pas de client enregistré : rattachez le devis à un client avant de facturer');
      const lines = (await db.query(`SELECT * FROM progress_billing_lines WHERE billing_id = $1 AND amount_period <> 0`, [id])).rows;
      const periodHt = Number(b.period_ht);
      const share = periodHt !== 0 ? Number(b.net_ht) / periodHt : 0;
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const items = lines.map(l => {
        const net = r2(Number(l.amount_period) * share);
        return { description: `${l.label} — avancement ${Number(l.pct_cumulative)} %`, quantity: 1, unitPrice: net, subtotal: net, tvaRate: Number(l.tva_rate) || null };
      });
      // Arrondis : la dernière ligne absorbe l'écart pour retomber sur le net HT de la situation.
      const diff = r2(Number(b.net_ht) - items.reduce((s, i) => s + i.subtotal, 0));
      if (items.length && diff !== 0) { const last = items[items.length - 1]; last.unitPrice = r2(last.unitPrice + diff); last.subtotal = last.unitPrice; }
      const date = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + Number(b.term || 0) * 86400000).toISOString().slice(0, 10);
      const inv = await invoiceRepository.create({
        invoiceType: 'emitted', customerId: b.customer_id, invoiceDate: date, dueDate: due,
        amount: Number(b.net_ht), taxAmount: Number(b.tax_amount), totalAmount: Number(b.total_ttc), items,
        notes: `Situation de travaux ${b.number} (marché ${b.quote_number}) — travaux de la période ${Number(b.period_ht).toFixed(2)} HT, `
          + `retenue de garantie ${Number(b.retention_amount).toFixed(2)}, remboursement d'avance ${Number(b.advance_recovery_amount).toFixed(2)}.`,
        createdBy: userId, storeId: b.store_id ?? undefined,
      });
      await db.query(`UPDATE progress_billings SET invoice_id = $2 WHERE id = $1`, [id, inv.id]);
      return this.get(id);
    });
  },

  async cancel(id: string) {
    const r = await db.query(`UPDATE progress_billings SET status = 'cancelled' WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
    if (!r.rowCount) throw new ProgressBillingError('Seule une situation en préparation s’annule');
  },
};
