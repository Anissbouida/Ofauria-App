-- 085: Add contenant_id to recipes
-- Le contenant détermine le rendement, les pièces produites et le calcul du coût de production

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS contenant_id UUID REFERENCES production_contenants(id);

-- Pour les recettes produits finis existantes, tenter de relier au contenant via le profil produit
UPDATE recipes r
SET contenant_id = pp.contenant_id
FROM produit_profil_production pp
WHERE pp.produit_id = r.product_id
  AND r.product_id IS NOT NULL
  AND r.contenant_id IS NULL;
