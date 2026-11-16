/**
 * G0-11 — contrôle du SMIG : comparaison du salaire contractuel au SMIG du barème.
 * Les montants utilisés ici sont des valeurs de test, pas des valeurs légales.
 */
import { describe, it, expect } from 'vitest';
import { checkSmig, smigScaleFromRow, smigBlockMessage } from '../services/smig.js';

const scale = { smigHourly: 17, smigMonthly: 3200 };

describe('Contrôle du SMIG (G0-11)', () => {
  it('salarié au mois : sous le SMIG → écart, au SMIG ou au-dessus → rien', () => {
    const f = checkSmig({ monthly_salary: '3000.00', pay_frequency: 'monthly' }, scale);
    expect(f).toMatchObject({ basis: 'mensuel', actual: 3000, minimum: 3200, gap: 200 });
    expect(f?.message).toMatch(/sous le SMIG mensuel/);
    expect(checkSmig({ monthly_salary: 3200 }, scale)).toBeNull();
    expect(checkSmig({ monthly_salary: 4500 }, scale)).toBeNull();
  });

  it('salarié à la semaine : ramené au mois (× 52 / 12)', () => {
    // 700 × 52 / 12 = 3 033,33 < 3 200
    expect(checkSmig({ weekly_salary: 700, pay_frequency: 'weekly' }, scale)).toMatchObject({ actual: 3033.33, gap: 166.67 });
    // 800 × 52 / 12 = 3 466,67 ≥ 3 200
    expect(checkSmig({ weekly_salary: 800, pay_frequency: 'weekly' }, scale)).toBeNull();
  });

  it('salarié à l\'heure : taux horaire contre le SMIG horaire', () => {
    expect(checkSmig({ hourly_rate: 15.5 }, scale)).toMatchObject({ basis: 'horaire', minimum: 17 });
    expect(checkSmig({ hourly_rate: 17 }, scale)).toBeNull();
  });

  it('mode bloquant : refus nominatif dès qu\'un salarié est sous le SMIG', () => {
    const staff = [
      { first_name: 'Sara', last_name: 'A', monthly_salary: 3000 },
      { first_name: 'Omar', last_name: 'B', monthly_salary: 5000 },
    ];
    expect(smigBlockMessage(staff, scale)).toMatch(/Paie bloquée : 1 salarié\(s\) sous le SMIG — Sara A/);
    expect(smigBlockMessage(staff.slice(1), scale)).toBeNull();
    expect(smigBlockMessage(staff, { smigHourly: null, smigMonthly: null })).toBeNull();
  });

  it('sans SMIG saisi ou sans salaire : aucun contrôle', () => {
    expect(checkSmig({ monthly_salary: 1000 }, { smigHourly: null, smigMonthly: null })).toBeNull();
    expect(checkSmig({}, scale)).toBeNull();
    expect(smigScaleFromRow(null)).toEqual({ smigHourly: null, smigMonthly: null });
    expect(smigScaleFromRow({ smig_hourly: '17.0000', smig_monthly: '' })).toEqual({ smigHourly: 17, smigMonthly: null });
  });
});
