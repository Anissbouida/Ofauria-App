import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { companyBankRepository, type BankAccountInput } from '../repositories/company-bank.repository.js';
import { taxCodeRepository } from '../repositories/tax-code.repository.js';
import { taxScaleRepository } from '../repositories/payroll-config.repository.js';
import { activeCountryCode, countryPackOverview } from '../services/country-pack.js';
import { ribKeyValid } from '../services/salary-transfer.js';
import { sectorRepository, type Activation, type AdjustmentChanges } from '../repositories/sector.repository.js';
import { impactPreview } from '../services/module-impact.js';
import { loadSectorStarter, sectorStarterPreview } from '../services/sector-starter.service.js';
import { healthReport, dismissRecommendation, restoreDismissed } from '../services/config-health.js';
import { onboardingReport, hideOnboarding, showAllOnboarding } from '../services/module-onboarding.js';
import { exportCurrentConfig, previewConfigModel, saveModelAsSector, deleteCustomSector } from '../services/config-templates.js';
import { assistantConfigured, suggestConfig, AssistantUnavailable } from '../services/config-assistant.js';

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

/** Corps { modules: { clé: true|false|null }, features: { … } } validé. */
function readAdjustments(body: unknown): AdjustmentChanges | string {
  const b = (body ?? {}) as { modules?: unknown; features?: unknown };
  const readMap = (v: unknown): Record<string, boolean | null> | string => {
    if (v === undefined) return {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Format invalide';
    const out: Record<string, boolean | null> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== true && val !== false && val !== null) return `Valeur invalide pour ${k}`;
      out[k] = val;
    }
    return out;
  };
  const modules = readMap(b.modules);
  if (typeof modules === 'string') return modules;
  const features = readMap(b.features);
  if (typeof features === 'string') return features;
  return { modules, features };
}

const activationView = (a: Activation) => ({
  sector: { code: a.sector.code, label: a.sector.label },
  packModules: a.packModules,
  packFeatures: a.packFeatures,
  moduleOverrides: a.moduleOverrides,
  featureOverrides: a.featureOverrides,
  catalog: a.catalog,
  modules: [...a.modules],
  features: [...a.features],
  rollout: a.rollout,
});

/** Fiche société : comptes bancaires et TVA (Paramètres, lot 5, mig 331). */
export const companyController = {
  /** Secteur d'activité courant + liste des secteurs (mig 468). Lisible par tout
   *  utilisateur authentifié : le client s'en sert pour masquer les modules hors secteur. */
  async sector(req: AuthRequest, res: Response) {
    const [mine, available] = await Promise.all([
      req.user ? sectorRepository.forUser(req.user) : sectorRepository.activation().then(act => ({ act, modules: act.modules, features: act.features })),
      sectorRepository.list(),
    ]);
    const act = mine.act;
    const labels = await sectorRepository.labels(act.sector.code);
    // `modules` / `features` = listes EFFECTIVES pour CET utilisateur (préréglage +
    // ajustements, mig 507 ; pilotes et établissement, mig 509) : le client les
    // applique aux menus.
    const current = { ...act.sector, modules: [...mine.modules], features: [...mine.features] };
    const adjusted = Object.keys(act.moduleOverrides).length + Object.keys(act.featureOverrides).length;
    res.json({ success: true, data: { current, labels, adjusted, available: available.map(s => ({ code: s.code, label: s.label, isCustom: !!s.is_custom })) } });
  },

  /** Écran « Secteur et modules » (mig 507) : préréglage, écarts, catalogue des
   *  options et listes effectives. Le client compose l'écran avec le registre partagé. */
  async modules(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: activationView(await sectorRepository.activation()) });
  },

  /** Ajuste des modules / options : { modules: { clé: true|false|null }, features: { … } }. */
  async saveModules(req: AuthRequest, res: Response) {
    const changes = readAdjustments(req.body);
    if (typeof changes === 'string') { bad(res, changes); return; }
    const result = await sectorRepository.applyAdjustments(changes, req.user?.userId);
    if ('error' in result) { bad(res, result.error); return; }
    res.json({ success: true, data: activationView(result.activation) });
  },

  /** Aperçu d'impact (P0b, sans rien écrire) : modules / options qui apparaissent ou
   *  disparaissent, rôles touchés, données masquées. Même corps que PUT /modules. */
  async previewModules(req: AuthRequest, res: Response) {
    const changes = readAdjustments(req.body);
    if (typeof changes === 'string') { bad(res, changes); return; }
    const plan = await sectorRepository.planAdjustments(changes);
    if ('error' in plan) { bad(res, plan.error); return; }
    res.json({ success: true, data: await impactPreview(plan.diff, sectorRepository.featureLabel(plan.current)) });
  },

  /** Historique des configurations (mig 508). */
  async moduleVersions(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await sectorRepository.versions() });
  },

  /** Bilan de santé de la configuration (P8) : recommandations calculées, rien n'est appliqué. */
  async moduleHealth(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await healthReport() });
  },
  async dismissHealth(req: AuthRequest, res: Response) {
    if (!(await dismissRecommendation(String(req.params.key ?? ''), req.user?.userId))) { bad(res, 'Recommandation inconnue'); return; }
    res.json({ success: true, data: await healthReport() });
  },
  /** Modèles de configuration (P10) : export de la configuration courante. */
  async exportConfig(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await exportCurrentConfig(typeof req.query.name === 'string' ? req.query.name : undefined) });
  },
  /** Aperçu d'un modèle importé (rien n'est écrit). */
  async previewConfigModel(req: AuthRequest, res: Response) {
    const r = await previewConfigModel((req.body ?? {}).model);
    if ('error' in r) { bad(res, r.error); return; }
    res.json({ success: true, data: r });
  },
  /** Configuration en langage naturel (P11) : proposition de l'IA, rien n'est écrit. */
  async assistantStatus(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: { available: assistantConfigured() } });
  },
  async suggestConfig(req: AuthRequest, res: Response) {
    const description = (req.body ?? {}).description;
    if (typeof description !== 'string') { bad(res, 'Description manquante'); return; }
    try {
      const r = await suggestConfig(description);
      if ('error' in r) { bad(res, r.error); return; }
      res.json({ success: true, data: r });
    } catch (err) {
      if (err instanceof AssistantUnavailable) { bad(res, err.message, 503); return; }
      throw err;
    }
  },
  /** Enregistre comme secteur personnalisé : un modèle importé, ou la configuration courante sous un nom. */
  async createSector(req: AuthRequest, res: Response) {
    const body = (req.body ?? {}) as { model?: unknown; name?: unknown };
    const model = body.model ?? await exportCurrentConfig(typeof body.name === 'string' ? body.name : undefined);
    const r = await saveModelAsSector(model, req.user?.userId);
    if ('error' in r) { bad(res, r.error); return; }
    res.status(201).json({ success: true, data: r });
  },
  async deleteSector(req: AuthRequest, res: Response) {
    const r = await deleteCustomSector(String(req.params.code ?? ''));
    if ('error' in r) { bad(res, r.error); return; }
    res.json({ success: true, data: r });
  },

  /** Mise en route guidée (P9) : tâches par module, cochées d'après les données. */
  async moduleOnboarding(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await onboardingReport() });
  },
  async hideOnboarding(req: AuthRequest, res: Response) {
    if (!(await hideOnboarding(String(req.params.module ?? ''), req.user?.userId))) { bad(res, 'Module inconnu'); return; }
    res.json({ success: true, data: await onboardingReport() });
  },
  async showOnboarding(_req: AuthRequest, res: Response) {
    await showAllOnboarding();
    res.json({ success: true, data: await onboardingReport() });
  },
  async restoreHealth(_req: AuthRequest, res: Response) {
    await restoreDismissed();
    res.json({ success: true, data: await healthReport() });
  },

  /** Restaure une version : elle redevient la configuration courante. */
  async restoreModuleVersion(req: AuthRequest, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { bad(res, 'Version invalide'); return; }
    const result = await sectorRepository.restoreVersion(id, req.user?.userId);
    if ('error' in result) { bad(res, result.error, 404); return; }
    res.json({ success: true, data: activationView(result.activation) });
  },

  /** Diffusion d'un module (mig 509) : { pilot: { roles, users } | null, disabledStores: [] }. */
  async saveModuleRollout(req: AuthRequest, res: Response) {
    const b = (req.body ?? {}) as { pilot?: unknown; disabledStores?: unknown };
    const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : null;
    const disabledStores = b.disabledStores === undefined ? [] : strings(b.disabledStores);
    if (!disabledStores) { bad(res, 'Établissements invalides'); return; }
    let pilot: { roles: string[]; users: string[] } | null = null;
    if (b.pilot !== null && b.pilot !== undefined) {
      const p = b.pilot as { roles?: unknown; users?: unknown };
      const roles = strings(p.roles ?? []); const users = strings(p.users ?? []);
      if (!roles || !users) { bad(res, 'Pilote invalide'); return; }
      pilot = { roles, users };
    }
    const result = await sectorRepository.applyRollout(String(req.params.key), { pilot, disabledStores }, req.user?.userId);
    if ('error' in result) { bad(res, result.error); return; }
    res.json({ success: true, data: activationView(result.activation) });
  },

  /** Revient au préréglage du secteur (supprime tous les ajustements). */
  async resetModules(req: AuthRequest, res: Response) {
    res.json({ success: true, data: activationView(await sectorRepository.resetAdjustments(req.user?.userId)) });
  },

  /** Données de départ du secteur courant (phase 9.3) : aperçu, et chargement à la demande. */
  /** Aperçu des données de départ : secteur courant, ou ?sector=code (profil envisagé, C-03). */
  async sectorStarter(req: AuthRequest, res: Response) {
    const asked = typeof req.query.sector === 'string' ? req.query.sector.slice(0, 40) : '';
    const code = asked && await sectorRepository.pack(asked) ? asked : (await sectorRepository.current()).code;
    res.json({ success: true, data: { sector: code, preview: await sectorStarterPreview(code) } });
  },
  async loadSectorStarter(req: AuthRequest, res: Response) {
    const current = await sectorRepository.current();
    const result = await loadSectorStarter(current.code, req.user!.userId);
    res.json({ success: true, data: result });
  },

  /** Change le secteur de la société (réservé à la direction via la route). */
  async setSector(req: AuthRequest, res: Response) {
    const body = (req.body ?? {}) as { code?: unknown; keepAdjustments?: unknown };
    const code = String(body.code ?? '').trim();
    if (!code) { bad(res, 'Secteur requis'); return; }
    // Par défaut on garde les ajustements (rien ne disparaît sans le demander).
    const updated = await sectorRepository.setSector(code, { keepAdjustments: body.keepAdjustments !== false, userId: req.user?.userId });
    if (!updated) { bad(res, 'Secteur inconnu', 404); return; }
    res.json({ success: true, data: updated });
  },

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
    // Pays actif (module_parameters company.country_code) lu par le pack pays (G6-06).
    res.json({ success: true, data: await taxCodeRepository.list(await activeCountryCode()) });
  },

  /**
   * Pack pays en lecture seule (G6-06) : pays, paramètres légaux en vigueur, barème de
   * cotisations / IR en vigueur (payroll_tax_scales) et taux de TVA en vigueur (tax_codes).
   */
  async countryPack(_req: AuthRequest, res: Response) {
    const overview = await countryPackOverview();
    const scale = await taxScaleRepository.findForDate(overview.date).catch(() => null);
    const taxCodes = (await taxCodeRepository.available())
      ? (await taxCodeRepository.list(overview.country)).filter((t: { status?: string }) => t.status === 'current')
      : [];
    res.json({ success: true, data: { ...overview, payrollScale: scale, taxCodes } });
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
