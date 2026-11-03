import { describe, it, expect } from 'vitest';
import { decide } from '../services/credit-control.js';

describe('Contrôle de crédit — décision (O2C L3)', () => {
  const base = { limit: 1000, onHold: false, blocking: false };
  it('sous le plafond ou sans plafond : passe', () => {
    expect(decide({ ...base, exposureAfter: 1000 }).decision).toBe('pass');
    expect(decide({ ...base, limit: null, exposureAfter: 99_999 }).decision).toBe('pass');
    expect(decide({ ...base, limit: 0, exposureAfter: 99_999 }).decision).toBe('pass');
  });
  it('plafond dépassé : alerte, ou blocage au jalon bloquant', () => {
    const warn = decide({ ...base, exposureAfter: 1200.5 });
    expect(warn.decision).toBe('warn');
    expect(warn.message).toMatch(/1\s?200,50 DH engagés pour un plafond de 1\s?000,00 DH/);
    expect(decide({ ...base, blocking: true, exposureAfter: 1200 }).decision).toBe('block');
  });
  it('client bloqué : refusé même sous le plafond et hors jalon bloquant', () => {
    const d = decide({ ...base, onHold: true, holdReason: 'Relance niveau 3', exposureAfter: 10 });
    expect(d).toEqual({ decision: 'block', message: 'Client bloqué : achats à crédit suspendus (Relance niveau 3).' });
  });
  it('dérogation : tracée comme telle, avec le motif du refus', () => {
    const d = decide({ ...base, blocking: true, override: true, exposureAfter: 5000 });
    expect(d.decision).toBe('override');
    expect(d.message).toMatch(/Plafond de crédit dépassé/);
    // Rien à déroger quand tout passe.
    expect(decide({ ...base, override: true, exposureAfter: 10 }).decision).toBe('pass');
  });
});
