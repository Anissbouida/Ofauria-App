/**
 * Phase 10.1 — rendu arabe : helpers purs (sans base).
 *
 * Verifie la detection de l'arabe, le montant en toutes lettres arabe et la
 * disponibilite de la police Cairo embarquee. La generation PDF complete
 * (qui lit document_templates) est couverte par le test BD invoice-arabic.db.
 */
import { describe, it, expect } from 'vitest';
import { containsArabic, numberToWordsAR, arabicFontPath } from '../utils/arabic-pdf.js';

describe('Arabe — detection', () => {
  it('reconnait une chaine arabe, ignore le latin', () => {
    expect(containsArabic('فاتورة')).toBe(true);
    expect(containsArabic('FACTURE')).toBe(false);
    expect(containsArabic('Total 120 DH')).toBe(false);
    expect(containsArabic('')).toBe(false);
    expect(containsArabic(null)).toBe(false);
    // Mixte : un seul caractere arabe suffit a declencher la police dediee.
    expect(containsArabic('Réf. القاعدة 24')).toBe(true);
  });
});

describe('Arabe — montant en toutes lettres', () => {
  it('petits nombres', () => {
    expect(numberToWordsAR(0)).toBe('صفر درهم');
    expect(numberToWordsAR(5)).toBe('خمسة درهم');
    expect(numberToWordsAR(20)).toBe('عشرون درهم');
  });

  it('centaines, milliers et centimes', () => {
    const w = numberToWordsAR(1250.5);
    expect(w).toContain('درهم');
    expect(w).toContain('سنتيم'); // la partie decimale
    expect(w).toContain('ألف');   // 1000
    const h = numberToWordsAR(300);
    expect(h).toBe('ثلاثمائة درهم');
  });

  it('devise personnalisable', () => {
    expect(numberToWordsAR(2, 'يورو', 'سنت')).toBe('اثنان يورو');
  });
});

describe('Arabe — police embarquee', () => {
  it('Cairo est disponible dans assets/fonts', () => {
    // Le bundle serveur embarque Cairo-Regular.ttf ; sans elle, la facture
    // arabe retombe sur le latin au lieu de sortir du charabia.
    expect(arabicFontPath()).toBeTruthy();
  });
});
