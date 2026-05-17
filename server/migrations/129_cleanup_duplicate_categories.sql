-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 129 : Cleanup des catégories doublons de la 128
--
-- La 128 a créé Baguettes/Salée/Plateaux par méconnaissance des catégories
-- pré-existantes BAGUETTE/BAGUETTE TRADITION/SALÉ/SALÉ & SOIRÉE/PLATEAU SALÉ
-- & SUCRÉ (ajoutées via le référentiel après les migrations historiques).
-- Cette migration déplace les produits vers les bonnes cibles puis supprime
-- les 3 doublons.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Baguettes (slug=baguettes) → BAGUETTE ou BAGUETTE TRADITION ───
-- Les "tradition" et pains spéciaux (chofane, copain, long, à l'ancienne, avoine)
-- vont en BAGUETTE TRADITION. Les "normale" restent en BAGUETTE.
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'baguette-tradition')
WHERE category_id = (SELECT id FROM categories WHERE slug = 'baguettes')
  AND (
    name ILIKE '%TRADITION%'
    OR name ILIKE '%À L''ANCIENNE%'
    OR name ILIKE '%AVOINE%'
    OR name ILIKE '%CHOUFANE%'
    OR name ILIKE '%COPAIN%'
    OR name = 'PAIN LONG'
  );

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'baguette')
WHERE category_id = (SELECT id FROM categories WHERE slug = 'baguettes');

-- ─── 2. Salée (slug=salee) → SALÉ (sauf PLATEAU SOIREE MINI → SALÉ & SOIRÉE) ───
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'sale-soiree')
WHERE category_id = (SELECT id FROM categories WHERE slug = 'salee')
  AND name = 'PLATEAU SOIREE MINI';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'sale')
WHERE category_id = (SELECT id FROM categories WHERE slug = 'salee');

-- ─── 3. Plateaux (slug=plateaux) → PLATEAU SALÉ & SUCRÉ ───
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'plateau-sale-sucre')
WHERE category_id = (SELECT id FROM categories WHERE slug = 'plateaux');

-- ─── 4. Suppression des 3 doublons ───
-- Garde-fou : refuse la suppression s'il reste un produit lié (ne devrait pas).
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT COUNT(*) INTO remaining FROM products p
    JOIN categories c ON c.id = p.category_id
   WHERE c.slug IN ('baguettes', 'salee', 'plateaux');
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Cleanup avorté : % produit(s) encore rattachés aux catégories doublons', remaining;
  END IF;
END $$;

DELETE FROM categories WHERE slug IN ('baguettes', 'salee', 'plateaux');

COMMIT;
