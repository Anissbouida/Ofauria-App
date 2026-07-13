import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { reconciliationRepository } from '../repositories/reconciliation.repository.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Magasin de rattachement : celui de l'utilisateur (null pour un admin global). */
function storeOf(req: AuthRequest): string | null {
  return req.user!.storeId ?? null;
}

export const reconciliationController = {
  // ─── Journees ──────────────────────────────────────────────────────────

  async listDays(req: AuthRequest, res: Response) {
    const { from, to } = req.query as Record<string, string>;
    const rows = await reconciliationRepository.listDays({ from, to, storeId: storeOf(req) });
    res.json({ success: true, data: rows });
  },

  async getDay(req: AuthRequest, res: Response) {
    const day = await reconciliationRepository.getDayById(req.params.id);
    if (!day) { res.status(404).json({ success: false, error: { message: 'Journee introuvable' } }); return; }
    res.json({ success: true, data: day });
  },

  /** Ouvre (ou recupere) la journee pour une date. Body: { date } */
  async openDay(req: AuthRequest, res: Response) {
    const { date } = req.body as { date?: string };
    if (!date || !DATE_RE.test(date)) { res.status(400).json({ success: false, error: { message: 'Date invalide (AAAA-MM-JJ)' } }); return; }
    const day = await reconciliationRepository.openDay({ date, storeId: storeOf(req), userId: req.user!.userId });
    res.json({ success: true, data: day });
  },

  /** Cloture. Garde-fou : refuse si aucune vente importee, sauf force=true. */
  async close(req: AuthRequest, res: Response) {
    const force = req.body?.force === true || (req.query.force as string) === 'true';
    if (!force) {
      const nSales = await reconciliationRepository.countSales(req.params.id);
      if (nSales === 0) {
        res.status(409).json({
          success: false,
          error: { code: 'NO_SALES', message: 'Aucune vente importee pour cette journee. Importer Loyverse avant de cloturer, ou forcer la cloture.' },
        });
        return;
      }
    }
    const day = await reconciliationRepository.setStatus(req.params.id, 'closed');
    if (!day) { res.status(404).json({ success: false, error: { message: 'Journee introuvable' } }); return; }
    res.json({ success: true, data: day });
  },

  async reopen(req: AuthRequest, res: Response) {
    const day = await reconciliationRepository.setStatus(req.params.id, 'open');
    if (!day) { res.status(404).json({ success: false, error: { message: 'Journee introuvable' } }); return; }
    res.json({ success: true, data: day });
  },

  // ─── Lignes ────────────────────────────────────────────────────────────

  /** Cree/maj une ligne. Body: { productName, sku?, category?, approQty?, invenduQty?, unitPrice? } */
  async upsertLine(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const productName = String(b.productName ?? '').trim();
    if (!productName) { res.status(400).json({ success: false, error: { message: 'Nom produit requis' } }); return; }
    const line = await reconciliationRepository.upsertLine(req.params.id, {
      sku: (b.sku as string) ?? null,
      productName,
      category: (b.category as string) ?? null,
      approQty: num(b.approQty),
      invenduQty: num(b.invenduQty),
      unitPrice: num(b.unitPrice),
    });
    res.json({ success: true, data: line });
  },

  /** Edition inline d'une ligne. Body: { approQty?, recuQty?, venduQty?, invenduQty?, unitPrice? } */
  async updateLine(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const line = await reconciliationRepository.updateLine(req.params.lineId, {
      approQty: num(b.approQty),
      recuQty: num(b.recuQty),
      venduQty: num(b.venduQty),
      invenduQty: num(b.invenduQty),
      unitPrice: num(b.unitPrice),
    });
    res.json({ success: true, data: line });
  },

  async deleteLine(req: AuthRequest, res: Response) {
    await reconciliationRepository.deleteLine(req.params.lineId);
    res.json({ success: true });
  },

  /** Saisie en masse de l'appro. Body: { rows: [{ sku?, productName, category?, approQty, unitPrice? }] } */
  async bulkAppro(req: AuthRequest, res: Response) {
    const { rows } = req.body as {
      rows?: { sku?: string; productName: string; category?: string; approQty: number; unitPrice?: number }[];
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucune ligne a importer' } }); return;
    }
    const result = await reconciliationRepository.bulkUpsertAppro(req.params.id, rows);
    res.json({ success: true, data: result });
  },

  // ─── Import Loyverse ───────────────────────────────────────────────────

  /** Body: { items: [{ sku?, productName, category?, quantity, unitPrice }] } */
  async importSales(req: AuthRequest, res: Response) {
    const { items } = req.body as {
      items?: { sku?: string; productName: string; category?: string; quantity: number; unitPrice: number }[];
    };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucune vente a importer' } }); return;
    }
    const result = await reconciliationRepository.importSales(req.params.id, items);
    res.json({ success: true, data: result });
  },

  // ─── Rapport ───────────────────────────────────────────────────────────

  async suggest(req: AuthRequest, res: Response) {
    const { date } = req.query as Record<string, string>;
    if (!date || !DATE_RE.test(date)) {
      res.status(400).json({ success: false, error: { message: 'Date invalide (AAAA-MM-JJ)' } });
      return;
    }
    const result = await reconciliationRepository.suggest({ date, storeId: storeOf(req) });
    res.json({ success: true, data: result });
  },

  // ─── Créneaux ──────────────────────────────────────────────────────────

  async listSlots(_req: AuthRequest, res: Response) {
    const rows = await reconciliationRepository.listSlots();
    res.json({ success: true, data: rows });
  },

  async upsertSlot(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const category = String(b.category ?? '').trim();
    const label = String(b.label ?? '').trim();
    if (!category || !label) {
      res.status(400).json({ success: false, error: { message: 'Catégorie et libellé requis' } });
      return;
    }
    const slot = await reconciliationRepository.upsertSlot({
      id: (b.id as string) || undefined,
      category,
      slotNumber: Number(b.slotNumber) || 1,
      label,
      targetTime: (b.targetTime as string) || null,
      defaultPct: Number(b.defaultPct) || 0,
      sortOrder: Number(b.sortOrder) || 0,
    });
    res.json({ success: true, data: slot });
  },

  async deleteSlot(req: AuthRequest, res: Response) {
    await reconciliationRepository.deleteSlot(req.params.id);
    res.json({ success: true });
  },

  // ─── Catalogue produits ────────────────────────────────────────────────

  async listProducts(_req: AuthRequest, res: Response) {
    const rows = await reconciliationRepository.listProducts();
    res.json({ success: true, data: rows });
  },

  /** Body: { id?, productName, sku?, category?, unitPrice? } */
  async upsertProduct(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const productName = String(b.productName ?? '').trim();
    if (!productName) { res.status(400).json({ success: false, error: { message: 'Nom produit requis' } }); return; }
    try {
      const row = await reconciliationRepository.upsertProduct({
        id: (b.id as string) || undefined,
        sku: (b.sku as string) ?? null,
        productName,
        category: (b.category as string) ?? null,
        unitPrice: num(b.unitPrice),
      });
      res.json({ success: true, data: row });
    } catch (e: any) {
      if (e?.code === '23505') {  // violation d'unicite sur product_key
        res.status(409).json({ success: false, error: { message: 'Un produit avec ce SKU / nom existe déjà' } });
        return;
      }
      throw e;
    }
  },

  async deleteProduct(req: AuthRequest, res: Response) {
    await reconciliationRepository.deleteProduct(req.params.id);
    res.json({ success: true });
  },

  /** Body: { rows: [{ sku?, productName, category?, unitPrice? }] } */
  async bulkProducts(req: AuthRequest, res: Response) {
    const { rows } = req.body as { rows?: { sku?: string; productName: string; category?: string; unitPrice?: number }[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun produit à importer' } }); return;
    }
    const result = await reconciliationRepository.bulkUpsertProducts(rows);
    res.json({ success: true, data: result });
  },

  // ─── Traductions darija ────────────────────────────────────────────────

  async listDarija(_req: AuthRequest, res: Response) {
    const rows = await reconciliationRepository.listDarija();
    res.json({ success: true, data: rows });
  },

  /** Body: { productKey, darija } — darija vide = suppression. */
  async upsertDarija(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const productKey = String(b.productKey ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!productKey) {
      res.status(400).json({ success: false, error: { message: 'Clé produit requise' } });
      return;
    }
    const row = await reconciliationRepository.upsertDarija(productKey, String(b.darija ?? ''));
    res.json({ success: true, data: row });
  },

  async report(req: AuthRequest, res: Response) {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      res.status(400).json({ success: false, error: { message: 'Periode invalide (from/to en AAAA-MM-JJ)' } }); return;
    }
    const rows = await reconciliationRepository.report({ from, to, storeId: storeOf(req) });
    res.json({ success: true, data: rows });
  },
};
