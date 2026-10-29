import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * CRM (mig 371) : opportunités, pipeline et activités commerciales.
 * Étapes et probabilités par défaut : nouveau 10 %, qualifié 30 %, proposition 60 %,
 * négociation 80 %, gagné 100 %, perdu 0 % (la probabilité reste modifiable).
 */
export type Stage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export const STAGE_PROBABILITY: Record<Stage, number> = { new: 10, qualified: 30, proposal: 60, negotiation: 80, won: 100, lost: 0 };
const OPEN: Stage[] = ['new', 'qualified', 'proposal', 'negotiation'];
const NAME = (a: string) => `NULLIF(concat_ws(' ', ${a}.first_name, ${a}.last_name), '')`;

export type OpportunityInput = {
  title: string; customerId?: string | null; prospectName?: string | null; prospectCompany?: string | null; prospectPhone?: string | null;
  prospectEmail?: string | null; prospectCity?: string | null; sourceCode?: string | null; expectedAmount?: number | null;
  probability?: number | null; expectedCloseDate?: string | null; ownerId?: string | null; description?: string | null;
  campaignId?: string | null;
};

const SELECT = `
  SELECT o.*,
         COALESCE(NULLIF(c.company_name, ''), ${NAME('c')}, o.prospect_company, o.prospect_name) AS client_label,
         c.phone AS customer_phone, c.email AS customer_email,
         ${NAME('ow')} AS owner_name, src.label AS source_label, lr.label AS lost_reason_label,
         na.id AS next_activity_id, na.kind AS next_activity_kind, na.subject AS next_activity_subject, na.due_at AS next_activity_due,
         (na.due_at IS NOT NULL AND na.due_at < now()) AS activity_overdue,
         (SELECT COUNT(*) FROM quotes q WHERE q.opportunity_id = o.id)::int AS quote_count,
         ROUND(COALESCE(o.expected_amount, 0) * o.probability / 100.0, 2) AS weighted_amount
    FROM opportunities o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users ow ON ow.id = o.owner_id
    LEFT JOIN ref_entries src ON src.table_id = 'crm_sources' AND src.code = o.source_code
    LEFT JOIN ref_entries lr ON lr.table_id = 'quote_lost_reasons' AND lr.code = o.lost_reason_code
    LEFT JOIN LATERAL (SELECT a.id, a.kind, a.subject, a.due_at FROM crm_activities a
                        WHERE a.opportunity_id = o.id AND a.done_at IS NULL AND a.kind <> 'note' AND o.stage NOT IN ('won', 'lost')
                        ORDER BY a.due_at NULLS LAST, a.created_at LIMIT 1) na ON true`;

export const crmRepository = {
  async list(p: { stage?: string; ownerId?: string; search?: string; open?: boolean; storeId?: string; limit: number; offset: number }) {
    const v: unknown[] = []; const add = (x: unknown) => { v.push(x); return `$${v.length}`; };
    const cond = ['true'];
    if (p.storeId) cond.push(`(o.store_id IS NULL OR o.store_id = ${add(p.storeId)}::uuid)`);
    if (p.stage) cond.push(`o.stage = ${add(p.stage)}`);
    else if (p.open) cond.push(`o.stage IN ('new', 'qualified', 'proposal', 'negotiation')`);
    if (p.ownerId) cond.push(`o.owner_id = ${add(p.ownerId)}::uuid`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      cond.push(`(o.number ILIKE ${s} OR o.title ILIKE ${s} OR o.prospect_name ILIKE ${s} OR o.prospect_company ILIKE ${s}
                 OR c.company_name ILIKE ${s} OR concat_ws(' ', c.first_name, c.last_name) ILIKE ${s})`);
    }
    const where = cond.join(' AND ');
    const base = [...v];
    const rows = await db.query(`${SELECT} WHERE ${where}
      ORDER BY (o.stage IN ('won', 'lost')), o.expected_close_date NULLS LAST, o.updated_at DESC LIMIT ${add(p.limit)} OFFSET ${add(p.offset)}`, v);
    const total = await db.query(`SELECT COUNT(*)::int AS n FROM opportunities o LEFT JOIN customers c ON c.id = o.customer_id WHERE ${where}`, base);
    return { rows: rows.rows, total: total.rows[0].n };
  },

  /** Tableau de bord : pipeline ouvert, prévision pondérée, gagné / perdu du mois, transformation sur 90 j. */
  async overview(p: { storeId?: string; ownerId?: string }) {
    const v: unknown[] = []; const add = (x: unknown) => { v.push(x); return `$${v.length}`; };
    const cond = ['true'];
    if (p.storeId) cond.push(`(o.store_id IS NULL OR o.store_id = ${add(p.storeId)}::uuid)`);
    if (p.ownerId) cond.push(`o.owner_id = ${add(p.ownerId)}::uuid`);
    const w = cond.join(' AND ');
    const [byStage, month, rate, sources, overdue] = await Promise.all([
      db.query(`SELECT o.stage, COUNT(*)::int AS count, COALESCE(SUM(o.expected_amount), 0)::numeric(14,2) AS amount,
                       COALESCE(SUM(o.expected_amount * o.probability / 100.0), 0)::numeric(14,2) AS weighted
                  FROM opportunities o WHERE ${w} GROUP BY o.stage`, v),
      db.query(`SELECT COUNT(*) FILTER (WHERE o.stage = 'won')::int AS won, COALESCE(SUM(o.expected_amount) FILTER (WHERE o.stage = 'won'), 0)::numeric(14,2) AS won_amount,
                       COUNT(*) FILTER (WHERE o.stage = 'lost')::int AS lost
                  FROM opportunities o WHERE ${w} AND o.closed_at >= date_trunc('month', now())`, v),
      db.query(`SELECT COUNT(*) FILTER (WHERE o.stage = 'won')::int AS won, COUNT(*) FILTER (WHERE o.stage = 'lost')::int AS lost
                  FROM opportunities o WHERE ${w} AND o.closed_at > now() - interval '90 days'`, v),
      db.query(`SELECT COALESCE(src.label, 'Non renseignée') AS label, COUNT(*)::int AS count,
                       COUNT(*) FILTER (WHERE o.stage = 'won')::int AS won, COALESCE(SUM(o.expected_amount) FILTER (WHERE o.stage = 'won'), 0)::numeric(14,2) AS won_amount
                  FROM opportunities o LEFT JOIN ref_entries src ON src.table_id = 'crm_sources' AND src.code = o.source_code
                 WHERE ${w} AND o.created_at > now() - interval '365 days' GROUP BY 1 ORDER BY 2 DESC`, v),
      db.query(`SELECT COUNT(*)::int AS n FROM crm_activities a JOIN opportunities o ON o.id = a.opportunity_id
                 WHERE ${w} AND a.done_at IS NULL AND a.kind <> 'note' AND a.due_at < now() AND o.stage NOT IN ('won', 'lost')`, v),
    ]);
    const m = month.rows[0]; const r = rate.rows[0]; const decided = r.won + r.lost;
    return {
      byStage: Object.fromEntries(byStage.rows.map(x => [x.stage, { count: x.count, amount: Number(x.amount), weighted: Number(x.weighted) }])),
      month: { won: m.won, wonAmount: Number(m.won_amount), lost: m.lost },
      conversion: { won: r.won, lost: r.lost, rate: decided ? Math.round(r.won / decided * 100) : null },
      sources: sources.rows.map(x => ({ label: x.label, count: x.count, won: x.won, wonAmount: Number(x.won_amount) })),
      overdueActivities: overdue.rows[0].n,
    };
  },

  async findById(id: string) {
    const r = await db.query(`${SELECT} WHERE o.id = $1`, [id]);
    if (!r.rows[0]) return null;
    const [activities, quotes] = await Promise.all([
      db.query(`SELECT a.*, ${NAME('u')} AS assigned_name, ${NAME('cb')} AS created_by_name FROM crm_activities a
                  LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN users cb ON cb.id = a.created_by
                 WHERE a.opportunity_id = $1 ORDER BY (a.done_at IS NULL AND a.kind <> 'note') DESC, COALESCE(a.done_at, a.due_at, a.created_at) DESC`, [id]),
      db.query(`SELECT id, number, status, total, quote_date, valid_until FROM quotes WHERE opportunity_id = $1 ORDER BY created_at DESC`, [id]),
    ]);
    return { ...r.rows[0], activities: activities.rows, quotes: quotes.rows };
  },

  async create(input: OpportunityInput, ctx: { userId: string; storeId: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'opportunity');
      const r = await client.query(
        `INSERT INTO opportunities (number, store_id, title, customer_id, prospect_name, prospect_company, prospect_phone, prospect_email, prospect_city,
                                    source_code, expected_amount, probability, expected_close_date, owner_id, description, created_by, campaign_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [number, ctx.storeId, input.title.trim(), input.customerId ?? null, ...prospect(input),
         input.sourceCode ?? null, input.expectedAmount ?? null, input.probability ?? STAGE_PROBABILITY.new,
         input.expectedCloseDate ?? null, input.ownerId ?? ctx.userId, input.description?.trim() || null, ctx.userId, input.campaignId ?? null]);
      await client.query('COMMIT');
      const id = r.rows[0].id as string;
      if (input.ownerId && input.ownerId !== ctx.userId) await notifyOwner(id, ctx.userId);
      return this.findById(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async update(id: string, input: OpportunityInput, userId: string) {
    const cur = (await db.query(`SELECT owner_id FROM opportunities WHERE id = $1`, [id])).rows[0];
    if (!cur) return null;
    await db.query(
      `UPDATE opportunities SET title = $2, customer_id = $3, prospect_name = $4, prospect_company = $5, prospect_phone = $6, prospect_email = $7,
              prospect_city = $8, source_code = $9, expected_amount = $10, probability = COALESCE($11, probability), expected_close_date = $12,
              owner_id = COALESCE($13, owner_id), description = $14, campaign_id = $15
        WHERE id = $1`,
      [id, input.title.trim(), input.customerId ?? null, ...prospect(input), input.sourceCode ?? null, input.expectedAmount ?? null,
       input.probability ?? null, input.expectedCloseDate ?? null, input.ownerId ?? null, input.description?.trim() || null, input.campaignId ?? null]);
    if (input.ownerId && input.ownerId !== cur.owner_id && input.ownerId !== userId) await notifyOwner(id, userId);
    return this.findById(id);
  },

  /** Changement d'étape : la probabilité suit l'étape ; gagné / perdu clôturent, perdu exige un motif. */
  async moveStage(id: string, stage: Stage, p: { lostReasonCode?: string | null; lostNote?: string | null; userId: string }) {
    const cur = (await db.query(`SELECT stage FROM opportunities WHERE id = $1`, [id])).rows[0];
    if (!cur) return { error: 'not_found' as const };
    if (stage === 'lost' && !p.lostReasonCode) return { error: 'Indiquez le motif de la perte' };
    await db.query(
      `UPDATE opportunities SET stage = $2::text, probability = $3,
              closed_at = CASE WHEN $2::text IN ('won', 'lost') THEN COALESCE(closed_at, now()) ELSE NULL END,
              lost_reason_code = CASE WHEN $2::text = 'lost' THEN $4::text ELSE NULL END,
              lost_note = CASE WHEN $2::text = 'lost' THEN $5::text ELSE NULL END
        WHERE id = $1`,
      [id, stage, STAGE_PROBABILITY[stage], p.lostReasonCode ?? null, p.lostNote?.trim() || null]);
    if (cur.stage !== stage) {
      await db.query(`INSERT INTO crm_activities (opportunity_id, kind, subject, done_at, outcome, created_by) VALUES ($1, 'note', $2, now(), $3, $4)`,
        [id, `Étape : ${STAGE_LABEL[cur.stage as Stage]} → ${STAGE_LABEL[stage]}`, stage === 'lost' ? p.lostNote ?? null : null, p.userId]);
    }
    return { data: await this.findById(id) };
  },

  async addActivity(oppId: string, a: { kind: string; subject: string; dueAt?: string | null; assignedTo?: string | null; outcome?: string | null; done?: boolean }, userId: string) {
    const r = await db.query(
      `INSERT INTO crm_activities (opportunity_id, kind, subject, due_at, assigned_to, outcome, done_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END, $8) RETURNING *`,
      [oppId, a.kind, a.subject.trim(), a.dueAt ?? null, a.assignedTo ?? userId, a.outcome?.trim() || null, !!a.done || a.kind === 'note', userId]);
    await db.query(`UPDATE opportunities SET updated_at = now() WHERE id = $1`, [oppId]);
    return r.rows[0];
  },

  async completeActivity(activityId: string, outcome: string | null) {
    const r = await db.query(`UPDATE crm_activities SET done_at = now(), outcome = COALESCE($2, outcome) WHERE id = $1 AND done_at IS NULL RETURNING opportunity_id`,
      [activityId, outcome?.trim() || null]);
    return r.rows[0] ?? null;
  },

  async deleteActivity(activityId: string) {
    const r = await db.query(`DELETE FROM crm_activities WHERE id = $1 AND done_at IS NULL RETURNING opportunity_id`, [activityId]);
    return r.rows[0] ?? null;
  },

  /** Activités à faire d'un commercial (ou de tous), échues d'abord. */
  async todo(p: { userId?: string; limit: number }) {
    const r = await db.query(
      `SELECT a.*, o.number, o.title, o.stage, COALESCE(NULLIF(c.company_name, ''), ${NAME('c')}, o.prospect_company, o.prospect_name) AS client_label,
              ${NAME('u')} AS assigned_name, (a.due_at < now()) AS overdue
         FROM crm_activities a JOIN opportunities o ON o.id = a.opportunity_id
         LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = a.assigned_to
        WHERE a.done_at IS NULL AND a.kind <> 'note' AND o.stage NOT IN ('won', 'lost') AND ($1::uuid IS NULL OR a.assigned_to = $1::uuid)
        ORDER BY a.due_at NULLS LAST, a.created_at LIMIT $2`, [p.userId ?? null, p.limit]);
    return r.rows;
  },

  /** Prospect → fiche client (professionnel si une société est renseignée). */
  async createCustomer(id: string, userId: string) {
    const o = (await db.query(`SELECT * FROM opportunities WHERE id = $1`, [id])).rows[0];
    if (!o) return { error: 'not_found' as const };
    if (o.customer_id) return { error: 'Cette opportunité a déjà une fiche client' };
    const [first, ...rest] = String(o.prospect_name ?? '').trim().split(/\s+/);
    const c = await db.query(
      `INSERT INTO customers (first_name, last_name, company_name, customer_type, phone, email, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [first || null, rest.join(' ') || null, o.prospect_company || null, o.prospect_company ? 'professionnel' : 'particulier',
       o.prospect_phone || null, o.prospect_email || null, o.prospect_city || null]);
    await db.query(`UPDATE opportunities SET customer_id = $2 WHERE id = $1`, [id, c.rows[0].id]);
    await db.query(`INSERT INTO crm_activities (opportunity_id, kind, subject, done_at, created_by) VALUES ($1, 'note', 'Fiche client créée', now(), $2)`, [id, userId]);
    return { data: await this.findById(id) };
  },

  /** Utilisateurs actifs à qui confier une opportunité. */
  async owners() {
    return (await db.query(`SELECT id, ${NAME('u')} AS name, role FROM users u WHERE u.is_active IS NOT FALSE ORDER BY u.first_name, u.last_name`)).rows;
  },

  /* ── Campagnes marketing (mig 383) ── */
  /** Liste des campagnes avec leur retour : opportunités, gagnées, chiffre gagné. */
  async campaigns(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (c.store_id IS NULL OR c.store_id = $1)`; }
    const r = await db.query(
      `SELECT c.*,
              COUNT(o.id)::int                                            AS opportunities,
              COUNT(o.id) FILTER (WHERE o.stage = 'won')::int             AS won,
              COUNT(o.id) FILTER (WHERE o.stage = 'lost')::int            AS lost,
              COALESCE(SUM(o.expected_amount) FILTER (WHERE o.stage = 'won'), 0)::float8 AS won_amount,
              COALESCE(SUM(o.expected_amount) FILTER (WHERE o.stage NOT IN ('won','lost')), 0)::float8 AS pipeline_amount
         FROM crm_campaigns c
         LEFT JOIN opportunities o ON o.campaign_id = c.id
         ${where}
        GROUP BY c.id
        ORDER BY (c.status = 'active') DESC, c.start_date DESC NULLS LAST, c.created_at DESC`, params);
    return r.rows.map((row: Record<string, unknown>) => ({ ...row, budget: row.budget != null ? Number(row.budget) : null }));
  },

  async createCampaign(input: { name: string; startDate?: string | null; endDate?: string | null; budget?: number | null; notes?: string | null; storeId?: string | null; userId: string | null }) {
    if (input.endDate && input.startDate && input.endDate < input.startDate) return { error: 'La date de fin doit suivre le début' };
    const r = await db.query(
      `INSERT INTO crm_campaigns (name, start_date, end_date, budget, store_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [input.name.trim(), input.startDate || null, input.endDate || null,
       input.budget != null && input.budget >= 0 ? input.budget : null, input.storeId ?? null, input.notes?.trim() || null, input.userId]);
    return { data: (await this.campaigns(input.storeId)).find((c: Record<string, unknown>) => c.id === r.rows[0].id) };
  },

  async setCampaignStatus(id: string, status: 'active' | 'closed') {
    await db.query(`UPDATE crm_campaigns SET status = $2 WHERE id = $1`, [id, status]);
    return (await db.query(`SELECT * FROM crm_campaigns WHERE id = $1`, [id])).rows[0] || null;
  },

  /** Campagnes actives pour le sélecteur du formulaire d'opportunité. */
  async campaignOptions(storeId?: string | null) {
    const params: unknown[] = [];
    let where = `WHERE status = 'active'`;
    if (storeId) { params.push(storeId); where += ` AND (store_id IS NULL OR store_id = $1)`; }
    return (await db.query(`SELECT id, name FROM crm_campaigns ${where} ORDER BY name`, params)).rows;
  },

  /** Effets d'un devis lié (mig 371) : envoyé → proposition ; transformé en commande → gagné. */
  async onQuoteEvent(quoteId: string, event: 'sent' | 'converted', userId: string | null) {
    const q = (await db.query(`SELECT opportunity_id, number FROM quotes WHERE id = $1`, [quoteId])).rows[0];
    if (!q?.opportunity_id) return;
    const o = (await db.query(`SELECT stage FROM opportunities WHERE id = $1`, [q.opportunity_id])).rows[0];
    if (!o || !OPEN.includes(o.stage)) return;
    if (event === 'sent' && (o.stage === 'new' || o.stage === 'qualified')) {
      await this.moveStage(q.opportunity_id, 'proposal', { userId: userId as string });
    } else if (event === 'converted') {
      await this.moveStage(q.opportunity_id, 'won', { userId: userId as string });
      await db.query(`UPDATE opportunities SET expected_amount = COALESCE((SELECT total FROM quotes WHERE id = $2), expected_amount) WHERE id = $1`, [q.opportunity_id, quoteId]);
    }
  },
};

const STAGE_LABEL: Record<Stage, string> = { new: 'Nouveau', qualified: 'Qualifié', proposal: 'Proposition', negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu' };

function prospect(i: OpportunityInput) {
  const keep = !i.customerId;
  return [keep ? i.prospectName?.trim() || null : null, keep ? i.prospectCompany?.trim() || null : null, keep ? i.prospectPhone?.trim() || null : null,
    keep ? i.prospectEmail?.trim() || null : null, keep ? i.prospectCity?.trim() || null : null];
}

async function notifyOwner(id: string, userId: string) {
  const o = (await db.query(`SELECT owner_id, number, title, store_id FROM opportunities WHERE id = $1`, [id])).rows[0];
  if (!o?.owner_id) return;
  await db.query(
    `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id, created_by)
     VALUES ('all', $1, $2, 'crm_opportunity_assigned', $3, $4, 'opportunity', $5, $6)`,
    [o.owner_id, o.store_id, `Opportunité confiée · ${o.number}`, o.title, id, userId]);
}
