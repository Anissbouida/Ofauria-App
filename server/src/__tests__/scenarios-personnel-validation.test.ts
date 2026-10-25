/**
 * Scenarios RH — contrôle du RIB à la saisie (tests PURS, sans base).
 *
 * Parcours gérant : à l'embauche (ou lors d'une mise à jour), le RIB marocain
 * est validé AVANT persistance par createEmployeeSchema. La clé de contrôle
 * mod-97 (F-057) est vérifiée dès la saisie, pas seulement à la génération de
 * l'ordre de virement : un RIB à clé fausse est refusé, un RIB valide (espaces
 * tolérés) accepté, et l'absence de RIB reste permise (champ optionnel).
 *
 * Ces scénarios ne touchent pas la base : ils valident le schéma zod et la
 * fonction pure ribKey/ribKeyValid.
 */
import { describe, it, expect } from 'vitest';
import { createEmployeeSchema, updateEmployeeSchema } from '../validators/employees.validator.js';
import { ribKey, ribKeyValid } from '../services/salary-transfer.js';

// Un salarié minimal valide (les seuls champs requis : prénom, nom, rôle, date d'embauche).
const base = { firstName: 'Yassine', lastName: 'El Alami', role: 'cashier', hireDate: '2026-01-01' };

// RIB marocain = 24 chiffres dont les 2 derniers forment la clé mod-97.
const first22 = '2307800012345678901234';
const validRib = first22 + ribKey(first22);
const badRib = first22 + (ribKey(first22) === '00' ? '01' : '00');

describe('Embauche — contrôle du RIB à la saisie', () => {
  it('le RIB de référence a bien une clé valide (sanity sur le helper)', () => {
    expect(validRib).toHaveLength(24);
    expect(ribKeyValid(validRib)).toBe(true);
    expect(ribKeyValid(badRib)).toBe(false);
  });

  it('accepte un salarié avec un RIB à clé mod-97 valide', () => {
    const r = createEmployeeSchema.safeParse({ ...base, rib: validRib, bankName: 'Attijariwafa' });
    expect(r.success).toBe(true);
    // Le RIB est normalisé (sans espaces) à 24 chiffres.
    if (r.success) expect(r.data.rib).toBe(validRib);
  });

  it('accepte le même RIB saisi par blocs de 4 (espaces tolérés)', () => {
    const spaced = validRib.replace(/(.{4})/g, '$1 ').trim();
    const r = createEmployeeSchema.safeParse({ ...base, rib: spaced });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rib).toBe(validRib); // espaces retirés
  });

  it('refuse un salarié dont la clé RIB est fausse', () => {
    const r = createEmployeeSchema.safeParse({ ...base, rib: badRib });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/clé de contrôle|RIB/i);
    }
  });

  it('refuse un RIB qui n a pas 24 chiffres', () => {
    expect(createEmployeeSchema.safeParse({ ...base, rib: '2307800012' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, rib: validRib + '5' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, rib: 'ABCDEFGHIJKLMNOPQRSTUVWX' }).success).toBe(false);
  });

  it('le RIB est optionnel : embauche sans RIB (absent ou vide) acceptée', () => {
    expect(createEmployeeSchema.safeParse({ ...base }).success).toBe(true);
    const empty = createEmployeeSchema.safeParse({ ...base, rib: '' });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.rib ?? null).toBeNull(); // '' -> null
  });

  it('même contrôle à la mise à jour (RIB corrigé en cours de vie)', () => {
    expect(updateEmployeeSchema.safeParse({ rib: validRib }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse({ rib: badRib }).success).toBe(false);
  });
});
