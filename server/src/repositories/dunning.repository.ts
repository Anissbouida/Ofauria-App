import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import { getParameter } from '../services/module-parameters.service.js';
import { enqueueEmail } from '../services/mailer.js';
import { openDocuments, type ReceivableDoc } from './receivables.repository.js';

/**
 * Relances clients (mig 366).
 *
 * Niveau visé = le plus haut niveau actif dont le seuil (jours après échéance) est
 * atteint par la plus ancienne pièce échue du client. Une lettre n'est proposée que si
 * ce niveau dépasse celui des relances déjà émises pour le retard en cours (celles
 * créées depuis l'échéance de la plus ancienne pièce ouverte), et s'il n'y a pas déjà
 * un brouillon pour ce client.
 */

export type DunningSettings = { enabled: boolean; auto_send: boolean; min_amount: number; credit_control: 'warn' | 'block'; auto_release: boolean };
export type DunningLevel = {
  level: number; label: string; days_after_due: number; fee_amount: string; interest_rate: string; subject: string; body: string;
  send_email: boolean; credit_hold: boolean; is_active: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const frDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
const NAME = `COALESCE(NULLIF(c.company_name, ''), NULLIF(concat_ws(' ', c.first_name, c.last_name), ''), 'Client')`;

export async function dunningSettings(): Promise<DunningSettings> {
  const p = await getParameter<Partial<DunningSettings>>('sales.dunning');
  return {
    enabled: p?.enabled !== false, auto_send: !!p?.auto_send, min_amount: Number(p?.min_amount ?? 50) || 0,
    credit_control: p?.credit_control === 'block' ? 'block' : 'warn', auto_release: p?.auto_release !== false,
  };
}

async function activeLevels(): Promise<DunningLevel[]> {
  return (await db.query(`SELECT * FROM dunning_levels WHERE is_active ORDER BY level`)).rows;
}

/** Texte de la lettre : champs remplacés. */
function render(tpl: string, v: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

type Proposal = {
  customerId: string; customerName: string; email: string | null; phone: string | null; creditHold: boolean;
  overdue: number; maxDaysLate: number; lastLevel: number | null; lastDunningAt: string | null;
  targetLevel: number; targetLabel: string; docs: ReceivableDoc[];
};

export const dunningRepository = {
  levels: activeLevels,
  async allLevels(): Promise<DunningLevel[]> {
    return (await db.query(`SELECT * FROM dunning_levels ORDER BY level`)).rows;
  },
  async saveLevel(level: number, d: Partial<{ label: string; daysAfterDue: number; feeAmount: number; interestRate: number; subject: string; body: string; sendEmail: boolean; creditHold: boolean; isActive: boolean }>, userId: string) {
    const r = await db.query(
      `INSERT INTO dunning_levels (level, label, days_after_due, fee_amount, interest_rate, subject, body, send_email, credit_hold, is_active, updated_by)
       VALUES ($1::smallint, COALESCE($2, $12::text), COALESCE($3, 90), COALESCE($4, 0), COALESCE($5, 0), COALESCE($6, 'Relance'), COALESCE($7, '{client},\n\n{pieces}\n\n{societe}'),
               COALESCE($8, true), COALESCE($9, false), COALESCE($10, true), $11)
       ON CONFLICT (level) DO UPDATE SET
         label = COALESCE($2, dunning_levels.label), days_after_due = COALESCE($3, dunning_levels.days_after_due),
         fee_amount = COALESCE($4, dunning_levels.fee_amount), interest_rate = COALESCE($5, dunning_levels.interest_rate),
         subject = COALESCE($6, dunning_levels.subject), body = COALESCE($7, dunning_levels.body),
         send_email = COALESCE($8, dunning_levels.send_email), credit_hold = COALESCE($9, dunning_levels.credit_hold),
         is_active = COALESCE($10, dunning_levels.is_active), updated_by = $11, updated_at = now()
       RETURNING *`,
      [level, d.label ?? null, d.daysAfterDue ?? null, d.feeAmount ?? null, d.interestRate ?? null, d.subject ?? null, d.body ?? null,
       d.sendEmail ?? null, d.creditHold ?? null, d.isActive ?? null, userId, `Niveau ${level}`]);
    return r.rows[0];
  },

  /** Clients à relancer maintenant, avec le niveau visé. */
  async proposals(storeId?: string): Promise<Proposal[]> {
    const [settings, levels] = await Promise.all([dunningSettings(), activeLevels()]);
    if (!levels.length) return [];
    const docs = (await openDocuments({ storeId })).filter(d => d.customer_id);
    const byCustomer = new Map<string, ReceivableDoc[]>();
    for (const d of docs) byCustomer.set(d.customer_id!, [...(byCustomer.get(d.customer_id!) ?? []), d]);
    if (!byCustomer.size) return [];
    const ids = [...byCustomer.keys()];
    const [customers, last, drafts] = await Promise.all([
      db.query(`SELECT c.id, ${NAME} AS name, c.email, c.phone, c.credit_hold, c.dunning_paused_until FROM customers c WHERE c.id = ANY($1::uuid[])`, [ids]),
      db.query(`SELECT DISTINCT ON (customer_id) customer_id, level, dunning_date, created_at FROM dunnings
                 WHERE customer_id = ANY($1::uuid[]) AND status IN ('sent', 'draft') ORDER BY customer_id, level DESC, created_at DESC`, [ids]),
      db.query(`SELECT customer_id FROM dunnings WHERE customer_id = ANY($1::uuid[]) AND status = 'draft'`, [ids]),
    ]);
    const cById = new Map(customers.rows.map(c => [c.id, c]));
    const lastById = new Map(last.rows.map(l => [l.customer_id, l]));
    const draftSet = new Set(drafts.rows.map(d => d.customer_id));
    const today = new Date().toISOString().slice(0, 10);
    const out: Proposal[] = [];
    for (const [cid, list] of byCustomer) {
      const overdueDocs = list.filter(d => d.days_late > 0);
      if (!overdueDocs.length || draftSet.has(cid)) continue;
      const c = cById.get(cid);
      if (!c) continue;
      const paused = c.dunning_paused_until && String(c.dunning_paused_until instanceof Date ? c.dunning_paused_until.toISOString() : c.dunning_paused_until).slice(0, 10) >= today;
      if (paused) continue;
      const overdue = round2(overdueDocs.reduce((s, d) => s + d.remaining, 0));
      if (overdue < settings.min_amount) continue;
      const maxDaysLate = Math.max(...overdueDocs.map(d => d.days_late));
      const target = [...levels].reverse().find(l => maxDaysLate >= l.days_after_due);
      if (!target) continue;
      // Relances du retard en cours : émises depuis l'échéance de la plus ancienne pièce ouverte.
      const oldestDue = overdueDocs.map(d => d.due_date).sort()[0];
      const l = lastById.get(cid);
      const lDate = l ? String(l.dunning_date instanceof Date ? l.dunning_date.toISOString() : l.dunning_date).slice(0, 10) : null;
      const lastLevel = l && lDate! >= oldestDue ? Number(l.level) : null;
      if (lastLevel != null && target.level <= lastLevel) continue;
      out.push({
        customerId: cid, customerName: c.name, email: c.email, phone: c.phone, creditHold: !!c.credit_hold,
        overdue, maxDaysLate, lastLevel, lastDunningAt: lastLevel != null ? lDate : null,
        targetLevel: target.level, targetLabel: target.label, docs: overdueDocs,
      });
    }
    return out.sort((a, b) => b.maxDaysLate - a.maxDaysLate || b.overdue - a.overdue);
  },

  /** Crée la lettre d'un client au niveau visé (ou au niveau imposé). */
  async create(customerId: string, p: { userId: string | null; level?: number; storeId?: string }) {
    const levels = await activeLevels();
    const docs = (await openDocuments({ customerId, storeId: p.storeId })).filter(d => d.days_late > 0);
    if (!docs.length) return { error: 'Ce client n\'a aucune pièce échue' };
    const maxDaysLate = Math.max(...docs.map(d => d.days_late));
    const level = p.level != null ? levels.find(l => l.level === p.level) : [...levels].reverse().find(l => maxDaysLate >= l.days_after_due);
    if (!level) return { error: 'Aucun niveau de relance atteint (voir les niveaux)' };
    const c = (await db.query(`SELECT c.id, ${NAME} AS name, c.email FROM customers c WHERE c.id = $1`, [customerId])).rows[0];
    if (!c) return { error: 'Client introuvable' };
    const legal = await loadCompanyLegal();
    const amount = round2(docs.reduce((s, d) => s + d.remaining, 0));
    const rate = Number(level.interest_rate) || 0;
    const interest = round2(docs.reduce((s, d) => s + d.remaining * rate / 100 * d.days_late / 365, 0));
    const fee = Number(level.fee_amount) || 0;
    const pieces = docs.map(d => `- ${d.kind === 'invoice' ? 'Facture' : 'Ticket'} ${d.number} du ${frDate(d.doc_date)}, échue le ${frDate(d.due_date)} (${d.days_late} j de retard) : ${n2(d.remaining)} DH`).join('\n');
    const vars = {
      client: c.name, montant: n2(amount), pieces, jours: String(maxDaysLate), frais: n2(fee), penalites: n2(interest),
      total: n2(amount + fee + interest), societe: legal.name || '', date: new Date().toLocaleDateString('fr-FR'),
    };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'dunning');
      const r = await client.query(
        `INSERT INTO dunnings (number, customer_id, level, level_label, amount_due, fee_amount, interest_amount, max_days_late, subject, body, email_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [number, customerId, level.level, level.label, amount, fee, interest, maxDaysLate,
         render(level.subject, vars).slice(0, 200), render(level.body, vars), c.email || null, p.userId]);
      const id = r.rows[0].id;
      for (const d of docs) {
        await client.query(
          `INSERT INTO dunning_items (dunning_id, doc_kind, doc_id, doc_number, doc_date, due_date, days_late, remaining) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, d.kind, d.id, d.number, d.doc_date, d.due_date, d.days_late, d.remaining]);
      }
      await client.query('COMMIT');
      return { data: await this.findById(id), level };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async list(p: { status?: string; customerId?: string; limit: number; offset: number }) {
    const v: unknown[] = []; const cond = ['true'];
    if (p.status) { v.push(p.status); cond.push(`d.status = $${v.length}`); }
    if (p.customerId) { v.push(p.customerId); cond.push(`d.customer_id = $${v.length}::uuid`); }
    const where = cond.join(' AND ');
    const total = await db.query(`SELECT COUNT(*)::int AS n FROM dunnings d WHERE ${where}`, v);
    v.push(p.limit, p.offset);
    const r = await db.query(
      `SELECT d.*, ${NAME} AS customer_name, c.email AS customer_email, c.credit_hold, u.first_name || ' ' || u.last_name AS created_by_name,
              (SELECT COUNT(*) FROM dunning_items i WHERE i.dunning_id = d.id)::int AS item_count
         FROM dunnings d JOIN customers c ON c.id = d.customer_id LEFT JOIN users u ON u.id = d.created_by
        WHERE ${where} ORDER BY (d.status = 'draft') DESC, d.created_at DESC LIMIT $${v.length - 1} OFFSET $${v.length}`, v);
    return { rows: r.rows, total: total.rows[0].n };
  },

  async findById(id: string) {
    const r = await db.query(
      `SELECT d.*, ${NAME} AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address,
              c.city AS customer_city, c.ice AS customer_ice, c.credit_hold
         FROM dunnings d JOIN customers c ON c.id = d.customer_id WHERE d.id = $1`, [id]);
    if (!r.rows[0]) return null;
    const items = await db.query(`SELECT * FROM dunning_items WHERE dunning_id = $1 ORDER BY due_date`, [id]);
    return { ...r.rows[0], items: items.rows };
  },

  /** Envoi : e-mail (mis en file) ou constat d'un envoi papier / téléphonique. Applique le blocage du niveau. */
  async send(id: string, p: { via: 'email' | 'print' | 'phone' | 'other'; userId: string | null; emailTo?: string | null }) {
    const d = await this.findById(id);
    if (!d) return { error: 'not_found' as const };
    if (d.status !== 'draft' && !(d.status === 'sent' && p.via === 'email')) return { error: 'Relance déjà envoyée, soldée ou annulée' };
    const to = (p.emailTo ?? d.email_to ?? d.customer_email ?? '').trim();
    if (p.via === 'email') {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) return { error: 'Adresse e-mail du client manquante ou invalide' };
      await enqueueEmail({ to, toName: d.customer_name, subject: d.subject, text: d.body, type: 'dunning', referenceType: 'dunning', referenceId: id, createdBy: p.userId });
    }
    await db.query(`UPDATE dunnings SET status = 'sent', sent_at = COALESCE(sent_at, now()), sent_via = $2::text, email_to = CASE WHEN $2::text = 'email' THEN $3::text ELSE email_to END WHERE id = $1`,
      [id, p.via, to || null]);
    const level = (await db.query(`SELECT credit_hold FROM dunning_levels WHERE level = $1`, [d.level])).rows[0];
    if (level?.credit_hold && !d.credit_hold) await this.hold(d.customer_id, { reason: `${d.level_label} ${d.number} impayée`, userId: p.userId, storeId: null });
    return { data: await this.findById(id) };
  },

  async cancel(id: string) {
    const r = await db.query(`UPDATE dunnings SET status = 'cancelled' WHERE id = $1 AND status IN ('draft', 'sent') RETURNING id`, [id]);
    return r.rows[0] ? { data: await this.findById(id) } : { error: 'Relance introuvable ou déjà close' };
  },

  async hold(customerId: string, p: { reason: string; userId: string | null; storeId: string | null }) {
    const r = await db.query(
      `UPDATE customers c SET credit_hold = true, credit_hold_reason = $2, credit_hold_at = now(), credit_hold_by = $3 WHERE id = $1 AND NOT credit_hold
       RETURNING ${NAME} AS name`, [customerId, p.reason.slice(0, 300), p.userId]);
    if (r.rows[0]) {
      await db.query(
        `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
         VALUES ('manager', $1, 'credit_hold', $2, $3, 'customer', $4, $5)`,
        [p.storeId, `Client bloqué · ${r.rows[0].name}`, `Achats à crédit suspendus : ${p.reason}`, customerId, p.userId]);
    }
    return !!r.rows[0];
  },
  async release(customerId: string) {
    const r = await db.query(`UPDATE customers SET credit_hold = false, credit_hold_reason = NULL, credit_hold_at = NULL, credit_hold_by = NULL WHERE id = $1 AND credit_hold RETURNING id`, [customerId]);
    return !!r.rows[0];
  },
  async pause(customerId: string, until: string | null) {
    await db.query(`UPDATE customers SET dunning_paused_until = $2 WHERE id = $1`, [customerId, until]);
  },

  async blocked() {
    const r = await db.query(
      `SELECT c.id, ${NAME} AS name, c.credit_hold_reason, c.credit_hold_at, c.dunning_paused_until, c.credit_limit,
              u.first_name || ' ' || u.last_name AS held_by_name
         FROM customers c LEFT JOIN users u ON u.id = c.credit_hold_by
        WHERE c.credit_hold OR c.dunning_paused_until >= CURRENT_DATE ORDER BY c.credit_hold DESC, c.credit_hold_at DESC`);
    return r.rows;
  },

  /**
   * Passage quotidien : solde les relances dont plus aucune pièce n'est ouverte, débloque
   * les clients à jour (si activé), puis crée les relances dues (et les envoie si prévu).
   */
  async run(): Promise<{ items: number; message: string }> {
    const settings = await dunningSettings();
    if (!settings.enabled) return { items: 0, message: 'Relances désactivées dans les paramètres' };
    const open = await openDocuments({});
    const openKeys = new Set(open.map(d => `${d.kind}:${d.id}`));
    const pending = await db.query(
      `SELECT d.id, array_agg(i.doc_kind || ':' || i.doc_id) AS keys FROM dunnings d JOIN dunning_items i ON i.dunning_id = d.id
        WHERE d.status IN ('draft', 'sent') GROUP BY d.id`);
    let resolved = 0;
    for (const p of pending.rows) {
      if (!(p.keys as string[]).some(k => openKeys.has(k))) {
        await db.query(`UPDATE dunnings SET status = 'resolved', resolved_at = now() WHERE id = $1`, [p.id]);
        resolved++;
      }
    }
    let released = 0;
    if (settings.auto_release) {
      const overdueCustomers = new Set(open.filter(d => d.days_late > 0 && d.customer_id).map(d => d.customer_id));
      const held = await db.query(`SELECT id FROM customers WHERE credit_hold`);
      for (const h of held.rows) if (!overdueCustomers.has(h.id) && await this.release(h.id)) released++;
    }
    const proposals = await this.proposals();
    let created = 0; let mailed = 0;
    for (const pr of proposals) {
      const r = await this.create(pr.customerId, { userId: null });
      if (!('data' in r) || !r.data) continue;
      created++;
      if (settings.auto_send && r.level?.send_email && pr.email) {
        const s = await this.send(r.data.id, { via: 'email', userId: null });
        if ('data' in s) mailed++;
      }
    }
    const toSend = created - mailed;
    if (toSend > 0) {
      await db.query(
        `INSERT INTO notifications (target_role, type, title, message, reference_type)
         VALUES ('manager', 'dunning_to_send', $1, $2, 'dunning')`,
        [`${toSend} relance(s) client à envoyer`, 'Ventes › Relances : vérifiez puis envoyez par e-mail ou imprimez les lettres.']);
    }
    const parts = [`${created} relance(s) créée(s)`, mailed ? `${mailed} envoyée(s) par e-mail` : '', resolved ? `${resolved} soldée(s)` : '', released ? `${released} client(s) débloqué(s)` : ''];
    return { items: created + resolved + released, message: parts.filter(Boolean).join(' · ') };
  },

  /**
   * Contrôle de crédit avant une vente à crédit : client bloqué → refus ; plafond dépassé →
   * refus si le contrôle est « bloquant », sinon simple alerte (comportement mig 354).
   */
  async creditCheck(customerId: string, amount: number): Promise<{ blocked: string | null; warning: string | null }> {
    const c = (await db.query(`SELECT credit_hold, credit_hold_reason, credit_limit FROM customers WHERE id = $1`, [customerId])).rows[0];
    if (!c) return { blocked: null, warning: null };
    if (c.credit_hold) return { blocked: `Client bloqué : achats à crédit suspendus${c.credit_hold_reason ? ` (${c.credit_hold_reason})` : ''}. Débloquez-le dans Ventes › Relances ou faites régler comptant.`, warning: null };
    const limit = Number(c.credit_limit ?? 0);
    if (!(limit > 0)) return { blocked: null, warning: null };
    const docs = await openDocuments({ customerId });
    const exposure = round2(docs.reduce((s, d) => s + d.remaining, 0) + amount);
    if (exposure <= limit + 0.005) return { blocked: null, warning: null };
    const msg = `Plafond de crédit dépassé : ${n2(exposure)} DH engagés pour un plafond de ${n2(limit)} DH.`;
    return (await dunningSettings()).credit_control === 'block' ? { blocked: msg, warning: null } : { blocked: null, warning: msg };
  },
};
