/**
 * Inaltérabilité du grand livre (mig 413).
 *
 * Le scellement chaîne chaque écriture comptabilisée par empreinte SHA-256
 * (fn_ledger_seal) ; la vérification recalcule toute la chaîne et les ancres
 * de clôture (fn_ledger_verify). On expose aussi l'état des triggers de garde :
 * un trigger désactivé ne bloque plus rien, seule la chaîne le révèle ensuite.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { createNotification } from '../utils/notify.js';
import { logger } from '../utils/logger.js';

/** Triggers dont dépend l'inaltérabilité, avec leur rôle lisible. */
const GUARDS = [
  { table: 'journal_entries', trigger: 'trg_check_journal_entry_balance', role: 'Équilibre débit = crédit à la validation' },
  { table: 'journal_entries', trigger: 'trg_check_period_lock', role: 'Verrou des périodes clôturées' },
  { table: 'journal_entries', trigger: 'trg_journal_entry_guard', role: 'En-tête figé après validation' },
  { table: 'journal_entry_lines', trigger: 'trg_journal_line_guard', role: 'Lignes figées après validation' },
  { table: 'journal_entries', trigger: 'trg_journal_entry_audit', role: 'Trace des validations et extournes' },
  { table: 'journal_entry_lines', trigger: 'trg_journal_line_lettrage_audit', role: 'Trace du lettrage' },
  { table: 'fiscal_periods', trigger: 'trg_fiscal_period_status', role: 'Clôture séquentielle et ancrage' },
  { table: 'ledger_audit_log', trigger: 'ledger_audit_log_append_only', role: "Journal d'audit en ajout seul" },
] as const;

type Queryable = PoolClient | typeof db;

export type IntegrityActor = { userId: string | null; ip?: string | null };

export type AuditEvent = 'post' | 'reverse' | 'draft_delete' | 'letter' | 'unletter' | 'reletter' | 'seal' | 'verify' | 'outbox_replay' | 'year_close' | 'fec_export' | 'redated' | 'guards_check';

async function logEvent(
  client: Queryable,
  event: AuditEvent,
  actor: IntegrityActor,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO ledger_audit_log (event, actor, client_ip, details) VALUES ($1, $2, $3, $4)`,
    [event, actor.userId, actor.ip || null, JSON.stringify(details)]);
}

async function head(client: Queryable = db) {
  const r = await client.query(
    `SELECT chain_seq::int AS seq, chain_hash AS hash FROM journal_entries
      WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`);
  return (r.rows[0] as { seq: number; hash: string } | undefined) ?? { seq: 0, hash: null };
}

export const ledgerIntegrityRepository = {
  async status() {
    const [chain, top, guards, lastVerify, lastAnchor] = await Promise.all([
      db.query(
        `SELECT count(*) FILTER (WHERE chain_seq IS NOT NULL)::int AS sealed,
                count(*) FILTER (WHERE chain_seq IS NULL)::int AS unsealed,
                max(sealed_at) AS last_sealed_at,
                min(posted_at) FILTER (WHERE chain_seq IS NULL) AS oldest_unsealed_at
           FROM journal_entries WHERE status IN ('posted','reversed')`),
      head(),
      db.query(
        `SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND t.tgname = ANY($1)`, [GUARDS.map(g => g.trigger)]),
      db.query(
        `SELECT l.at, l.details, u.first_name, u.last_name
           FROM ledger_audit_log l LEFT JOIN users u ON u.id = l.actor
          WHERE l.event = 'verify' ORDER BY l.id DESC LIMIT 1`),
      db.query(
        `SELECT e.at, e.to_status, e.chain_seq::int AS chain_seq, e.chain_hash, fp.month, fp.year
           FROM fiscal_period_events e JOIN fiscal_periods fp ON fp.id = e.period_id
          WHERE e.chain_seq IS NOT NULL ORDER BY e.at DESC LIMIT 1`),
    ]);
    const found = new Map((guards.rows as { table_name: string; trigger_name: string; enabled: string }[])
      .map(g => [`${g.table_name}.${g.trigger_name}`, g.enabled]));
    return {
      ...chain.rows[0],
      headSeq: top.seq,
      headHash: top.hash,
      // 'O' = actif, 'A' = actif même en réplication ; 'D' = désactivé ; absent = supprimé.
      guards: GUARDS.map(g => {
        const state = found.get(`${g.table}.${g.trigger}`);
        return { ...g, enabled: state === 'O' || state === 'A', missing: state === undefined };
      }),
      lastVerify: lastVerify.rows[0] ?? null,
      lastAnchor: lastAnchor.rows[0] ?? null,
    };
  },

  /** Scelle les écritures en attente ; l'action est tracée. */
  async seal(actor: IntegrityActor) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actor.userId);
      const r = await client.query(`SELECT fn_ledger_seal() AS n`);
      const sealed = r.rows[0].n as number;
      const top = await head(client);
      await logEvent(client, 'seal', actor, { sealed, head_seq: top.seq });
      await client.query('COMMIT');
      return { sealed, headSeq: top.seq, headHash: top.hash };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Tâche planifiée : ne trace que les passages qui ont scellé quelque chose. */
  async sealAuto() {
    const r = await db.query(`SELECT fn_ledger_seal() AS n`);
    const sealed = r.rows[0].n as number;
    if (sealed > 0) await logEvent(db, 'seal', { userId: null }, { sealed, head_seq: (await head()).seq, auto: true });
    return { items: sealed, message: sealed ? `${sealed} écriture(s) scellée(s)` : 'Rien à sceller' };
  },

  /**
   * Surveillance planifiée des protections du grand livre (plan compta, étape 10, audit C-08).
   * Trigger absent ou désactivé, session_replication_role forcé sur la base ou le rôle, chaîne
   * d'empreintes rompue (vérifiée au plus toutes les 6 h : le recalcul porte sur toute la chaîne).
   * Le résultat est tracé (événement guards_check) ; les responsables sont prévenus au PREMIER
   * passage en anomalie, pas à chaque passage tant qu'elle dure.
   */
  async checkGuards() {
    const guards = (await db.query(`SELECT table_name, trigger_name, enabled FROM fn_ledger_guards_status()`)).rows as
      { table_name: string; trigger_name: string; enabled: boolean }[];
    const disabled = guards.filter(g => !g.enabled).map(g => `${g.table_name}.${g.trigger_name}`);
    const forced = (await db.query(
      `SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) AS c WHERE c LIKE 'session_replication_role=%' LIMIT 1`)).rows.length > 0;
    const sessionRole = String((await db.query(`SELECT current_setting('session_replication_role') AS v`)).rows[0].v);
    const lastVerify = (await db.query(
      `SELECT at, (details->>'ok')::boolean AS ok FROM ledger_audit_log WHERE event = 'verify' ORDER BY id DESC LIMIT 1`)).rows[0] as { at: Date; ok: boolean } | undefined;
    let chainOk = lastVerify ? lastVerify.ok : true;
    let verified = false;
    if (!lastVerify || Date.now() - new Date(lastVerify.at).getTime() > 6 * 3_600_000) {
      chainOk = (await this.verify({ userId: null })).ok;
      verified = true;
    }
    const ok = disabled.length === 0 && !forced && sessionRole === 'origin' && chainOk;
    const previous = (await db.query(
      `SELECT (details->>'ok')::boolean AS ok FROM ledger_audit_log WHERE event = 'guards_check' ORDER BY id DESC LIMIT 1`)).rows[0] as { ok: boolean } | undefined;
    await logEvent(db, 'guards_check', { userId: null }, { ok, disabled, replication_role_forced: forced, session_replication_role: sessionRole, chain_ok: chainOk, verified });
    if (!ok) {
      const what = [
        disabled.length ? `trigger(s) désactivé(s) : ${disabled.join(', ')}` : null,
        forced || sessionRole !== 'origin' ? 'mode de réplication forcé (les triggers sont ignorés)' : null,
        chainOk ? null : 'chaîne d\'empreintes rompue',
      ].filter(Boolean).join(' ; ');
      logger.error({ details: [what] }, '[ledger] protections du grand livre en anomalie');
      if (!previous || previous.ok) {
        for (const targetRole of ['manager', 'admin']) {
          await createNotification({
            targetRole, type: 'ledger_guards', referenceType: 'ledger_guards',
            title: 'Grand livre : protections en anomalie',
            message: `La surveillance du grand livre a relevé : ${what}. Les écritures ne sont plus protégées tant que ce n'est pas corrigé ; la clôture du mois est bloquée.`,
          });
        }
      }
    }
    return {
      items: disabled.length + (chainOk ? 0 : 1),
      message: ok ? `Protections actives${verified ? ', chaîne vérifiée' : ''}` : `ANOMALIE : ${disabled.length} trigger(s) désactivé(s)${chainOk ? '' : ', chaîne rompue'}${forced ? ', réplication forcée' : ''}`,
    };
  },

  /** Recalcule la chaîne et les ancres ; le résultat est tracé. */
  async verify(actor: IntegrityActor) {
    const [anomalies, count, top] = await Promise.all([
      db.query(`SELECT seq::int AS seq, entry_id, entry_no, problem FROM fn_ledger_verify(200)`),
      db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE chain_seq IS NOT NULL`),
      head(),
    ]);
    const result = {
      ok: anomalies.rows.length === 0,
      checked: count.rows[0].n as number,
      headSeq: top.seq,
      headHash: top.hash,
      anomalies: anomalies.rows as { seq: number; entry_id: string | null; entry_no: string | null; problem: string }[],
    };
    await logEvent(db, 'verify', actor, {
      ok: result.ok, anomalies: result.anomalies.length, checked: result.checked, head_seq: top.seq,
    });
    return result;
  },

  async auditLog(p: { event?: string; entryId?: string; before?: number; limit?: number }) {
    const r = await db.query(
      `SELECT l.id::text AS id, l.at, l.event, l.entry_id, l.entry_number, l.line_id, l.lettrage_id,
              l.client_ip::text AS client_ip, l.details, u.first_name, u.last_name
         FROM ledger_audit_log l LEFT JOIN users u ON u.id = l.actor
        WHERE ($1::text IS NULL OR l.event = $1)
          AND ($2::uuid IS NULL OR l.entry_id = $2)
          AND ($3::bigint IS NULL OR l.id < $3)
        ORDER BY l.id DESC LIMIT $4`,
      [p.event ?? null, p.entryId ?? null, p.before ?? null, Math.min(Math.max(p.limit ?? 50, 1), 200)]);
    return r.rows;
  },

  logOutboxReplay(actor: IntegrityActor, result: { replayed: number; posted: number; failed: number }, onlyId?: string) {
    return logEvent(db, 'outbox_replay', actor, { ...result, outbox_id: onlyId ?? null });
  },
};
