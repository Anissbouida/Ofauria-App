/**
 * M8-04 — les impressions de l'ordre suivent le gabarit résolu (titre, colonnes,
 * signatures, mention) ; sans gabarit, l'impression historique est conservée.
 */
import { describe, it, expect } from 'vitest';
import { defaultPrintTemplate } from '@ofauria/shared';
import { buildBsiHtml, buildFicheHtml, buildTicketHtml } from './plan-print';

const settings = { companyName: 'Société test' };
const plan = { id: '00000000-0000-0000-0000-000000000001', plan_date: '2026-11-17', of_number: 'OF-26-0001', type: 'daily' };
const needs = [{ ingredient_name: 'Acier S235', needed_quantity: '12.5', unit: 'kg' }];
const items = [{ product_name: 'Châssis', planned_quantity: 10, actual_quantity: 9, lot_number: 'L-1' }];

describe('Impressions paramétrables (M8-04)', () => {
  it('bon de sortie par défaut : titre et signatures historiques', () => {
    const html = buildBsiHtml(plan, needs, settings, 'P1', 'BSI-1', 'Matin');
    expect(html).toContain('Bon de sortie ingrédients');
    expect(html).toContain('Magasinier');
    expect(html).toContain('Lot a utiliser');
  });
  it('bon de sortie : colonnes masquées, signatures et mention du gabarit', () => {
    const tpl = { ...defaultPrintTemplate('production_bon_sortie'), title: 'Bon de sortie matières',
      columns: ['ingredient', 'quantity', 'unit'], signatures: ['Chef d\'atelier', 'Logistique'], footer: 'Copie <atelier>' };
    const html = buildBsiHtml(plan, needs, settings, 'P1', 'BSI-1', 'Matin', tpl);
    expect(html).toContain('Bon de sortie matières');
    expect(html).not.toContain('Lot a utiliser');
    expect(html).not.toContain('Observations / Ecarts');
    expect(html).toContain('Logistique');
    expect(html).not.toContain('>Magasinier<');
    expect(html).toContain('Copie &lt;atelier&gt;');
  });
  it('fiche de production sans signatures ; ticket avec numéro d\'ordre serveur', () => {
    const fiche = buildFicheHtml(plan, items, settings, 'P1', { ...defaultPrintTemplate('production_fiche'), signatures: [] });
    expect(fiche).not.toContain('class="signatures"');
    const ticket = buildTicketHtml(plan, items[0], settings, { ...defaultPrintTemplate('production_ticket'), columns: ['quantity', 'plan_number'] });
    expect(ticket).toContain('OF-26-0001');
    expect(ticket).not.toContain('Produit par');
  });
});
