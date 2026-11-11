-- Phase 9.2 — Tableaux de bord et rapports proposés par secteur.
--
-- Chaque secteur peut ouvrir sur sa propre page d'accueil (home_route) et proposer ses
-- rapports (report_keys). La boulangerie garde le tableau de bord adaptatif (home_route
-- NULL) ; un secteur « Générique », sans production, ouvre ailleurs. Additif.
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS home_route VARCHAR(80);
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS report_keys TEXT[] NOT NULL DEFAULT '{}';

-- Le secteur générique (sans fabrication) ouvre sur les ventes et propose des rapports
-- transverses ; la boulangerie conserve son accueil adaptatif.
UPDATE sector_packs
   SET home_route = '/sales', report_keys = ARRAY['sales', 'margins', 'builder']
 WHERE code = 'generique' AND home_route IS NULL;
