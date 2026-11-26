-- 715 — Production selon le profil (feuille de route, phase 4).
--
-- Audit court (étape 4.1) : le moteur existe (types d'ordre et leurs exigences — pesée, bon de
-- sortie, contrôle qualité —, étapes et relevés de procédé, nomenclatures à plusieurs niveaux
-- par les semi-finis, gammes et postes, sous-traitance, séries, libération des lots, séparation
-- des tâches au bon de sortie). Il manquait le CONTENU des profils nouveaux : aucun type d'ordre
-- pour Santé et pharmacie, Textile, Restauration, Agriculture, ni les règles qui font le
-- « dossier de lot » d'un laboratoire pharmaceutique. Ce lot n'ajoute que des données de profil,
-- appliquées par l'assistant à l'activation (industry-profile.applyProfileLayers).
--
-- Santé et pharmacie (étape 4.2, dossier de lot) :
--   - ordre de lot : pesée obligatoire au bon de sortie, contrôle qualité obligatoire ;
--   - étapes déclarées obligatoires, libération manuelle par la qualité ;
--   - séparation des tâches : qui a pesé et remis le bon ne peut pas en accepter la réception
--     (pesée contrôlée par une deuxième personne).
-- Les profils ne sont mis à jour que s'ils n'ont pas déjà leurs propres types d'ordre.

UPDATE sector_packs SET profile = jsonb_set(jsonb_set(COALESCE(profile, '{}'::jsonb), '{order_types}', '[
  {"code": "ORDRE_LOT", "label": "Ordre de fabrication de lot", "is_default": true, "consumption_mode": "au_bon_de_sortie",
   "is_subcontracting": false, "requires_weighing": true, "requires_bon_sortie": true, "requires_quality_check": true},
  {"code": "CONDITIONNEMENT", "label": "Ordre de conditionnement", "is_default": false, "consumption_mode": "au_bon_de_sortie",
   "is_subcontracting": false, "requires_weighing": false, "requires_bon_sortie": true, "requires_quality_check": true}
]'::jsonb), '{policies}', COALESCE(profile->'policies', '[]'::jsonb) || '[
  {"key": "production.enforce_declared_steps", "value": {"enabled": true}},
  {"key": "quality.auto_release", "value": {"enabled": false}},
  {"key": "production.segregation_of_duties", "value": {"enabled": true}}
]'::jsonb)
 WHERE code = 'sante' AND jsonb_array_length(COALESCE(profile->'order_types', '[]'::jsonb)) = 0;

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{order_types}', '[
  {"code": "CONFECTION", "label": "Ordre de confection", "is_default": true, "consumption_mode": "a_la_declaration",
   "is_subcontracting": false, "requires_weighing": false, "requires_bon_sortie": true, "requires_quality_check": false},
  {"code": "FACONNAGE", "label": "Façonnage sous-traité", "is_default": false, "consumption_mode": "a_la_declaration",
   "is_subcontracting": true, "requires_weighing": false, "requires_bon_sortie": false, "requires_quality_check": true}
]'::jsonb)
 WHERE code = 'textile' AND jsonb_array_length(COALESCE(profile->'order_types', '[]'::jsonb)) = 0;

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{order_types}', '[
  {"code": "PRODUCTION_CUISINE", "label": "Production cuisine", "is_default": true, "consumption_mode": "a_la_declaration",
   "is_subcontracting": false, "requires_weighing": false, "requires_bon_sortie": false, "requires_quality_check": false}
]'::jsonb)
 WHERE code = 'restauration' AND jsonb_array_length(COALESCE(profile->'order_types', '[]'::jsonb)) = 0;

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{order_types}', '[
  {"code": "TRANSFORMATION", "label": "Ordre de transformation", "is_default": true, "consumption_mode": "a_la_declaration",
   "is_subcontracting": false, "requires_weighing": true, "requires_bon_sortie": false, "requires_quality_check": false}
]'::jsonb)
 WHERE code = 'agriculture' AND jsonb_array_length(COALESCE(profile->'order_types', '[]'::jsonb)) = 0;
