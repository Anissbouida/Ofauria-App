import type { Response } from 'express';
import { receivablesRepository } from '../repositories/receivables.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { customerAddressRepository, type CustomerAddressInput } from '../repositories/customer-address.repository.js';

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
    const archived = (req.query.archived as string) === 'true';
    const result = await customerRepository.findAll({ search, customerType: validType, archived, limit: l, offset: (p - 1) * l });
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
    const bad = await validateLegalIds(req.body);
    if (bad) { res.status(400).json({ success: false, error: { message: bad } }); return; }
    try {
      const customer = await customerRepository.create(req.body);
      await customerRepository.logAudit(customer.id, 'create', req.user?.userId ?? null);
      res.status(201).json({ success: true, data: customer });
    } catch (err) { if (!handleIceDuplicate(err, res)) throw err; }
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
    const bad = await validateLegalIds(req.body);
    if (bad) { res.status(400).json({ success: false, error: { message: bad } }); return; }
    try {
      const customer = await customerRepository.update(req.params.id, req.body);
      await customerRepository.logAudit(req.params.id, 'update', req.user?.userId ?? null, { fields: Object.keys(req.body) });
      res.json({ success: true, data: customer });
    } catch (err) { if (!handleIceDuplicate(err, res)) throw err; }
  },
  /** Restaure un client archivé (phase 4.4). */
  async restore(req: AuthRequest, res: Response) {
    const row = await customerRepository.restore(req.params.id, req.user?.userId ?? null);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data: null });
  },
  /** Piste d'audit de la fiche (phase 4.4). */
  async history(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await customerRepository.history(req.params.id) });
  },
  // ───── Protection des données — loi 09-08 (phase 4.6) ─────
  /** Enregistre le consentement marketing. */
  async consent(req: AuthRequest, res: Response) {
    const v = req.body?.marketingConsent === true || req.body?.marketingConsent === 'true';
    const row = await customerRepository.setConsent(req.params.id, v, req.user?.userId ?? null);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data: null });
  },
  /** Export des données personnelles (droit d'accès / portabilité). */
  async exportData(req: AuthRequest, res: Response) {
    const data = await customerRepository.exportData(req.params.id);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data });
  },
  /** Anonymisation (droit à l'effacement) : conserve la comptabilité. */
  async anonymize(req: AuthRequest, res: Response) {
    const row = await customerRepository.anonymize(req.params.id, req.user?.userId ?? null);
    if (!row) { res.status(409).json({ success: false, error: { message: 'Client introuvable ou déjà anonymisé' } }); return; }
    res.json({ success: true, data: null });
  },
  /** GET /customers/check?ice=…&name=…&excludeId=… : doublons probables (4.3). */
  async check(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    res.json({ success: true, data: await customerRepository.findDuplicates({ name: q.name, ice: q.ice, excludeId: q.excludeId }) });
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
  /** Archive le client (phase 4.4) : plus de hard delete, l'historique reste. */
  async remove(req: AuthRequest, res: Response) {
    const row = await customerRepository.archive(req.params.id, req.user?.userId ?? null);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Client introuvable' } }); return; }
    res.json({ success: true, data: null });
  },

  // ───── Adresses multiples (phase 4.1) ─────
  async listAddresses(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await customerAddressRepository.list(req.params.id) });
  },
  async createAddress(req: AuthRequest, res: Response) {
    const data = parseAddress(req.body);
    if (!data) { res.status(400).json({ success: false, error: { message: 'Adresse (ligne) requise' } }); return; }
    res.status(201).json({ success: true, data: await customerAddressRepository.create(req.params.id, data) });
  },
  async updateAddress(req: AuthRequest, res: Response) {
    const data = parseAddress(req.body, true);
    if (!data) { res.status(400).json({ success: false, error: { message: 'Adresse invalide' } }); return; }
    const row = await customerAddressRepository.update(req.params.addressId, req.params.id, data);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Adresse introuvable' } }); return; }
    res.json({ success: true, data: row });
  },
  async removeAddress(req: AuthRequest, res: Response) {
    const row = await customerAddressRepository.remove(req.params.addressId, req.params.id);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Adresse introuvable' } }); return; }
    res.json({ success: true, data: null });
  },
};

/** Contrôle le format des identifiants légaux (phase 4.3) contre le référentiel
 *  pack pays (identifier_types.pattern). Rend un message d'erreur ou null. */
async function validateLegalIds(body: Record<string, unknown>): Promise<string | null> {
  const patterns = await customerRepository.identifierPatterns('MA');
  const check = (code: string, raw: unknown, label: string, hint: string): string | null => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) return null;
    const pat = patterns[code];
    if (pat && !new RegExp(pat).test(v)) return `${label} invalide : ${hint}.`;
    return null;
  };
  return check('MA_ICE', body.ice, 'ICE', '15 chiffres attendus')
    || check('MA_IF', body.ifFiscal, 'IF', '1 à 8 chiffres attendus');
}

/** Transforme la violation de l'index unique ICE (23505) en 409 lisible au lieu
 *  d'une erreur brute. Rend true si l'erreur a été gérée. */
function handleIceDuplicate(err: unknown, res: Response): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && String(e.constraint || '').includes('ice')) {
    res.status(409).json({ success: false, error: { message: 'Cet ICE est déjà utilisé par un autre client.' } });
    return true;
  }
  return false;
}

/** Normalise le corps d'une adresse. En création, address_line est requis ;
 *  en mise à jour (partial=true), il peut être absent (autres champs modifiés). */
function parseAddress(body: Record<string, unknown>, partial = false): CustomerAddressInput | null {
  const addressLine = typeof body.addressLine === 'string' ? body.addressLine.trim() : '';
  if (!partial && !addressLine) return null;
  const kind = body.kind === 'delivery' || body.kind === 'billing' || body.kind === 'both' ? body.kind : undefined;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const cc = typeof body.countryCode === 'string' && body.countryCode.trim() ? body.countryCode.trim().toUpperCase().slice(0, 2) : null;
  return {
    addressLine: addressLine || (partial ? (undefined as unknown as string) : addressLine),
    label: str(body.label),
    kind,
    postalCode: str(body.postalCode),
    city: str(body.city),
    countryCode: cc,
    // Ne toucher au défaut que si le champ est fourni (sinon on le préserve).
    isDefaultDelivery: 'isDefaultDelivery' in body ? (body.isDefaultDelivery === true || body.isDefaultDelivery === 'true') : undefined,
    isDefaultBilling: 'isDefaultBilling' in body ? (body.isDefaultBilling === true || body.isDefaultBilling === 'true') : undefined,
  };
}
