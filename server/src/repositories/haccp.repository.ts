import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';
import { createNotification } from '../utils/notify.js';
import { ingredientLotRepository } from './ingredient-lot.repository.js';

/**
 * Plan de maîtrise sanitaire (mig 315) : relevés de température, plan de
 * nettoyage, actions correctives, contrôle à réception.
 * Règle : toute anomalie (relevé hors plage, nettoyage non conforme, réception
 * non conforme) ouvre une action corrective et prévient le gérant. Les chefs
 * saisissent ; le gérant valide.
 */

export type ActionSource = 'temperature' | 'cleaning' | 'reception' | 'other';
export type ActionStatus = 'open' | 'done' | 'validated';

const USER_NAME = (alias: string) => `COALESCE(NULLIF(TRIM(${alias}.first_name || ' ' || ${alias}.last_name), ''), ${alias}.email)`;

/** Visible par le magasin : rattaché au magasin ou commun (store_id NULL). */
const STORE_SCOPE = (col: string, param: string) => `(${col} IS NULL OR ${param}::uuid IS NULL OR ${col} = ${param}::uuid)`;

async function notifyManagers(p: { storeId: string | null; title: string; message: string; actionId: string; userId: string }) {
  for (const targetRole of ['manager', 'admin']) {
    await createNotification({
      targetRole, storeId: p.storeId ?? undefined, type: 'haccp_alert', title: p.title, message: p.message,
      referenceType: 'haccp_action', referenceId: p.actionId, createdBy: p.userId,
    });
  }
}

async function insertAction(client: PoolClient | typeof db, a: {
  storeId: string | null; source: ActionSource; sourceId: string | null; problem: string;
  actionTaken?: string | null; userId: string;
}) {
  const taken = a.actionTaken?.trim() || null;
  const { rows } = await client.query(
    `INSERT INTO haccp_corrective_actions
       (store_id, source_kind, source_id, problem, action_taken, status, created_by, done_by, done_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [a.storeId, a.source, a.sourceId, a.problem, taken, taken ? 'done' : 'open', a.userId,
      taken ? a.userId : null, taken ? new Date() : null],
  );
  return rows[0];
}

function fmtTemp(v: number) {
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`;
}

export const haccpRepository = {
  // ─── Feuille du jour (écran des chefs) ────────────────────────────────

  async today(storeId: string | null) {
    const tz = getUserTimezone();
    const [equip, tasks, actions] = await Promise.all([
      db.query(
        `SELECT e.id, e.nom, e.type, e.temp_min::float, e.temp_max::float, e.readings_per_day,
                COALESCE(t.count, 0)::int AS readings_today,
                t.last_value::float, t.last_in_range, t.last_at
           FROM production_equipements e
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS count,
                    (array_agg(r.value ORDER BY r.read_at DESC))[1] AS last_value,
                    (array_agg(r.in_range ORDER BY r.read_at DESC))[1] AS last_in_range,
                    MAX(r.read_at) AS last_at
               FROM haccp_temperature_readings r
              WHERE r.equipment_id = e.id
                AND (r.read_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date
                AND ${STORE_SCOPE('r.store_id', '$1')}
           ) t ON true
          WHERE e.haccp_monitored AND e.is_active AND ${STORE_SCOPE('e.store_id', '$1')}
          ORDER BY e.type, e.nom`,
        [storeId],
      ),
      db.query(
        `SELECT k.id, k.zone, k.label, k.frequency, k.method,
                l.done_at AS last_done_at, l.conforme AS last_conforme, l.done_by_name AS last_done_by,
                (l.done_at IS NULL OR (l.done_at AT TIME ZONE '${tz}')::date
                   <= (NOW() AT TIME ZONE '${tz}')::date - (CASE k.frequency WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE 30 END)
                ) AS due
           FROM haccp_cleaning_tasks k
           LEFT JOIN LATERAL (
             SELECT cl.done_at, cl.conforme, ${USER_NAME('u')} AS done_by_name
               FROM haccp_cleaning_logs cl LEFT JOIN users u ON u.id = cl.done_by
              WHERE cl.task_id = k.id AND ${STORE_SCOPE('cl.store_id', '$1')}
              ORDER BY cl.done_at DESC LIMIT 1
           ) l ON true
          WHERE k.is_active AND ${STORE_SCOPE('k.store_id', '$1')}
          ORDER BY k.display_order, k.zone, k.label`,
        [storeId],
      ),
      this.listActions({ storeId, statuses: ['open', 'done'] }),
    ]);
    return { equipment: equip.rows, tasks: tasks.rows, actions };
  },

  // ─── Relevés ──────────────────────────────────────────────────────────

  /**
   * Relevé de température. Hors plage → action corrective obligatoire (déjà
   * réalisée si actionTaken est fourni, sinon ouverte) + alerte au gérant.
   */
  async addReading(p: { equipmentId: string; value: number; note?: string | null; actionTaken?: string | null; storeId: string | null; userId: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: eq } = await client.query(
        `SELECT id, nom, temp_min, temp_max FROM production_equipements
          WHERE id = $1 AND haccp_monitored AND is_active`,
        [p.equipmentId],
      );
      if (!eq[0]) throw Object.assign(new Error('Enceinte inconnue ou non surveillée'), { statusCode: 404 });
      const e = eq[0];
      const inRange = p.value >= Number(e.temp_min) && p.value <= Number(e.temp_max);

      const { rows } = await client.query(
        `INSERT INTO haccp_temperature_readings (equipment_id, store_id, value, temp_min, temp_max, read_by, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [e.id, p.storeId, p.value, e.temp_min, e.temp_max, p.userId, p.note?.trim() || null],
      );
      const reading = rows[0];
      let action = null;
      if (!inRange) {
        action = await insertAction(client, {
          storeId: p.storeId, source: 'temperature', sourceId: reading.id, userId: p.userId,
          problem: `${e.nom} : ${fmtTemp(p.value)} (plage ${fmtTemp(e.temp_min)} à ${fmtTemp(e.temp_max)})`,
          actionTaken: p.actionTaken,
        });
        await client.query(`UPDATE haccp_temperature_readings SET corrective_action_id = $1 WHERE id = $2`, [action.id, reading.id]);
      }
      await client.query('COMMIT');
      if (action) {
        await notifyManagers({
          storeId: p.storeId, actionId: action.id, userId: p.userId,
          title: 'Température hors plage', message: action.problem,
        });
      }
      return { reading: { ...reading, in_range: inRange }, action };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async readingsRegister(p: { storeId: string | null; from: string; to: string; equipmentId?: string; outOfRangeOnly?: boolean }) {
    const tz = getUserTimezone();
    const { rows } = await db.query(
      `SELECT r.id, r.read_at, r.value::float, r.temp_min::float, r.temp_max::float, r.in_range, r.note,
              e.nom AS equipment_name, e.type AS equipment_type, ${USER_NAME('u')} AS read_by_name,
              a.id AS action_id, a.status AS action_status, a.action_taken
         FROM haccp_temperature_readings r
         JOIN production_equipements e ON e.id = r.equipment_id
         LEFT JOIN users u ON u.id = r.read_by
         LEFT JOIN haccp_corrective_actions a ON a.id = r.corrective_action_id
        WHERE (r.read_at AT TIME ZONE '${tz}')::date BETWEEN $2::date AND $3::date
          AND ${STORE_SCOPE('r.store_id', '$1')}
          AND ($4::uuid IS NULL OR r.equipment_id = $4::uuid)
          AND (NOT $5::boolean OR NOT r.in_range)
        ORDER BY r.read_at DESC
        LIMIT 1000`,
      [p.storeId, p.from, p.to, p.equipmentId ?? null, !!p.outOfRangeOnly],
    );
    return rows;
  },

  // ─── Nettoyage ────────────────────────────────────────────────────────

  async logCleaning(p: { taskId: string; conforme: boolean; note?: string | null; actionTaken?: string | null; storeId: string | null; userId: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: t } = await client.query(`SELECT id, zone, label FROM haccp_cleaning_tasks WHERE id = $1 AND is_active`, [p.taskId]);
      if (!t[0]) throw Object.assign(new Error('Tâche de nettoyage inconnue'), { statusCode: 404 });
      const { rows } = await client.query(
        `INSERT INTO haccp_cleaning_logs (task_id, store_id, done_by, conforme, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [p.taskId, p.storeId, p.userId, p.conforme, p.note?.trim() || null],
      );
      let action = null;
      if (!p.conforme) {
        action = await insertAction(client, {
          storeId: p.storeId, source: 'cleaning', sourceId: rows[0].id, userId: p.userId,
          problem: `Nettoyage non conforme — ${t[0].zone} : ${t[0].label}${p.note?.trim() ? ` (${p.note.trim()})` : ''}`,
          actionTaken: p.actionTaken,
        });
        await client.query(`UPDATE haccp_cleaning_logs SET corrective_action_id = $1 WHERE id = $2`, [action.id, rows[0].id]);
      }
      await client.query('COMMIT');
      if (action) {
        await notifyManagers({ storeId: p.storeId, actionId: action.id, userId: p.userId, title: 'Nettoyage non conforme', message: action.problem });
      }
      return { log: rows[0], action };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async cleaningRegister(p: { storeId: string | null; from: string; to: string }) {
    const tz = getUserTimezone();
    const { rows } = await db.query(
      `SELECT l.id, l.done_at, l.conforme, l.note, k.zone, k.label, k.frequency,
              ${USER_NAME('u')} AS done_by_name, a.status AS action_status
         FROM haccp_cleaning_logs l
         JOIN haccp_cleaning_tasks k ON k.id = l.task_id
         LEFT JOIN users u ON u.id = l.done_by
         LEFT JOIN haccp_corrective_actions a ON a.id = l.corrective_action_id
        WHERE (l.done_at AT TIME ZONE '${tz}')::date BETWEEN $2::date AND $3::date
          AND ${STORE_SCOPE('l.store_id', '$1')}
        ORDER BY l.done_at DESC
        LIMIT 1000`,
      [p.storeId, p.from, p.to],
    );
    return rows;
  },

  // ─── Actions correctives ──────────────────────────────────────────────

  async listActions(p: { storeId: string | null; statuses?: ActionStatus[]; from?: string; to?: string }) {
    const tz = getUserTimezone();
    const { rows } = await db.query(
      `SELECT a.*, ${USER_NAME('c')} AS created_by_name, ${USER_NAME('d')} AS done_by_name, ${USER_NAME('v')} AS validated_by_name
         FROM haccp_corrective_actions a
         LEFT JOIN users c ON c.id = a.created_by
         LEFT JOIN users d ON d.id = a.done_by
         LEFT JOIN users v ON v.id = a.validated_by
        WHERE ${STORE_SCOPE('a.store_id', '$1')}
          AND ($2::text[] IS NULL OR a.status = ANY($2::text[]))
          AND ($3::date IS NULL OR (a.created_at AT TIME ZONE '${tz}')::date >= $3::date)
          AND ($4::date IS NULL OR (a.created_at AT TIME ZONE '${tz}')::date <= $4::date)
        ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, a.created_at DESC
        LIMIT 500`,
      [p.storeId, p.statuses ?? null, p.from ?? null, p.to ?? null],
    );
    return rows;
  },

  async createAction(p: { storeId: string | null; problem: string; actionTaken?: string | null; userId: string }) {
    const action = await insertAction(db, { storeId: p.storeId, source: 'other', sourceId: null, problem: p.problem, actionTaken: p.actionTaken, userId: p.userId });
    await notifyManagers({ storeId: p.storeId, actionId: action.id, userId: p.userId, title: 'Non-conformité signalée', message: action.problem });
    return action;
  },

  /** Le chef décrit ce qui a été fait : open → done (en attente de validation). */
  async completeAction(id: string, actionTaken: string, userId: string) {
    const { rows } = await db.query(
      `UPDATE haccp_corrective_actions
          SET action_taken = $2, status = 'done', done_by = $3, done_at = NOW()
        WHERE id = $1 AND status IN ('open', 'done')
        RETURNING *`,
      [id, actionTaken.trim(), userId],
    );
    return rows[0] ?? null;
  },

  /** Gérant : valide (clôture) ou renvoie l'action au chef avec un commentaire. */
  async validateAction(id: string, approve: boolean, note: string | null, userId: string) {
    const { rows } = await db.query(
      approve
        ? `UPDATE haccp_corrective_actions
              SET status = 'validated', validated_by = $2, validated_at = NOW(), validation_note = $3
            WHERE id = $1 AND status = 'done' RETURNING *`
        : `UPDATE haccp_corrective_actions
              SET status = 'open', validation_note = $3, validated_by = $2, validated_at = NULL
            WHERE id = $1 AND status = 'done' RETURNING *`,
      [id, userId, note?.trim() || null],
    );
    return rows[0] ?? null;
  },

  // ─── Configuration ────────────────────────────────────────────────────

  async listEquipment(storeId: string | null) {
    const { rows } = await db.query(
      `SELECT id, nom, type, is_active, haccp_monitored, temp_min::float, temp_max::float, readings_per_day, store_id
         FROM production_equipements
        WHERE ${STORE_SCOPE('store_id', '$1')} AND type IN ('frigo', 'surgele', 'vitrine', 'autre')
        ORDER BY haccp_monitored DESC, type, nom`,
      [storeId],
    );
    return rows;
  },

  async saveEquipment(p: {
    id?: string; nom: string; type: 'frigo' | 'surgele' | 'vitrine' | 'autre'; haccp_monitored: boolean;
    temp_min: number | null; temp_max: number | null; readings_per_day: number; storeId: string | null;
  }) {
    if (p.id) {
      const { rows } = await db.query(
        `UPDATE production_equipements
            SET nom = $2, haccp_monitored = $3, temp_min = $4, temp_max = $5, readings_per_day = $6, updated_at = NOW()
          WHERE id = $1 RETURNING id`,
        [p.id, p.nom, p.haccp_monitored, p.temp_min, p.temp_max, p.readings_per_day],
      );
      return rows[0] ?? null;
    }
    // Enceinte créée depuis l'HACCP : sans coût horaire (n'entre pas dans le coût de revient).
    const { rows } = await db.query(
      `INSERT INTO production_equipements (nom, type, cout_horaire, store_id, haccp_monitored, temp_min, temp_max, readings_per_day)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7) RETURNING id`,
      [p.nom, p.type, p.storeId, p.haccp_monitored, p.temp_min, p.temp_max, p.readings_per_day],
    );
    return rows[0];
  },

  async listTasks(storeId: string | null) {
    const { rows } = await db.query(
      `SELECT id, zone, label, frequency, method, is_active, display_order, store_id
         FROM haccp_cleaning_tasks WHERE ${STORE_SCOPE('store_id', '$1')}
        ORDER BY is_active DESC, display_order, zone, label`,
      [storeId],
    );
    return rows;
  },

  async saveTask(p: { id?: string; zone: string; label: string; frequency: string; method: string | null; is_active: boolean; display_order: number }) {
    if (p.id) {
      const { rows } = await db.query(
        `UPDATE haccp_cleaning_tasks SET zone = $2, label = $3, frequency = $4, method = $5, is_active = $6, display_order = $7
          WHERE id = $1 RETURNING id`,
        [p.id, p.zone, p.label, p.frequency, p.method, p.is_active, p.display_order],
      );
      return rows[0] ?? null;
    }
    const { rows } = await db.query(
      `INSERT INTO haccp_cleaning_tasks (zone, label, frequency, method, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [p.zone, p.label, p.frequency, p.method, p.is_active, p.display_order],
    );
    return rows[0];
  },

  // ─── Contrôle à réception ─────────────────────────────────────────────

  async receptions(p: { storeId: string | null; from: string; to: string }) {
    const { rows } = await db.query(
      `SELECT rv.id, rv.voucher_number, rv.reception_date::text, rv.status, s.name AS supplier_name,
              ${USER_NAME('u')} AS received_by_name,
              qc.temperature_ok, qc.temperature_value::float, qc.visual_ok, qc.packaging_ok, qc.labels_ok,
              qc.overall_conformity, qc.notes AS qc_notes, qc.checked_at, ${USER_NAME('cu')} AS checked_by_name,
              a.id AS action_id, a.status AS action_status
         FROM reception_vouchers rv
         LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN users u ON u.id = rv.received_by
         LEFT JOIN reception_quality_checks qc ON qc.reception_voucher_id = rv.id
         LEFT JOIN users cu ON cu.id = qc.checked_by
         LEFT JOIN LATERAL (
           SELECT id, status FROM haccp_corrective_actions
            WHERE source_kind = 'reception' AND source_id = rv.id ORDER BY created_at DESC LIMIT 1
         ) a ON true
        WHERE rv.reception_date BETWEEN $2::date AND $3::date
          AND ${STORE_SCOPE('rv.store_id', '$1')}
          AND COALESCE(rv.voucher_kind, 'receive') <> 'reverse'
        ORDER BY rv.reception_date DESC, rv.voucher_number DESC
        LIMIT 500`,
      [p.storeId, p.from, p.to],
    );
    return rows;
  },

  /** Enregistre le contrôle ; non conforme → action corrective (une seule non clôturée par bon). */
  async saveReceptionCheck(p: {
    receptionVoucherId: string; temperatureOk?: boolean | null; temperatureValue?: number | null; visualOk?: boolean | null;
    packagingOk?: boolean | null; labelsOk?: boolean | null; overallConformity: boolean; notes?: string | null;
    actionTaken?: string | null; storeId: string | null; userId: string;
  }) {
    const { rows: rv } = await db.query(`SELECT id, voucher_number FROM reception_vouchers WHERE id = $1`, [p.receptionVoucherId]);
    if (!rv[0]) throw Object.assign(new Error('Bon de réception introuvable'), { statusCode: 404 });
    const qc = await ingredientLotRepository.saveQualityCheck({
      receptionVoucherId: p.receptionVoucherId,
      temperatureOk: p.temperatureOk ?? undefined, temperatureValue: p.temperatureValue ?? undefined,
      visualOk: p.visualOk ?? undefined, packagingOk: p.packagingOk ?? undefined, labelsOk: p.labelsOk ?? undefined,
      overallConformity: p.overallConformity, notes: p.notes ?? undefined, checkedBy: p.userId,
    });
    let action = null;
    if (!p.overallConformity) {
      const { rows: existing } = await db.query(
        `SELECT id FROM haccp_corrective_actions WHERE source_kind = 'reception' AND source_id = $1 AND status <> 'validated'`,
        [p.receptionVoucherId],
      );
      if (!existing[0]) {
        const failed = [
          p.temperatureOk === false && `température${p.temperatureValue != null ? ` ${fmtTemp(p.temperatureValue)}` : ''}`,
          p.visualOk === false && 'aspect', p.packagingOk === false && 'emballage', p.labelsOk === false && 'étiquetage',
        ].filter(Boolean).join(', ');
        action = await insertAction(db, {
          storeId: p.storeId, source: 'reception', sourceId: p.receptionVoucherId, userId: p.userId,
          problem: `Réception ${rv[0].voucher_number} non conforme${failed ? ` : ${failed}` : ''}${p.notes?.trim() ? ` (${p.notes.trim()})` : ''}`,
          actionTaken: p.actionTaken,
        });
        await notifyManagers({ storeId: p.storeId, actionId: action.id, userId: p.userId, title: 'Réception non conforme', message: action.problem });
      }
    }
    return { check: qc, action };
  },

  // ─── Indicateurs (vue d'ensemble Contrôle) ────────────────────────────

  async indicators(storeId: string | null, from?: string, to?: string) {
    const tz = getUserTimezone();
    const { rows } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM production_equipements e
           WHERE e.haccp_monitored AND e.is_active AND ${STORE_SCOPE('e.store_id', '$1')}
             AND NOT EXISTS (SELECT 1 FROM haccp_temperature_readings r
                              WHERE r.equipment_id = e.id AND ${STORE_SCOPE('r.store_id', '$1')}
                                AND (r.read_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date))::int AS missing_today,
         (SELECT COUNT(*) FROM haccp_temperature_readings r
           WHERE NOT r.in_range AND ${STORE_SCOPE('r.store_id', '$1')}
             AND ($2::date IS NULL OR (r.read_at AT TIME ZONE '${tz}')::date >= $2::date)
             AND ($3::date IS NULL OR (r.read_at AT TIME ZONE '${tz}')::date <= $3::date))::int AS out_of_range,
         (SELECT COUNT(*) FROM haccp_corrective_actions a WHERE a.status = 'open' AND ${STORE_SCOPE('a.store_id', '$1')})::int AS actions_open,
         (SELECT COUNT(*) FROM haccp_corrective_actions a WHERE a.status = 'done' AND ${STORE_SCOPE('a.store_id', '$1')})::int AS actions_to_validate,
         (SELECT COUNT(*) FROM haccp_cleaning_tasks k
           WHERE k.is_active AND ${STORE_SCOPE('k.store_id', '$1')}
             AND NOT EXISTS (
               SELECT 1 FROM haccp_cleaning_logs l
                WHERE l.task_id = k.id AND ${STORE_SCOPE('l.store_id', '$1')}
                  AND (l.done_at AT TIME ZONE '${tz}')::date
                      > (NOW() AT TIME ZONE '${tz}')::date - (CASE k.frequency WHEN 'daily' THEN 2 WHEN 'weekly' THEN 8 ELSE 31 END)))::int AS cleaning_late`,
      [storeId, from ?? null, to ?? null],
    );
    return rows[0];
  },
};
