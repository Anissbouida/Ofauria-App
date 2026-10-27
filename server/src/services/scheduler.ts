import { db } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { processOutbox } from './mailer.js';
import { maintenanceRepository } from '../repositories/maintenance.repository.js';
import { dunningRepository } from '../repositories/dunning.repository.js';
import { expireDue as loyaltyExpireDue } from './loyalty.js';

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
    const it = await maintenanceRepository.createFromPlan(pl.id, { userId: null as unknown as string, storeId: pl.store_id });
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
       `${q.customer_label ?? q.prospect_label ?? ''} — ${Number(q.total).toFixed(2)} DH : relancer le client ou classer le devis`, q.id]);
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

async function housekeeping(): Promise<JobResult> {
  const a = await db.query(`DELETE FROM scheduled_job_runs WHERE started_at < now() - interval '30 days'`);
  const b = await db.query(`DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < now() - interval '90 days'`);
  const n = (a.rowCount ?? 0) + (b.rowCount ?? 0);
  return { items: n, message: `${a.rowCount ?? 0} passage(s) et ${b.rowCount ?? 0} e-mail(s) supprimés` };
}

async function emailOutbox(): Promise<JobResult> {
  const r = await processOutbox();
  return { items: r.sent, message: `${r.message}${r.waiting ? ` · ${r.waiting} en attente` : ''}` };
}

export const JOBS: Record<string, Handler> = {
  email_outbox: emailOutbox,
  complaints_overdue: complaintsOverdue,
  project_tasks_overdue: projectTasksOverdue,
  maintenance_due: maintenanceDue,
  rfq_deadline: rfqDeadline,
  quotes_expire: quotesExpire,
  dunning_run: () => dunningRepository.run(),
  crm_activities_due: crmActivitiesDue,
  loyalty_expire: loyaltyExpireDue,
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
