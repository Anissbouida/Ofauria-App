-- Migration 259 : Report du reste de la veille (module Contrôle des ventes, ISOLE, TEMPORAIRE).
--
-- POURQUOI
--   La pâtisserie n'est pas jetée le soir : le reste de J-1 reste en vitrine et
--   se vend le lendemain. Or il n'entrait nulle part dans le calcul — il était
--   compté dans « Reste » le soir sans jamais avoir été compté dans « Reçu ».
--   Résultat : un faux surplus systématique (ex. PÂTISSERIE PREMIUM : reçu 75,
--   vendu 97, reste 31 → écart +53 alors que rien ne manquait).
--
-- MODELE
--   Equation de stock : Reste veille + Reçu = Vendu + Reste soir (+ écart).
--     Reste veille = stock d'ouverture, reporté automatiquement du reste soir de J-1 ;
--     Reste soir   = comptage physique de fin de journée (un seul chiffre, inchangé).
--   Ecart = Vendu + Reste soir − (Reçu + Reste veille).
--
--   report_veille_qty vaut 0 par défaut : les journées déjà saisies gardent
--   exactement l'écart qu'elles ont aujourd'hui.
--
--   Le report ne s'applique qu'aux catégories cochées (recon_carryover_categories) :
--   viennoiseries et baguettes sont jetées le soir, un report y créerait des
--   manques fictifs le lendemain.
--
-- DROP :
--   ALTER TABLE recon_lines DROP COLUMN IF EXISTS report_veille_qty;  -- recréer
--     ensuite ecart_qty / ecart_value avec la formule de la migration 257.
--   DROP TABLE IF EXISTS recon_carryover_categories;

-- 1. Catégories dont le reste se reporte sur le lendemain (éditable dans Paramètres)
CREATE TABLE IF NOT EXISTS recon_carryover_categories (
  category   VARCHAR(100) PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO recon_carryover_categories (category, enabled) VALUES
  ('PÂTISSERIE CLASSIQUE', true),
  ('PÂTISSERIE PREMIUM',   true)
ON CONFLICT (category) DO NOTHING;

-- 2. Stock d'ouverture reporté de J-1. Rempli par la synchro serveur à chaque
--    ouverture d'une journée non clôturée ; jamais saisi à la main.
ALTER TABLE recon_lines ADD COLUMN IF NOT EXISTS report_veille_qty NUMERIC(12,3) NOT NULL DEFAULT 0;

-- 3. L'écart intègre le stock d'ouverture. Les colonnes générées ne se modifient
--    pas en place : DROP puis re-ADD.
--
--    Le report n'entre dans l'écart qu'à partir du moment où la journée a été
--    touchée sur cette ligne (reçu, vendu ou reste saisi). Même principe que la
--    migration 257 : tant qu'il n'y a rien à rapprocher, l'écart reste à 0 au
--    lieu d'afficher un manque fictif de tout le stock d'ouverture pendant la
--    matinée. Ex. reporté 17, rien reçu / vendu / compté → écart 0 (et non −17).
ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_qty;
ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_value;

ALTER TABLE recon_lines ADD COLUMN ecart_qty NUMERIC(12,3) GENERATED ALWAYS AS (
  vendu_qty + invendu_qty - (recu_qty + CASE
    WHEN recu_qty > 0 OR vendu_qty > 0 OR invendu_qty > 0 THEN report_veille_qty
    ELSE 0 END)
) STORED;

ALTER TABLE recon_lines ADD COLUMN ecart_value NUMERIC(14,2) GENERATED ALWAYS AS (
  (vendu_qty + invendu_qty - (recu_qty + CASE
    WHEN recu_qty > 0 OR vendu_qty > 0 OR invendu_qty > 0 THEN report_veille_qty
    ELSE 0 END)) * unit_price
) STORED;
