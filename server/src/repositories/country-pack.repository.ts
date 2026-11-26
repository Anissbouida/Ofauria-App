import { db } from '../config/database.js';
import { companyCountryCode } from '../services/module-parameters.service.js';

/**
 * Pack pays (G6-06, mig 606) : accès aux données. La logique (valeur en vigueur, cache,
 * repli sur le Maroc) est dans services/country-pack.ts.
 */

export interface CountryPackRow {
  code: string;
  name: string;
  default_currency: string;
  declarative_formats: string[];
  notes: string | null;
}

export interface CountryParamRow {
  country_code: string;
  key: string;
  category: 'paie' | 'fiscalite' | 'formats';
  label: string;
  value_numeric: string | null;
  value_json: unknown;
  effective_from: string;
  legal_ref: string | null;
}

export const countryPackRepository = {
  /** Pays actif de la société : module_parameters company.country_code (mig 309), 'MA' à défaut. */
  async activeCountry(): Promise<string> {
    // Base antérieure à la mig 306 (table absente) : repli sur le Maroc.
    return companyCountryCode().catch(() => 'MA');
  },

  /** Tables du pack présentes (base antérieure à la mig 606 : repli sur les valeurs intégrées). */
  async available(): Promise<boolean> {
    const r = await db.query(`SELECT to_regclass('public.country_pack_parameters') IS NOT NULL AS ok`);
    return !!r.rows[0]?.ok;
  },

  async pack(code: string): Promise<CountryPackRow | null> {
    const r = await db.query(
      `SELECT code, name, default_currency, declarative_formats, notes FROM country_packs WHERE code = $1`, [code]);
    return (r.rows[0] as CountryPackRow | undefined) ?? null;
  },

  /** Tous les paramètres (toutes dates) des pays demandés. */
  async parameters(codes: string[]): Promise<CountryParamRow[]> {
    const r = await db.query(
      `SELECT country_code, key, category, label, value_numeric, value_json,
              effective_from::text AS effective_from, legal_ref
         FROM country_pack_parameters
        WHERE country_code = ANY($1::char(2)[])
        ORDER BY category, key, effective_from`, [codes]);
    return r.rows as CountryParamRow[];
  },
};
