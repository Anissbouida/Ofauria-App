-- ═══════════════════════════════════════════════════════════════════════════
-- Cycle de vie produits par categorie - Valeurs metier boulangerie-patisserie
-- Basees sur les normes ONSSA et bonnes pratiques professionnelles
-- ═══════════════════════════════════════════════════════════════════════════

-- Ajout d'un champ sale_type sur les produits : jour, dlv, commande
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_type VARCHAR(20) DEFAULT 'jour';
-- jour = vente du jour uniquement (invendu = perte ou recyclage)
-- dlv  = vendable sur plusieurs jours (DLV applicable)
-- commande = sur commande uniquement (pas de stock vitrine)

-- ═══════════════════════════════════════════════════════════════════════════
-- PAINS (slug: pains)
-- Produits du jour par excellence. Fabriques chaque matin.
-- Pas de DLV multi-jours : pain frais = vente du jour.
-- Pain rassis recyclable en chapelure ou pain perdu.
-- Exposition max 12h (matin -> fermeture).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 1,
  display_life_hours = 12,
  is_reexposable = false,
  max_reexpositions = 0,
  is_recyclable = true,
  sale_type = 'jour'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'pains')
  AND shelf_life_days IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VIENNOISERIES (slug: viennoiseries)
-- Croissants, pains au chocolat, brioches, chaussons...
-- Vente du jour : fraiches le matin, qualite decroit rapidement.
-- DLV 1 jour (J+0). Exposition max 10h.
-- Re-exposable 1 fois (si non vendu matin -> apres-midi avec remise).
-- Recyclable : croissants -> croissants aux amandes, pain perdu, pudding.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 1,
  display_life_hours = 10,
  is_reexposable = true,
  max_reexpositions = 1,
  is_recyclable = true,
  sale_type = 'jour'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'viennoiseries')
  AND shelf_life_days IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- PATISSERIES (slug: patisseries)
-- Eclairs, tartes, mille-feuilles, entremets individuels...
-- DLV 2-3 jours selon le type (creme patissiere = J+2, fruits secs = J+3).
-- Exposition max 8h (produits sensibles a la temperature).
-- NON re-exposable : la chaine du froid ne doit pas etre rompue.
-- NON recyclable : creme, fruits, mousses ne se transforment pas.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 2,
  display_life_hours = 8,
  is_reexposable = false,
  max_reexpositions = 0,
  is_recyclable = false,
  sale_type = 'dlv'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'patisseries')
  AND shelf_life_days IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- GATEAUX VITRINE (slug: gateaux)
-- Gateaux entiers en vitrine (forets noires, fraisiers, etc.)
-- DLV 3 jours en vitrine refrigeree.
-- Exposition max 10h par jour (vitrine froide).
-- Re-exposable 1 fois (J+1 en vitrine froide si non entame).
-- NON recyclable : produit fini complexe.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 3,
  display_life_hours = 10,
  is_reexposable = true,
  max_reexpositions = 1,
  is_recyclable = false,
  sale_type = 'dlv'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'gateaux')
  AND shelf_life_days IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- GATEAUX SUR MESURE (slug: gateaux-sur-mesure)
-- Gateaux personnalises pour evenements (mariage, anniversaire...).
-- Produits sur commande uniquement, pas de stock vitrine.
-- DLV 3 jours apres fabrication (conservation frigo client).
-- Pas d'exposition vitrine (livraison directe).
-- NON recyclable, NON re-exposable.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 3,
  display_life_hours = NULL,
  is_reexposable = false,
  max_reexpositions = 0,
  is_recyclable = false,
  sale_type = 'commande'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'gateaux-sur-mesure')
  AND shelf_life_days IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- SPECIALITES DE SAISON (slug: specialites-saison)
-- Creations saisonnieres (galette des rois, buche, cornes de gazelle...).
-- DLV variable selon le type : sec = 5j, frais = 2j.
-- Par defaut 3 jours (moyenne), ajustable par produit.
-- Exposition max 10h.
-- Re-exposable 1 fois si produit sec.
-- Recyclable selon le type (sec = oui, frais = non).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products SET
  shelf_life_days = 3,
  display_life_hours = 10,
  is_reexposable = true,
  max_reexpositions = 1,
  is_recyclable = false,
  sale_type = 'dlv'
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'specialites-saison')
  AND shelf_life_days IS NULL;
