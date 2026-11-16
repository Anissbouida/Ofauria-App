/**
 * G0-08 (V3) — couche de lecture / écriture des classeurs sur exceljs, qui
 * remplace la bibliothèque xlsx pour les fichiers téléversés.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from '../utils/sheets.js';

const ymd = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : d);

describe('Classeurs (exceljs)', () => {
  it('aller-retour : textes, nombres, booléens, dates et lignes vides', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Prix', 'Date', 'Actif'],
      ['Farine T55', 6.5, new Date(2026, 0, 31), true],
      [],
      ['Œufs « plein air »', '7,5', '31/12/2026', false],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Données');
    const back = await XLSX.read(await XLSX.write(wb));
    expect(back.SheetNames).toEqual(['Données']);
    const all = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets['Données'], { header: 1, defval: null });
    expect(all).toHaveLength(4);
    expect(all[1].map(ymd)).toEqual(['Farine T55', 6.5, '2026-1-31', true]);
    expect(all[2]).toEqual([null, null, null, null]);
    expect(all[3]).toEqual(['Œufs « plein air »', '7,5', '31/12/2026', false]); // « 7,5 » reste du texte
    // blankrows: false retire la ligne vide ; raw: false rend le texte d'aperçu.
    expect(XLSX.utils.sheet_to_json(back.Sheets['Données'], { header: 1, defval: null, blankrows: false })).toHaveLength(3);
    const display = XLSX.utils.sheet_to_json<string[]>(back.Sheets['Données'], { header: 1, raw: false });
    expect(display[1]).toEqual(['Farine T55', '6.5', '31/01/2026', 'true']);
    expect(display[2]).toEqual(['', '', '', '']);
  });

  it('une date garde son jour quel que soit le fuseau (pas de décalage à minuit)', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[new Date(2026, 5, 1), new Date(2026, 11, 31)]]), 'D');
    const [row] = (await XLSX.read(await XLSX.write(wb))).Sheets.D.rows;
    expect(row.map(ymd)).toEqual(['2026-6-1', '2026-12-31']);
  });

  it('formule → résultat, texte enrichi et lien → texte, erreur → vide', async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet('F');
    ws.getCell('A1').value = { formula: 'B1+C1', result: 12.5 };
    ws.getCell('B1').value = { richText: [{ text: 'Beurre ' }, { text: 'doux', font: { bold: true } }] };
    ws.getCell('C1').value = { text: 'site', hyperlink: 'https://example.test' };
    ws.getCell('D1').value = { error: '#DIV/0!' };
    const wb = await XLSX.read(Buffer.from(await book.xlsx.writeBuffer()));
    expect(wb.Sheets.F.rows[0]).toEqual([12.5, 'Beurre doux', 'site', null]);
  });

  it('json_to_sheet : en-têtes dans l\'ordre de première apparition', () => {
    const ws = XLSX.utils.json_to_sheet([{ a: 1, b: 2 }, { b: 3, c: 4 }]);
    expect(ws.rows).toEqual([['a', 'b', 'c'], [1, 2, null], [null, 3, 4]]);
  });

  it('refuse un ancien .xls et un fichier qui n\'est pas un classeur', async () => {
    await expect(XLSX.read(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).rejects.toThrow(/\.xls/);
    await expect(XLSX.read(Buffer.from('nom;prix\nx;1\n'))).rejects.toThrow(/xlsx/);
  });

  it('feuille vide et classeur sans donnée', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Vide');
    const back = await XLSX.read(await XLSX.write(wb));
    expect(back.Sheets.Vide.rows).toEqual([]);
    expect(XLSX.utils.sheet_to_json(undefined, { header: 1 })).toEqual([]);
  });

  it('numéro de série Excel → date', () => {
    expect(XLSX.SSF.parse_date_code(46053)).toEqual({ y: 2026, m: 1, d: 31 });
    expect(XLSX.SSF.parse_date_code(46174)).toEqual({ y: 2026, m: 6, d: 1 });
    expect(XLSX.SSF.parse_date_code(0)).toBeNull();
  });
});
