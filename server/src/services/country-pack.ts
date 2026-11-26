/**
 * Pack pays (G6-06, mig 606) : paramètres légaux de la paie et de la fiscalité, datés, par pays.
 *
 *  - countryParam(key, date?)  : valeur en vigueur à une date (défaut : aujourd'hui) pour le pays
 *                                actif (module_parameters company.country_code). Repli : valeur du
 *                                pack MA, puis valeur intégrée MA_DEFAULTS (base sans mig 606,
 *                                tests unitaires). Cache court (60 s).
 *  - countryParamSync(key)     : dernière valeur connue pour aujourd'hui (validateurs synchrones),
 *                                chargée au démarrage (index.ts) ; MA_DEFAULTS à défaut.
 *  - declarativeFormatAvailable(format) : les formats déclaratifs (e-BDS, EDI DGI, liasse) restent
 *                                propres à leur pays ; une route qui en produit un est refusée
 *                                (400) si le pack du pays actif ne le porte pas.
 *
 * Ce qui reste ailleurs, par réutilisation : barème de cotisations / IR daté (payroll_tax_scales),
 * codes TVA datés (tax_codes), réglages de l'employeur (payroll_settings, prioritaires sur la
 * valeur légale du pack).
 *
 * Analogie Oracle : une table de paramètres « à date d'effet » lue par un package qui garde le
 * résultat en variable de package quelques secondes.
 */
import { businessTz } from '../utils/timezone.js';
import { countryPackRepository, type CountryParamRow, type CountryPackRow } from '../repositories/country-pack.repository.js';
import { DEFAULT_OT_RATES, type OvertimeRates } from './overtime-engine.js';
import { DEFAULT_SENIORITY_BRACKETS, type SeniorityBracket } from './payroll-engine.js';

export interface CountryParams {
  'paie.base_days': number;
  'paie.legal_monthly_hours': number;
  'paie.legal_weekly_hours': number;
  'paie.ot_rates': OvertimeRates;
  'paie.night_window': { start: string; end: string };
  'paie.holiday_worked_rate': number;
  'paie.ot_annual_quota_hours': number;
  'paie.seniority_brackets': SeniorityBracket[];
  'fiscalite.vat_rates': number[];
  'formats.rib_length': number;
  'formats.ice_length': number;
}
export type CountryParamKey = keyof CountryParams;

/** Valeurs du pack MA (identiques au contenu de la mig 606) : dernier repli. */
export const MA_DEFAULTS: CountryParams = {
  'paie.base_days': 26,
  'paie.legal_monthly_hours': 191,
  'paie.legal_weekly_hours': 44,
  'paie.ot_rates': DEFAULT_OT_RATES,
  'paie.night_window': { start: '21:00', end: '06:00' },
  'paie.holiday_worked_rate': 1,
  'paie.ot_annual_quota_hours': 100,
  'paie.seniority_brackets': DEFAULT_SENIORITY_BRACKETS,
  // Taux en vigueur (CGI 2026 art. 99) ; les anciens taux 7 % et 14 % restent lisibles par date (mig 668).
  'fiscalite.vat_rates': [10, 20],
  'formats.rib_length': 24,
  'formats.ice_length': 15,
};

export const FALLBACK_COUNTRY = 'MA';
const TTL_MS = 60_000;

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: businessTz() });

const valueOf = (row: CountryParamRow): unknown =>
  row.value_numeric !== null && row.value_numeric !== undefined ? Number(row.value_numeric) : row.value_json;

/**
 * Valeur en vigueur (fonction pure) : pour le pays demandé, la ligne de plus grande date d'effet
 * <= date ; sinon même recherche sur le pack MA ; sinon MA_DEFAULTS.
 */
export function resolveParam<K extends CountryParamKey>(
  rows: CountryParamRow[], country: string, key: K, date: string,
): CountryParams[K] {
  for (const c of country === FALLBACK_COUNTRY ? [country] : [country, FALLBACK_COUNTRY]) {
    let best: CountryParamRow | null = null;
    for (const r of rows) {
      if (r.country_code.trim() !== c || r.key !== key || r.effective_from.slice(0, 10) > date) continue;
      if (!best || r.effective_from > best.effective_from) best = r;
    }
    if (best) return valueOf(best) as CountryParams[K];
  }
  return MA_DEFAULTS[key];
}

let cache: { at: number; country: string; rows: CountryParamRow[] } | null = null;

async function load(): Promise<{ country: string; rows: CountryParamRow[] }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  let country = FALLBACK_COUNTRY;
  let rows: CountryParamRow[] = [];
  try {
    country = await countryPackRepository.activeCountry();
    if (await countryPackRepository.available()) rows = await countryPackRepository.parameters([...new Set([country, FALLBACK_COUNTRY])]);
  } catch { /* base indisponible ou ancienne : valeurs intégrées */ }
  cache = { at: Date.now(), country, rows };
  return cache;
}

/** Pays actif de la société (code ISO), 'MA' à défaut. */
export async function activeCountryCode(): Promise<string> {
  return (await load()).country;
}

/** Valeur d'un paramètre du pack du pays actif, en vigueur à `date` (AAAA-MM-JJ, défaut aujourd'hui). */
export async function countryParam<K extends CountryParamKey>(key: K, date?: string): Promise<CountryParams[K]> {
  const { country, rows } = await load();
  return resolveParam(rows, country, key, (date ?? today()).slice(0, 10));
}

/** Lecture synchrone (validateurs) : dernière valeur chargée, pour aujourd'hui. */
export function countryParamSync<K extends CountryParamKey>(key: K): CountryParams[K] {
  return cache ? resolveParam(cache.rows, cache.country, key, today()) : MA_DEFAULTS[key];
}

/** Chargement au démarrage du serveur. */
export const loadCountryPack = async () => { await load(); };
/** Vide le cache (tests, après une modification du pack). */
export const clearCountryPackCache = () => { cache = null; };

/**
 * Format déclaratif disponible pour le pays actif ? Base sans mig 606 : seul le Maroc est
 * supposé (comportement antérieur).
 */
export async function declarativeFormatAvailable(format: string): Promise<{ ok: boolean; country: string }> {
  const country = await activeCountryCode();
  let pack: CountryPackRow | null = null;
  try {
    pack = (await countryPackRepository.available()) ? await countryPackRepository.pack(country) : null;
  } catch { pack = null; }
  if (!pack) return { ok: country === FALLBACK_COUNTRY, country };
  return { ok: (pack.declarative_formats ?? []).includes(format), country };
}

export const declarativeFormatRefusal = (label: string, country: string) =>
  `${label} : format déclaratif disponible pour le pays MA seulement (pays de la société : ${country}).`;

/** Vue lecture seule du pack (Paramètres) : pack, paramètres en vigueur et historique. */
export async function countryPackOverview(date?: string) {
  const d = (date ?? today()).slice(0, 10);
  const { country, rows } = await load();
  let pack: CountryPackRow | null = null;
  try { pack = (await countryPackRepository.available()) ? await countryPackRepository.pack(country) : null; } catch { pack = null; }
  const own = rows.filter(r => r.country_code.trim() === country);
  const source = own.length ? own : rows.filter(r => r.country_code.trim() === FALLBACK_COUNTRY);
  const keys = [...new Set(source.map(r => r.key))];
  const parameters = keys.map(key => {
    const history = source.filter(r => r.key === key);
    const current = history.filter(r => r.effective_from.slice(0, 10) <= d).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
    return {
      key,
      category: (current ?? history[0]).category,
      label: (current ?? history[0]).label,
      value: current ? valueOf(current) : null,
      effectiveFrom: current?.effective_from.slice(0, 10) ?? null,
      legalRef: current?.legal_ref ?? null,
      upcoming: history.filter(r => r.effective_from.slice(0, 10) > d).map(r => ({ value: valueOf(r), effectiveFrom: r.effective_from.slice(0, 10) })),
    };
  });
  return {
    country,
    pack: pack ? { code: pack.code.trim(), name: pack.name, defaultCurrency: pack.default_currency.trim(), declarativeFormats: pack.declarative_formats, notes: pack.notes } : null,
    fallback: !own.length && country !== FALLBACK_COUNTRY,
    date: d,
    parameters,
  };
}
