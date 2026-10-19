import { describe, it, expect } from 'vitest';
import { trialEndDate, renewedTrialEnd, cddRenewalWarnings, computeHrAlerts } from '../services/contract-rules.js';

describe('periode d essai', () => {
  it('cadre 3 mois, employe 1,5 mois, ouvrier 15 jours (dernier jour inclus)', () => {
    expect(trialEndDate('2026-01-01', 'cadre')).toBe('2026-03-31');
    expect(trialEndDate('2026-01-01', 'employe')).toBe('2026-02-15');
    expect(trialEndDate('2026-01-01', 'ouvrier')).toBe('2026-01-15');
  });
  it('renouvellement unique, meme duree', () => {
    expect(renewedTrialEnd('2026-01-15', '2026-01-01', 'ouvrier', false)).toBe('2026-01-30');
    expect(() => renewedTrialEnd('2026-01-30', '2026-01-01', 'ouvrier', true)).toThrow(/qu'une fois/);
  });
});

describe('renouvellement de CDD', () => {
  it('premier renouvellement : pas d avertissement', () => {
    expect(cddRenewalWarnings([{ kind: 'contrat', startDate: '2026-01-01', endDate: '2026-06-30' }], '2026-12-31')).toEqual([]);
  });
  it('second renouvellement : requalification', () => {
    const w = cddRenewalWarnings([
      { kind: 'contrat', startDate: '2025-01-01', endDate: '2025-12-31' },
      { kind: 'renouvellement', startDate: '2026-01-01', endDate: '2026-12-31' },
    ], '2027-06-30');
    expect(w[0]).toMatch(/requalifie/);
    expect(w[1]).toMatch(/2 ans/);           // 2025-01-01 -> 2027-06-30
  });
});

describe('alertes RH', () => {
  const base = {
    today: '2026-10-19', horizonDays: 30,
    employees: [
      { id: 'a', name: 'A', isDeclared: true, cnssNumber: null, cin: 'X1', cinExpiresOn: '2026-11-01' },
      { id: 'b', name: 'B', isDeclared: false, cnssNumber: null, cin: null, cinExpiresOn: null },
    ],
    contracts: [
      { employeeId: 'a', contractType: 'cdd', endDate: '2026-10-25', trialEndDate: null, status: 'active' },
      { employeeId: 'b', contractType: 'cdd', endDate: '2026-10-01', trialEndDate: '2026-10-29', status: 'active' },
    ],
    documents: [{ employeeId: 'a', docType: 'contrat', title: 'Contrat', expiresOn: null }],
  };
  const alerts = computeHrAlerts(base);
  it('CDD echu en premier (danger), fin proche, fin d essai, CIN qui expire', () => {
    expect(alerts[0]).toMatchObject({ employeeId: 'b', kind: 'cdd_expired', severity: 'danger' });
    expect(alerts.find(a => a.kind === 'cdd_end')).toMatchObject({ employeeId: 'a', daysLeft: 6, severity: 'danger' });
    expect(alerts.find(a => a.kind === 'trial_end')).toMatchObject({ employeeId: 'b', daysLeft: 10 });
    expect(alerts.find(a => a.kind === 'doc_expiry')).toMatchObject({ employeeId: 'a', daysLeft: 13 });
  });
  it('dossier incomplet : contrat signe, CIN, n° CNSS si declare', () => {
    expect(alerts.find(a => a.employeeId === 'a' && a.kind === 'missing_doc')?.message).toMatch(/n° CNSS/);
    expect(alerts.find(a => a.employeeId === 'b' && a.kind === 'missing_doc')?.message).toMatch(/contrat signé, CIN/);
  });
});
