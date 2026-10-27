import nodemailer, { type Transporter } from 'nodemailer';
import { db } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Envoi d'e-mails (mig 364).
 *
 * Les identifiants du serveur d'envoi ne sont jamais en base : variables d'environnement
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true pour 465), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM (adresse d'expédition, ex. « noreply@domaine.ma »).
 * En développement, MAIL_TRANSPORT=log journalise les messages au lieu de les envoyer.
 * La base porte seulement l'expéditeur affiché, la réponse et le pied (mail_settings).
 *
 * Toute l'application passe par la file `email_outbox` : un écran ou un trigger met en
 * file, la tâche planifiée `email_outbox` envoie. Un échec n'interrompt jamais l'action
 * métier qui a déclenché le message.
 */

export type MailMode = 'smtp' | 'log' | 'off';

const MAX_ATTEMPTS = 5;
// Délai avant la tentative n (minutes) : 1, 5, 15, 60.
const RETRY_MINUTES = [1, 5, 15, 60];

function mode(): MailMode {
  if (process.env.MAIL_TRANSPORT === 'log') return 'log';
  return process.env.SMTP_HOST && process.env.SMTP_FROM ? 'smtp' : 'off';
}

let cached: { key: string; transporter: Transporter } | null = null;
function transporter(): Transporter {
  const m = mode();
  const key = `${m}|${process.env.SMTP_HOST}|${process.env.SMTP_PORT}|${process.env.SMTP_USER}`;
  if (cached?.key === key) return cached.transporter;
  const t = m === 'log'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
        connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      });
  cached = { key, transporter: t };
  return t;
}

type MailSettings = { enabled: boolean; from_name: string | null; reply_to: string | null; footer: string | null };

async function settings(): Promise<MailSettings> {
  const r = await db.query(`SELECT enabled, from_name, reply_to, footer FROM mail_settings LIMIT 1`);
  return r.rows[0] ?? { enabled: true, from_name: null, reply_to: null, footer: null };
}

/** État affiché dans Paramètres : mode, expéditeur, serveur (sans secret). */
export async function mailStatus() {
  const s = await settings();
  const m = mode();
  return {
    mode: m,
    configured: m !== 'off',
    enabled: s.enabled,
    fromAddress: m === 'log' ? (process.env.SMTP_FROM || 'journal@kalum.local') : (process.env.SMTP_FROM ?? null),
    host: m === 'smtp' ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` : null,
    settings: s,
  };
}

async function send(to: { email: string; name?: string | null }, subject: string, text: string, s: MailSettings) {
  const from = process.env.SMTP_FROM || 'journal@kalum.local';
  const body = s.footer ? `${text}\n\n—\n${s.footer}` : text;
  const info = await transporter().sendMail({
    from: s.from_name ? { name: s.from_name, address: from } : from,
    to: to.name ? { name: to.name, address: to.email } : to.email,
    replyTo: s.reply_to || undefined,
    subject,
    text: body,
  });
  if (mode() === 'log') logger.info({ to: to.email, subject }, 'mail (journal) : non envoyé, MAIL_TRANSPORT=log');
  return info;
}

/** Met un e-mail en file (hors notifications : envoi de pièce, test…). */
export async function enqueueEmail(p: {
  to: string; toName?: string | null; subject: string; text: string; userId?: string | null;
  type?: string; referenceType?: string | null; referenceId?: string | null; createdBy?: string | null;
}) {
  const r = await db.query(
    `INSERT INTO email_outbox (to_email, to_name, user_id, subject, body_text, type, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [p.to, p.toName ?? null, p.userId ?? null, p.subject.slice(0, 255), p.text, p.type ?? 'manual',
     p.referenceType ?? null, p.referenceId ?? null, p.createdBy ?? null]);
  return r.rows[0];
}

/**
 * Envoie les messages dus. Sans serveur configuré ou envoi coupé : rien n'est tenté,
 * les messages attendent (ils partiront une fois l'envoi configuré).
 * Chaque message est verrouillé (SKIP LOCKED) : deux passages simultanés ne doublonnent pas.
 */
export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number; waiting: number; message: string }> {
  const s = await settings();
  if (mode() === 'off' || !s.enabled) {
    const w = await db.query(`SELECT COUNT(*)::int AS n FROM email_outbox WHERE status = 'queued'`);
    return { sent: 0, failed: 0, waiting: w.rows[0].n, message: mode() === 'off' ? 'Serveur d\'envoi non configuré' : 'Envoi coupé dans les paramètres' };
  }
  // Un message resté en file plus de 72 h (serveur d'envoi pas encore configuré, envoi coupé)
  // n'est plus d'actualité : annulé plutôt qu'envoyé en retard avec tout l'arriéré.
  await db.query(
    `UPDATE email_outbox SET status = 'cancelled', last_error = 'Trop ancien : non envoyé (plus de 72 h en attente)'
      WHERE status = 'queued' AND created_at < now() - interval '72 hours'`);
  let sent = 0; let failed = 0;
  for (let i = 0; i < limit; i++) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT * FROM email_outbox WHERE status = 'queued' AND next_attempt_at <= now()
          ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const m = r.rows[0];
      if (!m) { await client.query('COMMIT'); break; }
      try {
        await send({ email: m.to_email, name: m.to_name }, m.subject, m.body_text, s);
        await client.query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [m.id]);
        sent++;
      } catch (err) {
        const attempts = Number(m.attempts) + 1;
        const final = attempts >= MAX_ATTEMPTS;
        const msg = err instanceof Error ? err.message : String(err);
        await client.query(
          `UPDATE email_outbox SET attempts = $2, last_error = $3, status = $4,
                  next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1`,
          [m.id, attempts, msg.slice(0, 1000), final ? 'failed' : 'queued', String(RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)])]);
        if (final) failed++;
        logger.warn({ id: m.id, to: m.to_email, attempts, err: msg }, 'mail: échec d\'envoi');
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  const w = await db.query(`SELECT COUNT(*)::int AS n FROM email_outbox WHERE status = 'queued'`);
  return { sent, failed, waiting: w.rows[0].n, message: `${sent} envoyé(s)${failed ? `, ${failed} en échec définitif` : ''}` };
}

/** Envoi immédiat d'un message de test (hors file) : renvoie l'erreur du serveur telle quelle. */
export async function sendTestEmail(to: string) {
  if (mode() === 'off') throw new Error('Serveur d\'envoi non configuré (variables SMTP_HOST et SMTP_FROM)');
  const s = await settings();
  await send({ email: to }, 'Kalum · e-mail de test',
    'Ce message confirme que l\'envoi d\'e-mails fonctionne.\nLes alertes activées dans Paramètres › Notifications partiront à cette adresse.', s);
}
