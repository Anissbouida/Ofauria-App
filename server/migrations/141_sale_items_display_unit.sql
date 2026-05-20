-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 141 : unite d'affichage des ventes au poids
--
-- Les produits au poids stockent toujours `quantity` en grammes. Mais le
-- caissier saisit soit en grammes, soit en kilogrammes (toggle du modal POS).
-- `display_unit` memorise ce choix pour que le recu (ecran + imprime) affiche
-- la ligne dans la meme unite que la saisie : "1 kg @ ..." ou "1000 g @ ...".
--
-- NULL pour les produits unitaires et les anciennes lignes (fallback : grammes).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS display_unit VARCHAR(4);

ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_display_unit_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_display_unit_check
  CHECK (display_unit IS NULL OR display_unit IN ('g', 'kg'));
