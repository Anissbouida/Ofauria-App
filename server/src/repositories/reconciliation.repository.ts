import { db } from '../config/database.js';

/**
 * Module Rapprochement journalier (ISOLE, TEMPORAIRE).
 *
 * Bilan produit PAR SHIFT (mig 262), equation de stock inchangee (mig 259) :
 *   ecart = vendu + invendu - (recu + report_veille) ; negatif = manque.
 *  - report_veille : stock d'ouverture DU SHIFT, jamais saisi. 1er shift :
 *    reste du dernier shift de J-1 (categories a report seulement) ; shifts
 *    suivants : comptage de passation = invendu du shift precedent, TOUTES
 *    categories (entre deux shifts du meme jour, tout reste en vitrine) ;
 *  - approvisionne : saisi manuellement (ce qui part au magasin), hors calcul ;
 *  - recu : confirme par la caissiere a la reception ;
 *  - vendu : importe du CSV Loyverse filtre sur la plage horaire du shift ;
 *  - invendu : comptage physique de fin de shift (passation a 14h, ou soir).
 *
 * La somme des ecarts des shifts = ecart journalier (le comptage de passation
 * s'annule) : le decoupage LOCALISE l'ecart sans changer le total.
 * Journees anterieures a la mig 262 : shift unique n° 0 « Journée ».
 *
 * Etanche : ne lit ni n'ecrit aucune table du systeme reel. Tout est pilote
 * par le SKU/nom Loyverse. Les colonnes ecart_qty / ecart_value sont calculees
 * par la base (colonnes generees).
 */

/** Shifts crees pour toute nouvelle journee. */
const SHIFT_DEFS = [
  { number: 1, label: 'Matin' },
  { number: 2, label: 'Soir' },
];

export type ReconLineInput = {
  sku?: string | null;
  productName: string;
  category?: string | null;
  approQty?: number;
  recuQty?: number;
  venduQty?: number;
  invenduQty?: number;
  unitPrice?: number;
};

/** Cle de rapprochement : SKU s'il existe, sinon nom normalise. */
function productKey(sku?: string | null, name?: string | null): string {
  const s = (sku || '').trim();
  if (s) return s.toUpperCase();
  return (name || '').trim().toUpperCase();
}

/** Upsert d'un produit dans le catalogue (utilisable dans une transaction). */
async function registerProduct(
  q: { query: (text: string, vals?: unknown[]) => Promise<any> },
  p: { sku?: string | null; productName: string; category?: string | null; unitPrice?: number }
) {
  const key = productKey(p.sku, p.productName);
  if (!key) return;
  await q.query(
    `INSERT INTO recon_products (product_key, sku, product_name, category, unit_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_key) DO UPDATE SET
       sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_products.sku),
       product_name = EXCLUDED.product_name,
       category     = COALESCE(EXCLUDED.category, recon_products.category),
       unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_products.unit_price END,
       updated_at   = NOW()`,
    [key, p.sku ?? null, p.productName.trim(), p.category ?? null, p.unitPrice ?? 0]
  );
}

export const reconciliationRepository = {
  // ─── Journees ──────────────────────────────────────────────────────────

  async listDays(params: { from?: string; to?: string; storeId?: string | null }) {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (params.from) { vals.push(params.from); conds.push(`d.business_date >= $${vals.length}`); }
    if (params.to) { vals.push(params.to); conds.push(`d.business_date <= $${vals.length}`); }
    if (params.storeId) { vals.push(params.storeId); conds.push(`d.store_id = $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await db.query(`
      SELECT d.*,
             COALESCE(l.line_count, 0)      AS line_count,
             COALESCE(l.total_ecart_value, 0) AS total_ecart_value
      FROM recon_days d
      LEFT JOIN LATERAL (
        -- Un produit peut exister sur plusieurs shifts : compte distinct.
        -- La somme des ecarts des shifts = ecart journalier (telescopage).
        SELECT COUNT(DISTINCT product_key) AS line_count, SUM(ecart_value) AS total_ecart_value
        FROM recon_lines WHERE recon_day_id = d.id AND NOT hidden
      ) l ON true
      ${where}
      ORDER BY d.business_date DESC
    `, vals);
    return result.rows;
  },

  /** Shifts d'une journee, ordonnes (n° 0 = journee entiere, historique). */
  async getShifts(dayId: string) {
    const { rows } = await db.query(
      `SELECT * FROM recon_shifts WHERE recon_day_id = $1 ORDER BY shift_number`,
      [dayId]
    );
    return rows;
  },

  /**
   * Journee complete : shifts avec leurs lignes + vue agregee `lines` (les
   * consommateurs journee — export Excel, vue Journée — restent inchanges).
   * Agregat par produit : appro / recu / vendu / ecart = somme des shifts ;
   * ouverture = report du 1er shift ; reste soir = invendu du DERNIER shift
   * (les comptages de passation intermediaires ne sont pas des restes du jour).
   */
  async getDayById(id: string) {
    const d = await db.query(`SELECT * FROM recon_days WHERE id = $1`, [id]);
    if (!d.rows[0]) return null;
    const shifts = await this.getShifts(id);
    const { rows: lines } = await db.query(
      `SELECT l.*, s.shift_number
       FROM recon_lines l
       JOIN recon_shifts s ON s.id = l.recon_shift_id
       WHERE l.recon_day_id = $1 AND NOT l.hidden
       ORDER BY l.category NULLS LAST, l.product_name, s.shift_number`,
      [id]
    );

    const firstSn = shifts[0]?.shift_number;
    const lastSn = shifts[shifts.length - 1]?.shift_number;
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
      return Number.isFinite(n) ? n : 0;
    };

    // Agregat journee par produit (l'ordre categorie/nom des lignes est preserve).
    const agg = new Map<string, any>();
    for (const l of lines) {
      let a = agg.get(l.product_key);
      if (!a) {
        a = {
          id: null, recon_day_id: id, recon_shift_id: null,
          product_key: l.product_key, sku: l.sku, product_name: l.product_name, category: l.category,
          report_veille_qty: 0, appro_qty: 0, recu_qty: 0, vendu_qty: 0, vendu_amount: 0,
          invendu_qty: 0, unit_price: 0, ecart_qty: 0, ecart_value: 0, source_vendu: 'manual',
        };
        agg.set(l.product_key, a);
      }
      a.appro_qty += num(l.appro_qty);
      a.recu_qty += num(l.recu_qty);
      a.vendu_qty += num(l.vendu_qty);
      a.vendu_amount += num(l.vendu_amount);
      a.ecart_qty += num(l.ecart_qty);
      a.ecart_value += num(l.ecart_value);
      if (l.shift_number === firstSn) a.report_veille_qty = num(l.report_veille_qty);
      if (l.shift_number === lastSn) a.invendu_qty = num(l.invendu_qty);
      if (num(l.unit_price) > 0) a.unit_price = num(l.unit_price);
      if (l.source_vendu === 'loyverse_import') a.source_vendu = 'loyverse_import';
    }

    return {
      ...d.rows[0],
      shifts: shifts.map(s => ({ ...s, lines: lines.filter(l => l.recon_shift_id === s.id) })),
      lines: [...agg.values()],
    };
  },

  /**
   * Trouve la journee (date + magasin) ou la cree si absente. Idempotent.
   * Une nouvelle journee est creee avec ses shifts Matin / Soir ; les journees
   * anterieures a la mig 262 gardent leur shift unique « Journée ».
   */
  async openDay(params: { date: string; storeId?: string | null; userId?: string | null }) {
    const existing = await db.query(
      `SELECT * FROM recon_days
       WHERE business_date = $1 AND store_id IS NOT DISTINCT FROM $2`,
      [params.date, params.storeId ?? null]
    );
    let dayId: string;
    if (existing.rows[0]) {
      dayId = existing.rows[0].id;
      if (existing.rows[0].status === 'closed') return this.getDayById(dayId);
    } else {
      const inserted = await db.query(
        `INSERT INTO recon_days (business_date, store_id, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [params.date, params.storeId ?? null, params.userId ?? null]
      );
      dayId = inserted.rows[0].id;
      for (const s of SHIFT_DEFS) {
        await db.query(
          `INSERT INTO recon_shifts (recon_day_id, shift_number, label)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [dayId, s.number, s.label]
        );
      }
    }
    // Journee ouverte : resynchronise les stocks d'ouverture a chaque acces —
    // report de J-1 sur le 1er shift, passation entre shifts. Une correction
    // du reste (veille ou passation) se repercute immediatement.
    await this.syncCarryOver(dayId, params.date, params.storeId ?? null);
    await this.syncPassation(dayId);
    return this.getDayById(dayId);
  },

  // ─── Report du reste de la veille ──────────────────────────────────────

  /**
   * Aligne report_veille_qty sur le reste de J-1, pour les seules categories a
   * report (recon_carryover_categories). Idempotent : rejoue a chaque ouverture
   * de la journee, donc une correction du reste de la veille se propage tout
   * de suite. Cree la ligne du jour si le produit n'y figure pas encore, sinon
   * le stock d'ouverture serait perdu. Remet a 0 les reports devenus caducs
   * (categorie decochee, reste de J-1 corrige a 0, journee J-1 supprimee).
   */
  async syncCarryOver(dayId: string, date: string, storeId: string | null) {
    // Cible : PREMIER shift du jour. Source : DERNIER shift de J-1 (son
    // invendu est le vrai reste du soir ; les comptages de passation
    // intermediaires n'en font pas partie).
    const shifts = await this.getShifts(dayId);
    const firstShift = shifts[0];
    if (!firstShift) return;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Restes de J-1 eligibles au report (meme magasin).
      const prevCte = `
        WITH prev AS (
          SELECT l.product_key, l.sku, l.product_name, l.category,
                 l.invendu_qty, l.unit_price
          FROM recon_lines l
          JOIN recon_shifts s ON s.id = l.recon_shift_id
          JOIN recon_days d ON d.id = l.recon_day_id
          JOIN recon_carryover_categories c
            ON UPPER(c.category) = UPPER(l.category) AND c.enabled
          WHERE d.business_date = $2::date - 1
            AND d.store_id IS NOT DISTINCT FROM $3
            AND l.invendu_qty > 0
            AND NOT l.hidden
            AND s.shift_number = (
              SELECT MAX(s2.shift_number) FROM recon_shifts s2 WHERE s2.recon_day_id = d.id
            )
        )`;

      await client.query(`
        ${prevCte}
        INSERT INTO recon_lines
          (recon_day_id, recon_shift_id, product_key, sku, product_name, category, report_veille_qty, unit_price)
        SELECT $1, $4, p.product_key, p.sku, p.product_name, p.category, p.invendu_qty, p.unit_price
        FROM prev p
        ON CONFLICT (recon_shift_id, product_key) DO UPDATE SET
          report_veille_qty = EXCLUDED.report_veille_qty,
          updated_at        = NOW()
        WHERE recon_lines.report_veille_qty IS DISTINCT FROM EXCLUDED.report_veille_qty
      `, [dayId, date, storeId, firstShift.id]);

      await client.query(`
        ${prevCte}
        UPDATE recon_lines t
        SET report_veille_qty = 0, updated_at = NOW()
        WHERE t.recon_day_id = $1
          AND t.recon_shift_id = $4
          AND t.report_veille_qty <> 0
          AND NOT EXISTS (SELECT 1 FROM prev p WHERE p.product_key = t.product_key)
      `, [dayId, date, storeId, firstShift.id]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Chaine de passation : l'invendu compte a la fin d'un shift devient le
   * stock d'ouverture (report_veille_qty) du shift suivant. TOUTES categories :
   * la regle « categories a report » ne vaut qu'entre deux jours — au sein
   * d'une meme journee, la baguette de 14h est toujours en vitrine le soir.
   * Idempotent, rejoue a chaque ouverture et apres chaque saisie du comptage :
   * une correction du reste de passation se propage immediatement. Le garde-fou
   * de la colonne generee (ligne non touchee → ecart 0) evite les manques
   * fictifs cote soir tant que rien n'y est saisi.
   */
  async syncPassation(dayId: string) {
    const shifts = await this.getShifts(dayId);
    if (shifts.length < 2) return;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (let i = 1; i < shifts.length; i++) {
        const from = shifts[i - 1], to = shifts[i];
        await client.query(`
          INSERT INTO recon_lines
            (recon_day_id, recon_shift_id, product_key, sku, product_name, category, report_veille_qty, unit_price)
          SELECT $1, $2, l.product_key, l.sku, l.product_name, l.category, l.invendu_qty, l.unit_price
          FROM recon_lines l
          WHERE l.recon_shift_id = $3 AND l.invendu_qty > 0 AND NOT l.hidden
          ON CONFLICT (recon_shift_id, product_key) DO UPDATE SET
            report_veille_qty = EXCLUDED.report_veille_qty,
            updated_at        = NOW()
          WHERE recon_lines.report_veille_qty IS DISTINCT FROM EXCLUDED.report_veille_qty
        `, [dayId, to.id, from.id]);

        await client.query(`
          UPDATE recon_lines t
          SET report_veille_qty = 0, updated_at = NOW()
          WHERE t.recon_shift_id = $1
            AND t.report_veille_qty <> 0
            AND NOT EXISTS (
              SELECT 1 FROM recon_lines p
              WHERE p.recon_shift_id = $2 AND p.product_key = t.product_key AND p.invendu_qty > 0 AND NOT p.hidden
            )
        `, [to.id, from.id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Catégories du module avec leur drapeau de report. Union du referentiel
   * (recon_carryover_categories) et des categories reellement presentes au
   * catalogue : une categorie jamais parametree apparait decochee.
   */
  async listCarryOverCategories() {
    const { rows } = await db.query(`
      SELECT cat AS category, COALESCE(c.enabled, false) AS enabled
      FROM (
        SELECT DISTINCT category AS cat FROM recon_products WHERE category IS NOT NULL AND category <> ''
        UNION
        SELECT category FROM recon_carryover_categories
      ) s
      LEFT JOIN recon_carryover_categories c ON c.category = s.cat
      ORDER BY cat
    `);
    return rows;
  },

  async setCarryOverCategory(category: string, enabled: boolean) {
    const { rows } = await db.query(
      `INSERT INTO recon_carryover_categories (category, enabled)
       VALUES ($1, $2)
       ON CONFLICT (category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
       RETURNING category, enabled`,
      [category, enabled]
    );
    return rows[0];
  },

  /** Statut de la JOURNEE : cascade sur tous ses shifts (cloture/reouverture globale). */
  async setStatus(id: string, status: 'open' | 'closed') {
    const r = await db.query(
      `UPDATE recon_days SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, status]
    );
    if (r.rows[0]) {
      await db.query(
        `UPDATE recon_shifts SET status = $2, updated_at = NOW() WHERE recon_day_id = $1`,
        [id, status]
      );
    }
    return r.rows[0] || null;
  },

  /**
   * Statut d'un SEUL shift (cloture a la passation). Rouvrir un shift rouvre
   * aussi la journee si elle etait cloturee — sinon la saisie resterait
   * verrouillee par le statut du jour.
   */
  async setShiftStatus(shiftId: string, status: 'open' | 'closed') {
    const r = await db.query(
      `UPDATE recon_shifts SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [shiftId, status]
    );
    if (r.rows[0] && status === 'open') {
      await db.query(
        `UPDATE recon_days SET status = 'open', updated_at = NOW()
         WHERE id = $1 AND status = 'closed'`,
        [r.rows[0].recon_day_id]
      );
    }
    return r.rows[0] || null;
  },

  async assertOpen(dayId: string): Promise<void> {
    const r = await db.query(`SELECT status FROM recon_days WHERE id = $1`, [dayId]);
    if (!r.rows[0]) throw Object.assign(new Error('Journee introuvable'), { statusCode: 404 });
    if (r.rows[0].status === 'closed') {
      throw Object.assign(new Error('Journee cloturee : saisie verrouillee'), { statusCode: 409 });
    }
  },

  /** Verrou de saisie par shift : shift ET journee doivent etre ouverts. Renvoie le shift. */
  async assertShiftOpen(shiftId: string) {
    const r = await db.query(
      `SELECT s.*, d.status AS day_status
       FROM recon_shifts s JOIN recon_days d ON d.id = s.recon_day_id
       WHERE s.id = $1`,
      [shiftId]
    );
    if (!r.rows[0]) throw Object.assign(new Error('Shift introuvable'), { statusCode: 404 });
    if (r.rows[0].day_status === 'closed') {
      throw Object.assign(new Error('Journee cloturee : saisie verrouillee'), { statusCode: 409 });
    }
    if (r.rows[0].status === 'closed') {
      throw Object.assign(new Error(`Shift « ${r.rows[0].label} » cloture : saisie verrouillee`), { statusCode: 409 });
    }
    return r.rows[0];
  },

  // ─── Lignes ────────────────────────────────────────────────────────────

  /** Cree ou met a jour une ligne d'un shift (saisie manuelle appro/invendu/prix). */
  async upsertLine(shiftId: string, input: ReconLineInput) {
    const shift = await this.assertShiftOpen(shiftId);
    const key = productKey(input.sku, input.productName);
    const r = await db.query(
      `INSERT INTO recon_lines
         (recon_day_id, recon_shift_id, product_key, sku, product_name, category, appro_qty, recu_qty, vendu_qty, invendu_qty, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (recon_shift_id, product_key) DO UPDATE SET
         sku         = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
         product_name = EXCLUDED.product_name,
         category    = COALESCE(EXCLUDED.category, recon_lines.category),
         appro_qty   = EXCLUDED.appro_qty,
         recu_qty    = EXCLUDED.recu_qty,
         invendu_qty = EXCLUDED.invendu_qty,
         unit_price  = EXCLUDED.unit_price,
         hidden      = false,
         updated_at  = NOW()
       RETURNING *`,
      [
        shift.recon_day_id, shiftId, key, input.sku ?? null, input.productName, input.category ?? null,
        input.approQty ?? 0, input.recuQty ?? 0, input.venduQty ?? 0, input.invenduQty ?? 0, input.unitPrice ?? 0,
      ]
    );
    await registerProduct(db, input);
    // L'invendu du shift alimente l'ouverture du shift suivant.
    await this.syncPassation(shift.recon_day_id);
    return r.rows[0];
  },

  /** Mise a jour partielle d'une ligne existante (edition inline). */
  async updateLine(lineId: string, patch: { approQty?: number; recuQty?: number; venduQty?: number; invenduQty?: number; unitPrice?: number }) {
    const line = await db.query(`SELECT recon_day_id, recon_shift_id FROM recon_lines WHERE id = $1`, [lineId]);
    if (!line.rows[0]) throw Object.assign(new Error('Ligne introuvable'), { statusCode: 404 });
    await this.assertShiftOpen(line.rows[0].recon_shift_id);

    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: number | undefined) => {
      if (v !== undefined) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
    };
    add('appro_qty', patch.approQty);
    add('recu_qty', patch.recuQty);
    add('vendu_qty', patch.venduQty);
    add('invendu_qty', patch.invenduQty);
    add('unit_price', patch.unitPrice);
    if (!sets.length) {
      const cur = await db.query(`SELECT * FROM recon_lines WHERE id = $1`, [lineId]);
      return cur.rows[0];
    }
    vals.push(lineId);
    const r = await db.query(
      `UPDATE recon_lines SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    // Un comptage de passation corrige se propage a l'ouverture du shift suivant.
    if (patch.invenduQty !== undefined) {
      await this.syncPassation(line.rows[0].recon_day_id);
    }
    return r.rows[0];
  },

  /**
   * Suppression DOUCE (mig 265) : la ligne est masquée (hidden = true), pas
   * détruite. La synchro (report veille / passation) ne la ressuscite donc plus
   * à la prochaine ouverture de la journée. Ré-importer ou ré-ajouter le produit
   * la ré-affiche (hidden repassé à false par les upserts).
   */
  async deleteLine(lineId: string) {
    const line = await db.query(`SELECT recon_day_id, recon_shift_id FROM recon_lines WHERE id = $1`, [lineId]);
    if (!line.rows[0]) return;
    await this.assertShiftOpen(line.rows[0].recon_shift_id);
    await db.query(`UPDATE recon_lines SET hidden = true, updated_at = NOW() WHERE id = $1`, [lineId]);
    await this.syncPassation(line.rows[0].recon_day_id);
  },

  /**
   * Saisie en masse de l'approvisionne (collage Excel / import CSV).
   * Ne touche QUE appro_qty (et unit_price si fourni) : vendu_qty / invendu_qty
   * deja saisis sont preserves. Upsert par product_key, atomique.
   */
  async bulkUpsertAppro(
    shiftId: string,
    rows: { sku?: string | null; productName: string; category?: string | null; approQty: number; unitPrice?: number }[]
  ) {
    const shift = await this.assertShiftOpen(shiftId);
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        if (!r.productName?.trim()) continue;
        const key = productKey(r.sku, r.productName);
        await client.query(
          `INSERT INTO recon_lines
             (recon_day_id, recon_shift_id, product_key, sku, product_name, category, appro_qty, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (recon_shift_id, product_key) DO UPDATE SET
             sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
             product_name = EXCLUDED.product_name,
             category     = COALESCE(EXCLUDED.category, recon_lines.category),
             appro_qty    = EXCLUDED.appro_qty,
             unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_lines.unit_price END,
             hidden       = false,
             updated_at   = NOW()`,
          [shift.recon_day_id, shiftId, key, r.sku ?? null, r.productName.trim(), r.category ?? null, r.approQty ?? 0, r.unitPrice ?? 0]
        );
        await registerProduct(client, r);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  /** Nombre de lignes du jour ayant une vente (import Loyverse ou saisie). */
  async countSales(dayId: string): Promise<number> {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM recon_lines
       WHERE recon_day_id = $1 AND NOT hidden AND (source_vendu = 'loyverse_import' OR vendu_qty > 0)`,
      [dayId]
    );
    return r.rows[0]?.n ?? 0;
  },

  /** Idem, restreint a un shift (garde-fou de cloture par shift). */
  async countSalesShift(shiftId: string): Promise<number> {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM recon_lines
       WHERE recon_shift_id = $1 AND NOT hidden AND (source_vendu = 'loyverse_import' OR vendu_qty > 0)`,
      [shiftId]
    );
    return r.rows[0]?.n ?? 0;
  },

  /**
   * Remet les ventes du shift a zero (vendu_qty + vendu_amount) avant un
   * reimport propre. Appro / recu / invendu / prix sont preserves.
   */
  async resetSales(shiftId: string) {
    await this.assertShiftOpen(shiftId);
    const r = await db.query(
      `UPDATE recon_lines
       SET vendu_qty = 0, vendu_amount = 0, source_vendu = 'manual', updated_at = NOW()
       WHERE recon_shift_id = $1 AND (vendu_qty <> 0 OR vendu_amount <> 0 OR source_vendu = 'loyverse_import')`,
      [shiftId]
    );
    return { reset: r.rowCount ?? 0 };
  },

  /**
   * Pre-remplit le comptage de passation (invendu) avec le reste THEORIQUE :
   * invendu = max(ouverture + recu - vendu, 0), pour chaque ligne visible du
   * shift. « ouverture » = report_veille_qty (reste du soir de J-1 pour le Matin,
   * comptage de passation pour le Soir). JAMAIS l'appro : ce qui compte c'est le
   * stock reellement entre (recu confirme). Ramene l'ecart a 0 par defaut (meme
   * base que la colonne ecart) ; l'equipe ne fait plus que valider ou corriger
   * les ecarts au comptage physique. Idempotent (ne reecrit que les lignes dont
   * l'invendu differe). Le comptage de passation alimente l'ouverture du shift
   * suivant (syncPassation). Le 0 est caste en numeric pour eviter l'inference
   * integer de GREATEST sur des quantites decimales.
   */
  async prefillReste(shiftId: string) {
    const shift = await this.assertShiftOpen(shiftId);
    const theo = `GREATEST(report_veille_qty + recu_qty - vendu_qty, 0::numeric)`;
    const r = await db.query(
      `UPDATE recon_lines
         SET invendu_qty = ${theo}, updated_at = NOW()
       WHERE recon_shift_id = $1 AND NOT hidden
         AND invendu_qty IS DISTINCT FROM ${theo}`,
      [shiftId]
    );
    await this.syncPassation(shift.recon_day_id);
    return { updated: r.rowCount ?? 0 };
  },

  // ─── Import Loyverse (ventes) ──────────────────────────────────────────

  /**
   * Injecte les ventes du CSV Loyverse dans les lignes d'un shift (export
   * filtre sur la plage horaire du shift dans le back-office Loyverse).
   * Reimport idempotent : vendu_qty et unit_price sont ECRASES (set, pas
   * cumul). appro_qty / invendu_qty deja saisis sont preserves. Les produits
   * absents de la grille sont crees (rien n'est perdu).
   */
  async importSales(
    shiftId: string,
    items: { sku?: string | null; productName: string; category?: string | null; quantity: number; unitPrice: number; netSales?: number }[]
  ) {
    const shift = await this.assertShiftOpen(shiftId);
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const it of items) {
        if (!it.productName || !(it.quantity > 0)) continue;
        const key = productKey(it.sku, it.productName);
        await client.query(
          `INSERT INTO recon_lines
             (recon_day_id, recon_shift_id, product_key, sku, product_name, category, vendu_qty, vendu_amount, unit_price, source_vendu)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'loyverse_import')
           ON CONFLICT (recon_shift_id, product_key) DO UPDATE SET
             sku          = COALESCE(NULLIF(EXCLUDED.sku, ''), recon_lines.sku),
             product_name = EXCLUDED.product_name,
             category     = COALESCE(recon_lines.category, EXCLUDED.category),
             vendu_qty    = EXCLUDED.vendu_qty,
             vendu_amount = EXCLUDED.vendu_amount,
             unit_price   = CASE WHEN EXCLUDED.unit_price > 0 THEN EXCLUDED.unit_price ELSE recon_lines.unit_price END,
             source_vendu = 'loyverse_import',
             hidden       = false,
             updated_at   = NOW()`,
          [shift.recon_day_id, shiftId, key, it.sku ?? null, it.productName, it.category ?? null, it.quantity, it.netSales ?? 0, it.unitPrice ?? 0]
        );
        await registerProduct(client, it);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  // ─── Rapport de periode ────────────────────────────────────────────────

  /**
   * Suggestion fiche de besoin : catalogue complet + vendu du meme jour de semaine
   * J-7 (fallback J-14). Permet de pre-remplir l'appro du jour.
   */
  async suggest({ date, storeId }: { date: string; storeId: string | null }) {
    const { rows: refRows } = await db.query(`
      SELECT id, business_date::text AS business_date
      FROM recon_days
      WHERE business_date IN ($1::date - 7, $1::date - 14)
        AND store_id IS NOT DISTINCT FROM $2
      ORDER BY business_date DESC
      LIMIT 1
    `, [date, storeId]);

    const refDayId = refRows[0]?.id ?? null;
    const referenceDate = refRows[0]?.business_date ?? null;

    // Catalogue = recon_products (editable dans l'onglet Catalogue). Les imports
    // y enregistrent automatiquement les nouveaux produits : un produit supprime
    // ne revient que s'il reapparait dans un import Loyverse.
    const { rows } = await db.query(`
      SELECT
        p.product_key, p.product_name, p.sku, p.category, p.unit_price,
        COALESCE(ref.vendu_qty, 0)   AS suggested_qty,
        ref.appro_qty                AS ref_appro,
        ref.vendu_qty                AS ref_vendu,
        ref.invendu_qty              AS ref_invendu
      FROM recon_products p
      LEFT JOIN (
        -- Journee de reference cumulee sur ses shifts (mig 262)
        SELECT product_key,
               SUM(vendu_qty)   AS vendu_qty,
               SUM(appro_qty)   AS appro_qty,
               SUM(invendu_qty) AS invendu_qty
        FROM recon_lines
        WHERE recon_day_id = $1 AND NOT hidden
        GROUP BY product_key
      ) ref ON ref.product_key = p.product_key
      ORDER BY p.category NULLS LAST, p.product_name
    `, [refDayId]);

    return { referenceDate, products: rows };
  },

  // ─── Fiche de besoin partagée ──────────────────────────────────────────

  /** Fiche enregistrée pour une date : lignes + méta (qui / quand). */
  async getFiche(date: string) {
    const { rows } = await db.query(
      `SELECT product_key, sku, product_name, category, unit_price,
              slot_qty, total_qty, removed, saved_by_name, updated_at
       FROM recon_fiche_lines
       WHERE fiche_date = $1
       ORDER BY category NULLS LAST, product_name`,
      [date]
    );
    let savedAt: string | null = null;
    let savedBy: string | null = null;
    for (const r of rows) {
      if (!savedAt || r.updated_at > savedAt) { savedAt = r.updated_at; savedBy = r.saved_by_name; }
    }
    return { savedAt, savedBy, lines: rows };
  },

  /**
   * Enregistre la fiche d'une date (remplacement complet, atomique) : tout
   * utilisateur qui rouvre la fiche retrouve les mêmes quantités par créneau,
   * les produits ajoutés et les produits retirés.
   */
  async saveFiche(
    date: string,
    lines: {
      sku?: string | null; productName: string; category?: string | null;
      unitPrice?: number; slotQty?: Record<string, number>; totalQty?: number; removed?: boolean;
    }[],
    userId?: string | null
  ) {
    let savedByName: string | null = null;
    if (userId) {
      const u = await db.query(
        `SELECT TRIM(first_name || ' ' || last_name) AS name FROM users WHERE id = $1`,
        [userId]
      );
      savedByName = u.rows[0]?.name || null;
    }
    const client = await db.getClient();
    let saved = 0;
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM recon_fiche_lines WHERE fiche_date = $1`, [date]);
      for (const l of lines) {
        if (!l.productName?.trim()) continue;
        const key = productKey(l.sku, l.productName);
        await client.query(
          `INSERT INTO recon_fiche_lines
             (fiche_date, product_key, sku, product_name, category, unit_price,
              slot_qty, total_qty, removed, saved_by, saved_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (fiche_date, product_key) DO UPDATE SET
             slot_qty = EXCLUDED.slot_qty, total_qty = EXCLUDED.total_qty,
             removed = EXCLUDED.removed, updated_at = NOW()`,
          [
            date, key, l.sku ?? null, l.productName.trim(), l.category ?? null,
            l.unitPrice ?? 0, JSON.stringify(l.slotQty ?? {}), l.totalQty ?? 0,
            l.removed === true, userId ?? null, savedByName,
          ]
        );
        saved++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { saved };
  },

  // ─── Créneaux d'approvisionnement ────────────────────────────────────

  async listSlots() {
    const { rows } = await db.query(
      `SELECT * FROM recon_supply_slots ORDER BY category, sort_order, slot_number`
    );
    return rows;
  },

  async upsertSlot(data: {
    id?: string; category: string; slotNumber: number;
    label: string; targetTime?: string | null; defaultPct?: number; sortOrder?: number;
  }) {
    if (data.id) {
      const { rows } = await db.query(
        `UPDATE recon_supply_slots
         SET category = $2, slot_number = $3, label = $4, target_time = $5,
             default_pct = $6, sort_order = $7, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [data.id, data.category, data.slotNumber, data.label,
         data.targetTime ?? null, data.defaultPct ?? 0, data.sortOrder ?? 0]
      );
      return rows[0] || null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_supply_slots (category, slot_number, label, target_time, default_pct, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (category, slot_number) DO UPDATE SET
         label = EXCLUDED.label, target_time = EXCLUDED.target_time,
         default_pct = EXCLUDED.default_pct, sort_order = EXCLUDED.sort_order, updated_at = NOW()
       RETURNING *`,
      [data.category, data.slotNumber, data.label,
       data.targetTime ?? null, data.defaultPct ?? 0, data.sortOrder ?? 0]
    );
    return rows[0];
  },

  async deleteSlot(id: string) {
    await db.query(`DELETE FROM recon_supply_slots WHERE id = $1`, [id]);
  },

  // ─── Catalogue produits ────────────────────────────────────────────────

  async listProducts() {
    const { rows } = await db.query(
      `SELECT * FROM recon_products ORDER BY category NULLS LAST, product_name`
    );
    return rows;
  },

  /** Cree ou modifie un produit du catalogue. La cle est recalculee (SKU sinon nom). */
  async upsertProduct(data: { id?: string; sku?: string | null; productName: string; category?: string | null; unitPrice?: number }) {
    const key = productKey(data.sku, data.productName);
    if (data.id) {
      const { rows } = await db.query(
        `UPDATE recon_products
         SET product_key = $2, sku = $3, product_name = $4, category = $5, unit_price = $6, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [data.id, key, data.sku ?? null, data.productName.trim(), data.category ?? null, data.unitPrice ?? 0]
      );
      return rows[0] || null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_products (product_key, sku, product_name, category, unit_price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_key) DO UPDATE SET
         sku = EXCLUDED.sku, product_name = EXCLUDED.product_name,
         category = EXCLUDED.category, unit_price = EXCLUDED.unit_price, updated_at = NOW()
       RETURNING *`,
      [key, data.sku ?? null, data.productName.trim(), data.category ?? null, data.unitPrice ?? 0]
    );
    return rows[0];
  },

  async deleteProduct(id: string) {
    await db.query(`DELETE FROM recon_products WHERE id = $1`, [id]);
  },

  /** Vide entierement le catalogue produits. Historique des journees conserve. */
  async clearProducts() {
    const { rowCount } = await db.query(`DELETE FROM recon_products`);
    return { deleted: rowCount ?? 0 };
  },

  /** Import en masse dans le catalogue (CSV Loyverse « Importer le catalogue »). */
  async bulkUpsertProducts(rows: { sku?: string | null; productName: string; category?: string | null; unitPrice?: number }[]) {
    const client = await db.getClient();
    let upserted = 0;
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        if (!r.productName?.trim()) continue;
        await registerProduct(client, r);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { upserted };
  },

  // ─── Traductions darija ────────────────────────────────────────────────

  async listDarija() {
    const { rows } = await db.query(`SELECT * FROM recon_darija ORDER BY product_key`);
    return rows;
  },

  /** Upsert par cle produit normalisee. Une traduction vide supprime l'entree. */
  async upsertDarija(productKey: string, darija: string) {
    if (!darija.trim()) {
      await db.query(`DELETE FROM recon_darija WHERE product_key = $1`, [productKey]);
      return null;
    }
    const { rows } = await db.query(
      `INSERT INTO recon_darija (product_key, darija)
       VALUES ($1, $2)
       ON CONFLICT (product_key) DO UPDATE SET darija = EXCLUDED.darija, updated_at = NOW()
       RETURNING *`,
      [productKey, darija.trim()]
    );
    return rows[0];
  },

  async report(params: { from: string; to: string; storeId?: string | null }) {
    const vals: unknown[] = [params.from, params.to];
    let storeCond = '';
    if (params.storeId) { vals.push(params.storeId); storeCond = `AND d.store_id = $${vals.length}`; }
    // Le reste (invendu) d'une journee = celui de son DERNIER shift : les
    // comptages de passation intermediaires ne sont pas des restes du jour.
    // Vendu / appro / ecart se cumulent sur tous les shifts.
    const result = await db.query(`
      SELECT
        l.product_key,
        MAX(l.product_name)                AS product_name,
        MAX(l.category)                    AS category,
        SUM(l.appro_qty)                   AS appro_qty,
        SUM(l.vendu_qty)                   AS vendu_qty,
        COALESCE(SUM(l.invendu_qty) FILTER (WHERE s.shift_number = last_s.max_sn), 0) AS invendu_qty,
        SUM(l.ecart_qty)                   AS ecart_qty,
        SUM(l.ecart_value)                 AS ecart_value,
        COUNT(DISTINCT d.id)               AS days_count
      FROM recon_lines l
      JOIN recon_days d ON d.id = l.recon_day_id
      JOIN recon_shifts s ON s.id = l.recon_shift_id
      JOIN (
        SELECT recon_day_id, MAX(shift_number) AS max_sn
        FROM recon_shifts GROUP BY recon_day_id
      ) last_s ON last_s.recon_day_id = l.recon_day_id
      WHERE d.business_date BETWEEN $1 AND $2 AND NOT l.hidden ${storeCond}
      GROUP BY l.product_key
      ORDER BY SUM(ABS(l.ecart_value)) DESC
    `, vals);
    return result.rows;
  },
};
