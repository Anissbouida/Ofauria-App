import { Router, type Response } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { ROLE_GROUPS } from '@ofauria/shared';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { stockCountRepository } from '../repositories/stock-count.repository.js';

/**
 * Inventaire physique (mig 367). Le magasin (magasinier, gérant) ouvre et compte ; la
 * direction valide (séparation des tâches : celui qui compte ne valide pas seul l'écart).
 * Comptage « à l'aveugle » : tant que la campagne est en comptage, le stock théorique et
 * les écarts ne sont pas envoyés au magasinier.
 */
export const stockCountsRouter = Router();
const WAREHOUSE = ROLE_GROUPS.WAREHOUSE;
const DIRECTION = ROLE_GROUPS.ADMIN_MANAGER;
function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }
const isDirection = (req: AuthRequest) => ['admin', 'manager'].includes(req.user!.role);

/** Masque le théorique pour un compteur, sur une campagne à l'aveugle encore en comptage. */
function present(count: Record<string, any>, req: AuthRequest) {
  const hide = count.blind && count.status === 'counting' && !isDirection(req);
  if (!hide) return { ...count, theoretical_hidden: false };
  return {
    ...count, theoretical_hidden: true,
    lines: (count.lines ?? []).map((l: Record<string, any>) => ({ ...l, theoretical_at_start: null, theoretical_at_count: null, cost: null })),
  };
}

stockCountsRouter.get('/', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({ status: z.enum(['counting', 'review', 'validated', 'cancelled']).optional(),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const r = await stockCountRepository.list({ status: q.data.status, storeId: req.user!.storeId ?? null, limit: q.data.limit, offset: (q.data.page - 1) * q.data.limit });
  res.json({ success: true, data: r.rows.map(c => isDirection(req) ? c : { ...c, gap_value: null, gain_value: null, loss_value: null }), total: r.total });
}));

stockCountsRouter.post('/', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({
    title: z.string().trim().max(200).nullish(), itemKinds: z.enum(['ingredient', 'packaging', 'both']).optional(),
    categoryIds: z.array(z.string().uuid()).max(100).optional(), blind: z.boolean().optional(), includeInactive: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullish(), countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await stockCountRepository.create(b.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.status(201).json({ success: true, data: present(r.data!, req) });
}));

stockCountsRouter.get('/:id', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const c = await stockCountRepository.findById(req.params.id);
  if (!c) { bad(res, 'Inventaire introuvable', 404); return; }
  res.json({ success: true, data: present(c, req) });
}));

stockCountsRouter.put('/:id/lines/:lineId', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ countedQty: z.coerce.number().min(0).max(10_000_000).nullable(), note: z.string().trim().max(300).nullish() }).safeParse(req.body);
  if (!b.success) { bad(res, 'Quantité invalide'); return; }
  const r = await stockCountRepository.count(req.params.id, req.params.lineId, { ...b.data, userId: req.user!.userId });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Inventaire introuvable', 404) : bad(res, r.error, 409); return; }
  const line = r.data;
  const hide = !isDirection(req);
  res.json({ success: true, data: hide ? { ...line, theoretical_at_start: null, theoretical_at_count: null } : line });
}));

stockCountsRouter.post('/:id/lines', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ ingredientId: z.string().uuid().nullish(), packagingId: z.string().uuid().nullish() })
    .refine(x => !!x.ingredientId !== !!x.packagingId, 'Un article à la fois').safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await stockCountRepository.addLine(req.params.id, b.data);
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Inventaire introuvable', 404) : bad(res, r.error, 409); return; }
  res.status(201).json({ success: true, data: r.data });
}));

stockCountsRouter.post('/:id/submit', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await stockCountRepository.setStatus(req.params.id, 'submit', req.user!.userId);
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.json({ success: true, data: present(r.data!, req) });
}));
stockCountsRouter.post('/:id/reopen', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await stockCountRepository.setStatus(req.params.id, 'reopen', req.user!.userId);
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));
stockCountsRouter.post('/:id/cancel', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await stockCountRepository.setStatus(req.params.id, 'cancel', req.user!.userId);
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));
stockCountsRouter.post('/:id/validate', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ zeroUncounted: z.boolean().default(false) }).safeParse(req.body ?? {});
  if (!b.success) { bad(res); return; }
  const r = await stockCountRepository.validate(req.params.id, { zeroUncounted: b.data.zeroUncounted, userId: req.user!.userId });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Inventaire introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

/** Feuille de comptage imprimable (comptage papier puis saisie). Théorique imprimé seulement hors aveugle. */
stockCountsRouter.get('/:id/sheet', authenticate, authorize(...WAREHOUSE), asyncHandler(async (req: AuthRequest, res: Response) => {
  const c = await stockCountRepository.findById(req.params.id);
  if (!c) { bad(res, 'Inventaire introuvable', 404); return; }
  const showTh = !c.blind;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 36, left: 36, right: 36 }, info: { Title: `Feuille de comptage ${c.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const W = 595.28 - 72;
  const cols = showTh ? [W * 0.42, W * 0.18, W * 0.08, W * 0.12, W * 0.2] : [W * 0.5, W * 0.2, W * 0.1, W * 0.2];
  const heads = showTh ? ['ARTICLE', 'CATÉGORIE', 'UNITÉ', 'THÉORIQUE', 'COMPTÉ'] : ['ARTICLE', 'CATÉGORIE', 'UNITÉ', 'COMPTÉ'];
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#3B2F2F').text(`Feuille de comptage · ${c.number}`, 36, 36);
    doc.font('Helvetica').fontSize(8.5).fillColor('#7A7168')
      .text(`${c.title ? `${c.title} · ` : ''}Date : ${(c.count_date instanceof Date ? c.count_date : new Date(`${String(c.count_date).slice(0, 10)}T00:00:00`)).toLocaleDateString('fr-FR')} · ${c.lines_total} article(s)${c.blind ? ' · comptage à l\'aveugle' : ''} · Compté par : ______________________`);
    let x = 36; const y = doc.y + 6;
    doc.rect(36, y, W, 16).fill('#8E4A1F');
    heads.forEach((h, i) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF').text(h, x + 4, y + 4, { width: cols[i] - 8, lineBreak: false }); x += cols[i]; });
    return y + 16;
  };
  let y = header();
  (c.lines as Record<string, any>[]).forEach((l, r) => {
    if (y > 841.89 - 50) { doc.addPage(); y = header(); }
    let x = 36;
    if (r % 2 === 0) doc.rect(36, y, W, 18).fill('#F5F0E8');
    const cells = showTh
      ? [l.item_name, l.category_name ?? '', l.unit ?? '', Number(l.theoretical_at_start).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[  ]/g, ' '), '']
      : [l.item_name, l.category_name ?? '', l.unit ?? '', ''];
    cells.forEach((v, i) => { doc.font('Helvetica').fontSize(8).fillColor('#3B2F2F').text(String(v), x + 4, y + 5, { width: cols[i] - 8, height: 10, ellipsis: true }); x += cols[i]; });
    doc.moveTo(36 + W - cols[cols.length - 1] + 6, y + 15).lineTo(36 + W - 6, y + 15).lineWidth(0.4).stroke('#D6CFC4');
    y += 18;
  });
  doc.end();
  await new Promise(r => doc.on('end', r));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="comptage-${c.number}.pdf"`);
  res.send(Buffer.concat(chunks));
}));
