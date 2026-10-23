import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { invoiceRepository } from './accounting.repository.js';
import { packagingItemRepository } from './packaging-item.repository.js';
import { FLAGS } from '../config/feature-flags.js';
import { postOrQueue, postGoodsReceiptsForPo } from '../services/ledger-posting.service.js';
import { closePurchaseRequestsForOrder } from './purchase-request.helper.js';
import { fromInvoice, persistEntry, reverseEntriesForSource } from '../services/journal-generator.service.js';

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
       UNION
       SELECT DISTINCT ec.id::text AS id, ec.parent_id::text AS parent_id
         FROM purchase_order_items poi
         JOIN packaging_items pkg ON pkg.id = poi.packaging_id
         JOIN expense_categories ec ON ec.id = pkg.category_id
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

  // GR/IR (mig 311, G-D8-05) : les réceptions non encore comptabilisées passent
  // en 4417 AVANT la facture, qui solde ce compte d'attente ligne par ligne.
  await postGoodsReceiptsForPo(client as unknown as import('pg').PoolClient, purchaseOrderId, createdBy);

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
    `SELECT poi.id, poi.ingredient_id, poi.packaging_id, poi.quantity_delivered, poi.unit_price AS po_unit_price,
            COALESCE(ing.name, pkg.name) as ingredient_name,
            COALESCE(ing.category_id, pkg.category_id) AS line_category_id,
            -- TVA attendue (mig 309) : taux saisi sur la ligne de BC, sinon code par défaut de l'article
            -- ou de sa catégorie à la date du jour. Jamais un 0 implicite : NULL = taux à préciser.
            COALESCE(ing.default_tax_code, pkg.default_tax_code, cat.default_tax_code) AS tax_code,
            COALESCE(poi.tva_rate, fn_tax_rate(COALESCE(ing.default_tax_code, pkg.default_tax_code, cat.default_tax_code), CURRENT_DATE)) AS tva_rate,
            COALESCE(
              (SELECT rvi.unit_price FROM reception_voucher_items rvi
               WHERE rvi.purchase_order_item_id = poi.id AND rvi.unit_price IS NOT NULL
               ORDER BY rvi.id DESC LIMIT 1),
              poi.unit_price
            ) AS effective_unit_price
     FROM purchase_order_items poi
     LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
     LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
     LEFT JOIN expense_categories cat ON cat.id = COALESCE(ing.category_id, pkg.category_id)
     WHERE poi.purchase_order_id = $1 AND poi.quantity_delivered > 0`,
    [purchaseOrderId]
  );

  const invoiceItems = poItemDetails.rows.map((it: Record<string, unknown>) => {
    const qty = parseFloat(it.quantity_delivered as string);
    const price = parseFloat((it.effective_unit_price as string) ?? '0') || 0;
    const tvaRate = it.tva_rate != null ? parseFloat(it.tva_rate as string) : null;
    return {
      poItemId: it.id as string,
      taxCode: (it.tax_code as string | null) ?? null,
      tvaRate,
      ingredientId: (it.ingredient_id as string | null) ?? null,
      packagingId: (it.packaging_id as string | null) ?? null,
      // Categorie figee au moment de l'achat (celle de l'article), pour que
      // la ligne garde sa categorie meme si l'article est reclasse plus tard.
      categoryId: (it.line_category_id as string | null) ?? null,
      description: it.ingredient_name as string,
      quantity: qty,
      unitPrice: price,
      subtotal: qty * price,
    };
  });

  const amount = invoiceItems.reduce((sum: number, it: { subtotal: number }) => sum + it.subtotal, 0);
  const taxAmount = invoiceItems.reduce((sum: number, it: { subtotal: number; tvaRate: number | null }) =>
    sum + (it.tvaRate != null ? Math.round(it.subtotal * it.tvaRate) / 100 : 0), 0);

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

  const invoiceNumber = lookedUpNumber || await invoiceRepository.generateInvoiceNumber('received', client);
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
      invoice_date, amount, tax_amount, total_amount, notes, created_by, store_id, category_id,
      supplier_invoice_number, source, received_on, accounting_date)
     VALUES ($1, 'received', $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6::numeric, $11::numeric, $6::numeric + $11::numeric, $7, $8, $9, $10,
             $12, 'from_receipt', CURRENT_DATE, COALESCE($5::date, CURRENT_DATE)) RETURNING *`,
    [invoiceNumber, po.supplier_id, purchaseOrderId, effectiveRvId,
     lookedUpDate,
     Math.round(amount * 100) / 100,
     notesLabel,
     createdBy, storeId,
     derivedCategoryId,
     Math.round(taxAmount * 100) / 100,
     lookedUpNumber]
  );
  const invoice = invResult.rows[0];

  for (const item of invoiceItems) {
    await client.query(
      `INSERT INTO invoice_items (invoice_id, ingredient_id, packaging_id, category_id, description, quantity, unit_price, subtotal,
                                  tva_rate, tva_amount, tax_code, purchase_order_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [invoice.id, item.ingredientId, item.packagingId, item.categoryId, item.description, item.quantity, item.unitPrice, item.subtotal,
       item.tvaRate, item.tvaRate != null ? Math.round(item.subtotal * item.tvaRate) / 100 : null, item.taxCode, item.poItemId]
    );
  }

  // Écriture de la facture (mig 311, G-D8-01) : obligatoire ; un échec part en
  // file d'attente (ledger_outbox) ou annule la pièce en mode strict.
  // client est un vrai PoolClient au runtime (transaction du caller).
  const pgClient = client as unknown as import('pg').PoolClient;
  await postOrQueue(pgClient, { kind: 'invoice', id: invoice.id as string }, async () => {
    const entry = await fromInvoice(pgClient, invoice as unknown as Parameters<typeof fromInvoice>[1]);
    if (entry) await persistEntry(pgClient, entry, { userId: createdBy });
  });

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
      `SELECT rvi.*,
              COALESCE(ing.name, pkg.name) as ingredient_name,
              COALESCE(ing.unit, pkg.unit) as ingredient_unit,
              CASE WHEN rvi.packaging_id IS NOT NULL THEN 'consumable' ELSE 'ingredient' END as kind,
              poi.quantity_ordered, poi.quantity_delivered as total_delivered
       FROM reception_voucher_items rvi
       LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
       LEFT JOIN packaging_items pkg ON pkg.id = rvi.packaging_id
       JOIN purchase_order_items poi ON poi.id = rvi.purchase_order_item_id
       WHERE rvi.reception_voucher_id = $1
       ORDER BY COALESCE(ing.name, pkg.name)`,
      [id]
    );

    return { ...rvResult.rows[0], items: itemsResult.rows };
  },

  async generateVoucherNumber(client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }): Promise<string> {
    // Serie « reception_voucher » (Parametres > Numerotation, mig 329).
    return nextDocumentNumber(client ?? db, 'reception_voucher');
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
    // Une ligne porte SOIT un ingredient SOIT un consommable (packaging_items).
    items: { poItemId: string; ingredientId?: string | null; packagingId?: string | null; quantityReceived: number; unitPrice?: number | null; notes?: string; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // Contexte « réception » (mig 306) : seule la réception et son extourne peuvent modifier
      // quantité livrée, prix reçu et lignes d'un BC verrouillé. Portée : cette transaction.
      await client.query(`SELECT set_config('app.change_origin', 'receipt', true)`);

      // En-tête verrouillé pour toute la réception (mig 307, G-D4-19) : deux réceptions ou une
      // annulation concurrentes s'attendent au lieu de se croiser. Le statut est revérifié ici,
      // dans la transaction, et non plus seulement par le contrôleur avant de l'ouvrir.
      const poResult = await client.query(
        `SELECT po.*, s.name as supplier_name FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1 FOR UPDATE OF po`,
        [data.purchaseOrderId]
      );
      const po = poResult.rows[0];
      if (!po) throw new Error('Bon de commande non trouve');
      if (!['envoye', 'livre_partiel'].includes(po.status)) {
        const e: Error & { statusCode?: number } = new Error(
          `Le BC ${po.order_number} n'attend plus de livraison (statut ${po.status}).`);
        e.statusCode = 409;
        throw e;
      }

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

      // Store de credit pour les consommables (packaging_store_stock.store_id est
      // NOT NULL). Fallback sur le 1er magasin si la reception n'en porte pas.
      let consumableStoreId: string | null = data.storeId || null;
      if (!consumableStoreId && data.items.some(it => it.packagingId)) {
        const s = await client.query(`SELECT id FROM stores ORDER BY created_at LIMIT 1`);
        consumableStoreId = (s.rows[0]?.id as string | undefined) ?? null;
      }

      const warnings: string[] = [];
      const lotNumbers: string[] = [];

      // Process each item
      for (const item of data.items) {
        if (item.quantityReceived <= 0) continue;
        const isConsumable = !!item.packagingId;

        // Insert reception voucher item (ingredient OU consommable, lot/DLC fields)
        const rviResult = await client.query(
          `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, packaging_id, quantity_received, unit_price, notes, supplier_lot_number, expiration_date, manufactured_date,
                                               kind, created_by, po_unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'receive', $11,
                   (SELECT unit_price FROM purchase_order_items WHERE id = $2)) RETURNING id`,
          [rv.id, item.poItemId, item.ingredientId ?? null, item.packagingId ?? null, item.quantityReceived, item.unitPrice ?? null, item.notes || null,
           item.supplierLotNumber || null, item.expirationDate || null, item.manufacturedDate || null, data.receivedBy]
        );
        const rviId = rviResult.rows[0].id;

        // La quantité livrée de la ligne n'est plus écrite ici : l'insertion de la ligne de
        // réception poste un événement GR (trigger rvi_post_gr, mig 307) qui met à jour les
        // compteurs et refuse une sur-livraison au-delà de la tolérance paramétrée.
        const itemResult = await client.query(
          `SELECT * FROM purchase_order_items WHERE id = $1 FOR UPDATE`,
          [item.poItemId]
        );
        const poItem = itemResult.rows[0];
        const effectiveCost = item.unitPrice ?? (poItem && poItem.unit_price ? parseFloat(poItem.unit_price) : null);

        // Le prix reçu vit sur la ligne de réception. Il ne remplace plus le prix commandé
        // (mig 307, G-D4-07) : il complète seulement une ligne commandée sans prix.
        if (item.unitPrice != null && item.unitPrice > 0) {
          await client.query(
            `UPDATE purchase_order_items SET unit_price = $1 WHERE id = $2 AND unit_price IS NULL`,
            [item.unitPrice, item.poItemId]
          );
        }

        if (isConsumable) {
          // ─── Consommable : credite packaging_store_stock (stock simple, pas
          //     de lot/DLC/FEFO). Reutilise adjustStock (transaction tracee). ───
          if (!consumableStoreId) {
            const e: Error & { statusCode?: number } = new Error(
              'Aucun magasin disponible pour réceptionner le consommable.');
            e.statusCode = 400;
            throw e;
          }
          await packagingItemRepository.adjustStock(client as unknown as import('pg').PoolClient, {
            packagingId: item.packagingId as string,
            storeId: consumableStoreId,
            change: item.quantityReceived,
            type: 'reception',
            referenceId: data.purchaseOrderId,
            referenceType: 'purchase_order',
            unitCost: effectiveCost,
            note: `Reception ${voucherNumber} — BC ${po.order_number} — Fournisseur: ${po.supplier_name}`,
            performedBy: data.receivedBy,
          });
          // Met a jour le cout catalogue du consommable au dernier prix paye.
          if (effectiveCost && effectiveCost > 0) {
            await client.query(
              `UPDATE packaging_items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`,
              [effectiveCost, item.packagingId]
            );
          }
          continue;
        }

        // ─── Ingredient : lot ONSSA + tracabilite ───
        // Exigences lot fournisseur / DLC (mig 308) : en mode « warn », signalées dans la réponse ;
        // en mode « block », le trigger de la ligne de réception a déjà refusé.
        const reqs = (await client.query(`SELECT * FROM fn_lot_requirements($1)`, [item.ingredientId])).rows[0];
        if (reqs) {
          const missing: string[] = [];
          if (reqs.requires_dlc && !item.expirationDate) missing.push('DLC');
          if (reqs.requires_lot && !item.supplierLotNumber?.trim()) missing.push('lot fournisseur');
          if (missing.length) {
            const nm = (await client.query(`SELECT name FROM ingredients WHERE id = $1`, [item.ingredientId])).rows[0]?.name;
            warnings.push(`${nm} : ${missing.join(' et ')} manquant(s)`);
          }
        }
        // Le lot reçoit son numéro interne LI-AAMMJJ-NNNNN par défaut (mig 308).
        const lotRes = await client.query(
          `INSERT INTO ingredient_lots (ingredient_id, reception_voucher_item_id, supplier_id, supplier_lot_number,
            quantity_received, quantity_remaining, economat_quantity, pesage_quantity, unit_cost, manufactured_date, expiration_date, received_at, store_id)
           VALUES ($1, $2, $3, $4, $5, $5, $5, 0, $6, $7, $8, CURRENT_DATE, $9) RETURNING id, lot_number`,
          [item.ingredientId, rviId, po.supplier_id, item.supplierLotNumber || null,
           item.quantityReceived, effectiveCost, item.manufacturedDate || null, item.expirationDate || null,
           data.storeId || null]
        );
        const lotId = lotRes.rows[0].id as string;
        lotNumbers.push(lotRes.rows[0].lot_number as string);
        if (!poItem) continue;

        // Stock : le lot créé ci-dessus met à jour inventory par le trigger trg_inventory_sync_lots.
        // L'ancienne mise à jour manuelle ajoutait la quantité une seconde fois (double comptage,
        // corrigé en mig 308). Seule la date de dernier réapprovisionnement est posée ici.
        await client.query(
          `UPDATE inventory SET last_restocked_at = NOW() WHERE ingredient_id = $1 AND ($2::uuid IS NULL OR store_id = $2)`,
          [item.ingredientId, data.storeId || null]
        );

        // Update ingredient unit_cost if price provided
        if (effectiveCost && effectiveCost > 0) {
          await client.query(
            `UPDATE ingredients SET unit_cost = $1 WHERE id = $2`,
            [effectiveCost, item.ingredientId]
          );
        }

        // Insert inventory transaction with traceability
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, purchase_order_item_id, reception_voucher_id, store_id, ingredient_lot_id)
           VALUES ($1, 'restock', $2, $3, $4, $5, $6, $7, $8)`,
          [item.ingredientId, item.quantityReceived,
           `Reception ${voucherNumber} — BC ${po.order_number} — Fournisseur: ${po.supplier_name}`,
           data.receivedBy, item.poItemId, rv.id, data.storeId || null, lotId]
        );
      }

      // forceComplete : on aligne le BC sur ce qui a ete livre.
      //   - Les lignes 0 livre sont supprimees (le fournisseur ne livrera pas).
      //     Pas de RVi dessus (qty_received > 0 contraint), donc DELETE safe.
      //   - Les lignes partielles voient quantity_ordered descendre a
      //     quantity_delivered (le BC ne represente plus que le reel facture).
      // Apres ca, le calcul de statut ci-dessous tombe naturellement sur
      // 'livre_complet' (ou 'en_attente_facturation' si prix manquants).
      // forceComplete (mig 307, G-D4-10) : le reliquat est CLÔTURÉ, plus rien n'est supprimé
      // ni réécrit. Chaque ligne garde sa quantité commandée d'origine ; la part non livrée
      // devient une quantité annulée tracée (événement CANCEL), réversible.
      if (data.forceComplete) {
        await client.query(
          `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, reason_code_id, posted_by, note)
           SELECT poi.id, 'CANCEL', 1, poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base,
                  'close_remainder', gen_random_uuid(),
                  (SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND code = 'partial_delivery_closed'),
                  $2, $3
             FROM purchase_order_items poi
            WHERE poi.purchase_order_id = $1
              AND poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base > 0.0001`,
          [data.purchaseOrderId, data.receivedBy, `Reliquat clôturé à la réception ${voucherNumber}`]
        );
      }

      // Statut dérivé des lignes par une seule règle en base (mig 307).
      const statusRes = await client.query(`SELECT fn_po_delivery_status($1) AS s`, [data.purchaseOrderId]);
      const newStatus = statusRes.rows[0].s as string;

      await client.query(
        `UPDATE purchase_orders SET status = $1, delivery_date = CURRENT_DATE, updated_at = NOW() WHERE id = $2`,
        [newStatus, data.purchaseOrderId]
      );

      // Marchandise arrivee -> on ferme les demandes d'achat rattachees. Sans ca elles
      // restent a vie en 'assigned' et masquent l'ingredient dans l'onglet Economat
      // "Ingredients a commander" (flag already_ordered).
      await closePurchaseRequestsForOrder(client, data.purchaseOrderId, newStatus);

      // Auto-create received invoice when PO is fully delivered with prices.
      // Toute la logique de creation (categorisation, N° fournisseur, lignes)
      // vit dans createInvoiceFromPo pour etre reutilisable depuis la generation
      // manuelle (cf. purchaseOrderRepository.generateInvoice).
      // GR/IR (mig 311) : réception comptabilisée en 4417 au prix BC, même partielle.
      await postGoodsReceiptsForPo(client as unknown as import('pg').PoolClient, data.purchaseOrderId, data.receivedBy);
      let autoInvoice = null;
      if (newStatus === 'livre_complet') {
        autoInvoice = await createInvoiceFromPo(
          client, data.purchaseOrderId, rv.id, data.receivedBy, data.storeId || null
        );
      }

      await client.query('COMMIT');
      return { ...rv, status: newStatus, autoInvoice, warnings, lotNumbers };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Extourne de TOUTES les réceptions d'un BC par contre-pièce (mig 308, G-D5-04).
   *
   * Rien n'est supprimé. Pour chaque bon de réception actif : un bon miroir numéroté
   * (voucher_kind = 'reversal') reprend chaque ligne en sens inverse (kind = 'reverse'),
   * ce qui poste un GR_REVERSAL sur la ligne de BC ; les lots passent « reversed » à
   * quantité nulle (le trigger des lots recalcule le stock) ; un mouvement d'ajustement
   * négatif trace la sortie ; la facture auto est extournée en comptabilité puis annulée.
   * Le BC revient « envoyé ». Motif obligatoire.
   *
   * Garde-fous (409) : facture déjà payée ; lot déjà entamé (on n'extourne pas ce qui a
   * été consommé — corriger la ligne à la place).
   */
  async cancelForPurchaseOrder(purchaseOrderId: string, userId: string, reason?: { reasonCodeId: string; note?: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.change_origin', 'receipt', true)`);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

      if (!reason?.reasonCodeId) {
        const e: Error & { statusCode?: number } = new Error('Motif d\'extourne requis');
        e.statusCode = 400; throw e;
      }
      const reasonOk = await client.query(
        `SELECT 1 FROM ref_entries WHERE id = $1 AND table_id = 'purchase_reason_codes' AND is_active AND metadata->'scope' ? 'reverse'`,
        [reason.reasonCodeId]);
      if (!reasonOk.rowCount) {
        const e: Error & { statusCode?: number } = new Error('Motif invalide pour une extourne de réception');
        e.statusCode = 400; throw e;
      }

      const poRes = await client.query(
        `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.id = $1 FOR UPDATE OF po`,
        [purchaseOrderId]
      );
      const po = poRes.rows[0];
      if (!po) {
        const e: Error & { statusCode?: number } = new Error('Bon de commande non trouve');
        e.statusCode = 404; throw e;
      }
      if (!['livre_complet', 'livre_partiel', 'en_attente_facturation'].includes(po.status as string)) {
        const e: Error & { statusCode?: number } = new Error(
          'Ce bon de commande n\'est pas en etat receptionne — rien a extourner.');
        e.statusCode = 409; throw e;
      }

      const rvs = await client.query(
        `SELECT id, voucher_number, store_id FROM reception_vouchers
         WHERE purchase_order_id = $1 AND voucher_kind = 'receipt' AND status = 'posted' FOR UPDATE`,
        [purchaseOrderId]
      );
      if (rvs.rows.length === 0) {
        const e: Error & { statusCode?: number } = new Error('Aucune reception active a extourner pour ce bon de commande.');
        e.statusCode = 409; throw e;
      }
      const rvIds = rvs.rows.map((r: Record<string, unknown>) => r.id as string);

      // ── Garde-fou 1 : facture déjà (partiellement) payée ──
      const paidInv = await client.query(
        `SELECT invoice_number FROM invoices
         WHERE purchase_order_id = $1 AND status != 'cancelled' AND COALESCE(paid_amount, 0) > 0 LIMIT 1`,
        [purchaseOrderId]
      );
      if (paidInv.rows.length > 0) {
        const e: Error & { statusCode?: number } = new Error(
          `Extourne impossible : la facture ${paidInv.rows[0].invoice_number} a deja un paiement enregistre.`);
        e.statusCode = 409; throw e;
      }

      // ── Garde-fou 2 : lot déjà entamé ──
      const consumed = await client.query(
        `SELECT COALESCE(ing.name, '?') AS ingredient_name, il.lot_number
         FROM ingredient_lots il
         JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
         LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
         WHERE rvi.reception_voucher_id = ANY($1::uuid[])
           AND il.status <> 'reversed'
           AND il.quantity_remaining < il.quantity_received - 0.0001
         LIMIT 1`,
        [rvIds]
      );
      if (consumed.rows.length > 0) {
        const e: Error & { statusCode?: number } = new Error(
          `Extourne impossible : le lot ${consumed.rows[0].lot_number} de "${consumed.rows[0].ingredient_name}" a deja ete ` +
          `partiellement consomme. Corrigez la ligne de reception plutot que d'extourner le bon.`);
        e.statusCode = 409; throw e;
      }

      // ── Facture auto : extourne comptable puis annulation (jamais de suppression) ──
      const invs = await client.query(
        `SELECT id FROM invoices WHERE purchase_order_id = $1 AND status != 'cancelled'`,
        [purchaseOrderId]
      );
      for (const inv of invs.rows) {
        if (FLAGS.LEDGER_AUTOGEN) {
          await reverseEntriesForSource(
            client as unknown as import('pg').PoolClient,
            { sourceId: inv.id as string, sourceKinds: ['invoice', 'backfill'] }
          );
        }
        await client.query(
          `UPDATE invoices SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`,
          [inv.id, `Annulée : extourne de la réception du BC ${po.order_number}`]);
      }

      let fallbackStoreId: string | null = null;
      const reversalNumbers: string[] = [];

      for (const rv of rvs.rows) {
        // Bon miroir numéroté.
        const number = await this.generateVoucherNumber(client);
        const mirror = await client.query(
          `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, notes, received_by, store_id, voucher_kind, reverses_voucher_id)
           VALUES ($1, $2, $3, $4, $5, 'reversal', $6) RETURNING id`,
          [number, purchaseOrderId, `Extourne de ${rv.voucher_number}`, userId, rv.store_id ?? null, rv.id]
        );
        const mirrorId = mirror.rows[0].id as string;
        reversalNumbers.push(number as string);

        // Lignes encore actives du bon (quantité signée nette > 0 par ligne d'origine).
        const lines = await client.query(
          `SELECT o.id, o.purchase_order_item_id, o.ingredient_id, o.packaging_id, o.unit_price,
                  o.quantity_received + COALESCE((SELECT SUM(c.signed_quantity) FROM reception_voucher_items c WHERE c.parent_item_id = o.id), 0) AS net_qty
             FROM reception_voucher_items o
            WHERE o.reception_voucher_id = $1 AND o.kind = 'receive'`,
          [rv.id]
        );
        for (const l of lines.rows) {
          const qty = parseFloat(l.net_qty as string);
          if (!(qty > 0.0001)) continue;
          await client.query(
            `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, packaging_id,
                                                 quantity_received, unit_price, kind, parent_item_id, reason_code_id, created_by, notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'reverse', $7, $8, $9, $10)`,
            [mirrorId, l.purchase_order_item_id, l.ingredient_id, l.packaging_id, qty, l.unit_price, l.id,
             reason.reasonCodeId, userId, reason.note ?? null]
          );

          if (l.packaging_id) {
            let storeId = (rv.store_id as string | null);
            if (!storeId) {
              if (!fallbackStoreId) fallbackStoreId = (await client.query(`SELECT id FROM stores ORDER BY created_at LIMIT 1`)).rows[0]?.id ?? null;
              storeId = fallbackStoreId;
            }
            if (!storeId) {
              const e: Error & { statusCode?: number } = new Error('Aucun magasin disponible pour extourner le stock consommable.');
              e.statusCode = 400; throw e;
            }
            await packagingItemRepository.adjustStock(client as unknown as import('pg').PoolClient, {
              packagingId: l.packaging_id as string, storeId, change: -qty, type: 'adjustment',
              referenceId: purchaseOrderId, referenceType: 'purchase_order',
              note: `Extourne ${number} de la réception ${rv.voucher_number} — BC ${po.order_number}`,
              performedBy: userId,
            });
          } else if (l.ingredient_id) {
            // Le lot passe « reversed » à zéro : le trigger des lots recalcule le stock.
            const lot = await client.query(
              `UPDATE ingredient_lots
                  SET economat_quantity = 0, pesage_quantity = 0, status = 'reversed',
                      status_reason_code_id = $2, status_changed_by = $3, status_changed_at = NOW()
                WHERE reception_voucher_item_id = $1 AND status <> 'reversed'
                RETURNING id`,
              [l.id, reason.reasonCodeId, userId]
            );
            await client.query(
              `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, purchase_order_item_id, reception_voucher_id, store_id, ingredient_lot_id)
               VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7, $8)`,
              [l.ingredient_id, -qty, `Extourne ${number} de la réception ${rv.voucher_number} — BC ${po.order_number}`,
               userId, l.purchase_order_item_id, mirrorId, rv.store_id ?? null, lot.rows[0]?.id ?? null]
            );
          }
        }

        await client.query(
          `UPDATE reception_vouchers SET status = 'reversed', reversed_by = $2, reversed_at = NOW(),
                  reverse_reason_code_id = $3, reverse_note = $4 WHERE id = $1`,
          [rv.id, userId, reason.reasonCodeId, reason.note ?? null]
        );
      }

      // Écarts hors réception repris en mig 307 et reliquats clôturés : extournés aussi,
      // pour que le BC revienne exactement à « rien reçu ».
      await client.query(
        `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_by, note)
         SELECT poi.id, 'LEGACY_ADJUST', -1, poi.qty_received_base, 'reception_cancel', gen_random_uuid(), $2,
                'extourne de la réception : reçu hors bon de réception'
           FROM purchase_order_items poi
          WHERE poi.purchase_order_id = $1 AND poi.qty_received_base > 0.0001`,
        [purchaseOrderId, userId]
      );
      await client.query(
        `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_by, note)
         SELECT poi.id, 'CANCEL_REVERSAL', -1, poi.qty_cancelled_base, 'reception_cancel', gen_random_uuid(), $2,
                'extourne de la réception : reliquat rouvert'
           FROM purchase_order_items poi
          WHERE poi.purchase_order_id = $1 AND poi.qty_cancelled_base > 0.0001`,
        [purchaseOrderId, userId]
      );

      await client.query(
        `UPDATE purchase_orders SET status = 'envoye', delivery_date = NULL, updated_at = NOW() WHERE id = $1`,
        [purchaseOrderId]
      );
      await closePurchaseRequestsForOrder(client, purchaseOrderId);
      // GR/IR (mig 311) : les lignes miroir annulent en 4417 les réceptions comptabilisées.
      await postGoodsReceiptsForPo(client as unknown as import('pg').PoolClient, purchaseOrderId, userId);

      await client.query('COMMIT');
      return { purchaseOrderId, reversedVouchers: rvs.rows.map((r: Record<string, unknown>) => r.voucher_number), reversalNumbers };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Correction d'une ligne de réception (mig 308) : nouvelle ligne correct_up / correct_down
   * rattachée à la dernière réception de la ligne de BC. Le lot d'origine est ajusté (une baisse
   * ne peut pas dépasser ce qui reste à l'économat), un mouvement d'ajustement est tracé, la ligne
   * de BC reçoit son événement. Refusée si le BC est déjà facturé (correction à faire côté facture).
   */
  async correctReceiptLine(purchaseOrderId: string, poLineId: string, delta: number, reason: { reasonCodeId: string; note?: string | null }, userId: string, isAdmin: boolean) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.change_origin', 'receipt', true)`);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const fail = (code: number, msg: string) => { const e: Error & { statusCode?: number } = new Error(msg); e.statusCode = code; return e; };

      if (!(Math.abs(delta) > 0.0001)) throw fail(400, 'Indiquez la quantité à ajouter ou à retirer');
      const reasonOk = await client.query(
        `SELECT 1 FROM ref_entries WHERE id = $1 AND table_id = 'purchase_reason_codes' AND is_active AND metadata->'scope' ? 'correct'`,
        [reason.reasonCodeId]);
      if (!reasonOk.rowCount) throw fail(400, 'Motif invalide pour une correction de réception');

      const po = (await client.query(`SELECT id, order_number, status FROM purchase_orders WHERE id = $1 FOR UPDATE`, [purchaseOrderId])).rows[0];
      if (!po) throw fail(404, 'Bon de commande non trouve');
      const inv = await client.query(`SELECT invoice_number FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled' LIMIT 1`, [purchaseOrderId]);
      if (inv.rowCount) throw fail(409, `Le BC ${po.order_number} est facturé (${inv.rows[0].invoice_number}) : la correction se fait sur la facture`);

      const orig = (await client.query(
        `SELECT rvi.*, rv.voucher_number, rv.store_id, rv.created_at AS rv_created_at
           FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
          WHERE rvi.purchase_order_item_id = $1 AND rvi.kind = 'receive' AND rv.status = 'posted' AND rv.purchase_order_id = $2
          ORDER BY rv.created_at DESC LIMIT 1 FOR UPDATE OF rvi`,
        [poLineId, purchaseOrderId])).rows[0];
      if (!orig) throw fail(409, 'Aucune réception active sur cette ligne');

      if (!isAdmin) {
        const win = (await client.query(`SELECT COALESCE((value->>'hours')::int, 72) AS h FROM module_parameters WHERE key = 'purchasing.receipt_correction_window_hours'`)).rows[0]?.h ?? 72;
        const ageH = (Date.now() - new Date(orig.rv_created_at).getTime()) / 3_600_000;
        if (ageH > win) throw fail(409, `Délai de correction dépassé (${win} h) : demandez à un administrateur`);
      }

      const qty = Math.abs(delta);
      const kind = delta > 0 ? 'correct_up' : 'correct_down';
      if (orig.ingredient_id) {
        const lot = (await client.query(`SELECT id, economat_quantity, lot_number FROM ingredient_lots WHERE reception_voucher_item_id = $1 FOR UPDATE`, [orig.id])).rows[0];
        if (!lot) throw fail(409, 'Lot de réception introuvable');
        if (delta < 0 && Number(lot.economat_quantity) < qty - 0.0001) {
          throw fail(409, `Le lot ${lot.lot_number} n'a plus que ${Number(lot.economat_quantity)} à l'économat : correction maximale −${Number(lot.economat_quantity)}`);
        }
        await client.query(
          `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price,
                                               kind, parent_item_id, reason_code_id, created_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [orig.reception_voucher_id, poLineId, orig.ingredient_id, qty, orig.unit_price, kind, orig.id, reason.reasonCodeId, userId, reason.note ?? null]
        );
        await client.query(
          `UPDATE ingredient_lots SET economat_quantity = economat_quantity + $2,
                  quantity_received = quantity_received + $2 WHERE id = $1`,
          [lot.id, delta]
        );
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, purchase_order_item_id, reception_voucher_id, store_id, ingredient_lot_id)
           VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7, $8)`,
          [orig.ingredient_id, delta, `Correction de la réception ${orig.voucher_number} — BC ${po.order_number}`,
           userId, poLineId, orig.reception_voucher_id, orig.store_id ?? null, lot.id]
        );
      } else if (orig.packaging_id) {
        await client.query(
          `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, packaging_id, quantity_received, unit_price,
                                               kind, parent_item_id, reason_code_id, created_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [orig.reception_voucher_id, poLineId, orig.packaging_id, qty, orig.unit_price, kind, orig.id, reason.reasonCodeId, userId, reason.note ?? null]
        );
        const storeId = orig.store_id ?? (await client.query(`SELECT id FROM stores ORDER BY created_at LIMIT 1`)).rows[0]?.id;
        await packagingItemRepository.adjustStock(client as unknown as import('pg').PoolClient, {
          packagingId: orig.packaging_id as string, storeId, change: delta, type: 'adjustment',
          referenceId: purchaseOrderId, referenceType: 'purchase_order',
          note: `Correction de la réception ${orig.voucher_number} — BC ${po.order_number}`, performedBy: userId,
        });
      }

      // Statut de livraison recalculé par la règle en base (mig 307).
      const st = (await client.query(`SELECT fn_po_delivery_status($1) AS s`, [purchaseOrderId])).rows[0].s as string;
      const next = st === 'en_attente' ? po.status : st;
      await client.query(`UPDATE purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1 AND status IS DISTINCT FROM $2`, [purchaseOrderId, next]);
      await closePurchaseRequestsForOrder(client, purchaseOrderId);
      await postGoodsReceiptsForPo(client as unknown as import('pg').PoolClient, purchaseOrderId, userId);
      let autoInvoice = null;
      if (next === 'livre_complet') autoInvoice = await createInvoiceFromPo(client, purchaseOrderId, null, userId, null);

      await client.query('COMMIT');
      return { purchaseOrderId, status: next, kind, quantity: qty, autoInvoice };
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
