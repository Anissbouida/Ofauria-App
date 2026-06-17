-- Migration 167 : Dimensions physiques sur production_contenants.
--
-- Aujourd'hui le nom du contenant porte toute l'info ("Cadre 40x60cm",
-- "Cercle O18cm"). Pas de calcul possible (rendement de decoupe, comparaison
-- de volumes, etc.). On ajoute les dimensions structurees pour pouvoir
-- afficher proprement, calculer le rendement theorique apres decoupe, et
-- comparer les contenants entre eux.
--
-- Toutes les colonnes sont NULLABLE : les contenants existants restent
-- compatibles. La saisie est progressive au fil de la maintenance.

ALTER TABLE production_contenants
  ADD COLUMN IF NOT EXISTS longueur_cm DECIMAL(6,2) NULL,
  ADD COLUMN IF NOT EXISTS largeur_cm DECIMAL(6,2) NULL,
  ADD COLUMN IF NOT EXISTS profondeur_cm DECIMAL(6,2) NULL,
  ADD COLUMN IF NOT EXISTS diametre_cm DECIMAL(6,2) NULL,
  ADD COLUMN IF NOT EXISTS type_decoupe VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS nb_pieces_decoupe INT NULL;

COMMENT ON COLUMN production_contenants.longueur_cm IS
  'Longueur en cm pour les cadres/plaques rectangulaires.';
COMMENT ON COLUMN production_contenants.largeur_cm IS
  'Largeur en cm pour les cadres/plaques rectangulaires.';
COMMENT ON COLUMN production_contenants.profondeur_cm IS
  'Profondeur (hauteur) en cm pour les moules, cadres a etage.';
COMMENT ON COLUMN production_contenants.diametre_cm IS
  'Diametre en cm pour les contenants ronds (cercles, moules ronds).';
COMMENT ON COLUMN production_contenants.type_decoupe IS
  'Methode de decoupe : damier, bande, triangle, forme_libre, sans_decoupe. Voir ref_entries(type_decoupe).';
COMMENT ON COLUMN production_contenants.nb_pieces_decoupe IS
  'Nombre theorique de pieces obtenues apres decoupe (ex: cadre 40x60 en damier 5x4 = 20 pieces).';

-- Seed referentiel des types de decoupe (pour le select dans le formulaire)
INSERT INTO ref_tables (id, label, description, source, editable)
VALUES ('type_decoupe', 'Types de decoupe', 'Methodes de decoupe pour les cadres/plaques de production', 'ref_entries', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('type_decoupe', 'sans_decoupe',  'Sans decoupe',     'Le contenant produit directement la piece finale (moule cake, cercle individuel)', 1, true),
  ('type_decoupe', 'damier',        'Damier',           'Decoupe en grille reguliere (ex: 5x4 pieces sur un cadre rectangulaire)',          2, true),
  ('type_decoupe', 'bande',         'Bande',            'Decoupe en bandes longitudinales (ex: cake tranche)',                                3, true),
  ('type_decoupe', 'triangle',      'Triangle',         'Decoupe en parts triangulaires (ex: tartes, entremets ronds)',                       4, true),
  ('type_decoupe', 'forme_libre',   'Forme libre',      'Decoupe a l''emporte-piece avec forme variable',                                     5, true)
ON CONFLICT DO NOTHING;
