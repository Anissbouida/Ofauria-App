import { describe, it, expect } from 'vitest';
import { posteOf, computeBilan, computeCpc, computeEsg, simplifyBilan, controls, ACTIF } from '../services/liasse.rules.js';

const b = (code: string, balance: number) => ({ code, label: code, balance });

describe('liasse fiscale — règles (lot Bonus 14)', () => {
  it('rattache amortissements et provisions au poste qu\'ils corrigent', () => {
    expect(posteOf('2321')).toEqual({ poste: '232', contra: false });
    expect(posteOf('2832')).toEqual({ poste: '232', contra: true });
    expect(posteOf('2951')).toEqual({ poste: '251', contra: true });
    expect(posteOf('3942')).toEqual({ poste: '342', contra: true });
    expect(posteOf('486')).toEqual({ poste: '349', contra: false });
  });

  // Exercice type : capital 100 000, matériel 60 000 amorti de 12 000, stock 8 000,
  // clients 30 000, fournisseurs 25 000, banque 14 000, caisse −1 000 (découvert),
  // ventes 120 000, achats 70 000, personnel 30 000, dotations 12 000, IS 3 000.
  const bilanBal = [
    b('1111', -100000), b('2332', 60000), b('2833', -12000), b('3121', 8000), b('3421', 30000),
    b('4411', -25000), b('4453', -3000), b('5141', 14000), b('5161', -1000),
    b('3453', 2000), b('4701', -500), b('3701', 1500),
  ];
  const gestion = [
    b('7121', -120000), b('61221', 70000), b('6171', 30000), b('6191', 12000), b('6701', 3000),
    b('6331', 400), b('7331', -900), b('7513', -5000), b('6513', 4000),
  ];

  it('CPC : produits, charges, résultats intermédiaires et résultat net', () => {
    const c = computeCpc(gestion);
    expect(c.value('I3')).toBe(120000);
    expect(c.value('II')).toBe(112000);
    expect(c.value('III')).toBe(8000);
    expect(c.value('VI')).toBe(500);           // 900 − 400
    expect(c.value('X')).toBe(1000);           // 5 000 − 4 000
    expect(c.value('XI')).toBe(9500);
    expect(c.result).toBe(6500);               // 9 500 − 3 000
    expect(c.value('XVI')).toBe(6500);
    expect(c.unmapped).toEqual([]);
  });

  it('bilan : brut, amortissements, net, banque créditrice au passif, actif = passif', () => {
    const result = computeCpc(gestion).result;
    // Journal équilibré : la somme des soldes 1-5 vaut le résultat (report à nouveau en appoint).
    const plug = result - bilanBal.reduce((s, x) => s + x.balance, 0);
    const bal = [...bilanBal, b('1161', plug)];
    const r = computeBilan(bal, result);
    const a = (id: string) => r.actif.find(l => l.id === id)!;
    const p = (id: string) => r.passif.find(l => l.id === id)!.amount;
    expect(a('C3')).toMatchObject({ gross: 60000, amort: 12000, net: 48000 });
    expect(a('G2').net).toBe(30000);
    expect(a('G4').net).toBe(2000);
    expect(a('I').net).toBe(1500);
    expect(a('J2').net).toBe(14000);
    expect(p('S3')).toBe(1000);                // caisse à découvert → trésorerie passif
    expect(p('R')).toBe(500);
    expect(p('K1')).toBe(100000);
    expect(p('K8')).toBe(6500);
    expect(r.ecart).toBe(0);
    expect(r.total_actif).toBe(r.total_passif);
    expect(r.unmapped).toEqual([]);
  });

  it('signale un compte d\'actif créditeur et un compte sans rubrique', () => {
    const r = computeBilan([b('3421', -200), b('4411', 200), b('9999', 10)], 0);
    expect(r.anomalies.map(x => x.code)).toEqual(['3421', '4411']);
    expect(r.unmapped.map(x => x.code)).toEqual(['9999']);
    const ctrl = controls({ totalActif: 1, totalPassif: 2, bilanResult: 0, cpcResult: 0, esgResult: 0, unmapped: r.unmapped, anomalies: r.anomalies });
    expect(ctrl.filter(c => c.level === 'error')).toHaveLength(2);
    expect(ctrl.filter(c => c.level === 'warning')).toHaveLength(2);
  });

  it('ESG : TFR retrouve le résultat du CPC, CAF hors cessions', () => {
    const e = computeEsg(gestion);
    const t = (id: string) => e.tfr.find(l => l.id === id)!.amount;
    const c = (id: string) => e.caf.find(l => l.id === id)!.amount;
    expect(t('II')).toBe(120000);              // production vendue
    expect(t('III')).toBe(70000);
    expect(t('IV')).toBe(50000);               // valeur ajoutée
    expect(t('V')).toBe(20000);                // EBE
    expect(t('VI')).toBe(8000);
    expect(e.net).toBe(6500);
    expect(e.net).toBe(e.cpcResult);
    // CAF = 6 500 + 12 000 − 5 000 + 4 000
    expect(c('I')).toBe(17500);
    expect(c('II')).toBe(17500);
  });

  it('modèle simplifié : bilan regroupé au niveau des rubriques', () => {
    const r = computeBilan([b('2332', 1000), b('1111', -1000)], 0);
    const s = simplifyBilan(r.actif, ACTIF);
    expect(s.find(l => l.id === 'C3')).toBeUndefined();
    expect(s.find(l => l.id === 'C')).toMatchObject({ kind: 'line', net: 1000 });
    expect(s.find(l => l.id === 'TG')!.net).toBe(1000);
  });
});
