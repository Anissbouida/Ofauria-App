-- Migration 255: backfill des categories par ligne de facture / reception
--
-- Probleme : les factures auto-creees depuis les bons de commande n'ecrivaient
-- pas de category_id sur leurs lignes (invoice_items / reception_voucher_items).
-- L'affichage Charges & Depenses retombait alors sur la categorie de la
-- FACTURE, elle-meme derivee en "Matieres premieres" (racine) des que le BC
-- melangeait ingredients et emballages -> mauvaise categorie affichee pour
-- les emballages/consommables (boites, seaux, lumieres...).
--
-- Correctif code (meme lot) : createInvoiceFromPo stampe desormais
-- invoice_items.category_id depuis l'article (ingredients.category_id ou
-- packaging_items.category_id), et la requete d'affichage utilise la cascade
-- ligne -> article -> facture.
--
-- Ce backfill aligne l'historique : on remplit les lignes sans categorie
-- depuis la categorie actuelle de leur article. Les categories choisies
-- explicitement par l'utilisateur (category_id deja non NULL) ne sont
-- JAMAIS touchees.
--
-- Idempotente (WHERE category_id IS NULL).

-- ─── invoice_items : lignes ingredient ──────────────────────────────────────
UPDATE invoice_items ii
SET category_id = ing.category_id
FROM ingredients ing
WHERE ing.id = ii.ingredient_id
  AND ii.category_id IS NULL
  AND ing.category_id IS NOT NULL;

-- ─── invoice_items : lignes emballage / consommable ─────────────────────────
UPDATE invoice_items ii
SET category_id = pkg.category_id
FROM packaging_items pkg
WHERE pkg.id = ii.packaging_id
  AND ii.category_id IS NULL
  AND pkg.category_id IS NOT NULL;

-- ─── reception_voucher_items : lignes ingredient ────────────────────────────
-- (affichees dans Charges & Depenses quand la facture n'a pas d'invoice_items)
UPDATE reception_voucher_items rvi
SET category_id = ing.category_id
FROM ingredients ing
WHERE ing.id = rvi.ingredient_id
  AND rvi.category_id IS NULL
  AND ing.category_id IS NOT NULL;

-- ─── reception_voucher_items : lignes emballage / consommable ───────────────
UPDATE reception_voucher_items rvi
SET category_id = pkg.category_id
FROM packaging_items pkg
WHERE pkg.id = rvi.packaging_id
  AND rvi.category_id IS NULL
  AND pkg.category_id IS NOT NULL;
