import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';

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

    // All payments for the month
    const payments = await db.query(
      `SELECT p.id, p.payment_date, p.type, p.amount, p.payment_method, p.description, p.reference,
              s.name as supplier_name, ec.name as category_name, ec.type as category_type,
              e.first_name as employee_first_name, e.last_name as employee_last_name
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE p.payment_date BETWEEN $1 AND $2${storeFilterP}
       ORDER BY p.payment_date, p.created_at`,
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

    // Daily sales totals with payment method breakdown (source of truth for cash/card)
    const sales = await db.query(
      `SELECT TO_CHAR(DATE(created_at AT TIME ZONE '${tz}'), 'YYYY-MM-DD') as sale_date,
              COALESCE(SUM(total), 0) as total_sales,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_sales,
              COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_sales,
              COALESCE(SUM(CASE WHEN payment_method = 'mobile' THEN total ELSE 0 END), 0) as mobile_sales,
              COUNT(*) as sale_count
       FROM sales
       WHERE DATE(created_at AT TIME ZONE '${tz}') BETWEEN $1 AND $2${storeFilterSales}
       GROUP BY DATE(created_at AT TIME ZONE '${tz}')
       ORDER BY DATE(created_at AT TIME ZONE '${tz}')`,
      params
    );

    // Previous balance: payments before this month
    const prevStoreFilter = storeId ? ' AND p.store_id = $2' : '';
    const prevParams = storeId ? [startDate, storeId] : [startDate];

    const prevPayments = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_entries,
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_entries,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_exits,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_exits
       FROM payments p
       WHERE p.payment_date < $1${prevStoreFilter}`,
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

    // Previous sales totals (cash + card) from actual sales
    const prevSalesFilterS = storeId ? ' AND store_id = $2' : '';
    const prevSalesParams = storeId ? [startDate, storeId] : [startDate];

    const prevSales = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_total,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_total
       FROM sales
       WHERE DATE(created_at AT TIME ZONE '${tz}') < $1${prevSalesFilterS}`,
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

    return {
      payments: payments.rows,
      sessions: sessions.rows,
      sales: sales.rows,
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

/* ═══ Expense Categories ═══ */
export const expenseCategoryRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM expense_categories ORDER BY type, name');
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM expense_categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async create(data: { name: string; type: string; description?: string }) {
    const result = await db.query(
      `INSERT INTO expense_categories (name, type, description) VALUES ($1,$2,$3) RETURNING *`,
      [data.name, data.type, data.description || null]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.type !== undefined) { fields.push(`type = $${i++}`); values.push(data.type); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE expense_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async delete(id: string) {
    await db.query('DELETE FROM expense_categories WHERE id = $1', [id]);
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

  async generateInvoiceNumber(type: 'received' | 'emitted'): Promise<string> {
    const prefix = type === 'received' ? 'FR' : 'FE';
    const year = new Date().getFullYear();
    const result = await db.query(
      `SELECT COUNT(*) FROM invoices WHERE invoice_type = $1 AND EXTRACT(YEAR FROM invoice_date) = $2`,
      [type, year]
    );
    const seq = parseInt(result.rows[0].count) + 1;
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    invoiceNumber?: string; invoiceType?: string;
    supplierId?: string; customerId?: string; categoryId?: string;
    purchaseOrderId?: string; receptionVoucherId?: string; orderId?: string;
    invoiceDate: string; dueDate?: string; amount: number;
    taxAmount?: number; totalAmount?: number; notes?: string; createdBy: string; storeId?: string;
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
          invoice_date, due_date, amount, tax_amount, total_amount, notes, created_by, store_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [invoiceNumber, invoiceType, data.supplierId || null, data.customerId || null,
         data.categoryId || null, data.purchaseOrderId || null, data.receptionVoucherId || null,
         data.orderId || null, data.invoiceDate, data.dueDate || null,
         data.amount, data.taxAmount || 0, totalAmount,
         data.notes || null, data.createdBy, data.storeId || null]
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
    const paymentsResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1`, [id]
    );
    const totalPaid = parseFloat(paymentsResult.rows[0].total_paid);
    const inv = await db.query('SELECT total_amount FROM invoices WHERE id = $1', [id]);
    const totalAmount = parseFloat(inv.rows[0].total_amount);
    let status = 'pending';
    if (totalPaid >= totalAmount) status = 'paid';
    else if (totalPaid > 0) status = 'partial';

    const result = await db.query(
      `UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3 RETURNING *`,
      [totalPaid, status, id]
    );
    return result.rows[0];
  },

  async updateStatus(id: string, status: string) {
    const result = await db.query(`UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
    return result.rows[0];
  },

  async updateAttachment(id: string, url: string | null) {
    const result = await db.query(`UPDATE invoices SET attachment_url = $1 WHERE id = $2 RETURNING *`, [url, id]);
    return result.rows[0];
  },
};

/* ═══ Payments ═══ */
export const paymentRepository = {
  async findAll(params: { type?: string; dateFrom?: string; dateTo?: string; supplierId?: string; storeId?: string }) {
    const conditions: string[] = []; const values: unknown[] = []; let i = 1;
    if (params.storeId) { conditions.push(`p.store_id = $${i++}`); values.push(params.storeId); }
    if (params.type) { conditions.push(`p.type = $${i++}`); values.push(params.type); }
    if (params.dateFrom) { conditions.push(`p.payment_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`p.payment_date <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`p.supplier_id = $${i++}`); values.push(params.supplierId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT p.*, s.name as supplier_name, e.first_name as employee_first_name, e.last_name as employee_last_name,
              ec.name as category_name, ec.type as category_type, ec.requires_po,
              inv.invoice_number,
              po.order_number as purchase_order_number
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
       ${where}
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      values
    );
    return result.rows;
  },
  async create(data: {
    reference?: string; type: string; categoryId?: string; invoiceId?: string;
    supplierId?: string; employeeId?: string; amount: number;
    paymentMethod: string; paymentDate: string; description?: string; createdBy: string; storeId?: string;
    purchaseOrderId?: string; checkNumber?: string; checkDate?: string; checkAttachmentUrl?: string;
  }) {
    const result = await db.query(
      `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id,
        amount, payment_method, payment_date, description, created_by, store_id, purchase_order_id,
        check_number, check_date, check_attachment_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [data.reference || null, data.type, data.categoryId || null, data.invoiceId || null,
       data.supplierId || null, data.employeeId || null, data.amount,
       data.paymentMethod, data.paymentDate, data.description || null, data.createdBy,
       data.storeId || null, data.purchaseOrderId || null,
       data.checkNumber || null, data.checkDate || null, data.checkAttachmentUrl || null]
    );
    // Update invoice paid amount if linked
    if (data.invoiceId) {
      await invoiceRepository.updatePaidAmount(data.invoiceId);
    }
    return result.rows[0];
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
