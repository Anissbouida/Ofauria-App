import { ingredientAllergensRepository } from '../repositories/ingredient-allergens.repository.js';
import { ingredientCostCorrectionRepository } from '../repositories/ingredient-cost-correction.repository.js';
import { ingredientMergeRepository } from '../repositories/ingredient-merge.repository.js';
import type { Response } from 'express';
import { stockAnomalyRepository } from '../services/stock-anomaly.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { inventoryRepository, ingredientRepository } from '../repositories/inventory.repository.js';
import { ingredientLotRepository } from '../repositories/ingredient-lot.repository.js';
import { db } from '../config/database.js';
import { adjustIngredientStock } from '../services/stock-adjust.js';
import { allergensSchema } from '../validators/allergens.js';
import { stockValuationRepository } from '../repositories/stock-valuation.repository.js';
import { localIsoDate } from '../utils/local-date.js';

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

      // Entrée en stock unique (L3 P2P inc 5, mig 463) : le lot reçoit un coût
      // garanti (= CMUP courant) et le CMUP est recalculé (inchangé ici, on entre
      // au coût moyen courant). Remplace l'INSERT direct + lecture de coût.
      const lotResult = await client.query(
        `SELECT fn_stock_receipt($1, $2, $3, NULL, NULL, $4, $5, $6, $7) AS id`,
        [ingredientId, req.user!.storeId || null, quantity, supplierLotNumber || null,
         note || `Restockage direct — Lot fournisseur: ${supplierLotNumber || 'N/A'}`,
         manufacturedDate || null, expirationDate || null]
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
    // Motif d'une perte (referentiel material_loss_reasons, mig 333) ; ignore pour les autres types.
    const reasonCode = type === 'waste'
      ? (typeof req.body?.reasonCode === 'string' && /^[a-z0-9_]{1,40}$/.test(req.body.reasonCode) ? req.body.reasonCode : 'autre')
      : null;

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
      // Lots (source de vérité) + transaction : service partagé avec l'inventaire physique (mig 367).
      const r = await adjustIngredientStock(client, { ingredientId, storeId, qty, type, note, userId: req.user!.userId, reasonCode });
      if (!r.ok) {
        await client.query('ROLLBACK');
        res.status(409).json({ success: false, error: { message: `Stock insuffisant (disponible: ${r.available}, demande: ${Math.abs(qty)})` } });
        return;
      }
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
    // Robustesse (bug "seuil non retenu") : l'ancien code faisait un simple
    // UPDATE ... WHERE ingredient_id = $2 AND store_id = $3. Quand la ligne
    // inventory etait absente (ingredient jamais stocke) ou rattachee a un
    // store_id NULL (lignes legacy du seed), l'UPDATE ne touchait 0 ligne et on
    // renvoyait quand meme success => le seuil n'etait jamais persiste. On
    // upsert desormais, en rapatriant au passage une eventuelle ligne orpheline.
    const storeId = req.user!.storeId ?? null;
    if (storeId) {
      // 1) Rattache une ligne legacy orpheline (store NULL) au store courant,
      //    sauf si une ligne existe deja pour ce couple (contrainte d'unicite).
      //    Preserve current_quantity : la ligne devient visible sous le store.
      await db.query(
        `UPDATE inventory SET store_id = $1
           WHERE ingredient_id = $2 AND store_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM inventory b WHERE b.ingredient_id = $2 AND b.store_id = $1
             )`,
        [storeId, ingredientId]
      );
      // 2) Upsert du seuil pour (store, ingredient) : cree la ligne si absente.
      await db.query(
        `INSERT INTO inventory (ingredient_id, store_id, minimum_threshold)
           VALUES ($2, $1, $3)
         ON CONFLICT (store_id, ingredient_id)
           DO UPDATE SET minimum_threshold = EXCLUDED.minimum_threshold, updated_at = NOW()`,
        [storeId, ingredientId, threshold]
      );
    } else {
      // Admin sans store : met a jour toutes les lignes de l'ingredient ;
      // si aucune n'existe, en cree une (store NULL, comme la creation legacy).
      const r = await db.query(
        `UPDATE inventory SET minimum_threshold = $1, updated_at = NOW()
         WHERE ingredient_id = $2`,
        [threshold, ingredientId]
      );
      if (r.rowCount === 0) {
        await db.query(
          `INSERT INTO inventory (ingredient_id, store_id, minimum_threshold)
           VALUES ($1, NULL, $2)`,
          [ingredientId, threshold]
        );
      }
    }
    res.json({ success: true, data: null });
  },
  async transactions(req: AuthRequest, res: Response) {
    const { ingredientId } = req.query as Record<string, string>;
    const transactions = await inventoryRepository.getTransactions(ingredientId, 50, req.user!.storeId);
    res.json({ success: true, data: transactions });
  },
  /**
   * GET /inventory/consumption?dateFrom=...&dateTo=...
   * Renvoie les sorties de stock agregees par (ingredient, type de mouvement)
   * pour la periode. Utilise par l'onglet "Consommation matieres" du module
   * Comptabilite — vue distincte du cash-out, base sur les mouvements physiques.
   */
  async consumption(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const rows = await inventoryRepository.findMaterialConsumption({
      dateFrom, dateTo, storeId: req.user!.storeId,
    });
    res.json({ success: true, data: rows });
  },
  /**
   * GET /inventory/purchases?dateFrom=...&dateTo=...
   * Renvoie les ENTREES de stock (matiere premiere achetee/receptionnee via BC
   * ou achat direct) agregees par (article, origine) pour la periode. Vue
   * "montant depense" valorise au prix de reception — l'inverse de consumption.
   */
  async purchases(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const rows = await inventoryRepository.findMaterialPurchases({
      dateFrom, dateTo, storeId: req.user!.storeId,
    });
    res.json({ success: true, data: rows });
  },
  /**
   * GET /inventory/aging
   * Âge du stock matière : lots actifs encore en stock classés par ancienneté,
   * avec valeur et DLC. Résumé par tranche (0-30 / 31-60 / 61-90 / 90+) sur la
   * valeur, pour repérer les lots dormants et les risques de perte.
   */
  async aging(req: AuthRequest, res: Response) {
    const data = await inventoryRepository.stockAging(req.user!.storeId);
    res.json({ success: true, data });
  },
  /** GET /inventory/stock-anomalies?status=open|resolved — sorties supérieures au stock (G0-18). */
  async anomalies(req: AuthRequest, res: Response) {
    const status = req.query.status === 'open' || req.query.status === 'resolved' ? req.query.status : undefined;
    res.json({ success: true, data: await stockAnomalyRepository.list({ status, storeId: req.user!.storeId }) });
  },
  /** POST /inventory/stock-anomalies/:id/resolve — clôt une anomalie avec son motif. */
  async resolveAnomaly(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await stockAnomalyRepository.resolve(req.params.id, req.body.note, req.user!.userId) });
  },
  /** GET /inventory/cost-corrections/suspects — prix à revoir, avec les dernières réceptions et une proposition (G2-04). */
  async costSuspects(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await ingredientCostCorrectionRepository.suspects() });
  },
  /** POST /inventory/cost-corrections — corrige un coût unitaire avec son motif (G2-04). */
  async correctCost(req: AuthRequest, res: Response) {
    const out = await ingredientCostCorrectionRepository.correct(req.body.ingredientId, req.body.newCost, req.body.reason, req.user!.userId);
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out });
  },
  /** GET /inventory/cost-corrections — journal des corrections de coût. */
  async costCorrections(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await ingredientCostCorrectionRepository.history() });
  },
  /** POST /inventory/ingredient-merges/preview — ce que ferait la fusion de deux fiches (G2-03), sans rien écrire. */
  async mergePreview(req: AuthRequest, res: Response) {
    const out = await ingredientMergeRepository.preview(req.body.sourceId, req.body.targetId);
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out });
  },
  /** POST /inventory/ingredient-merges — fusionne la fiche en trop dans la fiche gardée (G2-03). Tout ou rien. */
  async mergeIngredients(req: AuthRequest, res: Response) {
    const out = await ingredientMergeRepository.merge(req.body.sourceId, req.body.targetId, req.user!.userId);
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out });
  },
  /** GET /inventory/ingredient-merges — journal des fusions. */
  async mergeHistory(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await ingredientMergeRepository.history() });
  },
  /** GET /inventory/unit-conversion-issues — lignes de fiche dont l'unité ne se convertit pas (G0-26). */
  async unitConversionIssues(_req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT source, line_id, recipe_id, recipe_name, format_id, ingredient_id, ingredient_name,
              line_unit, stock_unit, densite_kg_l::float8 AS densite_kg_l, quantity::float8 AS quantity
         FROM v_impossible_unit_conversions ORDER BY recipe_name, ingredient_name LIMIT 500`);
    res.json({ success: true, data: r.rows });
  },
  /** GET /inventory/price-health — anomalies de prix catalogue (mig 406, lot prix P5). */
  async priceHealth(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await ingredientRepository.priceHealth() });
  },
  /* ── Clôture de stock par période (mig 381) ── */
  /** GET /inventory/closings/preview — valorisation courante (avant de clôturer). */
  /** GET /inventory/stock-at?date=AAAA-MM-JJ[&format=csv] — stock valorisé à la fin d'une date (G5-01). */
  async stockAt(req: AuthRequest, res: Response) {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : localIsoDate(new Date());
    const data = await stockValuationRepository.stockAt(date, req.user!.storeId ?? null);
    if (req.query.format === 'csv') {
      const num = (n: number, d = 2) => n.toFixed(d).replace('.', ',');
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const rows = [['Article', 'Unité', 'Quantité', 'Coût unitaire', 'Valeur'].join(';'),
        ...data.lines.map(l => [esc(l.ingredient_name), l.unit, num(l.quantity, 3), num(l.unit_cost, 4), num(l.value)].join(';')),
        ['Total', '', '', '', num(data.total)].join(';')];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="stock-valorise-${date}.csv"`);
      res.send('\ufeff' + rows.join('\r\n'));
      return;
    }
    res.json({ success: true, data });
  },
  /** GET /inventory/stock-journal-gaps — articles dont le journal n'explique pas le stock (G5-01). */
  async journalGaps(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await stockValuationRepository.journalGaps(req.user!.storeId ?? null) });
  },
  async closingPreview(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await inventoryRepository.stockValuation(req.user!.storeId) });
  },
  /** GET /inventory/closings — liste des clôtures. */
  async closingList(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await inventoryRepository.listStockClosings(req.user!.storeId) });
  },
  /** GET /inventory/closings/:id — détail (lignes valorisées figées). */
  async closingGet(req: AuthRequest, res: Response) {
    const data = await inventoryRepository.getStockClosing(req.params.id);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Clôture introuvable' } }); return; }
    res.json({ success: true, data });
  },
  /** POST /inventory/closings — fige la valorisation pour une période. */
  async closingCreate(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.periodLabel || !b.closingDate) {
      res.status(400).json({ success: false, error: { message: 'Libellé de période et date requis' } });
      return;
    }
    const data = await inventoryRepository.createStockClosing({
      periodLabel: String(b.periodLabel), closingDate: String(b.closingDate),
      storeId: req.user!.storeId ?? null, notes: b.notes ? String(b.notes) : null, userId: req.user!.userId,
    });
    res.json({ success: true, data });
  },
  /** DELETE /inventory/closings/:id — rouvre (supprime l'instantané). */
  async closingDelete(req: AuthRequest, res: Response) {
    await inventoryRepository.deleteStockClosing(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const ingredientController = {
  /** GET /ingredients/allergen-grid — fiches et leurs allergènes, avec une proposition pour les non renseignées (G2-06). */
  async allergenGrid(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await ingredientAllergensRepository.grid({ onlyMissing: req.query.missing === '1' }) });
  },
  /** PUT /ingredients/:id/allergens — enregistre « contient » et « traces » et marque la fiche vérifiée (G2-06). */
  async saveAllergens(req: AuthRequest, res: Response) {
    const out = await ingredientAllergensRepository.save(req.params.id as string, req.body, req.user!.userId);
    if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
    res.json({ success: true, data: out });
  },
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
      // Allergenes : referentiel ferme (mig 344). Les synonymes sont normalises,
      // une valeur inconnue est refusee avec la liste admise.
      const allergens = allergensSchema.safeParse(req.body?.allergens);
      if (!allergens.success) {
        res.status(400).json({ success: false, error: { message: allergens.error.issues.map(i => i.message).join(', ') } });
        return;
      }
      const ingredient = await ingredientRepository.create({
        ...req.body,
        ...(allergens.data !== undefined ? { allergens: allergens.data } : {}),
        storeId: req.user!.storeId || null,
      });
      res.status(201).json({ success: true, data: ingredient });
    } catch (err) {
      console.error('Error creating ingredient:', err);
      res.status(400).json({ success: false, error: { message: 'Erreur lors de la création' } });
    }
  },
  async update(req: AuthRequest, res: Response) {
    try {
      const allergens = allergensSchema.safeParse(req.body?.allergens);
      if (!allergens.success) {
        res.status(400).json({ success: false, error: { message: allergens.error.issues.map(i => i.message).join(', ') } });
        return;
      }
      const ingredient = await ingredientRepository.update(req.params.id, {
        ...req.body,
        ...(allergens.data !== undefined ? { allergens: allergens.data } : {}),
      });
      res.json({ success: true, data: ingredient });
    } catch (err) {
      console.error('Error updating ingredient:', err);
      res.status(400).json({ success: false, error: { message: 'Erreur lors de la mise à jour' } });
    }
  },
  async convertToConsumable(req: AuthRequest, res: Response) {
    try {
      const { categoryId } = req.body as { categoryId?: string | null };
      const result = await ingredientRepository.convertToConsumable(
        req.params.id, categoryId || null, req.user!.storeId || null, req.user!.userId,
      );
      if (!result.ok) {
        res.status(409).json({ success: false, error: { message: result.reason } });
        return;
      }
      res.json({ success: true, data: { packagingId: result.packagingId, transferredQty: result.transferredQty } });
    } catch (err) {
      console.error('Error converting ingredient to consumable:', err);
      const msg = err instanceof Error ? err.message : 'Erreur lors de la conversion';
      res.status(500).json({ success: false, error: { message: msg } });
    }
  },
  async remove(req: AuthRequest, res: Response) {
    try {
      const force = req.query.force === 'true' || req.query.force === '1';
      const result = await ingredientRepository.delete(req.params.id, { force });
      if (!result.ok) {
        // Blocage metier (recette active, stock restant sans force…) — 409 Conflict.
        // On expose activeStock pour permettre au client de proposer "Forcer".
        res.status(409).json({
          success: false,
          error: {
            message: result.reason,
            activeStock: result.activeStock,
          },
        });
        return;
      }
      res.json({ success: true, data: { wastedQty: result.wastedQty ?? 0 } });
    } catch (err) {
      console.error('Error deleting ingredient:', err);
      const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      res.status(500).json({ success: false, error: { message: msg } });
    }
  },
};
