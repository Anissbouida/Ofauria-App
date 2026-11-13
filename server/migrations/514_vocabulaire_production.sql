-- 514 — Vocabulaire du module Production par secteur (plan Production générique, P6).
--
-- sector_labels (mig 495) : une clé neutre, un mot par secteur ; sans entrée, l'écran
-- garde son libellé actuel. Deux corrections et trois clés :
--   * Boulangerie : recipe / recipes valaient « Recette(s) », alors que toute
--     l'application dit « Fiche(s) technique(s) » (choix voulu : en comptabilité,
--     « recettes » = encaissements). Aligné avant que les écrans lisent ces clés.
--   * production_plan / production_plans / new_plan : « Plan de production » en
--     boulangerie, « Ordre de fabrication » pour un fabricant.
-- Additif (mise à jour de libellés seulement).

UPDATE sector_labels SET label_value = 'Fiche technique'  WHERE sector_pack = 'boulangerie' AND label_key = 'recipe'  AND label_value = 'Recette';
UPDATE sector_labels SET label_value = 'Fiches techniques' WHERE sector_pack = 'boulangerie' AND label_key = 'recipes' AND label_value = 'Recettes';

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT v.pack, v.k, v.val
  FROM (VALUES
    ('boulangerie', 'production_plan',  'Plan de production'),
    ('boulangerie', 'production_plans', 'Plans de production'),
    ('boulangerie', 'new_plan',         'Nouveau plan'),
    ('fabrication', 'production_plan',  'Ordre de fabrication'),
    ('fabrication', 'production_plans', 'Ordres de fabrication'),
    ('fabrication', 'new_plan',         'Nouvel ordre de fabrication'),
    ('generique',   'production_plan',  'Ordre de fabrication'),
    ('generique',   'production_plans', 'Ordres de fabrication'),
    ('generique',   'new_plan',         'Nouvel ordre de fabrication')
  ) AS v(pack, k, val)
  JOIN sector_packs sp ON sp.code = v.pack
ON CONFLICT (sector_pack, label_key) DO NOTHING;
