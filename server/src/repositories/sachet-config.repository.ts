import { db } from '../config/database.js';

export type SachetCategoryConfig = {
  id: number;
  name: string;
  articlesPerSachet: number | null;
  needsSachet: boolean;
};

export type SachetConfig = {
  defaultArticlesPerSachet: number;
  categories: SachetCategoryConfig[];
};

type CategoryUpdate = {
  id: number;
  articlesPerSachet: number | null;
  needsSachet: boolean;
};

export const sachetConfigRepository = {
  async get(): Promise<SachetConfig> {
    const settingsRes = await db.query(
      'SELECT default_articles_per_sachet FROM company_settings WHERE id = 1'
    );
    const categoriesRes = await db.query(
      `SELECT id, name, articles_per_sachet, needs_sachet
       FROM categories
       ORDER BY display_order, name`
    );

    return {
      defaultArticlesPerSachet: settingsRes.rows[0]?.default_articles_per_sachet ?? 5,
      categories: categoriesRes.rows.map((r: {
        id: number;
        name: string;
        articles_per_sachet: number | null;
        needs_sachet: boolean;
      }) => ({
        id: r.id,
        name: r.name,
        articlesPerSachet: r.articles_per_sachet,
        needsSachet: r.needs_sachet,
      })),
    };
  },

  async update(input: {
    defaultArticlesPerSachet?: number;
    categories?: CategoryUpdate[];
  }): Promise<SachetConfig> {
    await db.query('BEGIN');
    try {
      if (input.defaultArticlesPerSachet !== undefined) {
        await db.query(
          `UPDATE company_settings
           SET default_articles_per_sachet = $1, updated_at = NOW()
           WHERE id = 1`,
          [input.defaultArticlesPerSachet]
        );
      }

      if (input.categories) {
        for (const cat of input.categories) {
          await db.query(
            `UPDATE categories
             SET articles_per_sachet = $1, needs_sachet = $2
             WHERE id = $3`,
            [cat.articlesPerSachet, cat.needsSachet, cat.id]
          );
        }
      }

      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    return this.get();
  },

  async report(opts: { dateFrom?: string; dateTo?: string; storeId?: string }): Promise<{
    range: { from: string | null; to: string | null };
    perSaleswoman: Array<{
      userId: string;
      userName: string;
      storeName: string | null;
      salesCount: number;
      sachetsGiven: number;
      sachetsSuggested: number;
      overshoot: number;
      overshootRatio: number;
      topReason: string | null;
    }>;
    reasons: Array<{ reason: string; count: number }>;
    totals: {
      salesCount: number;
      sachetsGiven: number;
      sachetsSuggested: number;
      overshoot: number;
    };
  }> {
    const conds: string[] = [
      `s.sachets_given IS NOT NULL`,
      `s.sachets_suggested IS NOT NULL`,
    ];
    const params: unknown[] = [];
    let i = 1;
    if (opts.dateFrom) { conds.push(`s.created_at >= $${i++}`); params.push(opts.dateFrom); }
    if (opts.dateTo)   { conds.push(`s.created_at <  $${i++}`); params.push(opts.dateTo); }
    if (opts.storeId)  { conds.push(`s.store_id = $${i++}`);   params.push(opts.storeId); }
    const where = `WHERE ${conds.join(' AND ')}`;

    const perSaleswomanRes = await db.query(
      `WITH base AS (
         SELECT s.* FROM sales s ${where}
       ),
       agg AS (
         SELECT
           b.user_id,
           COUNT(*)::int AS sales_count,
           COALESCE(SUM(b.sachets_given), 0)::int AS sachets_given,
           COALESCE(SUM(b.sachets_suggested), 0)::int AS sachets_suggested,
           COALESCE(SUM(GREATEST(0, b.sachets_given - b.sachets_suggested)), 0)::int AS overshoot,
           MAX(b.store_id) AS store_id
         FROM base b
         GROUP BY b.user_id
       ),
       reason_rank AS (
         SELECT user_id, sachet_reason, COUNT(*) AS n,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY COUNT(*) DESC) AS rn
         FROM base
         WHERE sachet_reason IS NOT NULL
         GROUP BY user_id, sachet_reason
       )
       SELECT
         agg.user_id,
         TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS user_name,
         st.name AS store_name,
         agg.sales_count,
         agg.sachets_given,
         agg.sachets_suggested,
         agg.overshoot,
         rr.sachet_reason AS top_reason
       FROM agg
       JOIN users u ON u.id = agg.user_id
       LEFT JOIN stores st ON st.id = agg.store_id
       LEFT JOIN reason_rank rr ON rr.user_id = agg.user_id AND rr.rn = 1
       ORDER BY agg.overshoot DESC, agg.sales_count DESC`,
      params
    );

    const reasonsRes = await db.query(
      `SELECT s.sachet_reason AS reason, COUNT(*)::int AS count
       FROM sales s
       ${where} AND s.sachet_reason IS NOT NULL
       GROUP BY s.sachet_reason
       ORDER BY count DESC`,
      params
    );

    const totalsRes = await db.query(
      `SELECT
         COUNT(*)::int AS sales_count,
         COALESCE(SUM(s.sachets_given), 0)::int AS sachets_given,
         COALESCE(SUM(s.sachets_suggested), 0)::int AS sachets_suggested,
         COALESCE(SUM(GREATEST(0, s.sachets_given - s.sachets_suggested)), 0)::int AS overshoot
       FROM sales s
       ${where}`,
      params
    );

    const perSaleswoman = perSaleswomanRes.rows.map((r: {
      user_id: string;
      user_name: string;
      store_name: string | null;
      sales_count: number;
      sachets_given: number;
      sachets_suggested: number;
      overshoot: number;
      top_reason: string | null;
    }) => ({
      userId: r.user_id,
      userName: r.user_name || '—',
      storeName: r.store_name,
      salesCount: r.sales_count,
      sachetsGiven: r.sachets_given,
      sachetsSuggested: r.sachets_suggested,
      overshoot: r.overshoot,
      overshootRatio: r.sachets_suggested > 0 ? r.sachets_given / r.sachets_suggested : 0,
      topReason: r.top_reason,
    }));

    const totalsRow = totalsRes.rows[0] ?? { sales_count: 0, sachets_given: 0, sachets_suggested: 0, overshoot: 0 };

    return {
      range: { from: opts.dateFrom || null, to: opts.dateTo || null },
      perSaleswoman,
      reasons: reasonsRes.rows.map((r: { reason: string; count: number }) => ({
        reason: r.reason,
        count: r.count,
      })),
      totals: {
        salesCount: totalsRow.sales_count,
        sachetsGiven: totalsRow.sachets_given,
        sachetsSuggested: totalsRow.sachets_suggested,
        overshoot: totalsRow.overshoot,
      },
    };
  },
};
