/**
 * G6-06 — pack pays : résolution d'un paramètre daté (fonction pure) et équivalence du
 * barème d'ancienneté du pack avec l'ancienne fonction codée en dur.
 */
import { describe, it, expect } from 'vitest';
import { resolveParam, countryParamSync, MA_DEFAULTS } from '../services/country-pack.js';
import { seniorityRate, DEFAULT_SENIORITY_BRACKETS } from '../services/payroll-engine.js';
import type { CountryParamRow } from '../repositories/country-pack.repository.js';

const row = (country: string, key: string, effective: string, num: number | null, json: unknown = null): CountryParamRow => ({
  country_code: country, key, category: 'paie', label: key,
  value_numeric: num === null ? null : String(num), value_json: json, effective_from: effective, legal_ref: null,
});

/** Ancienne fonction (avant G6-06), recopiée telle quelle pour prouver le zéro écart. */
function legacySeniorityRate(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 0.05;
  if (years < 12) return 0.10;
  if (years < 20) return 0.15;
  if (years < 25) return 0.20;
  return 0.25;
}

describe('Pack pays — résolution d\'un paramètre daté', () => {
  const rows = [
    row('MA', 'paie.base_days', '2000-01-01', 26),
    row('MA', 'paie.base_days', '2030-01-01', 24),
    row('MA', 'paie.legal_monthly_hours', '2000-01-01', 191),
    row('TN', 'paie.base_days', '2000-01-01', 22),
    row('MA', 'fiscalite.vat_rates', '2000-01-01', null, [7, 10, 14, 20]),
  ];

  it('prend la plus grande date d\'effet <= date', () => {
    expect(resolveParam(rows, 'MA', 'paie.base_days', '2026-11-18')).toBe(26);
    expect(resolveParam(rows, 'MA', 'paie.base_days', '2030-01-01')).toBe(24);
    expect(resolveParam(rows, 'MA', 'paie.base_days', '1999-12-31')).toBe(MA_DEFAULTS['paie.base_days']);
  });

  it('lit le pack du pays actif, puis se replie sur le pack MA, puis sur les valeurs intégrées', () => {
    expect(resolveParam(rows, 'TN', 'paie.base_days', '2026-01-01')).toBe(22);
    expect(resolveParam(rows, 'TN', 'paie.legal_monthly_hours', '2026-01-01')).toBe(191);
    expect(resolveParam([], 'FR', 'paie.ot_rates', '2026-01-01')).toEqual({ day: 0.25, night: 0.5, restDay: 0.5, restNight: 1 });
  });

  it('rend une valeur json telle quelle', () => {
    expect(resolveParam(rows, 'MA', 'fiscalite.vat_rates', '2026-01-01')).toEqual([7, 10, 14, 20]);
  });

  it('lecture synchrone sans chargement : valeurs MA intégrées', () => {
    expect(countryParamSync('fiscalite.vat_rates')).toEqual([7, 10, 14, 20]);
    expect(countryParamSync('paie.base_days')).toBe(26);
  });

  it('valeurs intégrées = anciennes constantes codées en dur', () => {
    expect(MA_DEFAULTS).toMatchObject({
      'paie.base_days': 26, 'paie.legal_monthly_hours': 191, 'paie.legal_weekly_hours': 44,
      'paie.holiday_worked_rate': 1, 'paie.ot_annual_quota_hours': 100,
      'paie.night_window': { start: '21:00', end: '06:00' },
      'formats.rib_length': 24, 'formats.ice_length': 15,
    });
  });
});

describe('Prime d\'ancienneté : barème du pack = ancienne fonction', () => {
  it('même taux de 0 à 45 ans de service (entiers et demi-années)', () => {
    for (let y = 0; y <= 45; y += 0.5) {
      expect(seniorityRate(y)).toBe(legacySeniorityRate(y));
      expect(seniorityRate(y, DEFAULT_SENIORITY_BRACKETS)).toBe(legacySeniorityRate(y));
    }
  });

  it('suit un autre barème (autre pays) et l\'ordre des tranches n\'importe pas', () => {
    const other = [{ minYears: 10, rate: 0.1 }, { minYears: 3, rate: 0.03 }];
    expect(seniorityRate(2, other)).toBe(0);
    expect(seniorityRate(5, other)).toBe(0.03);
    expect(seniorityRate(12, other)).toBe(0.1);
  });
});
