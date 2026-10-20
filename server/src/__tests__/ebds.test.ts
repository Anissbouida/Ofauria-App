import { describe, it, expect } from 'vitest';
import { affilieKeyValid, immatriculationKeyValid, parsePreetabli, buildEbds, RECORD_LENGTH } from '../services/ebds.js';
import { ribKeyValid, ribKey, splitTransferLines, buildTransferCsv } from '../services/salary-transfer.js';

const pad = (s: string, n: number) => s.padEnd(n, ' ');
const z = (v: number | string, n: number) => String(v).padStart(n, '0');

/** Construit une immatriculation valide (cle C9) a partir de 8 chiffres. */
function withKey(first8: string): string {
  const c = first8.split('').map(Number);
  const t = (c[1] + c[3] + c[5] + c[7]) * 2 + c[2] + c[4] + c[6];
  return first8 + (t % 10 === 0 ? 0 : 10 - (t % 10));
}

const AFF = '1773341';          // exemple du cahier des charges (cle valide)
const PER = '202609';
const IMMA_A = '168764721';     // exemple du cahier des charges
const IMMA_B = withKey('12345678');
const IMMA_NEW = withKey('19876543');

function preetabli(): string {
  const a00 = 'A00' + z('20260900000001', 14) + 'A0' + pad('', 241);
  const a01 = 'A01' + AFF + PER + pad('TRIANGLE D\'ORIENT SARL', 40) + pad('BOULANGERIE', 40) + pad('NR 22 LOT FAJR', 120)
    + pad('MOHAMMEDIA', 20) + pad('28810', 6) + '12' + '20261001' + '20261010';
  const a02 = (num: string, name: string, enfants: number, af: number) =>
    'A02' + AFF + PER + num + pad(name, 60) + z(enfants, 2) + z(af, 6) + z(0, 6) + z(af, 6) + pad('', 155);
  const lines = [a02(IMMA_A, 'ALAOUI AHMED', 2, 60000), a02(IMMA_B, 'BENNANI SARA', 0, 0)];
  const a03 = 'A03' + AFF + PER + z(2, 6) + z(2, 6) + z(60000, 12) + z(0, 12) + z(60000, 12)
    + z(parseInt(IMMA_A) + parseInt(IMMA_B), 15) + pad('', 181);
  return [a00, a01, ...lines, a03].join('\n') + '\n';
}

describe('cles CNSS', () => {
  it('exemples du cahier des charges', () => {
    expect(affilieKeyValid('1773341')).toBe(true);
    expect(affilieKeyValid('1773342')).toBe(false);
    expect(immatriculationKeyValid('168764721')).toBe(true);
    expect(immatriculationKeyValid('168764722')).toBe(false);
    expect(immatriculationKeyValid('100000000')).toBe(false);
  });
});

describe('e-BDS : declaration principale depuis le preetabli', () => {
  const pre = parsePreetabli(preetabli());

  it('lit le preetabli', () => {
    expect(pre.affilie).toBe(AFF);
    expect(pre.periode).toBe(PER);
    expect(pre.a02.map(a => a.numAssure)).toEqual([IMMA_A, IMMA_B]);
    expect(pre.a02[0].afNet).toBe(60000);
  });

  it('refuse un enregistrement qui ne fait pas 260 caracteres', () => {
    expect(() => parsePreetabli('A00123\n')).toThrow(/260/);
  });

  const res = buildEbds(pre, [
    { name: 'Alaoui Ahmed', cnssNumber: IMMA_A, cin: 'BK123456', days: 26, salaireReel: 8000 },
    { name: 'Hajji Noûr-Eddine', cnssNumber: IMMA_NEW, cin: 'T 98765', days: 12.5, salaireReel: 1500.55 },
  ], 6000);
  const lines = res.content.split('\n');

  it('B00..B06 de 260 caracteres, LF, nom DS_affilie_MMAAAA', () => {
    expect(lines.pop()).toBe('');
    expect(lines.every(l => l.length === RECORD_LENGTH)).toBe(true);
    expect(lines.map(l => l.slice(0, 3))).toEqual(['B00', 'B01', 'B02', 'B02', 'B03', 'B04', 'B05', 'B06']);
    expect(res.fileName).toBe('DS_1773341_092026.txt');
  });

  it('B00 et B01 recopient A00 et A01', () => {
    const src = preetabli().split('\n');
    expect(lines[0]).toBe('B00' + src[0].slice(3, 17) + 'B0' + src[0].slice(19));
    expect(lines[1]).toBe('B01' + src[1].slice(3));
  });

  it('B02 declare : zones A02 identiques, centimes, plafond, controle', () => {
    const b = lines[2];
    expect(b.slice(3, 105)).toBe(pre.a02[0].line.slice(3, 105));
    expect(b.slice(105, 111)).toBe('000000');           // AF a reverser
    expect(b.slice(111, 113)).toBe('26');
    expect(b.slice(113, 126)).toBe(z(800000, 13));      // 8 000,00 DH
    expect(b.slice(126, 135)).toBe(z(600000, 9));       // plafond 6 000
    expect(b.slice(135, 137)).toBe('  ');
    expect(parseInt(b.slice(137, 156))).toBe(parseInt(IMMA_A) + 26 + 800000 + 600000);
  });

  it('assure du preetabli sans bulletin : sortant, AF net reversee', () => {
    const b = lines[3];
    expect(b.slice(135, 137)).toBe('SO');
    expect(b.slice(105, 111)).toBe('000000');           // AF net de B = 0
    expect(b.slice(111, 135)).toBe('0'.repeat(24));
    expect(parseInt(b.slice(137, 156))).toBe(parseInt(IMMA_B) + 1);
    expect(res.warnings.some(w => /BENNANI SARA.*SO/.test(w))).toBe(true);
  });

  it('B03 = zones A03 + sommes des B02', () => {
    const b = lines[4];
    expect(b.slice(3, 79)).toBe(pre.a03.slice(3, 79));
    expect(parseInt(b.slice(91, 97))).toBe(26);
    expect(parseInt(b.slice(97, 112))).toBe(800000);
    expect(parseInt(b.slice(112, 125))).toBe(600000);
    expect(parseInt(b.slice(125, 144))).toBe(parseInt(lines[2].slice(137, 156)) + parseInt(lines[3].slice(137, 156)));
  });

  it('B04 entrant : nom et CIN en A-Z0-9, jours arrondis, controle', () => {
    const b = lines[5];
    expect(b.slice(16, 25)).toBe(IMMA_NEW);
    expect(b.slice(25, 85).trim()).toBe('HAJJI NOUR EDDINE');
    expect(b.slice(85, 93)).toBe('T98765  ');
    expect(b.slice(93, 95)).toBe('13');
    expect(parseInt(b.slice(95, 108))).toBe(150055);
    expect(parseInt(b.slice(108, 117))).toBe(150055);
    expect(parseInt(b.slice(117, 136))).toBe(parseInt(IMMA_NEW) + 13 + 150055 + 150055);
  });

  it('B05 = recap entrants, B06 = B03 + B05', () => {
    const b05 = lines[6], b06 = lines[7], b03 = lines[4];
    expect(parseInt(b05.slice(16, 22))).toBe(1);
    expect(parseInt(b05.slice(22, 37))).toBe(parseInt(IMMA_NEW));
    expect(parseInt(b06.slice(16, 22))).toBe(3);
    expect(parseInt(b06.slice(22, 37))).toBe(parseInt(b03.slice(64, 79)) + parseInt(IMMA_NEW));
    expect(parseInt(b06.slice(37, 43))).toBe(39);
    expect(parseInt(b06.slice(43, 58))).toBe(950055);
    expect(parseInt(b06.slice(71, 90))).toBe(parseInt(b03.slice(125, 144)) + parseInt(b05.slice(71, 90)));
    expect(res.totals).toMatchObject({ salaries: 3, entrants: 1, sortants: 1, jours: 39, salaireReel: 9500.55 });
  });

  it('aucun entrant : une ligne B04 vide (9 espaces, zeros)', () => {
    const r = buildEbds(pre, [{ name: 'Alaoui Ahmed', cnssNumber: IMMA_A, cin: null, days: 26, salaireReel: 5000 }], 6000);
    const b04 = r.content.split('\n')[5];
    expect(b04.slice(0, 16)).toBe('B04' + AFF + PER);
    expect(b04.slice(16, 25)).toBe(' '.repeat(9));
    expect(b04.slice(93, 136)).toBe('0'.repeat(43));
    expect(parseInt(r.content.split('\n')[6].slice(16, 22))).toBe(0);
  });

  it('entrant sans immatriculation : 000000000 + CIN', () => {
    const r = buildEbds(pre, [{ name: 'Nouveau', cnssNumber: null, cin: 'AB1234', days: 10, salaireReel: 1000 }], 6000);
    const b04 = r.content.split('\n').find(l => l.startsWith('B04'))!;
    expect(b04.slice(16, 25)).toBe('000000000');
    expect(b04.slice(85, 93)).toBe('AB1234  ');
  });
});

describe('virement groupe', () => {
  // RIB fictif construit avec sa cle (banque 007, localite 780, compte 16 chiffres).
  const RIB = '007780' + '0001234567890123' + ribKey('007780' + '0001234567890123');

  it('cle RIB : mod 97', () => {
    expect(ribKeyValid(RIB)).toBe(true);
    expect(ribKeyValid(RIB.slice(0, 22) + '00')).toBe(RIB.endsWith('00'));
    expect(ribKeyValid('123')).toBe(false);
  });

  it('separe les lignes virables des RIB manquants ou faux', () => {
    const { valid, issues } = splitTransferLines([
      { payrollId: '1', employeeId: 'a', name: 'Alaoui Ahmed', rib: RIB.replace(/(\d{6})/, '$1 '), bankName: 'Attijariwafa', amount: 4200.5 },
      { payrollId: '2', employeeId: 'b', name: 'Sans Rib', rib: null, bankName: null, amount: 3000 },
      { payrollId: '3', employeeId: 'c', name: 'Rib Faux', rib: RIB.slice(0, 22) + (RIB.endsWith('99') ? '98' : '99'), bankName: null, amount: 3000 },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0].rib).toBe(RIB);
    expect(issues.map(i => i.name)).toEqual(['Sans Rib', 'Rib Faux']);
    const csv = buildTransferCsv(valid, 'SALAIRE 09/2026');
    expect(csv).toBe(`N°;Bénéficiaire;RIB;Banque;Montant;Motif\r\n1;ALAOUI AHMED;${RIB};Attijariwafa;4200.50;SALAIRE 09/2026\r\n`);
  });
});
