import { settingsRepository } from '../repositories/settings.repository.js';

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
  };
}

export async function loadCompanyLegal(): Promise<CompanyLegal> {
  return companyLegalFromRow(await settingsRepository.get());
}
