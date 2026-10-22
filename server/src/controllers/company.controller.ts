import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { companyBankRepository, type BankAccountInput } from '../repositories/company-bank.repository.js';
import { taxCodeRepository } from '../repositories/tax-code.repository.js';
import { ribKeyValid } from '../services/salary-transfer.js';
import { db } from '../config/database.js';

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, error: { message } });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_KINDS = ['standard', 'reduced', 'zero', 'exempt_without_credit', 'exempt_with_credit', 'out_of_scope'];

function readBank(body: Record<string, unknown>, creating: boolean): BankAccountInput | string {
  const out: BankAccountInput = {};
  for (const [k, max] of [['label', 80], ['bankName', 80]] as const) {
    if (body[k] !== undefined || creating) {
      const v = String(body[k] ?? '').trim();
      if (!v) return k === 'label' ? 'Libellé requis' : 'Banque requise';
      out[k] = v.slice(0, max);
    }
  }
  if (body.rib !== undefined || creating) {
    const rib = String(body.rib ?? '').replace(/\s/g, '');
    if (!/^\d{24}$/.test(rib)) return 'RIB : 24 chiffres';
    if (!ribKeyValid(rib)) return 'RIB : clé de contrôle incorrecte (vérifiez la saisie)';
    out.rib = rib;
  }
  if (body.swift !== undefined) {
    const s = body.swift ? String(body.swift).trim().toUpperCase() : '';
    if (s && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s)) return 'Code SWIFT/BIC invalide (8 ou 11 caractères)';
    out.swift = s || null;
  }
  if (body.ledgerAccount !== undefined) {
    const a = body.ledgerAccount ? String(body.ledgerAccount).trim() : '';
    if (a && !/^514\d{0,7}$/.test(a)) return 'Compte comptable : un compte de banque (514…)';
    out.ledgerAccount = a || null;
  }
  if (body.storeId !== undefined) out.storeId = body.storeId ? String(body.storeId) : null;
  for (const k of ['isDefault', 'showOnInvoices', 'isActive'] as const) if (body[k] !== undefined) out[k] = !!body[k];
  return out;
}

/** Fiche société : comptes bancaires et TVA (Paramètres, lot 5, mig 331). */
export const companyController = {
  async bankAccounts(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await companyBankRepository.list() });
  },

  async saveBankAccount(req: AuthRequest, res: Response) {
    const creating = !req.params.id;
    const data = readBank(req.body ?? {}, creating);
    if (typeof data === 'string') { bad(res, data); return; }
    try {
      const row = await companyBankRepository.save(creating ? null : req.params.id, data, req.user?.userId);
      if (!row) { bad(res, 'Compte inconnu', 404); return; }
      res.status(creating ? 201 : 200).json({ success: true, data: row });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') { bad(res, 'Ce RIB est déjà enregistré', 409); return; }
      throw err;
    }
  },

  async taxCodes(_req: AuthRequest, res: Response) {
    if (!(await taxCodeRepository.available())) { res.json({ success: true, data: [] }); return; }
    const country = (await db.query(
      `SELECT CASE WHEN to_regclass('public.module_parameters') IS NOT NULL
                   THEN (SELECT value->>'code' FROM module_parameters WHERE key = 'company.country_code') END AS c`)).rows[0]?.c ?? 'MA';
    res.json({ success: true, data: await taxCodeRepository.list(country) });
  },

  async addTaxRate(req: AuthRequest, res: Response) {
    if (!(await taxCodeRepository.available())) { bad(res, 'Codes TVA non disponibles sur cette base', 409); return; }
    const b = req.body ?? {};
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,20}$/.test(code)) { bad(res, 'Code : lettres, chiffres et _, 20 caractères maximum'); return; }
    const label = String(b.label ?? '').trim();
    if (label.length < 2 || label.length > 120) { bad(res, 'Libellé requis'); return; }
    const rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6) { bad(res, 'Taux entre 0 et 100, deux décimales au plus'); return; }
    if (!TAX_KINDS.includes(String(b.kind))) { bad(res, 'Nature de taux inconnue'); return; }
    if (['zero', 'exempt_without_credit', 'exempt_with_credit', 'out_of_scope'].includes(String(b.kind)) && rate !== 0) {
      bad(res, 'Un taux exonéré, nul ou hors champ doit valoir 0 %'); return;
    }
    if (!DATE.test(String(b.validFrom ?? ''))) { bad(res, 'Date d\'effet requise (AAAA-MM-JJ)'); return; }
    try {
      const row = await taxCodeRepository.addRate({
        country: 'MA', code, label, rate, kind: String(b.kind), recoverable: b.recoverable !== false,
        validFrom: String(b.validFrom), legalRef: b.legalRef ? String(b.legalRef).trim().slice(0, 500) : null,
      }, req.user?.userId);
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'OF409' || e.code === '23505') { bad(res, e.code === 'OF409' ? e.message! : 'Un taux existe déjà à cette date pour ce code', 409); return; }
      throw err;
    }
  },

  async updateTaxCode(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    if (b.rate !== undefined || b.validFrom !== undefined || b.code !== undefined) {
      bad(res, 'Le taux, le code et la date d\'effet sont figés : ajoutez un nouveau taux daté'); return;
    }
    if (b.validTo !== undefined && b.validTo !== null && !DATE.test(String(b.validTo))) { bad(res, 'Date de fin invalide'); return; }
    try {
      const row = await taxCodeRepository.update(req.params.id, {
        label: b.label !== undefined ? String(b.label).trim().slice(0, 120) : undefined,
        legalRef: b.legalRef !== undefined ? (b.legalRef ? String(b.legalRef).trim().slice(0, 500) : null) : undefined,
        validTo: b.validTo !== undefined ? (b.validTo || null) : undefined,
      }, req.user?.userId);
      if (!row) { bad(res, 'Code TVA inconnu', 404); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'OF409' || e.code === '23514') { bad(res, e.code === 'OF409' ? e.message! : 'Dates incohérentes', 409); return; }
      throw err;
    }
  },
};
