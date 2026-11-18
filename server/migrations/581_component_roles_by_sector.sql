-- M8-06 — Rôles de composants par secteur.
-- Les rôles livrés (fond, biscuit, glaçage, imbibage…) décrivent un entremets : réservés à
-- la boulangerie (metadata.sectors). Un jeu générique est ajouté pour les autres secteurs ;
-- « Emballage » reste commun. Un rôle sans metadata.sectors vaut pour tous les secteurs.
-- Les lignes de composition déjà saisies gardent leur rôle (simple filtre de la liste).
-- Rollback : UPDATE ref_entries SET metadata = metadata - 'sectors' WHERE table_id = 'component_roles' ;
--   DELETE FROM ref_entries WHERE table_id = 'component_roles' AND code IN ('matiere','composant','sous_ensemble','consommable','accessoire').

UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"sectors": ["boulangerie"]}'::jsonb
 WHERE table_id = 'component_roles'
   AND code IN ('fond', 'biscuit', 'croustillant', 'garniture', 'insert', 'fruits', 'nappage', 'glacage', 'decor', 'imbibage', 'chablonnage', 'pate')
   AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'sectors');

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('component_roles', 'matiere',       'Matière première',      110, '{"sectors": ["fabrication", "generique", "negoce"]}'),
  ('component_roles', 'composant',     'Composant',             120, '{"sectors": ["fabrication", "generique", "negoce"]}'),
  ('component_roles', 'sous_ensemble', 'Sous-ensemble',         130, '{"sectors": ["fabrication", "generique", "negoce"]}'),
  ('component_roles', 'consommable',   'Consommable',           140, '{"sectors": ["fabrication", "generique", "negoce"]}'),
  ('component_roles', 'accessoire',    'Accessoire / fixation', 150, '{"sectors": ["fabrication", "generique", "negoce"]}')
ON CONFLICT (table_id, code) DO NOTHING;
