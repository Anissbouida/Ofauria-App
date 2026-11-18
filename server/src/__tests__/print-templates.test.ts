/**
 * M8-04 — gabarits d'impression : fusion défaut ← modèle général ← variante du type d'ordre,
 * et refus des colonnes hors catalogue.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
import { mergePrintTemplate, checkLayout } from '../repositories/print-template.repository.js';

const lvl = (o: Partial<{ title: string | null; layout: object; footer_note: string | null }>) =>
  ({ title: null, layout: {}, footer_note: null, ...o }) as never;

describe('Gabarits d\'impression (M8-04)', () => {
  it('sans réglage : impression historique', () => {
    const t = mergePrintTemplate('production_bon_sortie');
    expect(t).toMatchObject({ title: 'Bon de sortie ingrédients', signatures: ['Chef de production', 'Magasinier'], source: 'default' });
    expect(t.columns).toEqual(['index', 'ingredient', 'quantity', 'unit', 'lot', 'expiry', 'served', 'observations']);
  });
  it('la variante du type d\'ordre l\'emporte champ par champ', () => {
    const t = mergePrintTemplate('production_fiche',
      lvl({ title: 'Rapport de fabrication', footer_note: 'Document interne' }),
      lvl({ layout: { columns: ['status', 'product', 'produced'] } }));
    expect(t.title).toBe('Rapport de fabrication');
    expect(t.footer).toBe('Document interne');
    expect(t.columns).toEqual(['product', 'produced', 'status']);
    expect(t.signatures).toEqual(['Chef de production', 'Responsable qualité', 'Direction']);
    expect(t.source).toBe('variant');
  });
  it('mention vide = aucune mention ; clés inconnues ignorées à la lecture', () => {
    const t = mergePrintTemplate('production_ticket', lvl({ footer_note: '', layout: { columns: ['quantity', 'xx'] } }));
    expect(t.footer).toBeNull();
    expect(t.columns).toEqual(['quantity']);
  });
  it('écriture : colonne inconnue ou signatures sur le ticket refusées', () => {
    expect(checkLayout('production_fiche', { columns: ['product', 'prix'] })).toMatch(/prix/);
    expect(checkLayout('production_ticket', { signatures: ['Chef'] })).toMatch(/pas de signatures/);
    expect(checkLayout('production_bon_sortie', { columns: ['lot'], signatures: ['Magasinier'] })).toBeNull();
  });
});
