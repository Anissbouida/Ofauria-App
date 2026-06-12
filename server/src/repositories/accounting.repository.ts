import { db } from '../config/database.js';
import { getUserTimezone, getLocalYear } from '../utils/timezone.js';

/* ═══ Caisse / Daily Register ═══ */
export const caisseRepository = {
  async getRegister(year: number, month: number, storeId?: string) {
    const tz = getUserTimezone();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const storeFilterP = storeId ? ' AND p.store_id = $3' : '';
    const storeFilterS = storeId ? ' AND store_id = $3' : '';
    const storeFilterSales = storeId ? ' AND store_id = $3' : '';
    const baseParams = [startDate, endDate];
    const params = storeId ? [...baseParams, storeId] : baseParams;

    // All payments for the month — vue TRESORERIE (cash effectif).
    //
    // Cheques : on filtre sur cashed_at et on exclut ceux pas encore encaisses
    // (sinon ils apparaitraient dans Caisse/Resume du jour de signature alors
    // que le cash n'a pas encore quitte la banque). Le payment_date renvoye
    // est aussi remplace par cashed_at pour que le frontend buckete sur le
    // bon jour. Pour les autres methodes (cash/transfer), payment_date = date
    // d'effet, on garde tel quel.
    const payments = await db.query(
      `SELECT p.id,
              (CASE WHEN p.payment_method = 'check' THEN p.cashed_at ELSE p.payment_date END) AS payment_date,
              p.type, p.amount, p.payment_method, p.description, p.reference,
              s.name as supplier_name, ec.name as category_name, ec.type as category_type,
              e.first_name as employee_first_name, e.last_name as employee_last_name
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE (p.payment_method != 'check' OR p.cashed_at IS NOT NULL)
         AND (CASE WHEN p.payment_method = 'check' THEN p.cashed_at ELSE p.payment_date END) BETWEEN $1 AND $2
         ${storeFilterP}
       ORDER BY (CASE WHEN p.payment_method = 'check' THEN p.cashed_at ELSE p.payment_date END), p.created_at`,
      params
    );

    // Cash register sessions grouped by date (cashier-reported + system amounts)
    const sessions = await db.query(
      `SELECT TO_CHAR(DATE(closed_at AT TIME ZONE '${tz}'), 'YYYY-MM-DD') as session_date,
              COALESCE(SUM(actual_amount), 0) as cash_caissiere,
              COALESCE(SUM(cash_revenue), 0) as cash_systeme,
              COALESCE(SUM(card_revenue), 0) as card_revenue,
              COALESCE(SUM(COALESCE(mobile_revenue, 0)), 0) as mobile_revenue,
              COUNT(*) as session_count
       FROM cash_register_sessions
       WHERE status = 'closed'
         AND DATE(closed_at AT TIME ZONE '${tz}') BETWEEN $1 AND $2${storeFilterS}
       GROUP BY DATE(closed_at AT TIME ZONE '${tz}')
       ORDER BY DATE(closed_at AT TIME ZONE '${tz}')`,
      params
    );

    // Daily sales totals with payment method breakdown (source of truth for cash/card).
    // Une vente a plus tard est rattachee au jour de son encaissement (paid_at)
    // et exclue tant qu'elle n'est pas encaissee.
    // On UNION ALL les saisies manuelles (matin+soir, montants `_reel`) — le temps
    // que le POS soit adopte. Voir migration 149.
    const storeFilterManual = storeId ? ' AND store_id = $3' : '';
    const sales = await db.query(
      `SELECT sale_date,
              SUM(total_sales) as total_sales,
              SUM(cash_sales) as cash_sales,
              SUM(card_sales) as card_sales,
              SUM(mobile_sales) as mobile_sales,
              SUM(sale_count) as sale_count
       FROM (
         SELECT TO_CHAR(DATE(COALESCE(paid_at, created_at) AT TIME ZONE '${tz}'), 'YYYY-MM-DD') as sale_date,
                COALESCE(SUM(total), 0) as total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'mobile' THEN total ELSE 0 END), 0) as mobile_sales,
                COUNT(*) as sale_count
         FROM sales
         WHERE payment_status IS DISTINCT FROM 'unpaid'
           AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE '${tz}') BETWEEN $1 AND $2${storeFilterSales}
         GROUP BY DATE(COALESCE(paid_at, created_at) AT TIME ZONE '${tz}')
         UNION ALL
         SELECT TO_CHAR(entry_date, 'YYYY-MM-DD') as sale_date,
                COALESCE(matin_cash_reel,0)+COALESCE(matin_carte_reel,0)+COALESCE(soir_cash_reel,0)+COALESCE(soir_carte_reel,0) as total_sales,
                COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0) as cash_sales,
                COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0) as card_sales,
                0 as mobile_sales,
                0 as sale_count
         FROM manual_shift_entries
         WHERE entry_date BETWEEN $1 AND $2${storeFilterManual}
       ) combined
       GROUP BY sale_date
       ORDER BY sale_date`,
      params
    );

    // Previous balance: payments before this month
    const prevStoreFilter = storeId ? ' AND p.store_id = $2' : '';
    const prevParams = storeId ? [startDate, storeId] : [startDate];

    // Solde reporte : meme logique tresorerie que la requete principale.
    // Cheques non encaisses exclus ; effective_date utilisee pour le filtre.
    const prevPayments = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_entries,
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_entries,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_exits,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_exits
       FROM payments p
       WHERE (p.payment_method != 'check' OR p.cashed_at IS NOT NULL)
         AND (CASE WHEN p.payment_method = 'check' THEN p.cashed_at ELSE p.payment_date END) < $1
         ${prevStoreFilter}`,
      prevParams
    );

    // Previous balance: cash register sessions before this month (cashier declared amounts)
    const prevStoreFilterS = storeId ? ' AND store_id = $2' : '';
    const prevSessionParams = storeId ? [startDate, storeId] : [startDate];

    const prevSessions = await db.query(
      `SELECT COALESCE(SUM(actual_amount), 0) as cash_total
       FROM cash_register_sessions
       WHERE status = 'closed'
         AND DATE(closed_at AT TIME ZONE '${tz}') < $1${prevStoreFilterS}`,
      prevSessionParams
    );

    // Previous sales totals (cash + card) from actual sales + saisies manuelles
    const prevSalesFilterS = storeId ? ' AND store_id = $2' : '';
    const prevSalesParams = storeId ? [startDate, storeId] : [startDate];

    const prevSales = await db.query(
      `SELECT
        SUM(cash_total) as cash_total,
        SUM(card_total) as card_total
       FROM (
         SELECT
           COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_total,
           COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_total
         FROM sales
         WHERE payment_status IS DISTINCT FROM 'unpaid'
           AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE '${tz}') < $1${prevSalesFilterS}
         UNION ALL
         SELECT
           COALESCE(SUM(COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0)), 0) as cash_total,
           COALESCE(SUM(COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0)), 0) as card_total
         FROM manual_shift_entries
         WHERE entry_date < $1${prevSalesFilterS}
       ) combined`,
      prevSalesParams
    );

    const cashEntries = parseFloat(prevPayments.rows[0].cash_entries);
    const bankEntries = parseFloat(prevPayments.rows[0].bank_entries);
    const cashExits = parseFloat(prevPayments.rows[0].cash_exits);
    const bankExits = parseFloat(prevPayments.rows[0].bank_exits);
    const prevSessionCash = parseFloat(prevSessions.rows[0].cash_total);
    const prevSalesCash = parseFloat(prevSales.rows[0].cash_total);
    const prevCardSales = parseFloat(prevSales.rows[0].card_total);

    // Use session amounts when available, otherwise use cash sales
    // (for months without cash register sessions, cash caissière = cash système)
    const prevCash = prevSessionCash > 0 ? prevSessionCash : prevSalesCash;

    // Detect discrepancies between session-reported cash and system cash sales
    const DISCREPANCY_THRESHOLD = 5; // DH — ignore rounding differences
    const reconciliationAlerts: { date: string; cashCaissiere: number; cashSysteme: number; ecart: number }[] = [];

    for (const session of sessions.rows) {
      const cashCaissiere = parseFloat(session.cash_caissiere);
      const cashSysteme = parseFloat(session.cash_systeme);
      const ecart = cashCaissiere - cashSysteme;
      if (Math.abs(ecart) > DISCREPANCY_THRESHOLD) {
        reconciliationAlerts.push({
          date: session.session_date,
          cashCaissiere,
          cashSysteme,
          ecart,
        });
      }
    }

    return {
      payments: payments.rows,
      sessions: sessions.rows,
      sales: sales.rows,
      reconciliationAlerts,
      previousBalance: {
        cashNet: cashEntries + prevCash - cashExits,
        cardCumul: prevCardSales + bankEntries - bankExits,
      },
    };
  },
};

/* ═══ Suppliers ═══ */
export const supplierRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM suppliers ORDER BY name');
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM suppliers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async create(data: {
    name: string; contactName?: string; phone?: string; email?: string;
    address?: string; city?: string; ice?: string; notes?: string;
  }) {
    const result = await db.query(
      `INSERT INTO suppliers (name, contact_name, phone, email, address, city, ice, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [data.name, data.contactName || null, data.phone || null, data.email || null,
       data.address || null, data.city || null, data.ice || null, data.notes || null]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', contactName: 'contact_name', phone: 'phone', email: 'email',
      address: 'address', city: 'city', ice: 'ice', notes: 'notes', isActive: 'is_active',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async delete(id: string) {
    await db.query('UPDATE suppliers SET is_active = false WHERE id = $1', [id]);
  },
};

/* ═══ Expense Categories (hierarchical) ═══ */
export const expenseCategoryRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT ec.*, p.name as parent_name
       FROM expense_categories ec
       LEFT JOIN expense_categories p ON p.id = ec.parent_id
       WHERE ec.is_active = true
       ORDER BY ec.level, ec.display_order, ec.name`
    );
    return result.rows;
  },
  async findAllTree() {
    const result = await db.query(
      `SELECT ec.*, p.name as parent_name
       FROM expense_categories ec
       LEFT JOIN expense_categories p ON p.id = ec.parent_id
       ORDER BY ec.level, ec.display_order, ec.name`
    );
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM expense_categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async findByLevel(level: number) {
    const result = await db.query(
      'SELECT * FROM expense_categories WHERE level = $1 AND is_active = true ORDER BY display_order, name',
      [level]
    );
    return result.rows;
  },
  async findChildren(parentId: string) {
    const result = await db.query(
      'SELECT * FROM expense_categories WHERE parent_id = $1 AND is_active = true ORDER BY display_order, name',
      [parentId]
    );
    return result.rows;
  },
  async create(data: { name: string; description?: string; parent_id?: string; level?: number; requires_po?: boolean; display_order?: number }) {
    const level = data.level || (data.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO expense_categories (name, type, description, parent_id, level, requires_po, display_order)
       VALUES ($1, 'expense', $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.description || null, data.parent_id || null, level,
       data.requires_po ?? false, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', description: 'description', parent_id: 'parent_id',
      level: 'level', requires_po: 'requires_po', display_order: 'display_order', is_active: 'is_active',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE expense_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async deactivate(id: string) {
    // Soft-delete: deactivate self + all children recursively
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM expense_categories WHERE id = $1
        UNION ALL
        SELECT ec.id FROM expense_categories ec JOIN tree t ON ec.parent_id = t.id
      )
      UPDATE expense_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
  async delete(id: string) {
    await db.query('UPDATE expense_categories SET is_active = false WHERE id = $1', [id]);
  },
};

/* ═══ Revenue Categories (hierarchical) ═══ */
export const revenueCategoryRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT rc.*, p.name as parent_name
       FROM revenue_categories rc
       LEFT JOIN revenue_categories p ON p.id = rc.parent_id
       WHERE rc.is_active = true
       ORDER BY rc.level, rc.display_order, rc.name`
    );
    return result.rows;
  },
  async findAllTree() {
    const result = await db.query(
      `SELECT rc.*, p.name as parent_name
       FROM revenue_categories rc
       LEFT JOIN revenue_categories p ON p.id = rc.parent_id
       ORDER BY rc.level, rc.display_order, rc.name`
    );
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM revenue_categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async findChildren(parentId: string) {
    const result = await db.query(
      'SELECT * FROM revenue_categories WHERE parent_id = $1 AND is_active = true ORDER BY display_order, name',
      [parentId]
    );
    return result.rows;
  },
  async create(data: { name: string; description?: string; parent_id?: string; level?: number; display_order?: number }) {
    const level = data.level || (data.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO revenue_categories (name, description, parent_id, level, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.name, data.description || null, data.parent_id || null, level, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', description: 'description', parent_id: 'parent_id',
      level: 'level', display_order: 'display_order', is_active: 'is_active',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE revenue_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async deactivate(id: string) {
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM revenue_categories WHERE id = $1
        UNION ALL
        SELECT rc.id FROM revenue_categories rc JOIN tree t ON rc.parent_id = t.id
      )
      UPDATE revenue_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
  async delete(id: string) {
    await db.query('UPDATE revenue_categories SET is_active = false WHERE id = $1', [id]);
  },
};

/* ═══ Invoices ═══ */
export const invoiceRepository = {
  async findAll(params: { supplierId?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string; invoiceType?: string }) {
    const conditions: string[] = []; const values: unknown[] = []; let i = 1;
    const invoiceType = params.invoiceType || 'received';
    conditions.push(`inv.invoice_type = $${i++}`); values.push(invoiceType);
    if (params.storeId) { conditions.push(`inv.store_id = $${i++}`); values.push(params.storeId); }
    if (params.supplierId) { conditions.push(`inv.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.customerId) { conditions.push(`inv.customer_id = $${i++}`); values.push(params.customerId); }
    if (params.status) { conditions.push(`inv.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`inv.invoice_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`inv.invoice_date <= $${i++}`); values.push(params.dateTo); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT inv.*,
              s.name as supplier_name,
              c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
              ec.name as category_name,
              po.order_number as purchase_order_number,
              rv.voucher_number as reception_voucher_number,
              o.order_number as order_number_ref
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       LEFT JOIN customers c ON c.id = inv.customer_id
       LEFT JOIN expense_categories ec ON ec.id = inv.category_id
       LEFT JOIN purchase_orders po ON po.id = inv.purchase_order_id
       LEFT JOIN reception_vouchers rv ON rv.id = inv.reception_voucher_id
       LEFT JOIN orders o ON o.id = inv.order_id
       ${where}
       ORDER BY inv.invoice_date DESC`,
      values
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT inv.*,
              s.name as supplier_name, s.phone as supplier_phone, s.ice as supplier_ice, s.address as supplier_address, s.city as supplier_city,
              c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone, c.email as customer_email,
              ec.name as category_name,
              po.order_number as purchase_order_number,
              rv.voucher_number as reception_voucher_number
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       LEFT JOIN customers c ON c.id = inv.customer_id
       LEFT JOIN expense_categories ec ON ec.id = inv.category_id
       LEFT JOIN purchase_orders po ON po.id = inv.purchase_order_id
       LEFT JOIN reception_vouchers rv ON rv.id = inv.reception_voucher_id
       WHERE inv.id = $1`, [id]
    );
    if (!result.rows[0]) return null;

    // Get invoice items
    const itemsResult = await db.query(
      `SELECT ii.*, p.name as product_name, ing.name as ingredient_name
       FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
       WHERE ii.invoice_id = $1
       ORDER BY ii.created_at`, [id]
    );

    // Get payments linked to this invoice
    const paymentsResult = await db.query(
      `SELECT p.* FROM payments p WHERE p.invoice_id = $1 ORDER BY p.payment_date DESC`, [id]
    );

    return { ...result.rows[0], items: itemsResult.rows, payments: paymentsResult.rows };
  },

  async generateInvoiceNumber(type: 'received' | 'emitted', client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    const runner = client ?? db;
    // Advisory lock prevents concurrent invoices from generating the same number
    await runner.query(`SELECT pg_advisory_xact_lock(hashtext('invoice_number_' || $1))`, [type]);
    const prefix = type === 'received' ? 'FR' : 'FE';
    const year = getLocalYear();
    const result = await runner.query(
      `SELECT COUNT(*) FROM invoices WHERE invoice_type = $1 AND EXTRACT(YEAR FROM invoice_date) = $2`,
      [type, year]
    );
    const seq = parseInt((result.rows[0] as Record<string, string>).count) + 1;
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    invoiceNumber?: string; invoiceType?: string;
    supplierId?: string; customerId?: string; categoryId?: string;
    purchaseOrderId?: string; receptionVoucherId?: string; orderId?: string;
    invoiceDate: string; dueDate?: string; amount: number;
    taxAmount?: number; totalAmount?: number; notes?: string; createdBy: string; storeId?: string;
    expectedPaymentMode?: string; receptionDate?: string;
    checkNumber?: string;
    items?: { productId?: string; ingredientId?: string; description?: string; quantity: number; unitPrice: number; subtotal: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const invoiceType = data.invoiceType || 'received';
      const invoiceNumber = data.invoiceNumber || await this.generateInvoiceNumber(invoiceType as 'received' | 'emitted');
      const totalAmount = data.totalAmount || ((data.amount || 0) + (data.taxAmount || 0));

      const invResult = await client.query(
        `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, customer_id, category_id,
          purchase_order_id, reception_voucher_id, order_id,
          invoice_date, due_date, amount, tax_amount, total_amount, notes, created_by, store_id,
          expected_payment_mode, reception_date, check_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [invoiceNumber, invoiceType, data.supplierId || null, data.customerId || null,
         data.categoryId || null, data.purchaseOrderId || null, data.receptionVoucherId || null,
         data.orderId || null, data.invoiceDate, data.dueDate || null,
         data.amount, data.taxAmount || 0, totalAmount,
         data.notes || null, data.createdBy, data.storeId || null,
         data.expectedPaymentMode || null, data.receptionDate || null,
         data.checkNumber || null]
      );

      // Insert invoice items if provided
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          await client.query(
            `INSERT INTO invoice_items (invoice_id, product_id, ingredient_id, description, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [invResult.rows[0].id, item.productId || null, item.ingredientId || null,
             item.description || null, item.quantity, item.unitPrice, item.subtotal]
          );
        }
      }

      await client.query('COMMIT');
      return invResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async createFromOrder(orderId: string, createdBy: string, storeId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get order + items
      const orderResult = await client.query(
        `SELECT o.*, c.first_name as customer_first_name, c.last_name as customer_last_name
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new Error('Commande non trouvee');

      const itemsResult = await client.query(
        `SELECT oi.*, p.name as product_name FROM order_items oi
         JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`, [orderId]
      );

      const invoiceNumber = await this.generateInvoiceNumber('emitted');

      const invResult = await client.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, order_id,
          invoice_date, amount, tax_amount, total_amount, notes, created_by, store_id)
         VALUES ($1, 'emitted', $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [invoiceNumber, order.customer_id, orderId,
         parseFloat(order.subtotal), parseFloat(order.tax_amount),
         parseFloat(order.total),
         `Facture generee depuis commande ${order.order_number}`,
         createdBy, storeId || null]
      );

      for (const item of itemsResult.rows) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invResult.rows[0].id, item.product_id, item.product_name,
           item.quantity, parseFloat(item.unit_price), parseFloat(item.subtotal)]
        );
      }

      await client.query('COMMIT');
      return invResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updatePaidAmount(id: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Lock invoice row to prevent concurrent payment race conditions
      const inv = await client.query('SELECT total_amount, status FROM invoices WHERE id = $1 FOR UPDATE', [id]);
      if (!inv.rows[0]) { await client.query('ROLLBACK'); return null; }
      const totalAmount = parseFloat(inv.rows[0].total_amount);
      const currentStatus = inv.rows[0].status as string;

      const paymentsResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1`, [id]
      );
      const totalPaid = parseFloat(paymentsResult.rows[0].total_paid);

      let status = 'pending';
      if (totalPaid >= totalAmount) status = 'paid';
      else if (totalPaid > 0) status = 'partial';

      // Preserve manual statuses (disputed/cancelled) unless invoice is now fully paid.
      // Avoids overwriting a deliberate "En litige" flag when a partial payment arrives.
      if ((currentStatus === 'disputed' || currentStatus === 'cancelled') && status !== 'paid') {
        status = currentStatus;
      }

      const result = await client.query(
        `UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3 RETURNING *`,
        [totalPaid, status, id]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(id: string, status: string) {
    const result = await db.query(`UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
    return result.rows[0];
  },

  async updateCategory(id: string, categoryId: string | null) {
    const result = await db.query(
      `UPDATE invoices SET category_id = $1 WHERE id = $2 RETURNING *`,
      [categoryId, id]
    );
    return result.rows[0];
  },

  async updateAttachment(id: string, url: string | null) {
    const result = await db.query(`UPDATE invoices SET attachment_url = $1 WHERE id = $2 RETURNING *`, [url, id]);
    return result.rows[0];
  },

  /**
   * Met a jour les modalites de reglement d'une facture (echeance, mode prevu,
   * date de reception). Champs additifs, tous optionnels.
   */
  async updatePaymentTerms(id: string, data: {
    dueDate?: string | null;
    expectedPaymentMode?: string | null;
    receptionDate?: string | null;
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.dueDate !== undefined) { sets.push(`due_date = $${i++}`); values.push(data.dueDate || null); }
    if (data.expectedPaymentMode !== undefined) {
      sets.push(`expected_payment_mode = $${i++}`);
      values.push(data.expectedPaymentMode || null);
    }
    if (data.receptionDate !== undefined) { sets.push(`reception_date = $${i++}`); values.push(data.receptionDate || null); }
    if (sets.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  /**
   * Remplace les lignes (invoice_items) d'une facture en une seule transaction.
   *
   * Politique :
   *   - Approche "bulk save" : on supprime toutes les lignes existantes et on
   *     reinsere celles fournies. Plus simple a piloter cote UI (un seul Save)
   *     et evite de tracker les diffs ligne par ligne.
   *   - Recalcule automatiquement invoices.amount = SUM(subtotal). Ne touche
   *     PAS au taxAmount existant (le gerant peut le saisir separement via PUT
   *     /:id si besoin) mais recalcule total_amount = amount + tax_amount.
   *   - Rejette si nouveau total_amount < paid_amount (incoherence comptable).
   *   - Resync statut a la fin (pending/partial/paid).
   *
   * Note : on prefere subtotal envoye par le client (deja arrondi a l'affichage)
   * plutot que recalculer qty * unit_price, pour eviter les drift de centimes.
   */
  async replaceItems(id: string, items: { productId?: string | null; ingredientId?: string | null; description?: string | null; quantity: number; unitPrice: number; subtotal: number }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cur = await client.query(
        `SELECT tax_amount, paid_amount FROM invoices WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!cur.rows[0]) { await client.query('ROLLBACK'); return null; }
      const taxAmount = parseFloat(cur.rows[0].tax_amount || '0');
      const paidAmount = parseFloat(cur.rows[0].paid_amount || '0');

      const newAmount = items.reduce((sum, it) => sum + (Number.isFinite(it.subtotal) ? it.subtotal : 0), 0);
      const newTotal = newAmount + taxAmount;
      if (newTotal < paidAmount - 0.001) {
        await client.query('ROLLBACK');
        throw new Error(
          `Le nouveau total (${newTotal.toFixed(2)} DH) est inferieur au deja paye (${paidAmount.toFixed(2)} DH). ` +
          `Rembourse ou supprime des paiements avant de baisser le montant.`
        );
      }

      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
      for (const it of items) {
        if (!Number.isFinite(it.quantity) || !Number.isFinite(it.unitPrice)) continue;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, ingredient_id, description, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, it.productId || null, it.ingredientId || null, it.description || null,
           it.quantity, it.unitPrice, it.subtotal]
        );
      }

      await client.query(
        `UPDATE invoices SET amount = $1, total_amount = $2 WHERE id = $3`,
        [newAmount, newTotal, id]
      );

      await client.query('COMMIT');
      return await this.updatePaidAmount(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Mise a jour complete d'une facture (admin/gerant). Champs additifs et
   * optionnels — seuls ceux fournis dans `data` sont modifies.
   *
   * Cas particuliers :
   *   - Si amount ou taxAmount change, total_amount est recalcule automatiquement
   *     (sauf si totalAmount est explicitement fourni — ex: reduction commerciale)
   *   - Si totalAmount baisse en-dessous de paid_amount, on rejette l'update
   *     (sinon on aurait une facture "trop payee" — incoherence comptable)
   *   - Les statuts derivees (pending/partial/paid) sont resynchronises a la fin
   */
  async update(id: string, data: {
    invoiceNumber?: string;
    supplierId?: string | null;
    customerId?: string | null;
    categoryId?: string | null;
    invoiceDate?: string;
    dueDate?: string | null;
    amount?: number;
    taxAmount?: number;
    totalAmount?: number;
    notes?: string | null;
    expectedPaymentMode?: string | null;
    receptionDate?: string | null;
    checkNumber?: string | null;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Lock + lecture etat courant pour valider totalAmount vs paid_amount
      const current = await client.query(
        `SELECT amount, tax_amount, total_amount, paid_amount FROM invoices WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const currentAmount = parseFloat(current.rows[0].amount);
      const currentTax = parseFloat(current.rows[0].tax_amount);
      const paidAmount = parseFloat(current.rows[0].paid_amount || '0');

      // Recalcule totalAmount si HT ou TVA change et qu'il n'est pas explicitement fourni
      const nextAmount = data.amount !== undefined ? data.amount : currentAmount;
      const nextTax = data.taxAmount !== undefined ? data.taxAmount : currentTax;
      const nextTotal = data.totalAmount !== undefined
        ? data.totalAmount
        : (data.amount !== undefined || data.taxAmount !== undefined)
        ? nextAmount + nextTax
        : undefined;

      if (nextTotal !== undefined && nextTotal < paidAmount) {
        await client.query('ROLLBACK');
        throw new Error(`Le montant total (${nextTotal.toFixed(2)} DH) ne peut etre inferieur au deja paye (${paidAmount.toFixed(2)} DH).`);
      }

      const sets: string[] = []; const values: unknown[] = []; let i = 1;
      if (data.invoiceNumber !== undefined) { sets.push(`invoice_number = $${i++}`); values.push(data.invoiceNumber); }
      if (data.supplierId !== undefined) { sets.push(`supplier_id = $${i++}`); values.push(data.supplierId || null); }
      if (data.customerId !== undefined) { sets.push(`customer_id = $${i++}`); values.push(data.customerId || null); }
      if (data.categoryId !== undefined) { sets.push(`category_id = $${i++}`); values.push(data.categoryId || null); }
      if (data.invoiceDate !== undefined) { sets.push(`invoice_date = $${i++}`); values.push(data.invoiceDate); }
      if (data.dueDate !== undefined) { sets.push(`due_date = $${i++}`); values.push(data.dueDate || null); }
      if (data.amount !== undefined) { sets.push(`amount = $${i++}`); values.push(data.amount); }
      if (data.taxAmount !== undefined) { sets.push(`tax_amount = $${i++}`); values.push(data.taxAmount); }
      if (nextTotal !== undefined) { sets.push(`total_amount = $${i++}`); values.push(nextTotal); }
      if (data.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(data.notes || null); }
      if (data.expectedPaymentMode !== undefined) {
        sets.push(`expected_payment_mode = $${i++}`);
        values.push(data.expectedPaymentMode || null);
      }
      if (data.receptionDate !== undefined) { sets.push(`reception_date = $${i++}`); values.push(data.receptionDate || null); }
      if (data.checkNumber !== undefined) { sets.push(`check_number = $${i++}`); values.push(data.checkNumber || null); }

      if (sets.length === 0) {
        await client.query('ROLLBACK');
        return current.rows[0];
      }

      values.push(id);
      await client.query(
        `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );

      await client.query('COMMIT');
      // Resync statut derive (pending/partial/paid) au cas ou totalAmount a change
      if (nextTotal !== undefined) {
        return await this.updatePaidAmount(id);
      }
      return await this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Suppression physique d'une facture (admin/gerant).
   *
   * Politique :
   *   - invoice_items est supprime en CASCADE (FK ON DELETE CASCADE en migration 055)
   *   - payments lies bloquent par defaut (FK sans CASCADE — preserve la
   *     coherence comptable). force=true supprime aussi les paiements.
   *
   * Retourne { deleted: true, deletedPayments: N } ou throws une erreur lisible
   * si payments existent et force=false.
   */
  async deleteById(id: string, opts: { force?: boolean } = {}): Promise<{ deleted: boolean; deletedPayments: number }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const inv = await client.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
      if (!inv.rows[0]) {
        await client.query('ROLLBACK');
        throw new Error('Facture introuvable');
      }

      const paymentsCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1`, [id]
      );
      const nPayments = paymentsCount.rows[0].n as number;

      if (nPayments > 0 && !opts.force) {
        await client.query('ROLLBACK');
        throw new Error(`Cette facture a ${nPayments} paiement(s) lie(s). Utilisez force=true pour supprimer aussi les paiements, ou annulez la facture a la place.`);
      }

      let deletedPayments = 0;
      if (nPayments > 0 && opts.force) {
        const delPay = await client.query(`DELETE FROM payments WHERE invoice_id = $1`, [id]);
        deletedPayments = delPay.rowCount || 0;
      }

      await client.query(`DELETE FROM invoices WHERE id = $1`, [id]);

      await client.query('COMMIT');
      return { deleted: true, deletedPayments };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Retourne les factures fournisseurs dont l'echeance est dans <= alertDays
   * jours (defaut 7), et dont le statut est encore non finalise.
   * Inclut les factures deja en retard (due_date < CURRENT_DATE).
   */
  async findPaymentAlerts(params: { storeId?: string; alertDays?: number }) {
    const alertDays = params.alertDays ?? 7;
    const conditions: string[] = [
      `inv.invoice_type = 'received'`,
      `inv.due_date IS NOT NULL`,
      `inv.due_date <= CURRENT_DATE + ($1 || ' days')::interval`,
      `inv.status IN ('pending', 'partial', 'overdue', 'disputed')`,
    ];
    const values: unknown[] = [String(alertDays)];
    let i = 2;
    if (params.storeId) {
      conditions.push(`inv.store_id = $${i++}`);
      values.push(params.storeId);
    }
    const result = await db.query(
      `SELECT inv.id, inv.invoice_number, inv.supplier_id, inv.invoice_date,
              inv.reception_date, inv.due_date, inv.total_amount, inv.paid_amount,
              inv.status, inv.expected_payment_mode, inv.notes,
              s.name AS supplier_name,
              (inv.total_amount - inv.paid_amount) AS remaining_amount,
              (inv.due_date - CURRENT_DATE) AS days_until_due,
              CASE WHEN inv.due_date < CURRENT_DATE THEN true ELSE false END AS is_overdue
         FROM invoices inv
         LEFT JOIN suppliers s ON s.id = inv.supplier_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY inv.due_date ASC, inv.invoice_date ASC`,
      values
    );
    return result.rows;
  },

  /**
   * Eclate les factures recues en une ligne par ingredient.
   *
   * Deux sources possibles selon comment la facture a ete saisie :
   *   1. `invoice_items` : creation manuelle via le modal Facture.
   *   2. `reception_voucher_items` : factures importees depuis Excel ou
   *      generees via le flux PO -> reception. Pas de invoice_items dans ce
   *      cas, on prend les lignes du bon de reception associe.
   *
   * On fait un UNION ALL des deux, en evitant les doublons pour les factures
   * qui ont les deux (priorite a invoice_items).
   */
  async findLineExpenses(params: { dateFrom?: string; dateTo?: string; supplierId?: string; storeId?: string }) {
    // Logique tresorerie (cash effectif) : une facture n'entre dans les charges
    // que lorsqu'elle est INTEGRALEMENT payee. La date utilisee est celle du
    // dernier paiement qui a cloture la facture (ex : un cheque encaisse le
    // 10/07 fait apparaitre la charge ce jour-la, pas a la date de facture).
    // Les factures impayees / partielles sont visibles ailleurs (onglet
    // "Factures recues" du module Achats) mais exclues des charges pour ne
    // pas fausser la tresorerie quotidienne.
    const conditions: string[] = [
      `inv.invoice_type = 'received'`,
      `inv.status = 'paid'`,
    ];
    const values: unknown[] = [];
    let i = 1;
    if (params.storeId) { conditions.push(`inv.store_id = $${i++}`); values.push(params.storeId); }
    // Note : dateFrom/dateTo filtrent sur la DATE EFFECTIVE de paiement
    // (pi.effective_date), pas sur invoice_date. C'est ce qui donne une vue
    // tresorerie coherente.
    if (params.dateFrom) { conditions.push(`pi.effective_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`pi.effective_date <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`inv.supplier_id = $${i++}`); values.push(params.supplierId); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `WITH paid_invoices AS (
         -- Date effective d'apparition de la charge = jour ou le cash sort
         -- vraiment du compte. Differente du payment_date qui est la DATE
         -- D'ACTION (jour ou l'utilisateur a clique 'Payer').
         --
         -- Cheques :
         --   - p.cashed_at IS NOT NULL : l'utilisateur a confirme l'encaissement
         --     via l'onglet Cheques -> date exacte du debit bancaire.
         --   - p.cashed_at IS NULL : cheque pas encore encaisse. On exclut
         --     cette facture des charges (logique tresorerie stricte : pas de
         --     cash sorti = pas de charge). Visible dans l'onglet Cheques en
         --     attente.
         --
         -- Cash / virement : pas de delai d'encaissement, payment_date = date
         -- d'effet, on garde tel quel.
         --
         -- Si plusieurs paiements partiels, on prend le plus tardif (celui
         -- qui a cloture la facture).
         SELECT
           p.invoice_id,
           MAX(
             CASE
               WHEN p.payment_method = 'check' THEN p.cashed_at
               ELSE p.payment_date
             END
           ) AS effective_date
         FROM payments p
         JOIN invoices inv ON inv.id = p.invoice_id
         WHERE p.invoice_id IS NOT NULL
           -- Exclut les paiements non concretises (cheques pas encore encaisses).
           -- Sans cette ligne, une facture status=paid avec uniquement un
           -- cheque en attente apparaitrait dans les charges avec un MAX(NULL).
           AND (p.payment_method != 'check' OR p.cashed_at IS NOT NULL)
         GROUP BY p.invoice_id
         -- Une facture "paid" qui n'a que des cheques en attente sera
         -- exclue ici (HAVING MAX retourne NULL -> filtre downstream).
         HAVING MAX(
           CASE
             WHEN p.payment_method = 'check' THEN p.cashed_at
             ELSE p.payment_date
           END
         ) IS NOT NULL
       ),
       ii_lines AS (
         -- Ratio TTC/HT par facture : reparti au prorata sur chaque ligne pour
         -- que les montants affiches dans Charges & Depenses incluent la TVA.
         -- tax_amount=0 (auto-facture non editee) -> ratio=1, lignes restent HT.
         -- tax_amount>0 -> ratio=(amount+tax_amount)/amount, lignes en TTC.
         SELECT
           ii.id                                       AS id,
           inv.id                                      AS invoice_id,
           inv.invoice_number                          AS invoice_number,
           pi.effective_date                           AS payment_date,
           inv.status                                  AS invoice_status,
           inv.supplier_id                             AS supplier_id,
           inv.category_id                             AS invoice_category_id,
           inv.purchase_order_id                       AS invoice_po_id,
           ii.ingredient_id                            AS ingredient_id,
           COALESCE(ing.name, p.name, ii.description)  AS designation,
           ing.category                                AS ingredient_category,
           ii.quantity                                 AS quantity,
           ROUND((ii.unit_price * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 4) AS unit_price,
           ROUND((ii.subtotal    * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 2) AS amount,
           ii.created_at                               AS sort_at
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         JOIN paid_invoices pi ON pi.invoice_id = inv.id
         LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
         LEFT JOIN products p ON p.id = ii.product_id
         ${where}
       ),
       rv_lines AS (
         SELECT
           rvi.id                                                  AS id,
           inv.id                                                  AS invoice_id,
           inv.invoice_number                                      AS invoice_number,
           pi.effective_date                                       AS payment_date,
           inv.status                                              AS invoice_status,
           inv.supplier_id                                         AS supplier_id,
           inv.category_id                                         AS invoice_category_id,
           inv.purchase_order_id                                   AS invoice_po_id,
           rvi.ingredient_id                                       AS ingredient_id,
           ing.name                                                AS designation,
           ing.category                                            AS ingredient_category,
           rvi.quantity_received                                   AS quantity,
           ROUND((COALESCE(rvi.unit_price, 0) * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 4) AS unit_price,
           ROUND((rvi.quantity_received * COALESCE(rvi.unit_price, 0) * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 2) AS amount,
           rvi.created_at                                          AS sort_at
         FROM reception_voucher_items rvi
         JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
         JOIN invoices inv ON inv.reception_voucher_id = rv.id
         JOIN paid_invoices pi ON pi.invoice_id = inv.id
         LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
         ${where}
           AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = inv.id)
       ),
       all_lines AS (
         SELECT * FROM ii_lines
         UNION ALL
         SELECT * FROM rv_lines
       )
       SELECT
         al.id, al.invoice_id, al.invoice_number, al.payment_date,
         al.invoice_status, al.supplier_id, al.ingredient_id,
         al.designation, al.ingredient_category,
         al.quantity, al.unit_price, al.amount,
         'invoice'::text       AS type,
         s.name                AS supplier_name,
         po.order_number       AS purchase_order_number,
         -- category_id : utilise par la cascade de filtres (root) de l'UI.
         -- On expose celle de la facture (souvent "Matieres premieres").
         al.invoice_category_id AS category_id,
         -- Description : sert d'etiquette dans la colonne Designation cote UI.
         CONCAT(
           al.designation,
           CASE WHEN al.quantity IS NOT NULL
                THEN ' (' || TRIM(BOTH '0' FROM TRIM(TRAILING '.' FROM al.quantity::text)) || ' x ' || ROUND(al.unit_price::numeric, 2) || ')'
                ELSE ''
           END
         )                     AS description,
         -- Categorie affichee (leaf) : on prefere la categorie de l'ingredient
         -- (farines / produits_laitiers / ...) plutot que celle de la facture.
         COALESCE(al.ingredient_category, ec.name) AS category_name
       FROM all_lines al
       LEFT JOIN suppliers s ON s.id = al.supplier_id
       LEFT JOIN purchase_orders po ON po.id = al.invoice_po_id
       LEFT JOIN expense_categories ec ON ec.id = al.invoice_category_id
       ORDER BY al.payment_date DESC, al.invoice_number, al.sort_at`,
      values
    );
    return result.rows;
  },
};

/* ═══ Payments ═══ */
export const paymentRepository = {
  /**
   * Liste des paiements vue TRESORERIE (utilise par ChargesTab).
   *
   * Une date "effective" est calculee par paiement :
   *   - Cheque : cashed_at (date d'encaissement confirmee), NULL si pas encore
   *     encaisse -> exclu de la liste (logique tresorerie stricte).
   *   - Cash / virement / autre : payment_date (cash sort le jour de l'action).
   *
   * Le filtre dateFrom/dateTo s'applique sur cette date effective. C'est ce
   * qui fait qu'un cheque signe aujourd'hui mais encaisse dans 1 mois apparait
   * dans le mois prochain et pas aujourd'hui.
   *
   * Pour voir TOUS les paiements (y compris cheques en attente), utiliser
   * findChecks() pour l'onglet Cheques dedie.
   */
  async findAll(params: { type?: string; dateFrom?: string; dateTo?: string; supplierId?: string; storeId?: string }) {
    const conditions: string[] = [
      // Exclut les cheques pas encore encaisses (cash pas encore sorti)
      `(p.payment_method != 'check' OR p.cashed_at IS NOT NULL)`,
    ];
    const values: unknown[] = []; let i = 1;
    if (params.storeId) { conditions.push(`p.store_id = $${i++}`); values.push(params.storeId); }
    if (params.type) { conditions.push(`p.type = $${i++}`); values.push(params.type); }
    // Date filter applique sur la date effective (cashed_at pour cheque, sinon payment_date)
    const effectiveDateExpr = `(CASE WHEN p.payment_method = 'check' THEN p.cashed_at ELSE p.payment_date END)`;
    if (params.dateFrom) { conditions.push(`${effectiveDateExpr} >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`${effectiveDateExpr} <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`p.supplier_id = $${i++}`); values.push(params.supplierId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT p.*, s.name as supplier_name, e.first_name as employee_first_name, e.last_name as employee_last_name,
              ec.name as category_name, ec.type as category_type, ec.requires_po,
              inv.invoice_number,
              po.order_number as purchase_order_number,
              -- Date effective (cash sorti) : utilisee par l'UI Charges pour
              -- afficher la date juste, et pour le tri.
              ${effectiveDateExpr} AS effective_date
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
       ${where}
       ORDER BY ${effectiveDateExpr} DESC, p.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Liste des cheques pour l'onglet "Cheques" (gestion encaissement).
   *
   * Renvoie TOUS les paiements payment_method='check', y compris ceux en
   * attente d'encaissement. Filtres :
   *   - status : 'pending' (cashed_at NULL), 'cashed' (cashed_at NOT NULL), 'all'
   *   - dateFrom/dateTo : filtre sur payment_date (date de signature)
   *   - supplierId / employeeId : restreint au beneficiaire
   *
   * Expose les colonnes utiles pour l'UI : beneficiaire, montant, dates,
   * facture associee (si reglement de facture), echeance prevue, etc.
   */
  async findChecks(params: {
    status?: 'pending' | 'cashed' | 'all';
    dateFrom?: string; dateTo?: string;
    supplierId?: string; employeeId?: string;
    storeId?: string;
  }) {
    const conditions: string[] = [`p.payment_method = 'check'`];
    const values: unknown[] = []; let i = 1;
    if (params.storeId) { conditions.push(`p.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status === 'pending') conditions.push(`p.cashed_at IS NULL`);
    else if (params.status === 'cashed') conditions.push(`p.cashed_at IS NOT NULL`);
    if (params.dateFrom) { conditions.push(`p.payment_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`p.payment_date <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`p.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.employeeId) { conditions.push(`p.employee_id = $${i++}`); values.push(params.employeeId); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `SELECT p.id, p.amount, p.payment_date, p.check_number, p.check_date,
              p.cashed_at, p.cashed_note, p.created_at, p.description, p.reference,
              p.type AS payment_type,
              s.name AS supplier_name, s.id AS supplier_id,
              COALESCE(e.first_name || ' ' || e.last_name, NULL) AS employee_name,
              e.id AS employee_id,
              ec.name AS category_name,
              inv.id AS invoice_id, inv.invoice_number, inv.invoice_date, inv.due_date AS invoice_due_date,
              inv.total_amount AS invoice_total,
              po.order_number AS purchase_order_number,
              cby.first_name || ' ' || cby.last_name AS cashed_by_name,
              -- Etat derive pour l'UI
              CASE WHEN p.cashed_at IS NOT NULL THEN 'cashed'
                   WHEN inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE THEN 'overdue'
                   ELSE 'pending'
              END AS status
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
       LEFT JOIN users cby ON cby.id = p.cashed_by
       ${where}
       ORDER BY
         -- En attente d'abord (action requise), puis par echeance/date
         CASE WHEN p.cashed_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(inv.due_date, p.payment_date) ASC,
         p.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Confirme l'encaissement d'un cheque (marquage manuel par l'utilisateur).
   * Verifie qu'il s'agit bien d'un cheque, qu'il n'est pas deja encaisse.
   * cashedAt par defaut = aujourd'hui.
   */
  async markCashed(id: string, data: { cashedAt?: string; cashedBy: string; note?: string }) {
    const cur = await db.query(`SELECT payment_method, cashed_at FROM payments WHERE id = $1`, [id]);
    if (!cur.rows[0]) throw new Error('Paiement introuvable');
    if (cur.rows[0].payment_method !== 'check') {
      throw new Error('Seuls les cheques peuvent etre marques encaisses');
    }
    if (cur.rows[0].cashed_at) {
      throw new Error('Ce cheque est deja marque encaisse');
    }
    const result = await db.query(
      `UPDATE payments
       SET cashed_at = COALESCE($1::date, CURRENT_DATE),
           cashed_by = $2,
           cashed_note = $3
       WHERE id = $4
       RETURNING *`,
      [data.cashedAt || null, data.cashedBy, data.note || null, id]
    );
    return result.rows[0];
  },

  /**
   * Annule la confirmation d'encaissement (admin uniquement, cf. routes).
   * Sert pour corriger une erreur de saisie. Re-bascule le cheque en attente.
   */
  async unmarkCashed(id: string) {
    const result = await db.query(
      `UPDATE payments
       SET cashed_at = NULL, cashed_by = NULL, cashed_note = NULL
       WHERE id = $1 AND payment_method = 'check'
       RETURNING *`,
      [id]
    );
    if (!result.rows[0]) throw new Error('Cheque introuvable ou non eligible');
    return result.rows[0];
  },
  async create(data: {
    reference?: string; type: string; categoryId?: string; invoiceId?: string;
    supplierId?: string; employeeId?: string; amount: number;
    paymentMethod: string; paymentDate: string; description?: string; createdBy: string; storeId?: string;
    purchaseOrderId?: string; checkNumber?: string; checkDate?: string; checkAttachmentUrl?: string;
  }) {
    // ─── Cas simple : pas de facture liee, INSERT direct ──────────────────
    if (!data.invoiceId) {
      const result = await db.query(
        `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id,
          amount, payment_method, payment_date, description, created_by, store_id, purchase_order_id,
          check_number, check_date, check_attachment_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [data.reference || null, data.type, data.categoryId || null, null,
         data.supplierId || null, data.employeeId || null, data.amount,
         data.paymentMethod, data.paymentDate, data.description || null, data.createdBy,
         data.storeId || null, data.purchaseOrderId || null,
         data.checkNumber || null, data.checkDate || null, data.checkAttachmentUrl || null]
      );
      return result.rows[0];
    }

    // ─── Cas facture liee : transaction + FOR UPDATE pour eviter ──────────
    // les doublons et sur-paiements en cas de double-clic / requetes concurrentes.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Lock la facture + lit l'etat courant
      const inv = await client.query(
        `SELECT total_amount, paid_amount, invoice_number FROM invoices WHERE id = $1 FOR UPDATE`,
        [data.invoiceId]
      );
      if (!inv.rows[0]) {
        const e: Error & { statusCode?: number } = new Error('Facture introuvable');
        e.statusCode = 404;
        throw e;
      }
      const totalAmount = parseFloat(inv.rows[0].total_amount);
      const currentPaid = parseFloat(inv.rows[0].paid_amount || '0');
      const invoiceNumber = inv.rows[0].invoice_number as string;

      // Garde 1 — sur-paiement : refuse si le cumul depasse le total.
      // Tolerance de 0.01 DH pour arrondis flottants.
      if (currentPaid + data.amount > totalAmount + 0.01) {
        const remaining = Math.max(0, totalAmount - currentPaid);
        const e: Error & { statusCode?: number } = new Error(
          `Le paiement de ${data.amount.toFixed(2)} DH dépasse le reste à payer ` +
          `(${remaining.toFixed(2)} DH sur ${totalAmount.toFixed(2)} DH) pour la facture ${invoiceNumber}.`
        );
        e.statusCode = 409;
        throw e;
      }

      // Garde 2 — doublon de cheque : un meme N° de cheque ne peut pas etre
      // saisi deux fois pour la meme facture (cas concret du bug observe).
      if (data.checkNumber && data.checkNumber.trim()) {
        const dup = await client.query(
          `SELECT id FROM payments WHERE invoice_id = $1 AND check_number = $2 LIMIT 1`,
          [data.invoiceId, data.checkNumber.trim()]
        );
        if (dup.rows.length > 0) {
          const e: Error & { statusCode?: number } = new Error(
            `Un paiement avec le chèque N° ${data.checkNumber.trim()} existe déjà pour la facture ${invoiceNumber}.`
          );
          e.statusCode = 409;
          throw e;
        }
      }

      const result = await client.query(
        `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id,
          amount, payment_method, payment_date, description, created_by, store_id, purchase_order_id,
          check_number, check_date, check_attachment_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [data.reference || null, data.type, data.categoryId || null, data.invoiceId,
         data.supplierId || null, data.employeeId || null, data.amount,
         data.paymentMethod, data.paymentDate, data.description || null, data.createdBy,
         data.storeId || null, data.purchaseOrderId || null,
         data.checkNumber || null, data.checkDate || null, data.checkAttachmentUrl || null]
      );

      await client.query('COMMIT');

      // Resync paid_amount + status (sa propre transaction, hors lock)
      await invoiceRepository.updatePaidAmount(data.invoiceId);

      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async update(id: string, data: { categoryId?: string; description?: string; amount?: number; paymentMethod?: string; paymentDate?: string }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.categoryId !== undefined) { sets.push(`category_id = $${i++}`); values.push(data.categoryId || null); }
    if (data.description !== undefined) { sets.push(`description = $${i++}`); values.push(data.description); }
    if (data.amount !== undefined) { sets.push(`amount = $${i++}`); values.push(data.amount); }
    if (data.paymentMethod !== undefined) { sets.push(`payment_method = $${i++}`); values.push(data.paymentMethod); }
    if (data.paymentDate !== undefined) { sets.push(`payment_date = $${i++}`); values.push(data.paymentDate); }
    if (sets.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE payments SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async delete(id: string) {
    // Get payment to check if linked to invoice
    const payment = await db.query('SELECT invoice_id FROM payments WHERE id = $1', [id]);
    const invoiceId = payment.rows[0]?.invoice_id;
    await db.query('DELETE FROM payments WHERE id = $1', [id]);
    if (invoiceId) {
      await invoiceRepository.updatePaidAmount(invoiceId);
    }
  },
  async summary(params: { dateFrom: string; dateTo: string; storeId?: string }) {
    const storeFilter = params.storeId ? ' AND p.store_id = $3' : '';
    const values: unknown[] = [params.dateFrom, params.dateTo];
    if (params.storeId) values.push(params.storeId);

    const result = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN ec.type = 'expense' OR p.type IN ('invoice','salary','expense') THEN p.amount ELSE 0 END), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN ec.type = 'income' OR p.type = 'income' THEN p.amount ELSE 0 END), 0) as total_income,
        COUNT(*) as total_payments
       FROM payments p
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       WHERE p.payment_date BETWEEN $1 AND $2${storeFilter}`,
      values
    );
    return result.rows[0];
  },
  async summaryByCategory(params: { dateFrom: string; dateTo: string; storeId?: string }) {
    const storeFilter = params.storeId ? ' AND p.store_id = $3' : '';
    const values: unknown[] = [params.dateFrom, params.dateTo];
    if (params.storeId) values.push(params.storeId);

    const result = await db.query(
      `SELECT ec.name as category_name, ec.type as category_type,
              COUNT(p.id) as payment_count, SUM(p.amount) as total_amount
       FROM payments p
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       WHERE p.payment_date BETWEEN $1 AND $2${storeFilter}
       GROUP BY ec.id, ec.name, ec.type
       ORDER BY total_amount DESC`,
      values
    );
    return result.rows;
  },
};
