import { db } from '../config/database.js';
import { invoiceRepository } from './accounting.repository.js';
import { getLocalYear } from '../utils/timezone.js';

// UUIDs racine/parent des categories de depenses (cf. migration 059).
const CAT_MATIERES_PREMIERES = '10000000-0000-0000-0000-000000000003'; // racine niveau 1
const CAT_INGREDIENTS        = '20000000-0000-0000-0000-000000000004'; // niveau 2
const CAT_EMBALLAGES         = '20000000-0000-0000-0000-000000000005'; // niveau 2

/**
 * Determine la categorie de depense la plus pertinente pour une facture
 * auto-creee depuis un BC, en se basant sur les categories des ingredients
 * commandes (ingredients.category mappe sur expense_categories.code niveau 3).
 *
 * Strategie :
 *  - Toutes les lignes pointent vers UN seul leaf  -> ce leaf (ex: "Farines").
 *  - Toutes les lignes ont le meme parent niveau 2 -> ce parent (ex: "Ingredients").
 *  - Mixte (ingredients + emballages, ou rien)     -> racine "Matieres premieres".
 *
 * L'admin peut toujours raffiner via le bouton "Categoriser" cote UI.
 */
type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function resolveInvoiceCategoryFromPo(
  client: TxClient,
  purchaseOrderId: string,
): Promise<string> {
  const res = await client.query(
    `WITH cats AS (
       SELECT DISTINCT ec.id::text AS id, ec.parent_id::text AS parent_id
         FROM purchase_order_items poi
         JOIN ingredients ing ON ing.id = poi.ingredient_id
         JOIN expense_categories ec
           ON ec.code = ing.category
          AND ec.parent_id IN ($2::uuid, $3::uuid)
        WHERE poi.purchase_order_id = $1
     )
     SELECT
       CASE
         WHEN COUNT(*) = 0 THEN $4
         WHEN COUNT(*) = 1 THEN (SELECT id FROM cats LIMIT 1)
         WHEN COUNT(DISTINCT parent_id) = 1 THEN (SELECT parent_id FROM cats LIMIT 1)
         ELSE $4
       END AS category_id
     FROM cats`,
    [purchaseOrderId, CAT_INGREDIENTS, CAT_EMBALLAGES, CAT_MATIERES_PREMIERES],
  );
  return (res.rows[0]?.category_id as string) ?? CAT_MATIERES_PREMIERES;
}

/**
 * Cree la facture "received" associee a un BC livre, dans le client
 * transactionnel fourni. Idempotent : retourne null si une facture
 * non-annulee existe deja pour ce BC.
 *
 * Utilise par deux chemins :
 *  - Reception complete (auto, depuis receptionVoucherRepository.create)
 *  - Generation manuelle (depuis purchaseOrderRepository.generateInvoice),
 *    quand l'utilisateur clique "Generer la facture" sur un BC livre_complet
 *    dont la facture n'a pas ete auto-creee (ex: prix saisis a posteriori
 *    via updateItemPrices / replaceItems).
 *
 * Prerequis attendus du caller : BC en statut livre_complet, toutes les
 * lignes avec unit_price NOT NULL. Le helper ne re-valide pas le statut —
 * c'est la responsabilite du caller.
 */
export async function createInvoiceFromPo(
  client: TxClient,
  purchaseOrderId: string,
  receptionVoucherId: string | null,
  createdBy: string,
  storeId: string | null,
): Promise<Record<string, unknown> | null> {
  // Idempotence : ne pas creer de doublon si une facture existe deja.
  const existingInv = await client.query(
    `SELECT id FROM invoices WHERE purchase_order_id = $1 AND status != 'cancelled' LIMIT 1`,
    [purchaseOrderId]
  );
  if (existingInv.rows.length > 0) return null;

  const poRes = await client.query(
    `SELECT id, order_number, supplier_id FROM purchase_orders WHERE id = $1`,
    [purchaseOrderId]
  );
  const po = poRes.rows[0];
  if (!po) throw new Error('Bon de commande non trouve');

  // Effective price = dernier prix saisi en reception si dispo, sinon prix BC.
  // Garantit que la facture refletera le prix reellement paye meme si le BC
  // avait un prix 0/NULL au depart.
  const poItemDetails = await client.query(
    `SELECT poi.id, poi.ingredient_id, poi.quantity_delivered, poi.unit_price AS po_unit_price,
            ing.name as ingredient_name,
            COALESCE(
              (SELECT rvi.unit_price FROM reception_voucher_items rvi
               WHERE rvi.purchase_order_item_id = poi.id AND rvi.unit_price IS NOT NULL
               ORDER BY rvi.id DESC LIMIT 1),
              poi.unit_price
            ) AS effective_unit_price
     FROM purchase_order_items poi
     JOIN ingredients ing ON ing.id = poi.ingredient_id
     WHERE poi.purchase_order_id = $1`,
    [purchaseOrderId]
  );

  const invoiceItems = poItemDetails.rows.map((it: Record<string, unknown>) => {
    const qty = parseFloat(it.quantity_delivered as string);
    const price = parseFloat((it.effective_unit_price as string) ?? '0') || 0;
    return {
      ingredientId: it.ingredient_id as string,
      description: it.ingredient_name as string,
      quantity: qty,
      unitPrice: price,
      subtotal: qty * price,
    };
  });

  const amount = invoiceItems.reduce((sum: number, it: { subtotal: number }) => sum + it.subtotal, 0);

  // N° et date facture : on prefere ceux du fournisseur (saisis lors de la
  // reception). Fallback sur auto-genere si non renseignes.
  const supplierInvoiceLookup = await client.query(
    `SELECT supplier_invoice_number AS number, supplier_invoice_date::text AS date
     FROM reception_vouchers
     WHERE purchase_order_id = $1 AND supplier_invoice_number IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [purchaseOrderId]
  );
  const lookedUpNumber = (supplierInvoiceLookup.rows[0]?.number as string | null) || null;
  const lookedUpDate = (supplierInvoiceLookup.rows[0]?.date as string | null) || null;

  const invoiceNumber = lookedUpNumber || await invoiceRepository.generateInvoiceNumber('received');
  const notesLabel = lookedUpNumber
    ? `Facture fournisseur ${lookedUpNumber} — reception depuis ${po.order_number}`
    : `Facture auto-generee depuis ${po.order_number}`;

  const derivedCategoryId = await resolveInvoiceCategoryFromPo(client, purchaseOrderId);

  // Si pas de rv_id explicite (generation manuelle a posteriori), on rattache
  // au dernier bon de reception du BC pour conserver le lien de tracabilite.
  let effectiveRvId = receptionVoucherId;
  if (effectiveRvId === null) {
    const lastRv = await client.query(
      `SELECT id FROM reception_vouchers WHERE purchase_order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [purchaseOrderId]
    );
    effectiveRvId = (lastRv.rows[0]?.id as string | null) ?? null;
  }

  const invResult = await client.query(
    `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, purchase_order_id, reception_voucher_id,
      invoice_date, amount, tax_amount, total_amount, notes, created_by, store_id, category_id)
     VALUES ($1, 'received', $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, 0, $6, $7, $8, $9, $10) RETURNING *`,
    [invoiceNumber, po.supplier_id, purchaseOrderId, effectiveRvId,
     lookedUpDate,
     amount,
     notesLabel,
     createdBy, storeId,
     derivedCategoryId]
  );
  const invoice = invResult.rows[0];

  for (const item of invoiceItems) {
    await client.query(
      `INSERT INTO invoice_items (invoice_id, ingredient_id, description, quantity, unit_price, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [invoice.id, item.ingredientId, item.description, item.quantity, item.unitPrice, item.subtotal]
    );
  }

  return invoice;
}

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

  async generateVoucherNumber(client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    const runner = client ?? db;
    await runner.query(`SELECT pg_advisory_xact_lock(hashtext('voucher_number'))`);
    const year = getLocalYear();
    const result = await runner.query(
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
    supplierInvoiceNumber?: string;
    supplierInvoiceDate?: string;
    /**
     * forceComplete : le fournisseur ne livrera pas le reste — on cloture le BC
     * en alignant les quantites commandees sur les quantites livrees. Les lignes
     * non livrees (qty_delivered=0) sont supprimees du BC. La facture est creee
     * sur la base de ce qui a effectivement ete recu.
     */
    forceComplete?: boolean;
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

      const supplierInvoiceNumber = data.supplierInvoiceNumber?.trim() || null;
      const supplierInvoiceDate = data.supplierInvoiceDate || null;

      // Garde : meme N° de facture fournisseur deja saisi sur une reception
      // antecedente du meme fournisseur = doublon (facture saisie deux fois).
      // On bloque pour eviter la creation d'une seconde facture en double.
      if (supplierInvoiceNumber) {
        const dup = await client.query(
          `SELECT rv.voucher_number, po.order_number
           FROM reception_vouchers rv
           JOIN purchase_orders po ON po.id = rv.purchase_order_id
           WHERE rv.supplier_invoice_number = $1
             AND po.supplier_id = $2
           LIMIT 1`,
          [supplierInvoiceNumber, po.supplier_id]
        );
        if (dup.rows.length > 0) {
          const e: Error & { statusCode?: number } = new Error(
            `La facture fournisseur N° ${supplierInvoiceNumber} a déjà été enregistrée ` +
            `(reception ${dup.rows[0].voucher_number} — BC ${dup.rows[0].order_number}). ` +
            `Vérifie le numéro avant de valider.`
          );
          e.statusCode = 409;
          throw e;
        }
      }

      // Generate voucher number (with advisory lock via client)
      const voucherNumber = await this.generateVoucherNumber(client);

      // Create reception voucher
      const rvResult = await client.query(
        `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, notes, received_by, store_id,
                                          supplier_invoice_number, supplier_invoice_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [voucherNumber, data.purchaseOrderId, data.notes || null, data.receivedBy, data.storeId || null,
         supplierInvoiceNumber, supplierInvoiceDate]
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

        // Lock PO item row before updating delivered quantity
        await client.query(
          `SELECT id FROM purchase_order_items WHERE id = $1 FOR UPDATE`,
          [item.poItemId]
        );
        const itemResult = await client.query(
          `UPDATE purchase_order_items SET quantity_delivered = quantity_delivered + $1 WHERE id = $2 RETURNING *`,
          [item.quantityReceived, item.poItemId]
        );
        const poItem = itemResult.rows[0];

        // Create ingredient lot for ONSSA traceability
        const effectiveCost = item.unitPrice ?? (poItem ? parseFloat(poItem.unit_price) : null);
        await client.query(
          `INSERT INTO ingredient_lots (ingredient_id, reception_voucher_item_id, supplier_id, supplier_lot_number,
            quantity_received, quantity_remaining, economat_quantity, pesage_quantity, unit_cost, manufactured_date, expiration_date, received_at, store_id)
           VALUES ($1, $2, $3, $4, $5, $5, $5, 0, $6, $7, $8, CURRENT_DATE, $9)`,
          [item.ingredientId, rviId, po.supplier_id, item.supplierLotNumber || null,
           item.quantityReceived, effectiveCost, item.manufacturedDate || null, item.expirationDate || null,
           data.storeId || null]
        );
        if (!poItem) continue;

        // Le prix saisi lors de la reception fait foi : il reflete ce que le
        // fournisseur a effectivement facture. On le repercute sur le BC pour
        // que total BC et facture restent coherents (sinon le BC affiche
        // l'ancien prix estime et la facture le vrai prix paye).
        if (item.unitPrice != null && item.unitPrice > 0) {
          await client.query(
            `UPDATE purchase_order_items SET unit_price = $1 WHERE id = $2`,
            [item.unitPrice, item.poItemId]
          );
        }

        // Lock inventory row then update
        const storeFilter = data.storeId ? ' AND store_id = $3' : '';
        const lockFilter = data.storeId ? ' AND store_id = $2' : '';
        const lockParams: unknown[] = [item.ingredientId];
        if (data.storeId) lockParams.push(data.storeId);
        await client.query(
          `SELECT id FROM inventory WHERE ingredient_id = $1${lockFilter} FOR UPDATE`,
          lockParams
        );

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

      // forceComplete : on aligne le BC sur ce qui a ete livre.
      //   - Les lignes 0 livre sont supprimees (le fournisseur ne livrera pas).
      //     Pas de RVi dessus (qty_received > 0 contraint), donc DELETE safe.
      //   - Les lignes partielles voient quantity_ordered descendre a
      //     quantity_delivered (le BC ne represente plus que le reel facture).
      // Apres ca, le calcul de statut ci-dessous tombe naturellement sur
      // 'livre_complet' (ou 'en_attente_facturation' si prix manquants).
      if (data.forceComplete) {
        await client.query(
          `DELETE FROM purchase_order_items
             WHERE purchase_order_id = $1 AND quantity_delivered = 0`,
          [data.purchaseOrderId]
        );
        await client.query(
          `UPDATE purchase_order_items
              SET quantity_ordered = quantity_delivered
            WHERE purchase_order_id = $1 AND quantity_delivered < quantity_ordered`,
          [data.purchaseOrderId]
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

      // Auto-create received invoice when PO is fully delivered with prices.
      // Toute la logique de creation (categorisation, N° fournisseur, lignes)
      // vit dans createInvoiceFromPo pour etre reutilisable depuis la generation
      // manuelle (cf. purchaseOrderRepository.generateInvoice).
      let autoInvoice = null;
      if (newStatus === 'livre_complet') {
        autoInvoice = await createInvoiceFromPo(
          client, data.purchaseOrderId, rv.id, data.receivedBy, data.storeId || null
        );
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
