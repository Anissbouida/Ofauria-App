import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { inventoryRepository, ingredientRepository } from '../repositories/inventory.repository.js';
import { ingredientLotRepository } from '../repositories/ingredient-lot.repository.js';
import { db } from '../config/database.js';

export const inventoryController = {
  async list(req: AuthRequest, res: Response) {
    const items = await inventoryRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: items });
  },
  async alerts(req: AuthRequest, res: Response) {
    const alerts = await inventoryRepository.findAlerts(req.user!.storeId);
    res.json({ success: true, data: alerts });
  },
  async restock(req: AuthRequest, res: Response) {
    const { ingredientId, quantity, note, supplierLotNumber, expirationDate, manufacturedDate } = req.body;
    if (!ingredientId || !quantity || quantity <= 0) {
      res.status(400).json({ success: false, error: { message: 'Ingredient et quantite requis' } });
      return;
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Update inventory quantity
      const storeFilter = req.user!.storeId ? ' AND store_id = $3' : '';
      const params: unknown[] = [quantity, ingredientId];
      if (req.user!.storeId) params.push(req.user!.storeId);
      await client.query(
        `UPDATE inventory SET current_quantity = current_quantity + $1, last_restocked_at = NOW(), updated_at = NOW()
         WHERE ingredient_id = $2${storeFilter}`,
        params
      );

      // Get ingredient info for lot cost
      const ingResult = await client.query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ingredientId]);
      const unitCost = ingResult.rows[0]?.unit_cost ? parseFloat(ingResult.rows[0].unit_cost) : null;

      // Create ingredient lot for ONSSA traceability
      const lotResult = await client.query(
        `INSERT INTO ingredient_lots (ingredient_id, supplier_lot_number,
          quantity_received, quantity_remaining, unit_cost, manufactured_date, expiration_date, received_at, store_id)
         VALUES ($1, $2, $3, $3, $4, $5, $6, CURRENT_DATE, $7) RETURNING id`,
        [ingredientId, supplierLotNumber || null,
         quantity, unitCost, manufacturedDate || null, expirationDate || null,
         req.user!.storeId || null]
      );

      // Record transaction with lot traceability
      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
         VALUES ($1, 'restock', $2, $3, $4, $5, $6)`,
        [ingredientId, quantity, note || `Restockage direct — Lot fournisseur: ${supplierLotNumber || 'N/A'}`,
         req.user!.userId, req.user!.storeId || null, lotResult.rows[0].id]
      );

      await client.query('COMMIT');
      res.json({ success: true, data: { supplierLotNumber } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async adjust(req: AuthRequest, res: Response) {
    const { ingredientId, quantity, type = 'adjustment', note } = req.body;

    // Whitelist types acceptes (doit matcher la contrainte DB
    // inventory_transactions_type_check).
    const ALLOWED_TYPES = new Set(['restock', 'usage', 'adjustment', 'waste', 'recycle', 'production']);
    if (!ingredientId || quantity === undefined || Number.isNaN(Number(quantity))) {
      res.status(400).json({ success: false, error: { message: 'Ingredient et quantite requis' } });
      return;
    }
    if (!ALLOWED_TYPES.has(type)) {
      res.status(400).json({
        success: false,
        error: { message: `Type d'ajustement invalide (valeurs: ${[...ALLOWED_TYPES].join(', ')})` },
      });
      return;
    }
    const qty = Number(quantity);
    if (Math.abs(qty) > 1_000_000) {
      res.status(400).json({ success: false, error: { message: 'Quantite demesuree' } });
      return;
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const storeId = req.user!.storeId || null;

      // Source de verite = ingredient_lots (depuis migration 114). On verifie le stock
      // dispo via SUM des lots actifs et on manipule les lots — le trigger
      // trg_inventory_sync_lots maintient inventory.current_quantity automatiquement.
      const totalRes = await client.query(
        `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0)::numeric AS total
         FROM ingredient_lots
         WHERE ingredient_id = $1 AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'}
           AND status = 'active'`,
        storeId ? [ingredientId, storeId] : [ingredientId]
      );
      const current = parseFloat(totalRes.rows[0]?.total || '0');

      if (qty < 0 && current + qty < 0) {
        await client.query('ROLLBACK');
        res.status(409).json({
          success: false,
          error: { message: `Stock insuffisant (disponible: ${current}, demande: ${Math.abs(qty)})` },
        });
        return;
      }

      if (qty > 0) {
        // Ajustement positif : cree un lot d'ajustement (economat). Pas de fournisseur,
        // pas de DLC. Marque par lot_number 'ADJ-YYMMDD-NNN' pour audit.
        const now = new Date();
        const yymmdd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const seqRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM ingredient_lots WHERE lot_number LIKE $1`,
          [`ADJ-${yymmdd}-%`]
        );
        const seq = String((seqRes.rows[0]?.n ?? 0) + 1).padStart(3, '0');
        const lotNumber = `ADJ-${yymmdd}-${seq}`;

        await client.query(
          `INSERT INTO ingredient_lots
             (ingredient_id, store_id, lot_number, quantity_received, quantity_remaining,
              economat_quantity, pesage_quantity, status, notes)
           VALUES ($1, $2, $3, $4, $4, $4, 0, 'active', $5)`,
          [ingredientId, storeId, lotNumber, qty,
           `Ajustement positif (${type}) : ${note || 'sans motif'}`]
        );
      } else if (qty < 0) {
        // Ajustement negatif : decremente FIFO sur les lots actifs (economat puis pesage).
        // Choix : pesage en premier (stock en cours d'utilisation, plus probable d'etre
        // l'origine d'un ecart d'inventaire), puis economat.
        let remaining = -qty;  // qty est negatif, on retire |qty|
        const lotsRes = await client.query(
          `SELECT id, economat_quantity, pesage_quantity
           FROM ingredient_lots
           WHERE ingredient_id = $1 AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'}
             AND status = 'active' AND (economat_quantity + pesage_quantity) > 0
           ORDER BY received_at ASC, created_at ASC
           FOR UPDATE`,
          storeId ? [ingredientId, storeId] : [ingredientId]
        );

        for (const lot of lotsRes.rows) {
          if (remaining <= 0) break;
          const pesage = parseFloat(lot.pesage_quantity);
          const economat = parseFloat(lot.economat_quantity);
          const takePesage = Math.min(pesage, remaining);
          remaining -= takePesage;
          const takeEconomat = Math.min(economat, remaining);
          remaining -= takeEconomat;
          if (takePesage > 0 || takeEconomat > 0) {
            await client.query(
              `UPDATE ingredient_lots
               SET pesage_quantity = pesage_quantity - $1,
                   economat_quantity = economat_quantity - $2
               WHERE id = $3`,
              [takePesage, takeEconomat, lot.id]
            );
          }
        }
        // Si remaining > 0 ici, c'est qu'on a ete en concurrence — peu probable car FOR UPDATE.
        if (remaining > 0.0001) {
          throw new Error(`Decrement impossible : ${remaining.toFixed(4)} restant non couvert`);
        }
      }
      // qty === 0 : no-op stock, mais on garde l'audit transaction.

      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ingredientId, type, qty, note || null, req.user!.userId, storeId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true, data: null });
  },
  async updateThreshold(req: AuthRequest, res: Response) {
    const { ingredientId, threshold } = req.body;
    if (!ingredientId || threshold === undefined) {
      res.status(400).json({ success: false, error: { message: 'Donnees manquantes' } });
      return;
    }
    const storeFilter = req.user!.storeId ? ' AND store_id = $3' : '';
    const params: unknown[] = [threshold, ingredientId];
    if (req.user!.storeId) params.push(req.user!.storeId);
    await db.query(
      `UPDATE inventory SET minimum_threshold = $1, updated_at = NOW()
       WHERE ingredient_id = $2${storeFilter}`,
      params
    );
    res.json({ success: true, data: null });
  },
  async transactions(req: AuthRequest, res: Response) {
    const { ingredientId } = req.query as Record<string, string>;
    const transactions = await inventoryRepository.getTransactions(ingredientId, 50, req.user!.storeId);
    res.json({ success: true, data: transactions });
  },
};

export const ingredientController = {
  async list(_req: AuthRequest, res: Response) {
    const ingredients = await ingredientRepository.findAll();
    res.json({ success: true, data: ingredients });
  },
  async getById(req: AuthRequest, res: Response) {
    const ingredient = await ingredientRepository.findById(req.params.id);
    if (!ingredient) { res.status(404).json({ success: false, error: { message: 'Ingrédient non trouvé' } }); return; }
    res.json({ success: true, data: ingredient });
  },
  async create(req: AuthRequest, res: Response) {
    try {
      const ingredient = await ingredientRepository.create(req.body);
      res.status(201).json({ success: true, data: ingredient });
    } catch (err) {
      console.error('Error creating ingredient:', err);
      res.status(400).json({ success: false, error: { message: 'Erreur lors de la création' } });
    }
  },
  async update(req: AuthRequest, res: Response) {
    try {
      const ingredient = await ingredientRepository.update(req.params.id, req.body);
      res.json({ success: true, data: ingredient });
    } catch (err) {
      console.error('Error updating ingredient:', err);
      res.status(400).json({ success: false, error: { message: 'Erreur lors de la mise à jour' } });
    }
  },
  async remove(req: AuthRequest, res: Response) {
    try {
      await ingredientRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      console.error('Error deleting ingredient:', err);
      res.status(400).json({ success: false, error: { message: 'Erreur lors de la suppression' } });
    }
  },
};
