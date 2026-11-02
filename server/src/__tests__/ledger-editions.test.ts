/**
 * Éditions comptables : rendu PDF (pagination) et Excel (montants numériques,
 * lignes typées) d'un état construit à la main.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { renderPdf, renderXlsx, fmtAmount, type Edition, type EditionContext } from '../services/ledger-editions.service.js';

const ctx: EditionContext = {
  legal: { name: 'BOULANGERIE TEST SARL', if: '12345678', ice: '001234567000089', rc: '4321' },
  author: 'Aniss Test', generatedAt: new Date('2026-11-02T10:00:00Z'), chain: { seq: 42, hash: 'a'.repeat(64) },
};
const edition = (lines: number): Edition => ({
  key: 'test', title: 'Livre-journal', period: 'Du 01/06/2026 au 30/06/2026', orientation: 'landscape',
  columns: [
    { key: 'date', label: 'Date', width: 10 }, { key: 'label', label: 'Libellé', width: 60 },
    { key: 'debit', label: 'Débit', width: 15, align: 'right', amount: true }, { key: 'credit', label: 'Crédit', width: 15, align: 'right', amount: true },
  ],
  rows: [
    { kind: 'group', cells: { date: '01/06/2026', label: 'OD-2026-00001 Écriture test' } },
    ...Array.from({ length: lines }, (_, i) => ({ kind: 'line' as const, cells: { label: `Ligne ${i + 1}`, debit: i % 2 ? null : 100.5, credit: i % 2 ? 100.5 : null } })),
    { kind: 'total', cells: { label: 'Total', debit: (lines / 2) * 100.5, credit: (lines / 2) * 100.5 } },
  ],
  carry: ['debit', 'credit'],
});
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('éditions comptables', () => {
  it('formate les montants à la française sans espace insécable', () => {
    expect(fmtAmount(1234567.5)).toBe('1 234 567,50');
  });

  it('pagine un long état en PDF', async () => {
    const short = await renderPdf(edition(4), ctx);
    expect(short.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(short)).toBe(1);
    expect(pages(await renderPdf(edition(200), ctx))).toBeGreaterThanOrEqual(5);
  });

  it('produit un classeur Excel aux montants numériques', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderXlsx(edition(4), ctx)) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('BOULANGERIE TEST SARL');
    expect(String(ws.getCell('A2').value)).toContain('Livre-journal');
    const header = ws.getRow(5).values as unknown[];
    expect(header.slice(1)).toEqual(['Date', 'Libellé', 'Débit', 'Crédit']);
    expect(ws.getCell('C7').value).toBe(100.5);                 // première ligne, montant en nombre
    expect(ws.getColumn(3).numFmt).toContain('#,##0.00');
    const total = ws.getRow(11);
    expect(total.getCell(2).value).toBe('Total');
    expect(total.font?.bold).toBe(true);
  });
});
