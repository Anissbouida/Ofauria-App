-- 651 — Quantités de crème pâtissière manifestement fausses (Amandine, Tarte aux amandes).
--
-- POURQUOI
--   Après le repointage (mig 649) et le retrait des doublons de la mig 411 (mig 650), deux
--   lignes gardaient une quantité impossible, relevée en production le 2026-11-23 :
--   - Amandine (cadre 40 × 60, ~40 carrés de 7 × 7) : Crème pâtissière à 1 g, dans ses deux
--     formats. Sur la même fiche le sirop est saisi « 1 kg » et la mousse « 1,11 kg » : erreur
--     d'unité, 1 kg retenu (≈ 4 mm d'épaisseur sur le cadre).
--   - Tarte aux amandes (22 tartelettes Ø 10) : Crème pâtissière à 22 g, soit 1 g par
--     tartelette. Frangipane usuelle : 2/3 crème d'amande, 1/3 crème pâtissière, pour ≈ 30 g
--     de garniture par tartelette de 10 cm → 11 g par tartelette, 242 g pour 22.
--   Valeurs ESTIMÉES (décision utilisateur : « selon ton jugement »), à confirmer par le chef.
--
-- CE QUI CHANGE
--   Seules les lignes qui portent EXACTEMENT la valeur fautive (fiche active de ce nom, source
--   « Crème pâtissière », 1 g ou 22 g) sont modifiées ; sur toute autre base, rien.
--
-- RETOUR ARRIÈRE
--   Tracé par recipe_format_components_bom_audit ; valeurs d'origine ci-dessus.

UPDATE recipe_format_components fc
   SET quantite = 1, unite = 'kg', updated_at = now()
  FROM recipe_formats f, recipes p, recipes b
 WHERE f.id = fc.format_id AND p.id = f.recipe_id AND b.id = fc.source_recipe_id
   AND p.archived_at IS NULL AND lower(btrim(p.name)) = 'amandine'
   AND lower(btrim(b.name)) = 'crème pâtissière'
   AND fc.quantite = 1 AND fc.unite = 'g';

UPDATE recipe_format_components fc
   SET quantite = 242, updated_at = now()
  FROM recipe_formats f, recipes p, recipes b
 WHERE f.id = fc.format_id AND p.id = f.recipe_id AND b.id = fc.source_recipe_id
   AND p.archived_at IS NULL AND lower(btrim(p.name)) = 'tarte aux amandes'
   AND lower(btrim(b.name)) = 'crème pâtissière'
   AND fc.quantite = 22 AND fc.unite = 'g';
