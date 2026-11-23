-- 647 — Vocabulaire complet (plan d'exécution multi-industries, étape 10, pas 10d).
--
-- POURQUOI
--   « Ingrédient », « Pesage », « Économat », les titres du bon de sortie et de la fiche de
--   production et le titre de la notification de fin de fabrication étaient écrits en dur :
--   un atelier de mécanique lisait encore le vocabulaire d'une boulangerie.
--
-- CE QUI CHANGE
--   Nouveaux termes du catalogue (shared/vocabulary.ts) et leurs valeurs pour les profils hors
--   alimentaire (fabrication et ses enfants par héritage, générique, négoce). La boulangerie et
--   l'agroalimentaire gardent la valeur de repli (Ingrédient, Pesage, Économat…). Une valeur
--   déjà posée n'est pas écrasée.
--
-- RETOUR ARRIÈRE
--   DELETE FROM sector_labels WHERE label_key IN ('ingredient', 'ingredients', 'weighing_zone',
--   'reserve_zone', 'doc_bon_sortie', 'doc_fiche_production', 'notif_production_done')
--   AND sector_pack IN ('fabrication', 'generique', 'negoce', 'process').

INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT p.code, v.k, v.val
  FROM (VALUES ('fabrication'), ('generique'), ('negoce')) AS p(code)
 CROSS JOIN (VALUES
   ('ingredient', 'Matière'),
   ('ingredients', 'Matières'),
   ('weighing_zone', 'En-cours ouvert'),
   ('reserve_zone', 'Réserve'),
   ('doc_bon_sortie', 'Bon de sortie des matières'),
   ('doc_fiche_production', 'Fiche de suivi de fabrication'),
   ('notif_production_done', 'Fabrication terminée')
 ) AS v(k, val)
 WHERE EXISTS (SELECT 1 FROM sector_packs sp WHERE sp.code = p.code)
ON CONFLICT (sector_pack, label_key) DO NOTHING;

-- Cosmétique, chimie : matières premières (le profil hérite de fabrication pour le reste).
INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT 'process', v.k, v.val
  FROM (VALUES ('ingredient', 'Matière première'), ('ingredients', 'Matières premières')) AS v(k, val)
 WHERE EXISTS (SELECT 1 FROM sector_packs WHERE code = 'process')
ON CONFLICT (sector_pack, label_key) DO NOTHING;
