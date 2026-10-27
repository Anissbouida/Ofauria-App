import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';
import { mailStatus, sendTestEmail, processOutbox } from '../services/mailer.js';
import { JOBS, runJob, runDueJobs } from '../services/scheduler.js';

/**
 * Paramètres › E-mails et Tâches planifiées (mig 364). Droits : section « notifications ».
 */
export const automationRouter = Router();

function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }

/* ─── E-mails ─────────────────────────────────────────────────────────────── */
automationRouter.get('/mail', authenticate, authorizeSettings('notifications'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [status, counts] = await Promise.all([
    mailStatus(),
    db.query(`SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
                     COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                     COUNT(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '30 days')::int AS sent_30d
                FROM email_outbox`),
  ]);
  res.json({ success: true, data: { ...status, counts: counts.rows[0] } });
}));

automationRouter.put('/mail', authenticate, authorizeSettings('notifications', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({
    enabled: z.boolean().optional(),
    fromName: z.string().trim().max(120).nullish(),
    replyTo: z.string().trim().email().max(255).nullish().or(z.literal('')),
    footer: z.string().trim().max(500).nullish(),
  }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const d = b.data;
  await auditedQuery(req.user!.userId,
    `UPDATE mail_settings SET enabled = COALESCE($1, enabled),
            from_name = CASE WHEN $2::boolean THEN $3 ELSE from_name END,
            reply_to  = CASE WHEN $4::boolean THEN $5 ELSE reply_to END,
            footer    = CASE WHEN $6::boolean THEN $7 ELSE footer END,
            updated_by = $8, updated_at = now()`,
    [d.enabled ?? null, d.fromName !== undefined, d.fromName || null, d.replyTo !== undefined, d.replyTo || null,
     d.footer !== undefined, d.footer || null, req.user!.userId]);
  res.json({ success: true, data: await mailStatus() });
}));

automationRouter.post('/mail/test', authenticate, authorizeSettings('notifications', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ to: z.string().trim().email() }).safeParse(req.body);
  if (!b.success) { bad(res, 'Adresse e-mail invalide'); return; }
  try {
    await sendTestEmail(b.data.to);
    res.json({ success: true, data: { to: b.data.to } });
  } catch (err) {
    bad(res, `Envoi refusé : ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}));

automationRouter.get('/mail/outbox', authenticate, authorizeSettings('notifications'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({ status: z.enum(['queued', 'sent', 'failed', 'cancelled']).optional() }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const r = await db.query(
    `SELECT o.id, o.to_email, o.to_name, o.subject, o.type, o.reference_type, o.status, o.attempts, o.last_error,
            o.next_attempt_at, o.sent_at, o.created_at, nr.label AS type_label
       FROM email_outbox o LEFT JOIN notification_rules nr ON nr.type = o.type
      WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 100`, [q.data.status ?? null]);
  res.json({ success: true, data: r.rows });
}));

/** Relance un message en échec (ou en attente) maintenant ; ou l'annule. */
automationRouter.post('/mail/outbox/:id/:action', authenticate, authorizeSettings('notifications', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success || !['retry', 'cancel'].includes(req.params.action)) { bad(res); return; }
  const r = req.params.action === 'retry'
    ? await db.query(`UPDATE email_outbox SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
                       WHERE id = $1 AND status IN ('failed', 'queued', 'cancelled') RETURNING id`, [id.data])
    : await db.query(`UPDATE email_outbox SET status = 'cancelled' WHERE id = $1 AND status IN ('queued', 'failed') RETURNING id`, [id.data]);
  if (!r.rows[0]) { bad(res, 'Message introuvable ou déjà envoyé', 404); return; }
  if (req.params.action === 'retry') await processOutbox(10).catch(() => null);
  res.json({ success: true });
}));

/* ─── Tâches planifiées ───────────────────────────────────────────────────── */
automationRouter.get('/jobs', authenticate, authorizeSettings('notifications'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [jobs, runs, ext] = await Promise.all([
    db.query(`SELECT j.*, ${'u.first_name || \' \' || u.last_name'} AS updated_by_name FROM scheduled_jobs j LEFT JOIN users u ON u.id = j.updated_by ORDER BY j.display_order`),
    db.query(`SELECT * FROM (SELECT r.*, row_number() OVER (PARTITION BY r.job_key ORDER BY r.started_at DESC) AS rn FROM scheduled_job_runs r) x
               WHERE rn <= 10 ORDER BY started_at DESC`),
    db.query(`SELECT last_external_tick AS last, last_internal_tick AS internal FROM scheduler_state LIMIT 1`),
  ]);
  res.json({ success: true, data: {
    jobs: jobs.rows.map(j => ({ ...j, implemented: !!JOBS[j.key], runs: runs.rows.filter(r => r.job_key === j.key) })),
    engine: {
      internal: process.env.SCHEDULER_DISABLED !== 'true',
      externalConfigured: (process.env.CRON_SECRET ?? '').length >= 32,
      lastExternalTick: ext.rows[0]?.last ?? null,
      lastInternalTick: ext.rows[0]?.internal ?? null,
    },
  } });
}));

automationRouter.patch('/jobs/:key', authenticate, authorizeSettings('notifications', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ enabled: z.boolean().optional(), intervalMinutes: z.coerce.number().int().min(1).max(10080).optional() }).safeParse(req.body);
  if (!b.success || !JOBS[req.params.key]) { bad(res, b.success ? 'Tâche inconnue' : b.error.issues[0]?.message); return; }
  const r = await auditedQuery(req.user!.userId,
    `UPDATE scheduled_jobs SET enabled = COALESCE($2, enabled), interval_minutes = COALESCE($3, interval_minutes),
            next_run_at = CASE WHEN $3::int IS NOT NULL THEN LEAST(next_run_at, now() + ($3::int || ' minutes')::interval) ELSE next_run_at END,
            updated_by = $4, updated_at = now() WHERE key = $1 RETURNING *`,
    [req.params.key, b.data.enabled ?? null, b.data.intervalMinutes ?? null, req.user!.userId]);
  res.json({ success: true, data: r.rows[0] });
}));

automationRouter.post('/jobs/:key/run', authenticate, authorizeSettings('notifications', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!JOBS[req.params.key]) { bad(res, 'Tâche inconnue', 404); return; }
  res.json({ success: true, data: await runJob(req.params.key, 'manual', req.user!.userId) });
}));

/* ─── Déclencheur externe (Cloud Scheduler) ───────────────────────────────── */
/**
 * POST /api/v1/cron/tick, en-tête X-Cron-Secret. Monté AVANT le contrôle d'origine anti-CSRF
 * (app.ts) : l'appel vient d'un serveur, sans cookie ni Origin ; c'est le secret qui authentifie.
 * Sans CRON_SECRET (≥ 32 caractères) la route répond 404.
 */
export async function cronTick(req: Request, res: Response) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = String(req.headers['x-cron-secret'] ?? '');
  if (secret.length < 32) { res.status(404).end(); return; }
  const a = Buffer.from(given); const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ success: false }); return; }
  try {
    const results = await runDueJobs('external');
    res.json({ success: true, data: results ?? { skipped: 'Un passage est déjà en cours' } });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
}
