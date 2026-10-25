/**
 * F-013 — Normalisation des modes de reglement (facture).
 *
 * payment_modes (paiements : virement|cheque|effet…) vs payment_methods
 * (factures : transfer|check|traite…). Saisir « virement » sur une facture
 * levait « Mode de reglement invalide ». normalizePaymentMethod convertit le
 * vocabulaire paiement vers celui des factures ; les codes facture passent tels
 * quels, null/'' aussi.
 */
import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

const { normalizePaymentMethod } = await import('../controllers/accounting.controller.js');

describe('F-013 — normalizePaymentMethod', () => {
  it('convertit le vocabulaire paiement vers celui des factures', () => {
    expect(normalizePaymentMethod('virement')).toBe('transfer');
    expect(normalizePaymentMethod('cheque')).toBe('check');
    expect(normalizePaymentMethod('cheque_barre')).toBe('check');
    expect(normalizePaymentMethod('effet')).toBe('traite');
    expect(normalizePaymentMethod('carte')).toBe('card');
    expect(normalizePaymentMethod('cash')).toBe('cash');
    expect(normalizePaymentMethod('mobile')).toBe('mobile');
  });

  it('laisse passer les codes facture deja valides', () => {
    for (const c of ['transfer', 'check', 'traite', 'card', 'deferred', 'mixed']) {
      expect(normalizePaymentMethod(c)).toBe(c);
    }
  });

  it('laisse passer null / vide / undefined sans erreur', () => {
    expect(normalizePaymentMethod(null)).toBeNull();
    expect(normalizePaymentMethod('')).toBe('');
    expect(normalizePaymentMethod(undefined)).toBeUndefined();
  });
});
