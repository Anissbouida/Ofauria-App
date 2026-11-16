/**
 * G0-08 (V3) — les imports et exports par classeur fonctionnent sur la nouvelle
 * couche (exceljs) : aller-retour des ingrédients et des recettes, import de
 * caisse, lecture d'un CSV en point-virgule.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from '../utils/sheets.js';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

describe('Imports et exports par classeur (exceljs)', () => {
  it('ingrédients : ce qui est exporté se réimporte à l\'identique', async () => {
    const { generateIngredientWorkbook, parseIngredientWorkbook } = await import('../services/ingredient-excel.service.js');
    const file = await generateIngredientWorkbook([
      { name: 'Farine T55', category: 'farines', unit: 'kg', unitCost: 6.5, supplier: 'Moulins', allergens: ['gluten'] },
      { name: 'Lait entier', category: 'produits_laitiers', unit: 'l', unitCost: '8.25', supplier: null, allergens: ['lait'] },
    ], { includeStock: false });
    const parsed = await parseIngredientWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map(r => [r.name, r.unit, r.unitCost, r.supplier, r.allergens])).toEqual([
      ['Farine T55', 'kg', 6.5, 'Moulins', ['gluten']],
      ['Lait entier', 'l', 8.25, null, ['lait']],
    ]);
    expect(parsed.rows[0].sourceRow).toBe(2);
  });

  it('recettes : les quatre feuilles se relisent', async () => {
    const { generateRecipeWorkbook, parseRecipeWorkbook } = await import('../services/recipe-excel.service.js');
    const file = await generateRecipeWorkbook({
      recipes: [{ name: 'Pâte brisée', isBase: true, productName: null, yieldQuantity: 2, yieldUnit: 'kg', marginMultiplier: null, instructions: 'Sabler, fraiser.' }],
      ingredients: [{ recipeName: 'Pâte brisée', ingredientName: 'Farine T55', quantity: 1, unit: 'kg' }],
      subRecipes: [],
      packaging: [],
    } as never, { includeCost: false });
    const wb = await XLSX.read(file);
    expect(wb.SheetNames).toEqual(['Recettes', 'Ingredients', 'Sous-recettes', 'Emballages']);
    const parsed = await parseRecipeWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.recipes.map(r => r.name)).toEqual(['Pâte brisée']);
    expect(parsed.ingredients).toHaveLength(1);
    expect(parsed.ingredients[0]).toMatchObject({ recipeName: 'Pâte brisée', ingredientName: 'Farine T55', quantity: 1 });
  });

  it('caisse : une vraie date Excel donne le bon jour', async () => {
    const { parseCaisseWorkbook } = await import('../services/caisse-excel-parser.service.js');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Date', 'Type', 'N°', 'Fournisseur', 'Désignation', 'Entrée', 'Sortie'],
      [new Date(2026, 4, 3), 'Dépense', 'P-1', 'MOULINS DU NORD', 'Farine', null, 320.5],
    ]), 'Caisse');
    const parsed = await parseCaisseWorkbook(await XLSX.write(wb));
    // Le mois du fichier est déduit de la cellule de date : 3 mai 2026, sans décalage.
    expect(parsed.meta).toMatchObject({ year: 2026, month: 5 });
  });

  it('CSV en point-virgule : accents conservés et « 7,5 » reste 7,5', async () => {
    const { readWorkbook } = await import('../services/data-import.js');
    const wb = await readWorkbook(Buffer.from('﻿Nom;Unité;Prix\n"Crème; fraîche";L;7,5\n\nSucre;kg;5\n', 'utf8'));
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false, raw: true });
    expect(rows).toEqual([['Nom', 'Unité', 'Prix'], ['Crème; fraîche', 'L', '7,5'], ['Sucre', 'kg', '5']]);
    // Latin-1 (CSV enregistré par Excel sous Windows).
    const latin = await readWorkbook(Buffer.from('Nom,Unité\nPâte,kg\n', 'latin1'));
    expect(latin.Sheets[latin.SheetNames[0]].rows[0]).toEqual(['Nom', 'Unité']);
  });

  it('un ancien .xls est refusé avec un message clair', async () => {
    const { readWorkbook } = await import('../services/data-import.js');
    await expect(readWorkbook(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))).rejects.toThrow(/\.xls.*\.xlsx/);
  });
});
