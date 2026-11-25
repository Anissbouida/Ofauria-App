import { db } from '../config/database.js';
import { lowStockAlertsEnabled } from './operating-rules.js';
import { reorderPointRepository } from '../repositories/reorder-point.repository.js';
import { cycleCountJob } from '../repositories/abc-cycle-count.repository.js';
import { logger } from '../utils/logger.js';
import { processOutbox, enqueueEmail } from './mailer.js';
import { getParameter } from './module-parameters.service.js';
import { maintenanceRepository } from '../repositories/maintenance.repository.js';
import { systemUserId } from './system-user.js';
import { runDepreciation } from './depreciation.service.js';
import { prepaidChargeRepository } from '../repositories/prepaid-charge.repository.js';
import { productLotRepository } from '../repositories/product-lot.repository.js';
import { journalTemplateRepository } from '../repositories/journal-template.repository.js';
import { dunningRepository } from '../repositories/dunning.repository.js';
import { ledgerIntegrityRepository } from '../repositories/ledger-integrity.repository.js';
import { expireDue as loyaltyExpireDue } from './loyalty.js';
import { deliveryNoteRepository } from '../repositories/delivery-note.repository.js';
import { toOrderRepository } from '../repositories/to-order.repository.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { webhookRepository } from '../repositories/webhook.repository.js';
import { currencySymbol } from './currency.js';
import { replayOutbox } from './ledger-posting.service.js';
import { createNotification } from '../utils/notify.js';

/**
 * Tâches planifiées (mig 364).
 *
 * Le code des tâches est ici ; la base (`scheduled_jobs`) porte l'activation, la fréquence
 * et le dernier passage, modifiables dans Paramètres › Tâches planifiées.
 *
 * Deux déclencheurs, qui peuvent coexister :
 *  - interne : toutes les minutes tant qu'une instance du serveur tourne (suffit en local
 *    ou sur un serveur toujours allumé) ;
 *  - externe : POST /api/v1/cron/tick avec l'en-tête X-Cron-Secret = CRON_SECRET (Cloud
 *    Scheduler), indispensable quand l'hébergeur endort les instances inactives.
 * Un verrou consultatif PostgreSQL garantit qu'un seul passage tourne à la fois, toutes
 * instances confondues ; chaque tâche ne traite que ce qui n'a pas déjà été traité.
 */

export type JobResult = { items: number; message: string };
type Handler = () => Promise<JobResult>;

const LOCK_KEY = 364_001;

/* ─── Tâches ──────────────────────────────────────────────────────────────── */

/** Réclamations ouvertes dont le délai est dépassé, pas encore signalées pour ce délai. */
async function complaintsOverdue(): Promise<JobResult> {
  const r = await db.query(
    `UPDATE complaints c SET overdue_notified_at = now()
      WHERE c.status IN ('open', 'in_progress') AND c.due_at IS NOT NULL AND c.due_at < now()
        AND (c.overdue_notified_at IS NULL OR c.overdue_notified_at < c.due_at)
      RETURNING c.id, c.number, c.subject, c.store_id, c.assigned_to, c.priority`);
  for (const c of r.rows) {
    const title = `Réclamation en retard · ${c.number}`;
    await db.query(
      `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id)
       VALUES ('manager', $1, 'complaint_overdue', $2, $3, 'complaint', $4)`, [c.store_id, title, c.subject, c.id]);
    if (c.assigned_to) {
      await db.query(
        `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id)
         VALUES ('all', $1, $2, 'complaint_overdue', $3, $4, 'complaint', $5)`, [c.assigned_to, c.store_id, title, c.subject, c.id]);
    }
  }
  return { items: r.rowCount ?? 0, message: r.rowCount ? `${r.rowCount} réclamation(s) signalée(s)` : 'Aucun retard' };
}

/** Tâches de projet ouvertes dont l'échéance est passée : la personne affectée, sinon le gérant. */
async function projectTasksOverdue(): Promise<JobResult> {
  const r = await db.query(
    `UPDATE project_tasks t SET overdue_notified_at = now()
       FROM projects p
      WHERE p.id = t.project_id AND t.status IN ('todo', 'in_progress')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
        AND (t.overdue_notified_at IS NULL OR t.overdue_notified_at < t.due_date + 1)
      RETURNING t.id, t.title, t.due_date, t.assignee_id, p.number, p.name, p.store_id`);
  for (const t of r.rows) {
    const u = t.assignee_id ? await db.query(`SELECT user_id FROM employees WHERE id = $1`, [t.assignee_id]) : null;
    const userId = u?.rows[0]?.user_id ?? null;
    const due = new Date(t.due_date).toLocaleDateString('fr-FR');
    await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, 'project_task_overdue', $4, $5, 'project_task', $6)`,
      [userId ? 'all' : 'manager', userId, t.store_id, `Tâche en retard · ${t.number}`, `${t.title} (${t.name}) — échéance ${due}`, t.id]);
  }
  return { items: r.rowCount ?? 0, message: r.rowCount ? `${r.rowCount} tâche(s) signalée(s)` : 'Aucun retard' };
}

/**
 * Plans d'entretien arrivés à échéance : crée l'intervention préventive (une seule ouverte
 * par plan, règle de createFromPlan) et prévient le gérant, une fois par échéance.
 */
async function maintenanceDue(): Promise<JobResult> {
  const plans = await db.query(
    `SELECT pl.id, pl.label, pl.next_due_on, pl.store_id FROM maintenance_plans pl
      WHERE pl.is_active AND pl.next_due_on <= CURRENT_DATE
        AND (pl.due_notified_on IS NULL OR pl.due_notified_on < pl.next_due_on)`);
  let created = 0;
  for (const pl of plans.rows) {
    // G0-28 : la tâche planifiée agit au nom de l'utilisateur technique « Système ».
    const it = await maintenanceRepository.createFromPlan(pl.id, { userId: await systemUserId(), storeId: pl.store_id });
    if (!it) continue;
    created++;
    await db.query(`UPDATE maintenance_plans SET due_notified_on = next_due_on WHERE id = $1`, [pl.id]);
    await db.query(
      `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id)
       VALUES ('manager', $1, 'maintenance_due', $2, $3, 'maintenance', $4)`,
      [pl.store_id, `Entretien à faire · ${it.number}`, `${pl.label} — échéance ${new Date(pl.next_due_on).toLocaleDateString('fr-FR')}`, it.id]);
  }
  return { items: created, message: created ? `${created} intervention(s) préventive(s) ouverte(s)` : 'Aucune échéance' };
}

/** Appels d'offres envoyés dont la date limite de réponse est passée. */
async function rfqDeadline(): Promise<JobResult> {
  const r = await db.query(
    `UPDATE rfqs r SET deadline_notified_at = now()
      WHERE r.status IN ('sent', 'quoted') AND r.response_deadline IS NOT NULL AND r.response_deadline < CURRENT_DATE
        AND (r.deadline_notified_at IS NULL OR r.deadline_notified_at < r.response_deadline + 1)
      RETURNING r.id, r.number, r.title, r.store_id, r.created_by,
                (SELECT COUNT(*) FROM supplier_quotations q WHERE q.rfq_id = r.id)::int AS quotes,
                (SELECT COUNT(*) FROM rfq_suppliers s WHERE s.rfq_id = r.id)::int AS suppliers`);
  for (const a of r.rows) {
    const msg = `${a.title} — ${a.quotes}/${a.suppliers} devis reçu(s) : comparer et attribuer, ou relancer`;
    await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, 'rfq_deadline', $4, $5, 'rfq', $6)`,
      [a.created_by ? 'all' : 'manager', a.created_by, a.store_id, `Date limite passée · ${a.number}`, msg, a.id]);
  }
  return { items: r.rowCount ?? 0, message: r.rowCount ? `${r.rowCount} appel(s) d'offres signalé(s)` : 'Aucune échéance' };
}

/** Devis envoyés dont la validité est dépassée : « expiré » (motif « sans réponse ») et auteur prévenu. */
async function quotesExpire(): Promise<JobResult> {
  const r = await db.query(
    `UPDATE quotes SET status = 'expired', lost_reason_code = COALESCE(lost_reason_code, 'no_answer'), expiry_notified_at = now()
      WHERE status = 'sent' AND valid_until < CURRENT_DATE
      RETURNING id, number, store_id, created_by, total,
                (SELECT COALESCE(NULLIF(c.company_name, ''), NULLIF(concat_ws(' ', c.first_name, c.last_name), ''))
                   FROM customers c WHERE c.id = quotes.customer_id) AS customer_label,
                COALESCE(prospect_company, prospect_name) AS prospect_label`);
  for (const q of r.rows) {
    await db.query(`INSERT INTO quote_events (quote_id, event_type, from_value, to_value, note) VALUES ($1, 'status', 'sent', 'expired', 'Validité dépassée')`, [q.id]);
    await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, 'quote_expired', $4, $5, 'quote', $6)`,
      [q.created_by ? 'all' : 'manager', q.created_by, q.store_id, `Devis expiré · ${q.number}`,
       `${q.customer_label ?? q.prospect_label ?? ''} — ${Number(q.total).toFixed(2)} ${currencySymbol()} : relancer le client ou classer le devis`, q.id]);
  }
  return { items: r.rowCount ?? 0, message: r.rowCount ? `${r.rowCount} devis expiré(s)` : 'Aucun devis expiré' };
}

/** Activités commerciales échues (mig 371) : une alerte par activité, au commercial à qui elle est confiée. */
async function crmActivitiesDue(): Promise<JobResult> {
  const r = await db.query(
    `UPDATE crm_activities a SET notified_at = now()
       FROM opportunities o
      WHERE o.id = a.opportunity_id AND a.done_at IS NULL AND a.kind <> 'note' AND a.due_at IS NOT NULL AND a.due_at <= now()
        AND a.notified_at IS NULL AND o.stage NOT IN ('won', 'lost')
      RETURNING a.id, a.subject, a.kind, a.due_at, a.assigned_to, o.id AS opp_id, o.number, o.title, o.store_id, o.owner_id`);
  const KIND: Record<string, string> = { call: 'Appel', meeting: 'Rendez-vous', email: 'E-mail', task: 'Tâche' };
  for (const a of r.rows) {
    const to = a.assigned_to ?? a.owner_id;
    await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, 'crm_activity_due', $4, $5, 'opportunity', $6)`,
      [to ? 'all' : 'manager', to, a.store_id, `${KIND[a.kind] ?? 'Activité'} à faire · ${a.number}`, `${a.subject} — ${a.title}`, a.opp_id]);
  }
  return { items: r.rowCount ?? 0, message: r.rowCount ? `${r.rowCount} activité(s) signalée(s)` : 'Aucune activité échue' };
}

/**
 * Facturation des BL (O2C L4, G-IV-08) : clients mensuels une fois le mois terminé (une
 * facture par client et par mois, datée du dernier jour du mois, ou d'aujourd'hui si la
 * période comptable est verrouillée) ; clients « à chaque livraison » dont le BL n'a pas
 * été facturé à la livraison, dès le lendemain (facture datée du BL).
 */
export async function monthlyInvoicing(opts: { customerId?: string } = {}): Promise<JobResult> {
  const actor = (await db.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1`)).rows[0]?.id as string | undefined;
  if (!actor) return { items: 0, message: 'Aucun administrateur actif pour émettre les factures' };
  const groups = (await db.query(
    `WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date AS d)
     SELECT dn.customer_id, COALESCE(c.billing_frequency, 'monthly') AS freq,
            array_agg(dn.id ORDER BY dn.delivery_date, dn.number) AS ids,
            max(dn.delivery_date)::text AS last_day,
            (date_trunc('month', max(dn.delivery_date)) + interval '1 month - 1 day')::date::text AS month_end
       FROM delivery_notes dn JOIN customers c ON c.id = dn.customer_id, today
      WHERE dn.status = 'delivered' AND ($1::uuid IS NULL OR dn.customer_id = $1)
        AND ((c.billing_frequency = 'per_delivery' AND dn.delivery_date < today.d)
             OR (COALESCE(c.billing_frequency, 'monthly') <> 'per_delivery' AND dn.delivery_date < date_trunc('month', today.d)))
      GROUP BY dn.customer_id, 2, CASE WHEN c.billing_frequency = 'per_delivery' THEN dn.id::text ELSE to_char(dn.delivery_date, 'YYYY-MM') END
      ORDER BY 4`, [opts.customerId ?? null])).rows as { customer_id: string; freq: string; ids: string[]; last_day: string; month_end: string }[];
  let done = 0; const errors: string[] = [];
  for (const g of groups) {
    let date = g.freq === 'per_delivery' ? g.last_day : g.month_end;
    const locked = (await db.query(
      `SELECT 1 FROM fiscal_periods WHERE $1::date BETWEEN start_date AND end_date AND status <> 'open'`, [date])).rows[0];
    if (locked) date = (await db.query(`SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date::text AS d`)).rows[0].d;
    try {
      await deliveryNoteRepository.invoice({ deliveryNoteIds: g.ids, invoiceDate: date, createdBy: actor });
      done++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length) throw new Error(`${done} facture(s) émise(s), ${errors.length} échec(s) : ${errors.slice(0, 3).join(' ; ')}`);
  return { items: done, message: done ? `${done} facture(s) émise(s)` : 'Aucun BL à facturer' };
}

async function housekeeping(): Promise<JobResult> {
  const a = await db.query(`DELETE FROM scheduled_job_runs WHERE started_at < now() - interval '30 days'`);
  const b = await db.query(`DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < now() - interval '90 days'`);
  const n = (a.rowCount ?? 0) + (b.rowCount ?? 0);
  return { items: n, message: `${a.rowCount ?? 0} passage(s) et ${b.rowCount ?? 0} e-mail(s) supprimés` };
}

/**
 * Rejeu des écritures en attente (plan compta, étape 5, audit C-07) : toutes les 15 minutes, chaque
 * pièce enregistrée dont l'écriture a échoué est rejouée (délai croissant entre essais). Une pièce qui
 * résiste à un premier rejeu est signalée UNE fois aux responsables : sa cause (compte manquant, période
 * close…) demande une action humaine, et la clôture du mois reste bloquée tant qu'elle existe.
 */
async function ledgerOutboxReplay(): Promise<JobResult> {
  const userId = await systemUserId();
  const r = await replayOutbox(userId, undefined, { onlyDue: true });
  const blocked = (await db.query(
    `UPDATE ledger_outbox SET notified_at = now()
      WHERE status <> 'posted' AND notified_at IS NULL AND attempts >= 2
      RETURNING source_kind, error_code, last_error`)).rows as { source_kind: string; error_code: string | null; last_error: string | null }[];
  if (blocked.length > 0) {
    const causes = [...new Set(blocked.map(b => b.error_code ?? 'OTHER'))].join(', ');
    for (const targetRole of ['manager', 'admin']) {
      await createNotification({
        targetRole, type: 'ledger_outbox', referenceType: 'ledger_outbox',
        title: 'Écritures à comptabiliser',
        message: `${blocked.length} pièce(s) enregistrée(s) sans écriture comptable (${causes}). Corrigez la cause : l'écriture se passera au prochain rejeu.`,
      });
    }
  }
  return {
    items: r.posted,
    message: `${r.posted} rejouée(s), ${r.failed} encore en attente${blocked.length ? ` · ${blocked.length} signalée(s)` : ''}`,
  };
}

/** Partitions d'exercice du journal d'audit comptable (mig 436) : exercice courant et suivant. */
async function ledgerPartitions(): Promise<JobResult> {
  const y = Number((await db.query(`SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Casablanca')::int AS y`)).rows[0].y);
  const before = Number((await db.query(`SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'ledger_audit_log'::regclass`)).rows[0].n);
  for (const year of [y, y + 1]) await db.query(`SELECT fn_ensure_audit_partition($1)`, [year]);
  const after = Number((await db.query(`SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'ledger_audit_log'::regclass`)).rows[0].n);
  return { items: after - before, message: after > before ? `${after - before} partition(s) créée(s)` : `Partitions ${y} et ${y + 1} déjà prêtes` };
}

async function emailOutbox(): Promise<JobResult> {
  const r = await processOutbox();
  return { items: r.sent, message: `${r.message}${r.waiting ? ` · ${r.waiting} en attente` : ''}` };
}

/**
 * MRP déclencheur (L6 P2P) : calcule le besoin net (ruptures + stock sous le seuil
 * + demandes, déduction des BC ouverts faite — même calcul que « À commander ») et
 * crée des demandes d'achat PROPOSÉES (approval_status 'draft') qu'un humain revoit
 * puis soumet. Dédupliquées par insertProposal. Désactivée par défaut (mig 464).
 */
async function purchaseSuggestions(): Promise<JobResult> {
  if (!(await lowStockAlertsEnabled())) return { items: 0, message: 'Alertes de stock bas désactivées (paramètre)' };
  const { rows } = await toOrderRepository.board();
  let created = 0;
  for (const r of rows as Record<string, unknown>[]) {
    if (r.covered || !(Number(r.suggested_qty) > 0)) continue;
    const id = await purchaseRequestRepository.insertProposal({
      ingredientId: r.ingredient_id as string,
      supplierId: (r.supplier_id as string | null) ?? null,
      quantity: Number(r.suggested_qty),
      unit: r.unit as string,
      storeId: (r.store_id as string | null) ?? null,
    });
    if (id) created++;
  }
  return { items: created, message: created ? `${created} demande(s) d'achat proposée(s)` : 'Aucune nouvelle proposition (besoins couverts)' };
}

/** Mois écoulé au fuseau de Casablanca : { year, month } et son dernier jour (AAAA-MM-JJ). */
async function previousMonth(): Promise<{ year: number; month: number; lastDay: string }> {
  const r = (await db.query(
    `SELECT EXTRACT(YEAR FROM d)::int AS year, EXTRACT(MONTH FROM d)::int AS month, to_char(d, 'YYYY-MM-DD') AS last_day
       FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') - interval '1 day')::date AS d) x`)).rows[0];
  return { year: r.year, month: r.month, lastDay: r.last_day };
}

/**
 * G1-07 — dotations aux amortissements : passe les dotations manquantes de l'exercice du
 * mois écoulé, de janvier à ce mois (rattrape un mois oublié). Idempotent : runDepreciation
 * saute toute immobilisation déjà dotée pour le mois. Un mois dont la période comptable est
 * verrouillée fait échouer la tâche, avec le message de la base.
 */
async function depreciationMonthly(): Promise<JobResult> {
  const { year, month } = await previousMonth();
  const userId = await systemUserId();
  let created = 0, total = 0;
  for (let m = 1; m <= month; m++) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await runDepreciation(client, { year, month: m, userId });
      await client.query('COMMIT');
      created += r.created; total = Math.round((total + r.totalAmount) * 100) / 100;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Dotations ${String(m).padStart(2, '0')}/${year} : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  return { items: created, message: created
    ? `${created} dotation(s) comptabilisée(s) jusqu'à ${String(month).padStart(2, '0')}/${year}, ${total.toFixed(2)} ${currencySymbol()}`
    : `Dotations à jour jusqu'à ${String(month).padStart(2, '0')}/${year}` };
}

/**
 * G1-08 — charges constatées d'avance : constate les mois échus non encore constatés, pour
 * toutes les charges actives, jusqu'au dernier jour du mois écoulé. Idempotent (une
 * constatation par charge et par mois).
 */
async function prepaidRecognition(): Promise<JobResult> {
  const { year, month, lastDay } = await previousMonth();
  const { posted } = await prepaidChargeRepository.recognizeDue({ asOf: lastDay, userId: await systemUserId() });
  const period = `${String(month).padStart(2, '0')}/${year}`;
  return { items: posted, message: posted ? `${posted} constatation(s) comptabilisée(s) jusqu'à ${period}` : `Charges constatées d'avance à jour jusqu'à ${period}` };
}

/**
 * G1-10 — péremption des lots de produits finis : DLC ou DLV dépassée. Perte enregistrée,
 * stock du magasin synchronisé, lot passé à « périmé » (productLotRepository.autoExpireDueLots).
 * Idempotent : un lot traité n'est plus actif.
 */
async function lotsExpire(): Promise<JobResult> {
  const { count, productIds } = await productLotRepository.autoExpireDueLots();
  return { items: count, message: count ? `${count} lot(s) périmé(s) sorti(s) du stock, ${productIds.length} produit(s) concerné(s)` : 'Aucun lot à périmer' };
}

/** Réglage des alertes d'échéance : seuils en jours, croissants et sans doublon ; e-mail en plus. */
function alertThresholds(cfg: { days?: unknown; email?: unknown } | null | undefined, fallback: number[]) {
  const raw = Array.isArray(cfg?.days) ? cfg!.days as unknown[] : fallback;
  const days = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 365))].sort((a, b) => a - b);
  return { days: days.length ? days : fallback, email: cfg?.email === true };
}

/** Responsables à prévenir par e-mail : gérants et administrateurs actifs de l'établissement (ou sans établissement). */
async function managerEmails(storeId: string | null): Promise<{ email: string; name: string }[]> {
  const r = await db.query(
    `SELECT email, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM users
      WHERE is_active AND NOT is_system AND role IN ('admin', 'manager') AND email IS NOT NULL
        AND ($1::uuid IS NULL OR store_id IS NULL OR store_id = $1)`, [storeId]);
  return r.rows;
}

/**
 * G1-11 — alertes de DLC : lots de matières et de produits finis encore en stock qui
 * expirent sous N jours, pour chaque seuil de stock.dlc_alerts. Une alerte par lot et par
 * seuil (lot_expiry_alerts) ; une notification par établissement et par nature de lot,
 * au magasinier pour les matières, au gérant pour les produits finis.
 */
async function dlcAlerts(): Promise<JobResult> {
  const { days, email } = alertThresholds(await getParameter<{ days?: number[]; email?: boolean }>('stock.dlc_alerts'), [7, 2]);
  type Row = { lot_kind: 'ingredient' | 'product'; lot_id: string; store_id: string | null; name: string; lot_number: string | null; expires_on: string; days_left: number };
  const fresh = new Map<string, Row>();
  for (const t of days) {
    const r = await db.query(
      `WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date AS d),
            due AS (
              SELECT 'ingredient'::text AS lot_kind, il.id AS lot_id, il.store_id, i.name,
                     COALESCE(il.supplier_lot_number, il.lot_number) AS lot_number, il.expiration_date AS expires_on
                FROM ingredient_lots il JOIN ingredients i ON i.id = il.ingredient_id, today
               WHERE il.status = 'active' AND il.quantity_remaining > 0
                 AND il.expiration_date BETWEEN today.d AND today.d + $1::int
              UNION ALL
              SELECT 'product', pl.id, pl.store_id, p.name, pl.lot_number, pl.expires_at
                FROM product_lots pl JOIN products p ON p.id = pl.product_id, today
               WHERE pl.status = 'active' AND (pl.backroom_qty + pl.vitrine_qty) > 0
                 AND pl.expires_at BETWEEN today.d AND today.d + $1::int),
            ins AS (
              INSERT INTO lot_expiry_alerts (lot_kind, lot_id, threshold_days, expires_on)
              SELECT lot_kind, lot_id, $1::smallint, expires_on FROM due
              ON CONFLICT DO NOTHING RETURNING lot_kind, lot_id)
       SELECT d.lot_kind, d.lot_id, d.store_id, d.name, d.lot_number, to_char(d.expires_on, 'DD/MM/YYYY') AS expires_on,
              (d.expires_on - (SELECT d FROM today))::int AS days_left
         FROM due d JOIN ins ON ins.lot_kind = d.lot_kind AND ins.lot_id = d.lot_id`, [t]);
    for (const row of r.rows as Row[]) fresh.set(`${row.lot_kind}:${row.lot_id}`, row);
  }
  if (!fresh.size) return { items: 0, message: `Aucun nouveau lot sous ${days.join(' / ')} jour(s)` };

  // Une notification par établissement et par nature de lot.
  const groups = new Map<string, Row[]>();
  for (const row of fresh.values()) {
    const k = `${row.store_id ?? ''}|${row.lot_kind}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.days_left - b.days_left);
    const kind = rows[0].lot_kind, storeId = rows[0].store_id;
    const what = kind === 'ingredient' ? 'matière' : 'produit fini';
    const lines = rows.map(x => `${x.name}${x.lot_number ? ` (lot ${x.lot_number})` : ''} — ${x.expires_on}, ${x.days_left === 0 ? "aujourd'hui" : `dans ${x.days_left} j`}`);
    const title = `DLC proche · ${rows.length} lot${rows.length > 1 ? 's' : ''} de ${what}`;
    const message = lines.slice(0, 6).join(' ; ') + (lines.length > 6 ? ` ; et ${lines.length - 6} autre(s)` : '');
    await db.query(
      `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type)
       VALUES ($1, $2, 'dlc_alert', $3, $4, 'lot')`, [kind === 'ingredient' ? 'magasinier' : 'manager', storeId, title, message]);
    if (email) {
      for (const m of await managerEmails(storeId)) {
        await enqueueEmail({ to: m.email, toName: m.name, subject: title, text: `Lots proches de leur date limite :\n\n${lines.join('\n')}`, type: 'dlc_alert' });
      }
    }
  }
  return { items: fresh.size, message: `${fresh.size} lot(s) signalé(s) sous ${days.join(' / ')} jour(s)` };
}

/**
 * G1-12 — échéances du personnel : carte d'identité, documents datés (visite médicale…),
 * fin de CDD, fin de période d'essai, sous N jours pour chaque seuil de hr.documents_due.
 * Une alerte par échéance et par seuil (hr_due_alerts) ; une notification au gérant par
 * établissement. Seuls les salariés actifs sont suivis.
 */
async function hrDocumentsDue(): Promise<JobResult> {
  const { days, email } = alertThresholds(await getParameter<{ days?: number[]; email?: boolean }>('hr.documents_due'), [30, 7]);
  type Row = { kind: string; ref_id: string; store_id: string | null; employee: string; label: string; due_on: string; days_left: number };
  const fresh = new Map<string, Row>();
  for (const t of days) {
    const r = await db.query(
      `WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date AS d),
            due AS (
              SELECT 'cin'::text AS kind, e.id AS ref_id, e.store_id, e.first_name || ' ' || e.last_name AS employee,
                     'Carte d''identité'::text AS label, e.cin_expires_on AS due_on
                FROM employees e WHERE e.is_active AND e.cin_expires_on IS NOT NULL
              UNION ALL
              SELECT 'document', d.id, e.store_id, e.first_name || ' ' || e.last_name,
                     COALESCE(NULLIF(d.title, ''), CASE d.doc_type WHEN 'visite_medicale' THEN 'Visite médicale'
                       WHEN 'certificat_medical' THEN 'Certificat médical' WHEN 'cin' THEN 'Carte d''identité' ELSE d.doc_type END), d.expires_on
                FROM employee_documents d JOIN employees e ON e.id = d.employee_id AND e.is_active WHERE d.expires_on IS NOT NULL
              UNION ALL
              SELECT 'cdd_end', c.id, e.store_id, e.first_name || ' ' || e.last_name, 'Fin de contrat (' || upper(c.contract_type) || ')', c.end_date
                FROM employee_contracts c JOIN employees e ON e.id = c.employee_id AND e.is_active
               WHERE c.status = 'active' AND c.end_date IS NOT NULL
              UNION ALL
              SELECT 'trial_end', c.id, e.store_id, e.first_name || ' ' || e.last_name, 'Fin de période d''essai', c.trial_end_date
                FROM employee_contracts c JOIN employees e ON e.id = c.employee_id AND e.is_active
               WHERE c.status = 'active' AND c.trial_end_date IS NOT NULL),
            near AS (SELECT due.* FROM due, today WHERE due.due_on BETWEEN today.d AND today.d + $1::int),
            ins AS (
              INSERT INTO hr_due_alerts (kind, ref_id, threshold_days, due_on)
              SELECT kind, ref_id, $1::smallint, due_on FROM near
              ON CONFLICT DO NOTHING RETURNING kind, ref_id)
       SELECT n.kind, n.ref_id, n.store_id, n.employee, n.label, to_char(n.due_on, 'DD/MM/YYYY') AS due_on,
              (n.due_on - (SELECT d FROM today))::int AS days_left
         FROM near n JOIN ins ON ins.kind = n.kind AND ins.ref_id = n.ref_id`, [t]);
    for (const row of r.rows as Row[]) fresh.set(`${row.kind}:${row.ref_id}`, row);
  }
  if (!fresh.size) return { items: 0, message: `Aucune nouvelle échéance sous ${days.join(' / ')} jour(s)` };

  const byStore = new Map<string, Row[]>();
  for (const row of fresh.values()) byStore.set(row.store_id ?? '', [...(byStore.get(row.store_id ?? '') ?? []), row]);
  for (const [key, rows] of byStore) {
    rows.sort((a, b) => a.days_left - b.days_left);
    const storeId = key || null;
    const lines = rows.map(x => `${x.employee} — ${x.label} : ${x.due_on}, ${x.days_left === 0 ? "aujourd'hui" : `dans ${x.days_left} j`}`);
    const title = `Personnel · ${rows.length} échéance${rows.length > 1 ? 's' : ''} proche${rows.length > 1 ? 's' : ''}`;
    await db.query(
      `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type)
       VALUES ('manager', $1, 'hr_document_due', $2, $3, 'employee')`,
      [storeId, title, lines.slice(0, 6).join(' ; ') + (lines.length > 6 ? ` ; et ${lines.length - 6} autre(s)` : '')]);
    if (email) {
      for (const m of await managerEmails(storeId)) {
        await enqueueEmail({ to: m.email, toName: m.name, subject: title, text: `Échéances du personnel à traiter :\n\n${lines.join('\n')}`, type: 'hr_document_due' });
      }
    }
  }
  return { items: fresh.size, message: `${fresh.size} échéance(s) signalée(s) sous ${days.join(' / ')} jour(s)` };
}

/**
 * G1-09 — écritures récurrentes : instancie les modèles d'écritures périodiques dont
 * l'échéance est atteinte (date de Casablanca). Une échéance refusée (période comptable
 * fermée…) met la tâche en erreur avec son motif ; les autres sont passées quand même.
 */
async function recurringEntries(): Promise<JobResult> {
  const today = (await db.query(`SELECT to_char((now() AT TIME ZONE 'Africa/Casablanca')::date, 'YYYY-MM-DD') AS d`)).rows[0].d as string;
  const { posted, errors } = await journalTemplateRepository.runRecurring(today, await systemUserId());
  if (errors.length) throw new Error(`${posted} écriture(s) passée(s) ; ${errors.length} échéance(s) refusée(s) : ${errors.join(' | ')}`);
  return { items: posted, message: posted ? `${posted} écriture(s) récurrente(s) passée(s)` : 'Aucune échéance à instancier' };
}

async function webhookOutbox(): Promise<JobResult> {
  const r = await webhookRepository.deliverPending();
  return { items: r.sent, message: `${r.sent} envoyé(s)${r.failed ? ` · ${r.failed} échec(s)` : ''}` };
}

/** Points de commande (G5-02) : appliqués en mode calculé, proposés en mode manuel. */
async function reorderPoints(): Promise<JobResult> {
  const r = await reorderPointRepository.recalculate();
  return { items: r.applied + r.proposed, message: `${r.applied} appliqué(s) · ${r.proposed} proposition(s) à valider` };
}

export const JOBS: Record<string, Handler> = {
  email_outbox: emailOutbox,
  webhook_outbox: webhookOutbox,
  purchase_suggestions: purchaseSuggestions,
  complaints_overdue: complaintsOverdue,
  project_tasks_overdue: projectTasksOverdue,
  maintenance_due: maintenanceDue,
  rfq_deadline: rfqDeadline,
  quotes_expire: quotesExpire,
  dunning_run: () => dunningRepository.run(),
  crm_activities_due: crmActivitiesDue,
  loyalty_expire: loyaltyExpireDue,
  ledger_seal: () => ledgerIntegrityRepository.sealAuto(),
  ledger_outbox_replay: ledgerOutboxReplay,
  ledger_guards_check: () => ledgerIntegrityRepository.checkGuards(),
  ledger_partitions: ledgerPartitions,
  monthly_invoicing: () => monthlyInvoicing(),
  depreciation_monthly: depreciationMonthly,
  prepaid_recognition: prepaidRecognition,
  lots_expire: lotsExpire,
  dlc_alerts: dlcAlerts,
  hr_documents_due: hrDocumentsDue,
  recurring_entries: recurringEntries,
  reorder_points: reorderPoints,
  cycle_counts: cycleCountJob,
  housekeeping,
};

/* ─── Moteur ──────────────────────────────────────────────────────────────── */

/** Exécute une tâche et trace le passage. Ne lève pas : l'erreur est enregistrée. */
export async function runJob(key: string, trigger: 'auto' | 'manual' | 'external', userId: string | null = null) {
  const handler = JOBS[key];
  if (!handler) throw new Error(`Tâche inconnue : ${key}`);
  const run = await db.query(
    `INSERT INTO scheduled_job_runs (job_key, trigger, triggered_by) VALUES ($1, $2, $3) RETURNING id`, [key, trigger, userId]);
  const started = Date.now();
  let status: 'ok' | 'error' = 'ok'; let result: JobResult = { items: 0, message: '' };
  try {
    result = await handler();
  } catch (err) {
    status = 'error';
    result = { items: 0, message: err instanceof Error ? err.message : String(err) };
    logger.error({ job: key, err: result.message }, 'tâche planifiée en erreur');
  }
  const ms = Date.now() - started;
  await db.query(
    `UPDATE scheduled_job_runs SET finished_at = now(), status = $2, items = $3, message = $4 WHERE id = $1`,
    [run.rows[0].id, status, result.items, result.message.slice(0, 2000)]);
  await db.query(
    `UPDATE scheduled_jobs SET last_run_at = now(), last_status = $2, last_message = $3, last_duration_ms = $4,
            next_run_at = now() + (interval_minutes || ' minutes')::interval WHERE key = $1`,
    [key, status, result.message.slice(0, 2000), ms]);
  return { key, status, ...result, durationMs: ms };
}

/**
 * Passe sur les tâches dues. Renvoie null si un autre passage tient déjà le verrou.
 * Le verrou de session est pris sur une connexion dédiée et toujours relâché.
 */
export async function runDueJobs(trigger: 'auto' | 'external' = 'auto') {
  const client = await db.getClient();
  try {
    const lock = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!lock.rows[0].ok) return null;
    try {
      await db.query(`UPDATE scheduler_state SET ${trigger === 'external' ? 'last_external_tick' : 'last_internal_tick'} = now()`);
      const due = await db.query(
        `SELECT key FROM scheduled_jobs WHERE enabled AND next_run_at <= now() ORDER BY display_order`);
      const results = [];
      for (const j of due.rows) {
        if (JOBS[j.key]) results.push(await runJob(j.key, trigger));
      }
      return results;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

let timer: NodeJS.Timeout | null = null;

/** Déclencheur interne (toutes les minutes). Coupé par SCHEDULER_DISABLED=true et en test. */
export function startScheduler() {
  if (timer || process.env.SCHEDULER_DISABLED === 'true' || process.env.NODE_ENV === 'test') return;
  const tick = () => { runDueJobs('auto').catch(err => logger.error({ err: String(err) }, 'planificateur : passage en erreur')); };
  setTimeout(tick, 15_000).unref();
  timer = setInterval(tick, 60_000);
  timer.unref();
  logger.info('planificateur interne démarré (toutes les minutes)');
}
