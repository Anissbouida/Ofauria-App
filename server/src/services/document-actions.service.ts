import { db } from '../config/database.js';

/**
 * Journal des actions de document (refonte Achats D3, G-D3-03, mig 306).
 *
 * Une ligne par action métier (créé, envoyé, reçu, annulé, bloqué…) avec auteur, canal,
 * motif codé et montant au moment de l'action. Append-only en base (trigger de refus).
 * À appeler DANS LA MÊME TRANSACTION que la mutation qu'elle décrit : si la mutation
 * échoue, l'action n'est pas journalisée ; si le journal échoue, la mutation est annulée.
 *
 * Analogie Oracle : PO_ACTION_HISTORY alimentée par le package d'API, pas par l'écran.
 */

export type DocumentType = 'purchase_request' | 'purchase_order' | 'reception_voucher' | 'supplier_invoice' | 'expense_payment' | 'supplier' | 'payment';

export type DocumentAction =
  | 'created' | 'submitted' | 'approved' | 'rejected' | 'returned' | 'auto_approved'
  | 'sent' | 'acknowledged' | 'received' | 'invoiced' | 'paid' | 'changed'
  | 'cancelled' | 'not_delivered' | 'reopened' | 'closed' | 'force_closed'
  | 'held' | 'released' | 'frozen' | 'unfrozen' | 'locked' | 'unlocked'
  | 'escalated' | 'delegated' | 'deleted' | 'reversed';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export interface RecordActionInput {
  documentType: DocumentType;
  documentId: string;
  action: DocumentAction;
  actorId: string | null;
  onBehalfOf?: string | null;
  channel?: 'web' | 'email_token' | 'whatsapp' | 'auto' | 'script';
  reasonCodeId?: string | null;
  note?: string | null;
  snapshotAmount?: number | null;
  diff?: Record<string, unknown> | null;
}

export async function recordAction(client: Queryable, a: RecordActionInput): Promise<void> {
  await client.query(
    `INSERT INTO document_actions
       (document_type, document_id, action, actor_id, on_behalf_of, channel, reason_code_id, note, snapshot_amount, diff)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [a.documentType, a.documentId, a.action, a.actorId, a.onBehalfOf ?? null, a.channel ?? 'web',
     a.reasonCodeId ?? null, a.note ?? null, a.snapshotAmount ?? null, a.diff ? JSON.stringify(a.diff) : null],
  );
}

/** Pose l'auteur de la transaction pour l'audit SGBD (équivalent DBMS_SESSION.SET_CONTEXT). */
export async function withActor(client: Queryable, userId: string | null | undefined): Promise<void> {
  if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
}

type HttpError = Error & { statusCode: number; code?: string };
function httpError(statusCode: number, message: string, code?: string): HttpError {
  const e = new Error(message) as HttpError;
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

/**
 * Vérifie qu'un code motif existe, est actif et autorisé pour l'action (scope),
 * et que la note est présente quand le motif l'exige. Renvoie l'id du motif.
 */
export async function assertReasonCode(
  client: Queryable, reasonCodeId: string, scope: string, note?: string | null,
): Promise<string> {
  const r = await client.query(
    `SELECT id, label, COALESCE((metadata->>'requires_note')::boolean, false) AS requires_note
       FROM ref_entries
      WHERE id = $1 AND table_id = 'purchase_reason_codes' AND is_active AND metadata -> 'scope' ? $2`,
    [reasonCodeId, scope],
  );
  const row = r.rows[0];
  if (!row) throw httpError(400, 'Motif invalide pour cette action', 'REASON_CODE_INVALID');
  if (row.requires_note && !(note && note.trim().length >= 3)) {
    throw httpError(400, `Le motif « ${row.label as string} » exige une précision`, 'REASON_NOTE_REQUIRED');
  }
  return row.id as string;
}

/** Historique ordonné d'un document, pour la ui-timeline. */
export async function listActions(documentType: DocumentType, documentId: string) {
  const r = await db.query(
    `SELECT a.id, a.seq, a.action, a.channel, a.note, a.snapshot_amount, a.diff, a.acted_at,
            a.reason_code_id, re.code AS reason_code, re.label AS reason_label,
            COALESCE(u.first_name || ' ' || u.last_name, u.email) AS actor_name,
            COALESCE(ob.first_name || ' ' || ob.last_name, ob.email) AS on_behalf_of_name
       FROM document_actions a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN users ob ON ob.id = a.on_behalf_of
       LEFT JOIN ref_entries re ON re.id = a.reason_code_id
      WHERE a.document_type = $1 AND a.document_id = $2
      ORDER BY a.seq`,
    [documentType, documentId],
  );
  return r.rows;
}
