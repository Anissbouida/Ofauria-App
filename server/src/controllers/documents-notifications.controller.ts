import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import { generateInvoicePdf } from '../services/invoice-pdf.service.js';
import { generatePurchaseOrderPdf } from '../services/purchase-order-pdf.service.js';
import { settingsRepository } from '../repositories/settings.repository.js';

/**
 * Modèles de documents et règles de notification (Paramètres, lot 6, mig 332).
 */

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });
const ROLE_CODE = /^[a-z][a-z0-9_]{1,29}$/;

async function exists(table: string): Promise<boolean> {
  return (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`])).rows[0].ok as boolean;
}

function text(v: unknown, max: number): string | null | undefined | false {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t.length > max ? false : t || null;
}

export const documentsNotificationsController = {
  // ─── Modèles de documents ──────────────────────────────────────────
  async documents(_req: AuthRequest, res: Response) {
    if (!(await exists('document_templates'))) { res.json({ success: true, data: [] }); return; }
    const r = await db.query(
      `SELECT d.*, concat_ws(' ', u.first_name, u.last_name) AS updated_by_name
         FROM document_templates d LEFT JOIN users u ON u.id = d.updated_by ORDER BY d.display_order`);
    res.json({ success: true, data: r.rows });
  },

  async updateDocument(req: AuthRequest, res: Response) {
    if (!(await exists('document_templates'))) { bad(res, 'Modèles non disponibles sur cette base', 409); return; }
    const b = req.body ?? {};
    const fields: [string, unknown][] = [];
    for (const [key, col, max] of [['paymentTerms', 'payment_terms', 500], ['latePenalty', 'late_penalty', 500], ['footerNote', 'footer_note', 300]] as const) {
      const v = text(b[key], max);
      if (v === false) { bad(res, `${key === 'footerNote' ? 'Note de pied de page' : key === 'paymentTerms' ? 'Conditions de paiement' : 'Pénalités de retard'} : ${max} caractères maximum`); return; }
      if (v !== undefined) fields.push([col, v]);
    }
    for (const [key, col] of [['showBank', 'show_bank'], ['showLegalForm', 'show_legal_form']] as const) {
      if (b[key] !== undefined) fields.push([col, !!b[key]]);
    }
    if (!fields.length) { bad(res, 'Rien à modifier'); return; }
    fields.push(['updated_by', req.user?.userId ?? null]);
    const r = await auditedQuery(req.user?.userId,
      `UPDATE document_templates SET ${fields.map((f, i) => `${f[0]} = $${i + 2}`).join(', ')}, updated_at = now()
        WHERE doc_type = $1 RETURNING *`,
      [req.params.docType, ...fields.map(f => f[1])]);
    if (!r.rows[0]) { bad(res, 'Modèle inconnu', 404); return; }
    res.json({ success: true, data: r.rows[0] });
  },

  /** Aperçu PDF avec des données d'exemple et les réglages enregistrés. */
  async preview(req: AuthRequest, res: Response) {
    const legal = await loadCompanyLegal();
    const logo = (await settingsRepository.get())?.logo_url as string | undefined;
    const today = new Date().toLocaleDateString('fr-FR');
    const company = {
      companyName: legal.name, companyAddress: legal.address, companyPhone: legal.phone, companyEmail: legal.email,
      companyRC: legal.rc, companyPatente: legal.patente, companyIF: legal.if, companyICE: legal.ice, logoPath: logo || undefined,
    };
    let pdf: Buffer;
    if (req.params.docType === 'invoice') {
      pdf = await generateInvoicePdf({
        invoiceNumber: 'FE-EXEMPLE', invoiceDate: today, customerName: 'Client exemple SARL', customerICE: '000000000000000',
        items: [
          { description: 'Plateau de mignardises (exemple)', quantity: 2, unit_price: 350, subtotal: 700 },
          { description: 'Gâteau d\'anniversaire 12 parts (exemple)', quantity: 1, unit_price: 420, subtotal: 420 },
        ],
        totalHT: 1120, tvaRate: 20, totalTVA: 224, totalTTC: 1344, ...company,
      });
    } else if (req.params.docType === 'purchase_order') {
      pdf = await generatePurchaseOrderPdf({
        orderNumber: 'BC-EXEMPLE', orderDate: today, supplierName: 'Fournisseur exemple',
        items: [
          { ingredientName: 'Farine T55 (exemple)', unit: 'kg', quantity: 50, unitPrice: 6.5, subtotal: 325 },
          { ingredientName: 'Beurre doux (exemple)', unit: 'kg', quantity: 10, unitPrice: 95, subtotal: 950 },
        ],
        totalHT: 1275, ...company,
      } as Parameters<typeof generatePurchaseOrderPdf>[0]);
    } else { bad(res, 'Type de document inconnu', 404); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="apercu-${req.params.docType}.pdf"`);
    res.send(pdf);
  },

  // ─── Règles de notification ────────────────────────────────────────
  async notificationRules(_req: AuthRequest, res: Response) {
    if (!(await exists('notification_rules'))) { res.json({ success: true, data: [] }); return; }
    const r = await db.query(
      `SELECT r.*, concat_ws(' ', u.first_name, u.last_name) AS updated_by_name,
              COALESCE(s.sent, 0)::int AS sent_30d, s.roles AS recipients_30d
         FROM notification_rules r
         LEFT JOIN users u ON u.id = r.updated_by
         LEFT JOIN (SELECT type, count(*) AS sent, array_agg(DISTINCT target_role) AS roles
                      FROM notifications WHERE created_at > now() - interval '30 days' GROUP BY type) s ON s.type = r.type
        ORDER BY r.domain, r.label`);
    res.json({ success: true, data: r.rows });
  },

  async updateNotificationRule(req: AuthRequest, res: Response) {
    if (!(await exists('notification_rules'))) { bad(res, 'Règles non disponibles sur cette base', 409); return; }
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [req.params.type];
    if (b.enabled !== undefined) { vals.push(!!b.enabled); sets.push(`enabled = $${vals.length}`); }
    if (b.extraRoles !== undefined) {
      if (!Array.isArray(b.extraRoles) || b.extraRoles.some((r: unknown) => typeof r !== 'string' || !ROLE_CODE.test(r))) { bad(res, 'Liste de rôles invalide'); return; }
      const roles = [...new Set(b.extraRoles as string[])];
      if (await exists('roles')) {
        const known = (await db.query(`SELECT code FROM roles WHERE code = ANY($1)`, [roles])).rows.map(x => x.code);
        const unknown = roles.filter(r => !known.includes(r));
        if (unknown.length) { bad(res, `Rôle inconnu : ${unknown[0]}`); return; }
      }
      vals.push(roles); sets.push(`extra_roles = $${vals.length}::varchar[]`);
    }
    if (!sets.length) { bad(res, 'Rien à modifier'); return; }
    vals.push(req.user?.userId ?? null);
    const r = await auditedQuery(req.user?.userId,
      `UPDATE notification_rules SET ${sets.join(', ')}, updated_by = $${vals.length}, updated_at = now() WHERE type = $1 RETURNING *`, vals);
    if (!r.rows[0]) { bad(res, 'Type de notification inconnu', 404); return; }
    res.json({ success: true, data: r.rows[0] });
  },
};
