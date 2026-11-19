import { settingsRepository } from '../repositories/settings.repository.js';
import type { LegalEntityRow } from '../repositories/legal-entity.repository.js';
import { resolveLegalEntity, type LegalContext } from '../services/legal-entity.js';

/**
 * Identite legale de l'entreprise pour les pieces editees (factures, bons de
 * commande, bulletins, attestations, pieces de depart). Saisie dans
 * Parametres > Entreprise (mig 326) ; a defaut de raison sociale, le nom
 * commercial.
 */
export interface CompanyLegal {
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  rc?: string;
  if?: string;
  ice?: string;
  patente?: string;
  // Fiche societe (mig 331)
  legalForm?: string;
  capital?: number;
  website?: string;
  communeCode?: string;   // code commune DGI (mig 433)
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function companyLegalFromRow(row: Record<string, unknown> | null | undefined): CompanyLegal {
  return {
    name: str(row?.legal_name) ?? str(row?.company_name) ?? '',
    address: str(row?.legal_address),
    city: str(row?.legal_city),
    phone: str(row?.legal_phone),
    email: str(row?.legal_email),
    rc: str(row?.legal_rc),
    if: str(row?.legal_if),
    ice: str(row?.legal_ice),
    patente: str(row?.legal_patente),
    legalForm: str(row?.legal_form),
    capital: row?.legal_capital !== null && row?.legal_capital !== undefined ? Number(row.legal_capital) : undefined,
    website: str(row?.legal_website),
    communeCode: str(row?.legal_commune_code),
  };
}

/**
 * G6-03 — identité d'une entité juridique, sous la même forme que company_settings.
 * Pour l'entité par défaut (miroir de company_settings, mig 608) le résultat est
 * identique à companyLegalFromRow(company_settings).
 */
export function companyLegalFromEntity(e: LegalEntityRow): CompanyLegal {
  return companyLegalFromRow({
    legal_name: e.legal_name, company_name: e.trade_name,
    legal_address: e.address, legal_city: e.city, legal_phone: e.phone, legal_email: e.email,
    legal_rc: e.rc, legal_if: e.if_number, legal_ice: e.ice, legal_patente: e.patente,
    legal_form: e.legal_form, legal_capital: e.capital, legal_website: e.website,
    legal_commune_code: e.commune_code,
  });
}

/**
 * Identité légale de la pièce : entité imposée, sinon entité de l'établissement de la
 * pièce, sinon entité par défaut (G6-03). Avant la mig 608 : company_settings.
 */
export async function loadCompanyLegal(ctx: LegalContext = {}): Promise<CompanyLegal> {
  const entity = await resolveLegalEntity(ctx);
  if (entity) return companyLegalFromEntity(entity);
  return companyLegalFromRow(await settingsRepository.get());
}

/**
 * Employeur d'un salarié (bulletins, attestations, pièces de départ) : identité de
 * l'entité de son établissement et son n° CNSS. Pour l'entité par défaut, le n° CNSS
 * reste celui des paramètres de paie (synchronisé avec l'entité, mig 608) ; pour une
 * autre entité, celui de l'entité.
 */
export async function loadEmployerLegal(
  ctx: LegalContext, payrollCnss: string | null | undefined,
): Promise<CompanyLegal & { cnss: string | null }> {
  const entity = await resolveLegalEntity(ctx);
  if (entity) {
    return { ...companyLegalFromEntity(entity), cnss: entity.is_default ? (payrollCnss ?? null) : entity.cnss };
  }
  return { ...companyLegalFromRow(await settingsRepository.get()), cnss: payrollCnss ?? null };
}

/** Logo des pièces de l'entité : le sien, sinon celui de la société. */
export async function loadLegalLogo(ctx: LegalContext, companyLogo: string | null | undefined): Promise<string | null> {
  const entity = await resolveLegalEntity(ctx);
  return entity?.logo_url || companyLogo || null;
}
