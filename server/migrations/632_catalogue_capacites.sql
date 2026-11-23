-- 632 — Catalogue de capacités (plan d'exécution multi-industries, étape 1).
--
-- POURQUOI
--   app_features (mig 507) ne contenait que 8 options, toutes du module Production, sans
--   dépendances entre elles ni notion d'obligation. Les fonctions transversales (lots,
--   dates limites, allergènes, traçabilité, contrôle qualité, pesage…) étaient toujours
--   actives, sans être nommées : impossible de les régler par métier ou de les hériter.
--
-- CE QUI CHANGE
--   - app_features gagne :
--       kind        'fonction' (défaut) ou 'reglementaire' : une capacité réglementaire ne
--                   se désactive pas tant que des données l'exigent (contrôle côté serveur) ;
--       requires    capacités dont elle dépend (activer l'une active les autres) ;
--       default_on  active même si le préréglage du secteur ne la cite pas (socle commun).
--   - Dix-sept capacités sont inscrites. Celles qui existent déjà dans le code sont
--     default_on = true : AUCUN changement de comportement pour une société existante.
--     Deux sont annoncées mais pas encore construites (réservation de matière,
--     conditionnement multi-niveaux) : default_on = false.
--   - Les options existantes reçoivent leurs dépendances (dlc_jour → dates limites, etc.).
--   - Nouvelle politique production.enforce_declared_steps : rend effectifs les drapeaux
--     « pesée obligatoire » et « contrôle obligatoire » des types d'ordre, jusqu'ici
--     seulement déclaratifs. Désactivée par défaut (comportement inchangé), activée dans
--     les profils de référence process, discret et atelier.

ALTER TABLE app_features ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fonction';
ALTER TABLE app_features ADD COLUMN IF NOT EXISTS requires TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE app_features ADD COLUMN IF NOT EXISTS default_on BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_app_features_kind') THEN
    ALTER TABLE app_features ADD CONSTRAINT chk_app_features_kind CHECK (kind IN ('fonction', 'reglementaire'));
  END IF;
END $$;

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('lots', 'stock', 'Gestion des lots',
   'Chaque entrée de matière et chaque fabrication porte un numéro de lot, consommé selon la date limite.', 100, 'reglementaire', '{}', true),
  ('series', 'stock', 'Numéros de série',
   'Suivi unitaire des articles choisis « par numéro de série », de la fabrication à la vente.', 110, 'fonction', '{}', true),
  ('dlc_ddm', 'stock', 'Dates limites (DLC / DDM)',
   'Date limite sur les lots, alertes avant péremption et refus des lots périmés.', 120, 'reglementaire', '{lots}', true),
  ('allergenes', 'products', 'Allergènes et traces',
   'Allergènes déclarés sur les matières, calculés sur les fiches et affichés sur les étiquettes.', 130, 'reglementaire', '{}', true),
  ('tracabilite', 'stock', 'Traçabilité amont et aval',
   'Du lot de matière au client, et du client au lot de matière.', 140, 'fonction', '{lots}', true),
  ('rappel', 'controle', 'Rappel de lot',
   'Retrouver tous les clients et stocks touchés par un lot, et organiser le retrait.', 150, 'fonction', '{tracabilite}', true),
  ('pesage', 'production', 'Pesage au bon de sortie',
   'Les matières sont pesées et sorties par un bon de sortie avant la fabrication.', 160, 'fonction', '{lots}', true),
  ('controle_qualite', 'controle', 'Contrôle qualité et libération',
   'Plans de contrôle, inspections, lots retenus jusqu''à leur libération.', 170, 'fonction', '{lots}', true),
  ('quarantaine', 'stock', 'Quarantaine',
   'Un lot non conforme est bloqué : il ne peut être ni consommé ni vendu.', 180, 'fonction', '{lots}', true),
  ('releves_temperature', 'production', 'Relevés de procédé',
   'Températures, durées et mesures saisies aux étapes de fabrication.', 190, 'fonction', '{}', true),
  ('rendements_pertes', 'production', 'Rendements, pertes et rebuts',
   'Écart entre prévu et produit, pertes par motif, rebuts.', 200, 'fonction', '{}', true),
  ('semi_finis', 'production', 'Produits semi-finis',
   'Recettes de base fabriquées à part, stockées et consommées par les fabrications.', 210, 'fonction', '{}', true),
  ('coproduits', 'production', 'Co-produits et sous-produits',
   'Une fabrication peut produire plusieurs articles ou des sous-produits valorisés.', 220, 'fonction', '{}', true),
  ('sous_traitance', 'production', 'Sous-traitance',
   'Ordres confiés à un façonnier : envoi des matières, réception, coût de façon.', 230, 'fonction', '{}', true),
  ('reservation_matiere', 'production', 'Réservation de matière',
   'Les matières d''un ordre confirmé sont réservées et ne peuvent plus servir ailleurs.', 240, 'fonction', '{lots}', false),
  ('conditionnement', 'production', 'Conditionnement multi-niveaux',
   'Unité, carton, palette ; les emballages sont des composants consommés en stock.', 250, 'fonction', '{}', false),
  ('etiquetage', 'products', 'Étiquetage',
   'Étiquette réglementaire : dénomination, liste d''ingrédients, allergènes, conservation.', 260, 'fonction', '{allergenes}', true)
ON CONFLICT (key) DO NOTHING;

-- Dépendances des options existantes (sans changer leur activation).
UPDATE app_features SET requires = '{dlc_ddm}'                WHERE key = 'dlc_jour'    AND requires = '{}';
UPDATE app_features SET requires = '{lots}'                   WHERE key = 'vitrine'     AND requires = '{}';
UPDATE app_features SET requires = '{releves_temperature}'    WHERE key = 'ccp_cuisson' AND requires = '{}';
UPDATE app_features SET requires = '{releves_temperature}'    WHERE key = 'haccp'       AND requires = '{}';
UPDATE app_features SET requires = '{lots,dlc_ddm}'           WHERE key = 'lot_thermal' AND requires = '{}';

-- Profils de référence : les étapes déclarées des types d'ordre deviennent obligatoires.
UPDATE sector_packs
   SET profile = jsonb_set(profile, '{policies}',
         COALESCE(profile->'policies', '[]'::jsonb)
         || '[{"key": "production.enforce_declared_steps", "value": {"enabled": true}}]'::jsonb)
 WHERE code IN ('process', 'discret', 'atelier')
   AND profile IS NOT NULL
   AND NOT (COALESCE(profile->'policies', '[]'::jsonb) @> '[{"key": "production.enforce_declared_steps"}]'::jsonb);
