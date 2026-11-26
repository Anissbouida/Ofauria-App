-- 729 — Compte de ventes par défaut livré par le profil (audit de cohérence des profils, lot L4).
--
-- Une ligne de facture client sans compte de famille (prestation, ligne libre, situation de
-- travaux, ordre de transport) était toujours passée en 7111 « Ventes de marchandises » : le CPC
-- et la liasse d'une entreprise de services étaient faux. La politique accounting.default_revenue
-- (catalogue des paramètres) vaut 7111 par défaut ; les profils la portent dans leurs couches :
--   prestations de services (7124) : BTP, services, transport ;
--   biens produits (7121) : industrie, textile, agriculture, agroalimentaire.
-- Boulangerie, restauration, commerce, négoce, santé, e-commerce, générique : 7111 inchangé.
-- La société reçoit la valeur à l'application de son profil (assistant ou Paramètres), et peut
-- la modifier.
--
-- Rollback : retirer l'entrée accounting.default_revenue de sector_packs.profile->'policies'.

CREATE OR REPLACE FUNCTION pg_temp.add_revenue_policy(p_codes text[], p_account text) RETURNS void LANGUAGE sql AS $$
  UPDATE sector_packs
     SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{policies}',
           COALESCE(profile->'policies', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('key', 'accounting.default_revenue', 'value', jsonb_build_object('account', p_account))))
   WHERE code = ANY(p_codes)
     AND NOT (COALESCE(profile->'policies', '[]'::jsonb) @> '[{"key": "accounting.default_revenue"}]'::jsonb);
$$;

SELECT pg_temp.add_revenue_policy('{btp,services,transport}', '7124');
SELECT pg_temp.add_revenue_policy('{fabrication,discret,process,atelier,textile,agriculture,agroalimentaire,agro_conditionne}', '7121');
