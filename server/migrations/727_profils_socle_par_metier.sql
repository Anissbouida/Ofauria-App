-- 727 — Le socle de capacités adapté à chaque métier (correctif de la mig 711).
--
-- CONSTAT (assistant de configuration, profil BTP) : le module Stock proposait gestion des
-- lots et dates limites (avec cadenas « réglementaire »), allergènes, étiquetage, quarantaine,
-- numéros de série… Ces capacités sont au socle (default_on, mig 632, pour ne rien changer à
-- Ofauria) et la mig 711 n'éteignait, pour BTP, transport et services, que trois options de
-- vente. Résultat : une entreprise de BTP héritait des exigences d'un métier de bouche.
--
-- CORRECTIF : chaque profil standard non alimentaire éteint par défaut ce qui ne le concerne
-- pas (sector_packs.off_features, lu par l'assistant et par le calcul des capacités). La
-- société peut toujours rallumer une capacité. Ajout seulement (valeurs déjà présentes
-- gardées), profils personnalisés non touchés. Inchangés : boulangerie, restauration,
-- agroalimentaire, agroalimentaire conditionné, générique.
--
-- Rollback : rétablir les off_features d'avant (711) pour les profils listés.

CREATE OR REPLACE FUNCTION pg_temp.off_add(p_code text, p_keys text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE sector_packs sp
     SET off_features = (SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}')
                           FROM unnest(sp.off_features || p_keys) k
                          -- jamais une capacité que le profil active lui-même
                          WHERE NOT (k = ANY(COALESCE(sp.features, '{}'))))
   WHERE sp.code = p_code AND COALESCE(sp.is_custom, false) = false;
$$;

-- Bâtiment et services : ni lots, ni dates limites, ni exigences alimentaires.
SELECT pg_temp.off_add('btp', '{allergenes,etiquetage,dlc_ddm,lots,series,tracabilite,quarantaine,rappel,controle_qualite,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,promotions_fidelite}');
SELECT pg_temp.off_add('services', '{allergenes,etiquetage,dlc_ddm,lots,series,tracabilite,quarantaine,rappel,controle_qualite,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,promotions_fidelite}');
-- Transport : les lots restent (stock des déposants), le reste du socle alimentaire s'éteint.
SELECT pg_temp.off_add('transport', '{allergenes,etiquetage,dlc_ddm,series,tracabilite,quarantaine,rappel,controle_qualite,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,promotions_fidelite}');
-- Commerce : revente sans fabrication ; lots, séries et rappel gardés.
SELECT pg_temp.off_add('commerce_detail', '{allergenes,etiquetage,dlc_ddm,quarantaine,controle_qualite,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,sous_traitance}');
SELECT pg_temp.off_add('ecommerce', '{allergenes,etiquetage,dlc_ddm,quarantaine,controle_qualite,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,sous_traitance}');
SELECT pg_temp.off_add('negoce', '{allergenes,etiquetage,pesage,releves_temperature,rendements_pertes,coproduits,semi_finis,promotions_fidelite}');
-- Industrie hors alimentaire : lots, séries, traçabilité et contrôle gardés.
SELECT pg_temp.off_add('textile', '{allergenes,etiquetage,dlc_ddm,quarantaine,pesage,releves_temperature,promotions_fidelite}');
SELECT pg_temp.off_add('atelier', '{allergenes,etiquetage,dlc_ddm,quarantaine,pesage,releves_temperature,coproduits,promotions_fidelite}');
SELECT pg_temp.off_add('discret', '{allergenes,etiquetage,dlc_ddm,pesage,releves_temperature,promotions_fidelite}');
SELECT pg_temp.off_add('fabrication', '{allergenes,etiquetage,dlc_ddm,pesage,releves_temperature,promotions_fidelite}');
-- Process (cosmétique, chimie) : dates limites, allergènes et étiquetage gardés (réglementaires).
SELECT pg_temp.off_add('process', '{series,promotions_fidelite}');
SELECT pg_temp.off_add('sante', '{allergenes,etiquetage,pesage,rendements_pertes,coproduits,semi_finis}');
SELECT pg_temp.off_add('agriculture', '{allergenes,etiquetage,series,promotions_fidelite}');
