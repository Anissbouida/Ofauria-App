import { db } from '../config/database.js';

/* ═══ Ref Tables (registry) ═══ */
export const refTableRepository = {
  /** List all registered reference tables with entry counts */
  async findAll() {
    const result = await db.query(`
      SELECT rt.*,
        CASE WHEN rt.source = 'ref_entries' THEN (
          SELECT COUNT(*) FROM ref_entries re WHERE re.table_id = rt.id
        )
        WHEN rt.id = 'expense_categories' THEN (SELECT COUNT(*) FROM expense_categories)
        WHEN rt.id = 'revenue_categories' THEN (SELECT COUNT(*) FROM revenue_categories)
        WHEN rt.id = 'product_categories' THEN (SELECT COUNT(*) FROM categories)
        ELSE 0 END::int AS total_count,
        CASE WHEN rt.source = 'ref_entries' THEN (
          SELECT COUNT(*) FROM ref_entries re WHERE re.table_id = rt.id AND re.is_active = true
        )
        WHEN rt.id = 'expense_categories' THEN (SELECT COUNT(*) FROM expense_categories WHERE is_active = true)
        WHEN rt.id = 'revenue_categories' THEN (SELECT COUNT(*) FROM revenue_categories WHERE is_active = true)
        WHEN rt.id = 'product_categories' THEN (SELECT COUNT(*) FROM categories)
        ELSE 0 END::int AS active_count
      FROM ref_tables rt
      ORDER BY rt.display_order, rt.label
    `);
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM ref_tables WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
};

/* ═══ Generic Ref Entries ═══ */
export const refEntryRepository = {
  /** List entries for a generic ref table */
  async findAll(tableId: string, includeInactive = false) {
    const filter = includeInactive ? '' : ' AND re.is_active = true';
    const result = await db.query(
      `SELECT re.* FROM ref_entries re
       WHERE re.table_id = $1${filter}
       ORDER BY re.display_order, re.label`,
      [tableId]
    );
    return result.rows;
  },

  async findById(tableId: string, id: string) {
    const result = await db.query(
      'SELECT * FROM ref_entries WHERE table_id = $1 AND id = $2',
      [tableId, id]
    );
    return result.rows[0] || null;
  },

  async create(tableId: string, data: {
    code?: string; label: string; description?: string;
    color?: string; icon?: string; display_order?: number; metadata?: Record<string, unknown>;
  }) {
    // Auto-assign display_order if not provided
    let order = data.display_order;
    if (order === undefined) {
      const maxResult = await db.query(
        'SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM ref_entries WHERE table_id = $1',
        [tableId]
      );
      order = maxResult.rows[0].next_order;
    }

    const result = await db.query(
      `INSERT INTO ref_entries (table_id, code, label, description, color, icon, display_order, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tableId, data.code || null, data.label, data.description || null,
       data.color || null, data.icon || null, order, JSON.stringify(data.metadata || {})]
    );
    return result.rows[0];
  },

  async update(tableId: string, id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      code: 'code', label: 'label', description: 'description',
      color: 'color', icon: 'icon', display_order: 'display_order',
      is_active: 'is_active', metadata: 'metadata',
    };
    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(key === 'metadata' ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (values.length === 0) return this.findById(tableId, id);
    values.push(tableId, id);
    const result = await db.query(
      `UPDATE ref_entries SET ${fields.join(', ')} WHERE table_id = $${i++} AND id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  /** Soft-delete: deactivate an entry */
  async deactivate(tableId: string, id: string) {
    const result = await db.query(
      `UPDATE ref_entries SET is_active = false, updated_at = NOW()
       WHERE table_id = $1 AND id = $2 RETURNING *`,
      [tableId, id]
    );
    return result.rows[0];
  },

  /** Reactivate an entry */
  async reactivate(tableId: string, id: string) {
    const result = await db.query(
      `UPDATE ref_entries SET is_active = true, updated_at = NOW()
       WHERE table_id = $1 AND id = $2 RETURNING *`,
      [tableId, id]
    );
    return result.rows[0];
  },

  /** Reorder entries within a table */
  async reorder(tableId: string, orderedIds: string[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query(
          'UPDATE ref_entries SET display_order = $1, updated_at = NOW() WHERE table_id = $2 AND id = $3',
          [i + 1, tableId, orderedIds[i]]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

/* ═══ Native Table Adapters ═══ */

/** Adapter for expense_categories table (hierarchical) */
const expenseCategoriesAdapter = {
  async findAll(includeInactive = false) {
    const filter = includeInactive ? '' : ' WHERE ec.is_active = true';
    const result = await db.query(
      `SELECT ec.*, p.name as parent_name
       FROM expense_categories ec
       LEFT JOIN expense_categories p ON p.id = ec.parent_id
       ${filter}
       ORDER BY ec.level, ec.display_order, ec.name`
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      table_id: 'expense_categories',
      code: null,
      label: r.name,
      description: r.description,
      color: null,
      icon: null,
      display_order: r.display_order,
      is_active: r.is_active,
      metadata: { requires_po: r.requires_po, level: r.level, parent_id: r.parent_id },
      created_at: r.created_at,
      updated_at: r.created_at,
      // Hierarchy fields
      _level: r.level,
      _parent_id: r.parent_id,
      _parent_name: r.parent_name,
      _requires_po: r.requires_po,
    }));
  },
  async create(data: Record<string, unknown>) {
    const md = (data.metadata || {}) as Record<string, unknown>;
    const level = md.level || (md.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO expense_categories (name, type, description, parent_id, level, requires_po, display_order)
       VALUES ($1, 'expense', $2, $3, $4, $5, $6) RETURNING *`,
      [data.label, data.description || null, md.parent_id || null, level,
       md.requires_po ?? false, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.label !== undefined) { fields.push(`name = $${i++}`); values.push(data.label); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (data.metadata) {
      const md = data.metadata as Record<string, unknown>;
      if (md.requires_po !== undefined) { fields.push(`requires_po = $${i++}`); values.push(md.requires_po); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE expense_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async checkUsage(id: string) {
    const result = await db.query(
      'SELECT COUNT(*)::int as count FROM payments WHERE category_id = $1', [id]
    );
    return result.rows[0].count;
  },
  async delete(id: string) {
    // Soft delete with cascading
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM expense_categories WHERE id = $1
        UNION ALL
        SELECT ec.id FROM expense_categories ec JOIN tree t ON ec.parent_id = t.id
      )
      UPDATE expense_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
};

/** Adapter for revenue_categories table (hierarchical) */
const revenueCategoriesAdapter = {
  async findAll(includeInactive = false) {
    const filter = includeInactive ? '' : ' WHERE rc.is_active = true';
    const result = await db.query(
      `SELECT rc.*, p.name as parent_name
       FROM revenue_categories rc
       LEFT JOIN revenue_categories p ON p.id = rc.parent_id
       ${filter}
       ORDER BY rc.level, rc.display_order, rc.name`
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      table_id: 'revenue_categories',
      code: null,
      label: r.name,
      description: r.description,
      color: null,
      icon: null,
      display_order: r.display_order,
      is_active: r.is_active,
      metadata: { level: r.level, parent_id: r.parent_id },
      created_at: r.created_at,
      updated_at: r.created_at,
      _level: r.level,
      _parent_id: r.parent_id,
      _parent_name: r.parent_name,
    }));
  },
  async create(data: Record<string, unknown>) {
    const md = (data.metadata || {}) as Record<string, unknown>;
    const level = md.level || (md.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO revenue_categories (name, description, parent_id, level, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.label, data.description || null, md.parent_id || null, level, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.label !== undefined) { fields.push(`name = $${i++}`); values.push(data.label); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE revenue_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async checkUsage(_id: string) {
    return 0; // Revenue categories not yet referenced by FK
  },
  async delete(id: string) {
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM revenue_categories WHERE id = $1
        UNION ALL
        SELECT rc.id FROM revenue_categories rc JOIN tree t ON rc.parent_id = t.id
      )
      UPDATE revenue_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
};

/** Adapter for categories (product categories) table */
const productCategoriesAdapter = {
  async findAll(includeInactive = false) {
    const result = await db.query('SELECT * FROM categories ORDER BY display_order, name');
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      table_id: 'product_categories',
      code: r.slug,
      label: r.name,
      description: r.description,
      color: null,
      icon: null,
      display_order: r.display_order,
      is_active: true,
      metadata: { slug: r.slug },
      created_at: r.created_at,
      updated_at: r.created_at,
    }));
  },
  async create(data: Record<string, unknown>) {
    const slug = (data.label as string).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const result = await db.query(
      `INSERT INTO categories (name, slug, description, display_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [data.label, data.code || slug, data.description || null, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.label !== undefined) { fields.push(`name = $${i++}`); values.push(data.label); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (data.display_order !== undefined) { fields.push(`display_order = $${i++}`); values.push(data.display_order); }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async checkUsage(id: string) {
    const result = await db.query(
      'SELECT COUNT(*)::int as count FROM products WHERE category_id = $1', [id]
    );
    return result.rows[0].count;
  },
  async delete(id: string) {
    await db.query('DELETE FROM categories WHERE id = $1', [id]);
  },
};

/** Native adapter interface */
interface NativeAdapter {
  findAll(includeInactive?: boolean): Promise<Record<string, unknown>[]>;
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  checkUsage(id: string): Promise<number>;
  delete(id: string): Promise<void>;
}

/** Registry of native adapters */
export const nativeAdapters: Record<string, NativeAdapter> = {
  expense_categories: expenseCategoriesAdapter as NativeAdapter,
  revenue_categories: revenueCategoriesAdapter as NativeAdapter,
  product_categories: productCategoriesAdapter as NativeAdapter,
};

/* ═══ Audit Log ═══ */
export const refAuditRepository = {
  async log(tableId: string, entryId: string, action: string, changes: unknown, userId?: string) {
    await db.query(
      `INSERT INTO ref_audit_log (table_id, entry_id, action, changes, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tableId, entryId, action, JSON.stringify(changes), userId || null]
    );
  },

  async findByTable(tableId: string, limit = 50) {
    const result = await db.query(
      `SELECT ral.*, u.first_name, u.last_name
       FROM ref_audit_log ral
       LEFT JOIN users u ON u.id = ral.user_id
       WHERE ral.table_id = $1
       ORDER BY ral.created_at DESC LIMIT $2`,
      [tableId, limit]
    );
    return result.rows;
  },

  async findRecent(limit = 100) {
    const result = await db.query(
      `SELECT ral.*, u.first_name, u.last_name, rt.label as table_label
       FROM ref_audit_log ral
       LEFT JOIN users u ON u.id = ral.user_id
       LEFT JOIN ref_tables rt ON rt.id = ral.table_id
       ORDER BY ral.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  },
};

/* ═══ Dashboard Stats ═══ */
export const refDashboardRepository = {
  async getStats() {
    // Get all ref tables with counts
    const tables = await refTableRepository.findAll();

    // Get recent audit entries
    const recentChanges = await refAuditRepository.findRecent(20);

    // Get orphan detection for generic ref_entries (entries never used)
    // We can't generically detect usage for all tables, so this returns basic stats
    const genericStats = await db.query(`
      SELECT re.table_id, COUNT(*) FILTER (WHERE re.is_active = false)::int as inactive_count
      FROM ref_entries re
      GROUP BY re.table_id
    `);

    const inactiveMap: Record<string, number> = {};
    for (const row of genericStats.rows) {
      inactiveMap[row.table_id as string] = row.inactive_count as number;
    }

    return {
      tables: tables.map((t: Record<string, unknown>) => ({
        ...t,
        inactive_count: inactiveMap[t.id as string] || 0,
      })),
      recentChanges,
    };
  },
};
