import type { Response } from 'express';
import type { PortalRequest } from '../middleware/portal.middleware.js';
import { db } from '../config/database.js';
import { invoicePdfById } from '../services/invoice-pdf-builder.service.js';

/**
 * Phase 10.3 — portail client. Tout est strictement limité au client du jeton
 * (req.portalCustomerId) : commandes, factures, relevé, et téléchargement d'une
 * facture qui lui appartient.
 */
export const portalController = {
  async me(req: PortalRequest, res: Response): Promise<void> {
    const c = (await db.query(
      `SELECT id, first_name, last_name, company_name, customer_type, email, phone
         FROM customers WHERE id = $1`, [req.portalCustomerId])).rows[0];
    res.json({ success: true, data: c });
  },

  async orders(req: PortalRequest, res: Response): Promise<void> {
    const rows = (await db.query(
      `SELECT id, order_number, type, status, total, pickup_date, created_at
         FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [req.portalCustomerId])).rows;
    res.json({ success: true, data: rows });
  },

  async invoices(req: PortalRequest, res: Response): Promise<void> {
    const rows = (await db.query(
      `SELECT id, invoice_number, invoice_date, due_date, total_amount,
              COALESCE(paid_amount, 0) AS paid_amount, status, kind
         FROM invoices
        WHERE customer_id = $1 AND kind IN ('invoice', 'credit_note')
        ORDER BY invoice_date DESC, invoice_number DESC LIMIT 300`, [req.portalCustomerId])).rows;
    res.json({ success: true, data: rows });
  },

  async invoicePdf(req: PortalRequest, res: Response): Promise<void> {
    // Appartenance vérifiée AVANT toute génération : un client ne peut tirer que ses factures.
    const own = (await db.query(
      `SELECT 1 FROM invoices WHERE id = $1 AND customer_id = $2`, [req.params.id, req.portalCustomerId])).rows[0];
    if (!own) { res.status(404).json({ success: false, error: 'Facture introuvable' }); return; }
    const built = await invoicePdfById(req.params.id, { locale: req.query.locale === 'ar' ? 'ar' : 'fr' });
    if (!built) { res.status(404).json({ success: false, error: 'Facture introuvable' }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    res.setHeader('Content-Length', built.buffer.length);
    res.send(built.buffer);
  },

  async statement(req: PortalRequest, res: Response): Promise<void> {
    const rows = (await db.query(
      `SELECT invoice_number, invoice_date, due_date, total_amount,
              COALESCE(paid_amount, 0) AS paid_amount,
              (total_amount - COALESCE(paid_amount, 0)) AS outstanding, status, kind
         FROM invoices
        WHERE customer_id = $1 AND kind IN ('invoice', 'credit_note')
        ORDER BY invoice_date, invoice_number`, [req.portalCustomerId])).rows;
    const outstanding = rows.reduce((s, r) => s + Number(r.outstanding || 0), 0);
    res.json({ success: true, data: { lines: rows, outstanding: Math.round(outstanding * 100) / 100 } });
  },
};
