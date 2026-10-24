import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { purchasingReportsRepository as repo, toCsv } from '../repositories/purchasing-reports.repository.js';

/**
 * Pilotage des achats (mig 312, D9 lot 1) :
 *   - reçu non facturé / facturé non reçu / engagements ouverts (par ligne de BC) ;
 *   - registre des entrées (traçabilité ONSSA), CSV serveur ;
 *   - journal des achats (état fiscal), CSV serveur.
 */
export const purchasingReportsRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filters = z.object({
  supplierId: z.string().uuid().optional(),
  minAgeDays: z.coerce.number().int().min(0).max(3650).optional(),
  from: isoDate.optional(), to: isoDate.optional(),
  lot: z.string().trim().max(60).optional(),
  incompleteOnly: z.enum(['true', 'false']).optional(),
  format: z.enum(['json', 'csv']).optional(),
});
function parse(req: AuthRequest, res: Response) {
  const r = filters.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return null; }
  return r.data;
}
function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

purchasingReportsRouter.get('/summary', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.summary() });
}));

// Écran Pilotage : une liste de rapprochement, filtrée et paginée (détail ou par fournisseur).
const boardFilters = z.object({
  kind: z.enum(['commitments', 'rni', 'inr', 'nolines']),
  group: z.enum(['detail', 'supplier']).default('detail'),
  supplierId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  dateFrom: isoDate.optional(), dateTo: isoDate.optional(),
  minAgeDays: z.coerce.number().int().min(0).max(3650).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
purchasingReportsRouter.get('/board', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = boardFilters.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.board({ ...f, search: search || undefined, limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));

purchasingReportsRouter.get('/received-not-invoiced', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const f = parse(req, res); if (!f) return;
  const rows = await repo.receivedNotInvoiced(f);
  if (f.format === 'csv') return sendCsv(res, 'recu-non-facture.csv', toCsv([
    { key: 'supplier_name', label: 'Fournisseur' }, { key: 'order_number', label: 'BC' }, { key: 'item_name', label: 'Article' },
    { key: 'qty', label: 'Quantité' }, { key: 'unit', label: 'Unité' }, { key: 'price_po', label: 'Prix BC' },
    { key: 'amount_at_po_price', label: 'Montant HT' }, { key: 'last_received_at', label: 'Dernière réception' }, { key: 'age_days', label: 'Âge (j)' },
  ], rows));
  res.json({ success: true, data: rows });
}));

purchasingReportsRouter.get('/invoiced-not-received', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const f = parse(req, res); if (!f) return;
  res.json({ success: true, data: await repo.invoicedNotReceived(f) });
}));

purchasingReportsRouter.get('/open-commitments', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const f = parse(req, res); if (!f) return;
  res.json({ success: true, data: await repo.openCommitments(f) });
}));

purchasingReportsRouter.get('/invoices-without-lines', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.invoicesWithoutLines() });
}));

// Registre des entrées paginé (écran Stock › Registre) : magasinier compris.
const registerBoard = z.object({
  from: isoDate.optional(), to: isoDate.optional(),
  supplierId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  flag: z.enum(['incomplete', 'nonconform', 'hors_bc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
purchasingReportsRouter.get('/goods-entry-register/board', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = registerBoard.safeParse(req.query);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Paramètres invalides' } }); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.goodsEntryRegisterPage({ ...f, search: search || undefined, storeId: req.user!.storeId, limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));

// Registre des entrées : consultable aussi par le magasinier (économat).
purchasingReportsRouter.get('/goods-entry-register', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const f = parse(req, res); if (!f) return;
  const rows = await repo.goodsEntryRegister({ ...f, incompleteOnly: f.incompleteOnly === 'true', storeId: req.user!.storeId });
  if (f.format === 'csv') return sendCsv(res, `registre-entrees${f.from ? '-' + f.from : ''}${f.to ? '-' + f.to : ''}.csv`, toCsv([
    { key: 'entry_date', label: 'Date' }, { key: 'source', label: 'Origine' }, { key: 'voucher_number', label: 'Bon de réception' },
    { key: 'order_number', label: 'BC' }, { key: 'supplier_name', label: 'Fournisseur' }, { key: 'supplier_ice', label: 'ICE' },
    { key: 'item_name', label: 'Article' }, { key: 'quantity', label: 'Quantité' }, { key: 'unit', label: 'Unité' },
    { key: 'container_label', label: 'Contenant' }, { key: 'supplier_lot', label: 'Lot fournisseur' }, { key: 'internal_lot', label: 'Lot interne' },
    { key: 'dlc', label: 'DLC' }, { key: 'manufactured_date', label: 'Date fabrication' }, { key: 'overall_conformity', label: 'Conforme' },
    { key: 'temperature_value', label: 'Température' }, { key: 'supplier_invoice_number', label: 'N° BL / facture' },
    { key: 'received_by', label: 'Réceptionné par' }, { key: 'incomplete', label: 'Incomplet' },
  ], rows));
  res.json({ success: true, data: rows });
}));

purchasingReportsRouter.get('/purchase-journal', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const f = parse(req, res); if (!f) return;
  if (!f.from || !f.to) { res.status(400).json({ success: false, error: { message: 'from et to requis' } }); return; }
  const rows = await repo.purchaseJournal({ from: f.from, to: f.to });
  if (f.format === 'csv') return sendCsv(res, `journal-achats-${f.from}-${f.to}.csv`, toCsv([
    { key: 'invoice_date', label: 'Date facture' }, { key: 'supplier_invoice_number', label: 'N° fournisseur' },
    { key: 'invoice_number', label: 'N° interne' }, { key: 'supplier_name', label: 'Fournisseur' }, { key: 'supplier_ice', label: 'ICE' },
    { key: 'ht_20', label: 'HT 20 %' }, { key: 'ht_14', label: 'HT 14 %' }, { key: 'ht_10', label: 'HT 10 %' }, { key: 'ht_7', label: 'HT 7 %' },
    { key: 'ht_0', label: 'HT exonéré / sans taux' }, { key: 'amount_ht', label: 'Total HT' }, { key: 'amount_tva', label: 'TVA' },
    { key: 'amount_ttc', label: 'TTC' }, { key: 'vat_recoverable_from', label: 'Droit à déduction' },
    { key: 'entry_number', label: 'Écriture' }, { key: 'accounting_date', label: 'Date comptable' }, { key: 'has_entry', label: 'Comptabilisée' },
  ], rows));
  res.json({ success: true, data: rows });
}));
