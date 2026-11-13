-- 513 — Référentiels du procédé de fabrication (plan Production générique, lot P4).
--
-- Trois listes étaient figées dans le code ET en base (contraintes CHECK) :
--   * types d'étape        (mig 342 : pétrissage, pointage… cuisson, refroidissement) ;
--   * types d'équipement   (mig 090 : four, batteur, pétrin, laminoir…) ;
--   * paramètres de relevé (mig 422 : temp_pate, temp_four, duree_cuisson…).
-- Un fabricant de meubles ne pouvait ni ajouter « Usinage » ni une « Presse ». Elles
-- deviennent des référentiels éditables (Paramètres › Référentiels, mécanisme
-- ref_tables / ref_entries existant). Les codes repris sont IDENTIQUES : aucune donnée
-- existante ne change.
--
-- metadata :
--   * types d'étape : ccp (point critique : l'étape ne se clôture pas sans relevé)
--     et default_param (paramètre proposé au relevé) — remplace CCP_STEP_TYPES ;
--   * paramètres de relevé : unit (°C, min, %, kg).
--
-- Les CHECK sont retirés : l'application vérifie que le code existe et est actif
-- dans le référentiel. Retour arrière : recréer les CHECK des mig 090 / 342 / 422.

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('production_step_types', 'Types d''étape de fabrication',
   'Étapes des fiches techniques et des plans (pétrissage, cuisson, usinage…). « CCP » : l''étape ne se clôture pas sans relevé.', 'ListOrdered', 'ref_entries', true, 0),
  ('production_equipment_types', 'Types d''équipement',
   'Familles d''équipements de production utilisées pour le coût réel (four, presse…).', 'Wrench', 'ref_entries', true, 0),
  ('process_reading_params', 'Paramètres de relevé',
   'Mesures saisies pendant la fabrication (température, durée, humidité…) et leur unité.', 'Thermometer', 'ref_entries', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('production_step_types', 'petrissage',      'Pétrissage',      10, '{"default_param":"temp_pate"}'),
  ('production_step_types', 'pointage',        'Pointage',        20, '{"default_param":"temp_pate"}'),
  ('production_step_types', 'faconnage',       'Façonnage',       30, '{}'),
  ('production_step_types', 'tourage',         'Tourage',         40, '{}'),
  ('production_step_types', 'appret',          'Apprêt',          50, '{"default_param":"humidite"}'),
  ('production_step_types', 'cuisson',         'Cuisson',         60, '{"ccp":true,"default_param":"temp_four"}'),
  ('production_step_types', 'refroidissement', 'Refroidissement', 70, '{"ccp":true,"default_param":"temp_coeur"}'),
  ('production_step_types', 'montage',         'Montage',         80, '{}'),
  ('production_step_types', 'finition',        'Finition',        90, '{}'),
  ('production_step_types', 'autre',           'Autre',          100, '{}'),

  ('production_equipment_types', 'four',     'Four',      10, '{}'),
  ('production_equipment_types', 'batteur',  'Batteur',   20, '{}'),
  ('production_equipment_types', 'petrin',   'Pétrin',    30, '{}'),
  ('production_equipment_types', 'laminoir', 'Laminoir',  40, '{}'),
  ('production_equipment_types', 'surgele',  'Surgélateur', 50, '{}'),
  ('production_equipment_types', 'frigo',    'Réfrigérateur', 60, '{}'),
  ('production_equipment_types', 'vitrine',  'Vitrine',   70, '{}'),
  ('production_equipment_types', 'autre',    'Autre',    100, '{}'),

  ('process_reading_params', 'temp_pate',     'Température pâte',   10, '{"unit":"°C"}'),
  ('process_reading_params', 'temp_four',     'Température four',   20, '{"unit":"°C"}'),
  ('process_reading_params', 'duree_cuisson', 'Durée cuisson',      30, '{"unit":"min"}'),
  ('process_reading_params', 'temp_coeur',    'Température à cœur', 40, '{"unit":"°C"}'),
  ('process_reading_params', 'humidite',      'Humidité',           50, '{"unit":"%"}'),
  ('process_reading_params', 'poids',         'Poids',              60, '{"unit":"kg"}')
ON CONFLICT (table_id, code) DO NOTHING;

-- Couleurs des types d'étape (frise du rétro-planning), reprises de l'écran.
UPDATE ref_entries e SET color = v.color
  FROM (VALUES ('petrissage', '#8b5cf6'), ('pointage', '#06b6d4'), ('faconnage', '#f59e0b'), ('tourage', '#6366f1'),
               ('appret', '#10b981'), ('cuisson', '#ef4444'), ('refroidissement', '#3b82f6'), ('montage', '#ec4899'),
               ('finition', '#14b8a6'), ('autre', '#9ca3af')) AS v(code, color)
 WHERE e.table_id = 'production_step_types' AND e.code = v.code AND e.color IS NULL;

ALTER TABLE production_item_etapes DROP CONSTRAINT IF EXISTS production_item_etapes_type_etape_check;
ALTER TABLE production_equipements DROP CONSTRAINT IF EXISTS production_equipements_type_check;
ALTER TABLE production_step_readings DROP CONSTRAINT IF EXISTS production_step_readings_parametre_check;
