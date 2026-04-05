import { db } from '../config/database.js';

export const notificationRepository = {
  async findForUser(params: {
    role: string;
    userId: string;
    storeId?: string;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const { role, userId, storeId, unreadOnly = false, limit = 30, offset = 0 } = params;
    const conditions = [
      `(n.target_role = $1 OR n.target_role = 'all')`,
      `(n.target_user_id IS NULL OR n.target_user_id = $2)`,
    ];
    const values: unknown[] = [role, userId];
    let i = 3;

    if (storeId) {
      conditions.push(`(n.store_id IS NULL OR n.store_id = $${i++})`);
      values.push(storeId);
    }

    if (unreadOnly) {
      conditions.push(`NOT ($2 = ANY(n.read_by))`);
    }

    // Only show notifications from the last 30 days
    conditions.push(`n.created_at > NOW() - INTERVAL '30 days'`);

    const where = conditions.join(' AND ');

    const countResult = await db.query(
      `SELECT COUNT(*) FROM notifications n WHERE ${where}`,
      values,
    );

    const result = await db.query(
      `SELECT n.*,
              u.first_name AS creator_first_name,
              u.last_name AS creator_last_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset],
    );

    return { rows: result.rows, total: parseInt(countResult.rows[0].count) };
  },

  async countUnread(role: string, userId: string, storeId?: string) {
    const conditions = [
      `(target_role = $1 OR target_role = 'all')`,
      `(target_user_id IS NULL OR target_user_id = $2)`,
      `NOT ($2 = ANY(read_by))`,
      `created_at > NOW() - INTERVAL '30 days'`,
    ];
    const values: unknown[] = [role, userId];
    let i = 3;

    if (storeId) {
      conditions.push(`(store_id IS NULL OR store_id = $${i++})`);
      values.push(storeId);
    }

    const result = await db.query(
      `SELECT COUNT(*) FROM notifications WHERE ${conditions.join(' AND ')}`,
      values,
    );
    return parseInt(result.rows[0].count);
  },

  async markAsRead(notificationId: string, userId: string) {
    await db.query(
      `UPDATE notifications SET read_by = array_append(read_by, $2::uuid)
       WHERE id = $1 AND NOT ($2 = ANY(read_by))`,
      [notificationId, userId],
    );
  },

  async markAllAsRead(role: string, userId: string, storeId?: string) {
    const conditions = [
      `(target_role = $1 OR target_role = 'all')`,
      `(target_user_id IS NULL OR target_user_id = $2)`,
      `NOT ($2 = ANY(read_by))`,
    ];
    const values: unknown[] = [role, userId];
    let i = 3;

    if (storeId) {
      conditions.push(`(store_id IS NULL OR store_id = $${i++})`);
      values.push(storeId);
    }

    await db.query(
      `UPDATE notifications SET read_by = array_append(read_by, $2::uuid)
       WHERE ${conditions.join(' AND ')}`,
      values,
    );
  },

  /**
   * Sync: create missing notifications for active production plans
   * targeting a given role. This ensures chefs see notifications for
   * plans that were created before the notification system or while
   * they were offline.
   */
  async syncProductionNotifications(role: string, storeId?: string) {
    try {
      // Find production plans targeting this role that are in actionable statuses
      // and don't already have a notification
      const conditions = [
        `pp.target_role = $1`,
        `pp.status IN ('draft', 'confirmed', 'in_progress')`,
      ];
      const values: unknown[] = [role];
      let i = 2;

      if (storeId) {
        conditions.push(`pp.store_id = $${i++}`);
        values.push(storeId);
      }

      const plans = await db.query(
        `SELECT pp.id, pp.plan_date, pp.status, pp.created_by,
                (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count
         FROM production_plans pp
         WHERE ${conditions.join(' AND ')}
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.reference_type = 'production_plan'
               AND n.reference_id = pp.id
               AND n.target_role = $1
           )
         ORDER BY pp.plan_date ASC`,
        values,
      );

      // Create notifications for each missing plan
      for (const plan of plans.rows) {
        const statusLabels: Record<string, string> = {
          draft: 'en brouillon',
          confirmed: 'confirme et pret a demarrer',
          in_progress: 'en cours de production',
        };
        await db.query(
          `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, $4, $5, 'production_plan', $6, $7)`,
          [
            role,
            storeId || null,
            `production_plan_${plan.status}`,
            plan.status === 'confirmed' ? 'Plan de production a demarrer' : 'Plan de production en attente',
            `Plan du ${plan.plan_date?.toString().slice(0, 10)} ${statusLabels[plan.status] || ''} — ${plan.item_count} produit(s)`,
            plan.id,
            plan.created_by,
          ],
        );
      }

      return plans.rows.length;
    } catch (err) {
      console.error('[notify] syncProductionNotifications failed:', err);
      return 0;
    }
  },

  /**
   * Sync: create missing notifications for active orders
   * This ensures chefs see notifications for orders that need production.
   */
  async syncOrderNotifications(role: string, storeId?: string) {
    try {
      // Only for chef roles — find confirmed/in_production orders without notifications
      const chefRoles = ['baker', 'pastry_chef', 'viennoiserie'];
      if (!chefRoles.includes(role)) return 0;

      const conditions = [
        `o.status IN ('confirmed', 'in_production')`,
      ];
      const values: unknown[] = [role];
      let i = 2;

      if (storeId) {
        conditions.push(`o.store_id = $${i++}`);
        values.push(storeId);
      }

      const orders = await db.query(
        `SELECT o.id, o.order_number, o.pickup_date, o.total, o.user_id
         FROM orders o
         WHERE ${conditions.join(' AND ')}
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.reference_type = 'order'
               AND n.reference_id = o.id
               AND n.target_role = $1
           )
         ORDER BY o.pickup_date ASC`,
        values,
      );

      for (const order of orders.rows) {
        await db.query(
          `INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, $4, $5, 'order', $6, $7)`,
          [
            role,
            storeId || null,
            'order_confirmed',
            'Commande a preparer',
            `Commande ${order.order_number} pour le ${order.pickup_date?.toString().slice(0, 10)} — ${parseFloat(order.total).toFixed(2)} DH`,
            order.id,
            order.user_id,
          ],
        );
      }

      return orders.rows.length;
    } catch (err) {
      console.error('[notify] syncOrderNotifications failed:', err);
      return 0;
    }
  },

  async create(data: {
    targetRole: string;
    targetUserId?: string;
    storeId?: string;
    type: string;
    title: string;
    message: string;
    referenceType?: string;
    referenceId?: string;
    createdBy?: string;
  }) {
    const result = await db.query(
      `INSERT INTO notifications (target_role, target_user_id, store_id, type, title, message, reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.targetRole,
        data.targetUserId || null,
        data.storeId || null,
        data.type,
        data.title,
        data.message,
        data.referenceType || null,
        data.referenceId || null,
        data.createdBy || null,
      ],
    );
    return result.rows[0];
  },
};
