-- 422 — Relevés de procédé par fournée (épic labo L2, partie 1 : socle)
--
-- POURQUOI
--   L'étape instanciée (production_item_etapes) porte la CONSIGNE copiée de la
--   fiche (temperature_c, humidite_pct — mig 342/419) mais aucune valeur MESURÉE.
--   Les relevés HACCP (mig 315) ne portent que sur les équipements (frigos, four,
--   vitrines), pas sur la fournée. Impossible donc de prouver la maîtrise du
--   procédé : température réelle de la pâte en fin de pétrissage, couple
--   temps/température de cuisson — ce sont les CCP (points critiques) du labo.
--
-- QUOI
--   Une table de relevés côté EXÉCUTION (là où la requête est utile), un relevé
--   par (étape, paramètre) : consigne + tolérance (reprises de la fiche à la
--   saisie), mesure, conformité calculée, drapeau CCP. Le blocage de clôture CCP
--   et l'action corrective arrivent en partie 2.
--
-- PARAMÈTRES : temp_pate | temp_four | duree_cuisson | temp_coeur | humidite | poids
--   (températures en °C, durée en min, poids en kg, humidité en %).
--
-- INVERSION : DROP TABLE production_step_readings;

CREATE TABLE IF NOT EXISTS production_step_readings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etape_id    UUID NOT NULL REFERENCES production_item_etapes(id) ON DELETE CASCADE,
  parametre   VARCHAR(20) NOT NULL
    CHECK (parametre IN ('temp_pate','temp_four','duree_cuisson','temp_coeur','humidite','poids')),
  consigne    NUMERIC(8,2),           -- cible, copiée de la fiche si disponible (NULL = libre)
  tolerance   NUMERIC(8,2)            -- ± ; de la fiche (NULL = pas de seuil → conforme NULL)
    CHECK (tolerance IS NULL OR tolerance >= 0),
  mesure      NUMERIC(8,2) NOT NULL,  -- valeur réellement relevée
  conforme    BOOLEAN,                -- calculé : |mesure - consigne| <= tolerance (NULL si pas de seuil)
  est_ccp     BOOLEAN NOT NULL DEFAULT false,  -- point critique (cuisson / refroidissement)
  note        TEXT,
  mesure_par  UUID REFERENCES users(id),
  mesure_a    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_readings_etape ON production_step_readings(etape_id);
CREATE INDEX IF NOT EXISTS idx_step_readings_ccp ON production_step_readings(est_ccp, conforme)
  WHERE est_ccp AND conforme IS NOT TRUE;

COMMENT ON TABLE production_step_readings IS
  'Relevés de procédé mesurés par fournée (épic labo L2, mig 422) : consigne/tolérance de la fiche, mesure réelle, conformité, CCP. Côté exécution (production_item_etapes).';
