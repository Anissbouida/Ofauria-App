import { db } from '../config/database.js';
import { invoiceRepository } from './accounting.repository.js';
import { getLocalYear } from '../utils/timezone.js';

export const receptionVoucherRepository = {
  async findAll(params: { purchaseOrderId?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`rv.store_id = $${i++}`); values.push(params.storeId); }
    if (params.purchaseOrderId) { conditions.push(`rv.purchase_order_id = $${i++}`); values.push(params.purchaseOrderId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT rv.*, po.order_number, s.name as supplier_name,
              u.first_name || ' ' || u.last_name as received_by_name,
              (SELECT COUNT(*) FROM reception_voucher_items WHERE reception_voucher_id = rv.id) as item_count,
              (SELECT COALESCE(SUM(quantity_received * COALESCE(unit_price, 0)), 0) FROM reception_voucher_items WHERE reception_voucher_id = rv.id) as total_amount
       FROM reception_vouchers rv
       JOIN purchase_orders po ON po.id = rv.purchase_order_id
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = rv.received_by
       ${where}
       ORDER BY rv.reception_date DESC, rv.created_at DESC`,
      values
    );
    return result.rows;
  },

  async findById(id: string) {
    const rvResult = await db.query(
      `SELECT rv.*, po.order_number, po.supplier_id, s.name as supplier_name,
              u.first_name || ' ' || u.last_name as received_by_name
       FROM reception_vouchers rv
       JOIN purchase_orders po ON po.id = rv.purchase_order_id
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = rv.received_by
       WHERE rv.id = $1`,
      [id]
    );
    if (!rvResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT rvi.*, ing.name as ingredient_name, ing.unit as ingredient_unit,
              poi.quantity_ordered, poi.quantity_delivered as total_delivered
       FROM reception_voucher_items rvi
       JOIN ingredients ing ON ing.id = rvi.ingredient_id
       JOIN purchase_order_items poi ON poi.id = rvi.purchase_order_item_id
       WHERE rvi.reception_voucher_id = $1
       ORDER BY ing.name`,
      [id]
    );

    return { ...rvResult.rows[0], items: itemsResult.rows };
  },

  async generateVoucherNumber(): Promise<string> {
    const year = getLocalYear();
    const result = await db.query(
      `SELECT COUNT(*) FROM reception_vouchers WHERE EXTRACT(YEAR FROM reception_date) = $1`,
      [year]
    );
    const seq = parseInt(result.rows[0].count) + 1;
    return `BR-${year}-${String(seq).padStart(4, '0')}`;
  },

  async create(data: {
    purchaseOrderId: string;
    notes?: string;
    receivedBy: string;
    storeId?: string;
    items: { poItemId: string; ingredientId: string; quantityReceived: number; unitPrice?: number | null; notes?: string; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get PO info
      const poResult = await client.query(
        `SELECT po.*, s.name as supplier_name FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1`,
        [data.purchaseOrderId]
      );
      const po = poResult.rows[0];
      if (!po) throw new Error('Bon de commande non trouve');

      // Generate voucher number
      const voucherNumber = await this.generateVoucherNumber();

      // Create reception voucher
      const rvResult = await client.query(
        `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, notes, received_by, store_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [voucherNumber, data.purchaseOrderId, data.notes || null, data.receivedBy, data.storeId || null]
      );
      const rv = rvResult.rows[0];

      // Process each item
      for (const item of data.items) {
        if (item.quantityReceived <= 0) continue;

        // Insert reception voucher item (with lot/DLC fields)
        const rviResult = await client.query(
          `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price, notes, supplier_lot_number, expiration_date, manufactured_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [rv.id, item.poItemId, item.ingredientId, item.quantityReceived, item.unitPrice ?? null, item.notes || null,
           item.supplierLotNumber || null, item.expirationDate || null, item.manufacturedDate || null]
        );
        const rviId = rviResult.rows[0].id;

        // Update purchase_order_items.quantity_delivered
        const itemResult = await client.query(
          `UPDATE purchase_order_items SET quantity_delivered = quantity_delivered + $1 WHERE id = $2 RETURNING *`,
          [item.quantityReceived, item.poItemId]
        );
        const poItem = itemResult.rows[0];

        // Create ingredient lot for ONSSA traceability
        const effectiveCost = item.unitPrice ?? (poItem ? parseFloat(poItem.unit_price) : null);
        await client.query(
          `INSERT INTO ingredient_lots (ingredient_id, reception_voucher_item_id, supplier_id, supplier_lot_number,
            quantity_received, quantity_remaining, unit_cost, manufactured_date, expiration_date, received_at, store_id)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, CURRENT_DATE, $9)`,
          [item.ingredientId, rviId, po.supplier_id, item.supplierLotNumber || null,
           item.quantityReceived, effectiveCost, item.manufacturedDate || null, item.expirationDate || null,
           data.storeId || null]
        );
        if (!poItem) continue;

        // Update price on PO item if provided and was NULL
        if (item.unitPrice != null && poItem.unit_price == null) {
          await client.query(
            `UPDATE purchase_order_items SET unit_price = $1 WHERE id = $2`,
            [item.unitPrice, item.poItemId]
          );
        }

        // Update inventory
        const storeFilter = data.storeId ? ' AND store_id = $3' : '';
        const invParams: unknown[] = [item.quantityReceived, item.ingredientId];
        if (data.storeId) invParams.push(data.storeId);

        await client.query(
          `UPDATE inventory SET current_quantity = current_quantity + $1,
                  last_restocked_at = NOW(), updated_at = NOW()
           WHERE ingredient_id = $2${storeFilter}`,
          invParams
        );

        // Update ingredient unit_cost if price provided
        const effectivePrice = item.unitPrice ?? (poItem.unit_price ? parseFloat(poItem.unit_price) : null);
        if (effectivePrice && effectivePrice > 0) {
          await client.query(
            `UPDATE ingredients SET unit_cost = $1 WHERE id = $2`,
            [effectivePrice, item.ingredientId]
          );
        }

        // Insert inventory transaction with traceability
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, purchase_order_item_id, reception_voucher_id, store_id)
           VALUES ($1, 'restock', $2, $3, $4, $5, $6, $7)`,
          [item.ingredientId, item.quantityReceived,
           `Reception ${voucherNumber} — BC ${po.order_number} — Fournisseur: ${po.supplier_name}`,
           data.receivedBy, item.poItemId, rv.id, data.storeId || null]
        );
      }

      // Determine new PO status
      const allItems = await client.query(
        `SELECT quantity_ordered, quantity_delivered, unit_price FROM purchase_order_items WHERE purchase_order_id = $1`,
        [data.purchaseOrderId]
      );
      const allDelivered = allItems.rows.every(
        (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) >= parseFloat(it.quantity_ordered as string)
      );
      const someDelivered = allItems.rows.some(
        (it: Record<string, unknown>) => parseFloat(it.quantity_delivered as string) > 0
      );
      const hasMissingPrices = allItems.rows.some(
        (it: Record<string, unknown>) => it.unit_price == null
      );

      let newStatus: string;
      if (allDelivered && hasMissingPrices) {
        newStatus = 'en_attente_facturation';
      } else if (allDelivered) {
        newStatus = 'livre_complet';
      } else if (someDelivered) {
        newStatus = 'livre_partiel';
      } else {
        newStatus = 'non_livre';
      }

      await client.query(
        `UPDATE purchase_orders SET status = $1, delivery_date = CURRENT_DATE, updated_at = NOW() WHERE id = $2`,
        [newStatus, data.purchaseOrderId]
      );

      // Auto-create received invoice when PO is fully delivered with prices
      let autoInvoice = null;
      if (newStatus === 'livre_complet') {
        // Check if an invoice already exists for this PO
        const existingInv = await client.query(
          `SELECT id FROM invoices WHERE purchase_order_id = $1 AND status != 'cancelled' LIMIT 1`,
          [data.purchaseOrderId]
        );
        if (existingInv.rows.length === 0) {
          // Build invoice items from PO items
          const poItems = allItems.rows;
          const poItemDetails = await client.query(
            `SELECT poi.*, ing.name as ingredient_name
             FROM purchase_order_items poi
             JOIN ingredients ing ON ing.id = poi.ingredient_id
             WHERE poi.purchase_order_id = $1`,
            [data.purchaseOrderId]
          );

          const invoiceItems = poItemDetails.rows.map((it: Record<string, unknown>) => ({
            ingredientId: it.ingredient_id as string,
            description: it.ingredient_name as string,
            quantity: parseFloat(it.quantity_delivered as string),
            unitPrice: parseFloat(it.unit_price as string),
            subtotal: parseFloat(it.quantity_delivered as string) * parseFloat(it.unit_price as string),
          }));

          const amount = invoiceItems.reduce((sum: number, it: { subtotal: number }) => sum + it.subtotal, 0);
          const invoiceNumber = await invoiceRepository.generateInvoiceNumber('received');

          const invResult = await client.query(
            `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, purchase_order_id, reception_voucher_id,
              invoice_date, amount, tax_amount, total_amount, notes, created_by, store_id)
             VALUES ($1, 'received', $2, $3, $4, CURRENT_DATE, $5, 0, $5, $6, $7, $8) RETURNING *`,
            [invoiceNumber, po.supplier_id, data.purchaseOrderId, rv.id,
             amount,
             `Facture auto-generee depuis ${po.order_number}`,
             data.receivedBy, data.storeId || null]
          );
          autoInvoice = invResult.rows[0];

          // Insert invoice items
          for (const item of invoiceItems) {
            await client.query(
              `INSERT INTO invoice_items (invoice_id, ingredient_id, description, quantity, unit_price, subtotal)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [autoInvoice.id, item.ingredientId, item.description, item.quantity, item.unitPrice, item.subtotal]
            );
          }
        }
      }

      await client.query('COMMIT');
      return { ...rv, status: newStatus, autoInvoice };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findByPurchaseOrder(purchaseOrderId: string) {
    const result = await db.query(
      `SELECT rv.*, u.first_name || ' ' || u.last_name as received_by_name,
              (SELECT COUNT(*) FROM reception_voucher_items WHERE reception_voucher_id = rv.id) as item_count,
              (SELECT COALESCE(SUM(quantity_received * COALESCE(unit_price, 0)), 0) FROM reception_voucher_items WHERE reception_voucher_id = rv.id) as total_amount
       FROM reception_vouchers rv
       LEFT JOIN users u ON u.id = rv.received_by
       WHERE rv.purchase_order_id = $1
       ORDER BY rv.reception_date DESC`,
      [purchaseOrderId]
    );
    return result.rows;
  },
};
