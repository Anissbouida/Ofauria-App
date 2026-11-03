import type { Response } from 'express';
import { receivablesRepository } from '../repositories/receivables.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { customerRepository } from '../repositories/customer.repository.js';

/** Champs de conditions commerciales du client (O2C L0, G-CR-04) et leur colonne. */
const COMMERCIAL_FIELDS = ['creditLimit', 'remisePct', 'delaiPaiementJours', 'tvaExonere', 'billingFrequency'] as const;
const COLUMN: Record<string, string> = {
  creditLimit: 'credit_limit', remisePct: 'remise_pct', delaiPaiementJours: 'delai_paiement_jours',
  tvaExonere: 'tva_exonere', billingFrequency: 'billing_frequency', customerType: 'customer_type',
};
const isDirection = (req: AuthRequest) => req.user?.role === 'admin' || req.user?.role === 'manager';
const isBlank = (v: unknown) => v === undefined || v === null || v === '' || v === false || v === 'false' || v === 'monthly';
/** Valeur envoyée identique à la valeur en base (nombres, booléens et vides normalisés). */
function sameValue(sent: unknown, stored: unknown) {
  const norm = (v: unknown) => {
    if (v === '' || v === undefined) return null;
    if (v === true || v === 'true' || v === 'on' || v === '1') return true;
    if (v === false || v === 'false') return false;
    if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return Number(v);
    return v;
  };
  const a = norm(sent), b = norm(stored);
  const empty = (v: unknown) => v === null || v === false || v === 0;
  return a === b || (empty(a) && empty(b));
}

export const customerController = {
  async list(req: AuthRequest, res: Response) {
    const { search, customerType, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const validType = ['particulier', 'professionnel', 'association', 'revendeur'].includes(customerType) ? customerType : undefined;
    const result = await customerRepository.findAll({ search, customerType: validType, limit: l, offset: (p - 1) * l });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },
  async getById(req: AuthRequest, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) { res.status(404).json({ success: false, error: { message: 'Client non trouvé' } }); return; }
    res.json({ success: true, data: customer });
  },
  async stats(req: AuthRequest, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) { res.status(404).json({ success: false, error: { message: 'Client non trouvé' } }); return; }
    const stats = await customerRepository.stats(req.params.id);
    res.json({ success: true, data: { customer, ...stats } });
  },
  async globalStats(_req: AuthRequest, res: Response) {
    const stats = await customerRepository.globalStats();
    res.json({ success: true, data: stats });
  },
  async create(req: AuthRequest, res: Response) {
    // O2C L0 (G-CR-04) : conditions commerciales réservées à la direction ; la caisse
    // crée des clients particuliers sans plafond, remise ni exonération.
    if (!isDirection(req)) {
      const set = COMMERCIAL_FIELDS.filter(k => !isBlank(req.body?.[k]));
      if (set.length || (req.body?.customerType && req.body.customerType !== 'particulier')) {
        res.status(403).json({ success: false, error: { message: 'Type de client et conditions commerciales (plafond, remise, délai, exonération, facturation) : réservés à la direction' } });
        return;
      }
    }
    const customer = await customerRepository.create(req.body);
    res.status(201).json({ success: true, data: customer });
  },
  async update(req: AuthRequest, res: Response) {
    if (!isDirection(req)) {
      const current = await customerRepository.findById(req.params.id);
      if (!current) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
      const changed = [...COMMERCIAL_FIELDS, 'customerType'].filter(k => req.body?.[k] !== undefined && !sameValue(req.body[k], current[COLUMN[k]]));
      if (changed.length) {
        res.status(403).json({ success: false, error: { message: 'Type de client et conditions commerciales (plafond, remise, délai, exonération, facturation) : réservés à la direction' } });
        return;
      }
    }
    const customer = await customerRepository.update(req.params.id, req.body);
    res.json({ success: true, data: customer });
  },
  /** Situation du client : dû, échu, plafond de crédit, disponible (mig 351). */
  async situation(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await receivablesRepository.customerSituation(req.params.id) });
  },
  /**
   * Relevé de compte du client sur une période (factures + règlements, solde
   * glissant). ?from=YYYY-MM-DD&to=YYYY-MM-DD — défaut : année civile en cours.
   */
  async statement(req: AuthRequest, res: Response) {
    const today = new Date();
    const y = today.getFullYear();
    const from = (req.query.from as string) || `${y}-01-01`;
    const to = (req.query.to as string) || `${y}-12-31`;
    const data = await receivablesRepository.customerStatement(req.params.id, from, to);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data });
  },
  async remove(req: AuthRequest, res: Response) {
    await customerRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};
