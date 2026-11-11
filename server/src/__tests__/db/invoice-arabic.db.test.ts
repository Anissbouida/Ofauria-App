/**
 * Phase 10.1 — « une facture sort en arabe ».
 *
 * Genere la MEME facture en francais puis en arabe et verifie que :
 *   - les deux sont des PDF valides (chemin francais non regresse) ;
 *   - la version arabe embarque la police Cairo (preuve que l'arabe est rendu,
 *     pas retombe en latin) et pese plus lourd (sous-ensemble de glyphes).
 *
 * Lit document_templates via loadDocumentTemplate : gate sur la base de test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { hasTestDb, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!hasTestDb)('Facture en arabe', () => {
  // generateInvoicePdf -> loadDocumentTemplate -> db : l'URL doit etre posee
  // AVANT l'import du service (db lit DATABASE_URL a l'import).
  let generateInvoicePdf: (typeof import('../../services/invoice-pdf.service.js'))['generateInvoicePdf'];

  const base = {
    invoiceNumber: 'FAC-AR-0001',
    invoiceDate: '11/11/2026',
    customerName: 'شركة الأطلس للتجارة',
    items: [{ description: 'دقيق فاخر', quantity: 3, unit_price: 100, subtotal: 300 }],
    totalHT: 300,
    tvaRate: 20,
    totalTVA: 60,
    totalTTC: 360,
    companyName: 'Kalum',
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ generateInvoicePdf } = await import('../../services/invoice-pdf.service.js'));
  });

  it('genere une facture arabe et une francaise valides', async () => {
    const fr = await generateInvoicePdf({ ...base, locale: 'fr' });
    const ar = await generateInvoicePdf({ ...base, locale: 'ar' });

    // En-tete PDF : les deux sont des PDF bien formes.
    expect(fr.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(ar.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // La version arabe embarque la police Cairo (nom present dans le
    // dictionnaire de police, non compresse) : l'arabe est reellement rendu.
    expect(ar.includes(Buffer.from('Cairo'))).toBe(true);

    // Sous-ensemble de glyphes arabes embarque => fichier sensiblement plus
    // lourd que la version latine (Helvetica, police standard non embarquee).
    expect(ar.length).toBeGreaterThan(fr.length);
  });
});
