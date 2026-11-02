/**
 * Lecture des relevés bancaires (mig 426) : un fichier type par format,
 * détection automatique, montants et dates.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  detectFormat, parseStatement, parseAmount, parseDate, type CsvProfile,
} from '../services/bank-statement-import.service.js';

const buf = (s: string) => Buffer.from(s, 'utf-8');

describe('montants et dates', () => {
  it('lit les montants à la française, signés ou entre parenthèses', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('-1.234,56')).toBe(-1234.56);
    expect(parseAmount('(12,00)')).toBe(-12);
    expect(parseAmount('12,00-')).toBe(-12);
    expect(parseAmount('1,234.56', '.')).toBe(1234.56);
    expect(parseAmount('350,00 DH')).toBe(350);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('lit les dates selon le format du profil et refuse une date impossible', () => {
    expect(parseDate('05/06/2026', 'DD/MM/YYYY')).toBe('2026-06-05');
    expect(parseDate('05.06.26', 'DD/MM/YY')).toBe('2026-06-05');
    expect(parseDate('2026-06-05', 'YYYY-MM-DD')).toBe('2026-06-05');
    expect(parseDate('06/05/2026', 'MM/DD/YYYY')).toBe('2026-06-05');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
  });
});

describe('CSV', () => {
  const profile: CsvProfile = { decimalSep: ',', dateFormat: 'DD/MM/YYYY', skipRows: 0, hasHeader: true, colDate: 0, colLabel: 1, colDebit: 2, colCredit: 3 };

  it('débit/crédit séparés, guillemets, BOM, total ignoré', () => {
    const csv = '﻿Date;Libellé;Débit;Crédit\n'
      + '02/06/2026;"VIR ECOMAB; facture 12";350,50;\n'
      + '05/06/2026;REMISE CHEQUE;;1 200,00\n'
      + ';Total;350,50;1 200,00\n';
    expect(detectFormat(buf(csv), 'releve.csv')).toBe('csv');
    const r = parseStatement(buf(csv), { profile });
    expect(r.lines).toEqual([
      { operationDate: '2026-06-02', valueDate: null, label: 'VIR ECOMAB; facture 12', reference: null, amount: 350.5, direction: 'out' },
      { operationDate: '2026-06-05', valueDate: null, label: 'REMISE CHEQUE', reference: null, amount: 1200, direction: 'in' },
    ]);
    expect(r.warnings.join(' ')).toMatch(/1 ligne\(s\) sans date ou sans montant/);
    expect(r.rawRows?.[0]).toEqual(['Date', 'Libellé', 'Débit', 'Crédit']);
  });

  it('montant signé, séparateur virgule, Windows-1252', () => {
    const text = 'Date opération,Libellé,Montant\n03/06/2026,PRLV Société Générale,-89.90\n10/06/2026,VIR REÇU,1500.00\n';
    const latin1 = Buffer.from(text, 'latin1');   // fichier enregistré en Windows-1252, pas en UTF-8
    const r = parseStatement(latin1, { profile: { ...profile, decimalSep: '.', colDebit: null, colCredit: null, colAmount: 2 } });
    expect(r.lines.map(l => [l.label, l.amount, l.direction])).toEqual([
      ['PRLV Société Générale', 89.9, 'out'],
      ['VIR REÇU', 1500, 'in'],
    ]);
  });

  it('sans profil, renvoie les lignes brutes pour choisir les colonnes', () => {
    const r = parseStatement(buf('a;b;c\n1;2;3\n'), {});
    expect(r.lines).toHaveLength(0);
    expect(r.rawRows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
});

describe('Excel', () => {
  it('lit la première feuille avec de vraies dates et nombres', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Relevé BMCE juin'], [],
      ['Date', 'Opération', 'Débit', 'Crédit'],
      [new Date(2026, 5, 2), 'VIR ECOMAB', 350.5, ''],
      [new Date(2026, 5, 5), 'REMISE', '', 1200],
    ], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relevé');
    const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(detectFormat(file, 'releve.xlsx')).toBe('xlsx');
    const r = parseStatement(file, { profile: { decimalSep: ',', dateFormat: 'DD/MM/YYYY', skipRows: 1, hasHeader: true, colDate: 0, colLabel: 1, colDebit: 2, colCredit: 3 } });
    expect(r.lines.map(l => [l.operationDate, l.amount, l.direction])).toEqual([['2026-06-02', 350.5, 'out'], ['2026-06-05', 1200, 'in']]);
  });
});

describe('OFX', () => {
  it('lit un OFX SGML : opérations, compte, solde et ouverture recalculée', () => {
    const ofx = 'OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MAD'
      + '<BANKACCTFROM><ACCTID>0001234<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260601<DTEND>20260630\n'
      + '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260603120000<TRNAMT>-89.90<FITID>A1<NAME>PRLV ORANGE<MEMO>Facture internet</STMTTRN>\n'
      + '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260610<TRNAMT>1500.00<FITID>A2<NAME>VIR CLIENT</STMTTRN>\n'
      + '</BANKTRANLIST><LEDGERBAL><BALAMT>5410.10<DTASOF>20260630</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
    expect(detectFormat(buf(ofx), 'export.ofx')).toBe('ofx');
    const r = parseStatement(buf(ofx), {});
    expect(r).toMatchObject({ format: 'ofx', accountNumber: '0001234', currency: 'MAD', closingBalance: 5410.1, openingBalance: 4000, statementDate: '2026-06-30', warnings: [] });
    expect(r.lines).toEqual([
      { operationDate: '2026-06-03', valueDate: null, label: 'PRLV ORANGE — Facture internet', reference: 'A1', amount: 89.9, direction: 'out' },
      { operationDate: '2026-06-10', valueDate: null, label: 'VIR CLIENT', reference: 'A2', amount: 1500, direction: 'in' },
    ]);
  });
});

describe('MT940', () => {
  it('date comptable sans année : rattachée à l\'année la plus proche de la date de valeur', () => {
    const mt = ':20:X\n:61:2701021231D10,00NTRFNONREF\n:61:2612310102C20,00NTRFNONREF\n';
    // Valeur 02/01/2027 comptée le 31/12 → 2026 ; valeur 31/12/2026 comptée le 02/01 → 2027.
    expect(parseStatement(buf(mt), { format: 'mt940' }).lines.map(l => [l.valueDate, l.operationDate]))
      .toEqual([['2027-01-02', '2026-12-31'], ['2026-12-31', '2027-01-02']]);
  });

  it('lit soldes, opérations et libellés :86:, contrôle des soldes juste', () => {
    const mt = ':20:STMT2026-06\n:25:011780000123456789\n:28C:00045/001\n:60F:C260531MAD12500,00\n'
      + ':61:2606020602D350,50NTRFNONREF//BK123\n:86:VIREMENT FOURNISSEUR?20ECOMAB\n'
      + ':61:2606050605C1200,00NMSCFAC2026-01\n:86:REMISE CHEQUE\nCLIENT\n'
      + ':62F:C260630MAD13349,50\n-\n';
    expect(detectFormat(buf(mt), 'releve.sta')).toBe('mt940');
    const r = parseStatement(buf(mt), {});
    expect(r).toMatchObject({ format: 'mt940', accountNumber: '011780000123456789', currency: 'MAD', openingBalance: 12500, closingBalance: 13349.5, statementDate: '2026-06-30', warnings: [] });
    expect(r.lines).toEqual([
      { operationDate: '2026-06-02', valueDate: '2026-06-02', label: 'VIREMENT FOURNISSEUR ECOMAB', reference: 'BK123', amount: 350.5, direction: 'out' },
      { operationDate: '2026-06-05', valueDate: '2026-06-05', label: 'REMISE CHEQUE CLIENT', reference: 'FAC2026-01', amount: 1200, direction: 'in' },
    ]);
  });
});

describe('CFONB 120', () => {
  /** Montant CFONB : 13 chiffres + dernier chiffre codé avec le signe. */
  const enc = (amount: number) => {
    const c = Math.round(Math.abs(amount) * 100).toString().padStart(14, '0');
    return c.slice(0, 13) + (amount < 0 ? '}JKLMNOPQR' : '{ABCDEFGHI')[Number(c.slice(-1))];
  };
  const rec = (code: string, date: string, amount: number, label = '', ref = '', valueDate = '') =>
    (code + '30004' + '    ' + '00123' + 'MAD' + '2' + ' ' + '12345678901' + 'B1' + date + '  ' + valueDate.padEnd(6)
      + label.padEnd(31).slice(0, 31) + '  ' + '0000001' + ' ' + ' ' + enc(amount) + ref.padEnd(16)).padEnd(120);

  it('lit ancien solde, mouvements signés, complément 05 et nouveau solde', () => {
    const lines = [
      rec('01', '310526', 12500),
      rec('04', '020626', -350.5, 'VIR ECOMAB', 'BK123', '020626'),
      '05' + '30004' + '    ' + '00123' + 'MAD' + '2' + ' ' + '12345678901' + 'B1' + '020626' + '     ' + 'LIB' + 'FACTURE 12'.padEnd(70) + '  ',
      rec('04', '050626', 1200, 'REMISE CHEQUE', '', '050626'),
      rec('07', '300626', 13349.5),
    ];
    lines.forEach(l => expect(l).toHaveLength(120));
    const file = lines.join('\r\n');
    expect(detectFormat(buf(file), 'releve.txt')).toBe('cfonb');
    const r = parseStatement(buf(file), {});
    expect(r).toMatchObject({ format: 'cfonb', accountNumber: '12345678901', currency: 'MAD', openingBalance: 12500, closingBalance: 13349.5, statementDate: '2026-06-30', warnings: [] });
    expect(r.lines).toEqual([
      { operationDate: '2026-06-02', valueDate: '2026-06-02', label: 'VIR ECOMAB FACTURE 12', reference: 'BK123', amount: 350.5, direction: 'out' },
      { operationDate: '2026-06-05', valueDate: '2026-06-05', label: 'REMISE CHEQUE', reference: '0000001', amount: 1200, direction: 'in' },
    ]);
    // Sans fins de ligne (fichier en un bloc), même résultat.
    expect(parseStatement(buf(lines.join('')), {}).lines).toHaveLength(2);
  });

  it('signale des soldes incohérents', () => {
    const file = [rec('01', '310526', 100), rec('04', '020626', -10, 'X'), rec('07', '300626', 95)].join('\n');
    expect(parseStatement(buf(file), {}).warnings.join(' ')).toMatch(/incohérents/);
  });
});
