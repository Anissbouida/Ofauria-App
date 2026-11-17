-- G5-04 (plan d'action 2026-11) — paramètres du calcul des besoins phasé.
--   horizon_days               : nombre de jours calculés (1 à 60) ;
--   product_lead_days          : délai de fabrication d'un produit fini (jours) ;
--   base_lead_days             : délai de fabrication d'une base / semi-fini ;
--   default_purchase_lead_days : délai d'achat quand la fiche article × fournisseur n'en a pas.
-- Le calcul lui-même (services/mrp-phased.ts) est en lecture seule ; aucune table.
--
-- INVERSION : DELETE FROM module_parameters WHERE key = 'production.mrp_phased';
INSERT INTO module_parameters (key, value, description)
VALUES ('production.mrp_phased', '{"horizon_days": 14, "product_lead_days": 0, "base_lead_days": 1, "default_purchase_lead_days": 2}'::jsonb,
        'Calcul des besoins phasé : horizon (jours), délais de fabrication des produits et des bases, délai d''achat par défaut')
ON CONFLICT (key) DO NOTHING;
