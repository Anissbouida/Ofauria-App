import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { zipOne, xmlEscape, vatPeriodBounds, vatDeductionXml, fraisProRateCode, VAT_PAYMENT_CODE } from '../services/dgi-edi.service.js';

describe('EDI DGI (lot Bonus 14)', () => {
  it('ZIP d\'un fichier : en-têtes, CRC et contenu restituable', () => {
    const data = Buffer.from('<a>é & ç</a>\r\n'.repeat(50), 'utf8');
    const z = zipOne('releve.xml', data, new Date(2026, 5, 30, 10, 20, 30));
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = z.readUInt16LE(26), size = z.readUInt32LE(18);
    expect(z.subarray(30, 30 + nameLen).toString()).toBe('releve.xml');
    expect(inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size)).equals(data)).toBe(true);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt32LE(14)).toBe(z.readUInt32LE(30 + nameLen + size + 16));   // même CRC local / central
  });

  it('échappe le XML et retire les caractères de contrôle', () => {
    expect(xmlEscape(`L'Épi & <Cie> "SARL"\u0001`)).toBe('L&apos;Épi &amp; &lt;Cie&gt; &quot;SARL&quot;');
  });

  it('bornes des périodes mensuelles et trimestrielles', () => {
    expect(vatPeriodBounds(2026, 2, 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(vatPeriodBounds(2024, 1, 2)).toEqual({ start: '2024-01-01', end: '2024-03-31' });
    expect(vatPeriodBounds(2026, 4, 2)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it('relevé des déductions : structure de l\'exemple officiel (BOM, ordre des balises, codes)', () => {
    const xml = vatDeductionXml('1003928', {
      period: { year: 2026, period: 6, regime: 1, start: '2026-06-01', end: '2026-06-30' },
      lines: [{ ord: 1, invoice_id: 'x', num: 'F-12', des: 'Farine', mht: 1000, tva: 70, ttc: 1070, supplier: 'Moulin & Fils',
        if: '3300624', ice: '001234567000089', tx: 7, mp: VAT_PAYMENT_CODE.virement, payment_mode: 'virement', dpai: '2026-06-12', dfac: '2026-06-02' }],
      totals: { ht: 1000, tva: 70, ttc: 1070 }, issues: [],
    });
    expect([...xml.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const s = xml.subarray(3).toString('utf8');
    expect(s.startsWith('<DeclarationReleveDeduction>\r\n\t<identifiantFiscal>1003928</identifiantFiscal>')).toBe(true);
    const order = ['<ord>', '<num>', '<des>', '<mht>', '<tva>', '<ttc>', '<refF>', '<if>', '<nom>', '<ice>', '<tx>', '<mp>', '<id>', '<dpai>', '<dfac>'];
    const pos = order.map(t => s.indexOf(t));
    expect(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1]))).toBe(true);
    expect(s).toContain('<mht>1000.00</mht>');
    expect(s).toContain('<tx>7.00</tx>');
    expect(s).toContain('<nom>Moulin &amp; Fils</nom>');
    expect(s).toContain('<id>4</id>');
    expect(s).toContain('<regime>1</regime>');
  });

  it('codes de paiement et taux de frais professionnels', () => {
    expect([VAT_PAYMENT_CODE.cash, VAT_PAYMENT_CODE.cheque_barre, VAT_PAYMENT_CODE.effet, VAT_PAYMENT_CODE.carte]).toEqual([1, 2, 5, 7]);
    expect(fraisProRateCode(60_000, 21_000)).toBe('TPP.35.2009');
    expect(fraisProRateCode(200_000, 35_000)).toBe('TPP.25.2009');
    expect(fraisProRateCode(0, 0)).toBe('TPP.35.2009');
  });
});
